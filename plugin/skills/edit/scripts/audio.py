#!/usr/bin/env python3
"""A video's sound, cleaned up like a studio's: the voice clear, the room quiet, the level right.

    python3 audio.py apply <edit_dir> [--force]   clean cut.mp4's voice when adjust.json "audio" is on (render.py calls it)
    python3 audio.py measure <video>               loudness (LUFS), true peak, noise floor in the pauses
    python3 audio.py demo                          self-check

adjust.json "audio": {"on": true, "echo": false, "breaths": false, "duck": true, "match": false, "ref": {...}}.
  on      studio sound: rumble off (high-pass 80 Hz), AI noise removal (DeepFilterNet, on this Mac: $MM_HOME/bin/deep-filter),
          a voice EQ (less mud, more presence and air), de-essing, gentle compression, then loudness to -14 LUFS under
          a -1 dBTP peak (two passes, so the level is exact and nothing is squashed)
  echo    room echo reduction: the noise removal at full strength with its post-filter, which takes the room's tail
  breaths breaths and mouth clicks softened: clicks repaired (adeclick), breaths between words (the cut's word times)
          10 dB down
  duck    the music dips under the voice (the edit's music bed: plan.py, StyleEdit)
  match   the voice EQ'd toward a reference creator's sound (the long-term spectrum of their cuts), at most +-4 dB a band

The cut's own voice is kept as cut.orig.m4a (the studio's A/B switch plays it) and the cleaned one as cut.clean.m4a;
cut.mp4 gets the cleaned voice muxed in, so the edit and every export carry it. A re-render of the cut (render.py)
writes the original again, and apply runs again; an unchanged cut and setting is not redone.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HOME = Path(os.environ.get("MM_HOME", Path.home() / ".motionmaxxing"))
SR = 48000
LUFS, TP, LRA = -14.0, -1.0, 11.0
ATTEN_DB, ATTEN_ECHO_DB = 30, 100   # how far the noise removal may go: natural, or all the way (with the post-filter)
BREATH_DB = -10.0
BREATH_MIN_S, BREATH_MAX_S = 0.18, 1.2   # a pause this long between words, with sound in it, is a breath
VOICE_EQ = "equalizer=f=300:t=q:w=1.2:g=-2.5,equalizer=f=3500:t=q:w=1.0:g=2,highshelf=f=10000:g=1.5"
BANDS = [(80, 160), (160, 315), (315, 630), (630, 1250), (1250, 2500), (2500, 5000), (5000, 10000), (10000, 16000)]


def deep_filter():
    p = HOME / "bin" / "deep-filter"
    return p if p.exists() else None


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        sys.exit(f"ERROR: {' '.join(map(str, cmd[:3]))}: {r.stderr.strip()[-400:]}")
    return r


def settings(edit):
    try:
        return json.loads((Path(edit) / "adjust.json").read_text(encoding="utf-8")).get("audio") or {}
    except (OSError, ValueError):
        return {}


def words(edit):
    """The cut's words on its own clock (cut.transcript.json), the spoken ones only."""
    for name in ("cut.transcript.json", "words.json"):
        try:
            ws = json.loads((Path(edit) / name).read_text(encoding="utf-8"))
            ws = ws.get("words", ws) if isinstance(ws, dict) else ws
            return [w for w in ws if w.get("type", "word") == "word" and "start" in w and "end" in w]
        except (OSError, ValueError):
            continue
    return []


def breath_ranges(ws, duration):
    """The pauses between words long enough to hold a breath (cut clock), a little inside the words' edges."""
    out = []
    for a, b in zip(ws, ws[1:]):
        s, e = a["end"] + 0.04, b["start"] - 0.04
        if BREATH_MIN_S <= e - s <= BREATH_MAX_S and 0 <= s < e <= duration:
            out.append((round(s, 3), round(e, 3)))
    return out


def breath_filter(ranges):
    """A volume step down inside each breath, eased so the room never pumps."""
    if not ranges:
        return ""
    k = 10 ** (BREATH_DB / 20)
    return ",".join(f"volume=enable='between(t,{s},{e})':volume={k:.3f}" for s, e in ranges)


def ltas(wav):
    """The long-term spectrum of a voice in BANDS (dB), from its loud parts only (speech, not the room)."""
    import numpy as np
    import wave
    w = wave.open(str(wav))
    a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    sr = w.getframerate()
    n = 4096
    frames = [a[i:i + n] for i in range(0, len(a) - n, n // 2)]
    if not frames:
        return None
    rms = np.array([np.sqrt(np.mean(f ** 2)) for f in frames])
    loud = [f for f, r in zip(frames, rms) if r > np.percentile(rms, 60)]
    win = np.hanning(n)
    spec = np.mean([np.abs(np.fft.rfft(f * win)) ** 2 for f in loud], axis=0)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    out = []
    for lo, hi in BANDS:
        m = (freqs >= lo) & (freqs < hi)
        out.append(float(10 * np.log10(spec[m].mean() + 1e-12)))
    mean = sum(out) / len(out)
    return [round(x - mean, 2) for x in out]   # the shape, not the level


def match_eq(src, ref, limit=4.0):
    """Equalizer bands taking the voice's spectrum shape toward the reference's, half the way, at most +-limit dB."""
    if not src or not ref:
        return ""
    parts = []
    for (lo, hi), s, r in zip(BANDS, src, ref):
        g = max(-limit, min(limit, (r - s) * 0.5))
        if abs(g) >= 0.5:
            f = (lo * hi) ** 0.5
            parts.append(f"equalizer=f={f:.0f}:t=o:w=1:g={g:.1f}")
    return ",".join(parts)


def ref_ltas(edit, ref):
    """The reference's voice spectrum: {"ltas": [...]} as given, or measured from a cut (an edit folder)."""
    if not ref:
        return None
    if ref.get("ltas"):
        return ref["ltas"]
    cut = Path(ref.get("edit", "")) / "cut.mp4"
    if not cut.exists():
        return None
    with tempfile.TemporaryDirectory() as t:
        w = Path(t) / "r.wav"
        run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-vn", "-ac", "1", "-ar", str(SR), "-t", "120", str(w)])
        return ltas(w)


def loudness(path, af=""):
    """(integrated LUFS, true peak dBTP, the loudnorm pass-1 numbers) of a file, after `af`."""
    chain = (af + "," if af else "") + f"loudnorm=I={LUFS}:TP={TP}:LRA={LRA}:print_format=json"
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", chain, "-f", "null", "-"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    if not m:
        sys.exit("ERROR: loudnorm printed no measurement")
    d = json.loads(m.group(0))
    return float(d["input_i"]), float(d["input_tp"]), d


def chain(s, edit, duration, src_ltas=None):
    """The filters after the noise removal, in order."""
    parts = []
    if s.get("breaths"):
        parts += ["adeclick=w=55:o=75"]
        bf = breath_filter(breath_ranges(words(edit), duration))
        if bf:
            parts.append(bf)
    eq = match_eq(src_ltas, ref_ltas(edit, s.get("ref"))) if s.get("match") and src_ltas else ""
    parts.append(eq or VOICE_EQ)
    parts += ["deesser=i=0.4:m=0.5:f=0.5:s=o", "acompressor=threshold=0.1:ratio=2.5:attack=8:release=160:makeup=1.4:knee=4"]
    return ",".join(parts)


def stamp(edit, s):
    """What the cleaned voice was made from: the cut's original voice and the settings."""
    orig = Path(edit) / "cut.orig.m4a"
    st = orig.stat() if orig.exists() else None
    key = json.dumps({k: s.get(k) for k in ("on", "echo", "breaths", "match", "ref")}, sort_keys=True)
    return hashlib.sha1(f"{st.st_size if st else 0}|{st.st_mtime_ns if st else 0}|{key}".encode()).hexdigest()[:16]


def original(edit):
    """cut.orig.m4a: the cut's own voice. A cut.mp4 newer than it (render.py wrote it again) is the new original."""
    d = Path(edit)
    cut, orig = d / "cut.mp4", d / "cut.orig.m4a"
    done = d / ".adjust" / "audio.json"
    try:
        last = json.loads(done.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        last = {}
    # cut.mp4 carries the cleaned voice once apply has run; it is the original only when it changed since
    fresh = not orig.exists() or (cut.stat().st_mtime_ns != last.get("cut_mtime_ns"))
    if fresh:
        run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-vn", "-c:a", "copy", str(orig)])
    return orig


def apply(edit, force=False):
    """Clean the cut's voice per adjust.json "audio" (or put the original back when it is off). -> what was done."""
    d = Path(edit)
    cut = d / "cut.mp4"
    if not cut.exists():
        return "no cut yet"
    s = settings(d)
    done = d / ".adjust" / "audio.json"
    done.parent.mkdir(exist_ok=True)
    orig = original(d)
    if not s.get("on"):
        try:
            last = json.loads(done.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            last = {}
        if last.get("clean"):   # it was cleaned before: the original goes back in
            mux(cut, orig)
            done.write_text(json.dumps({"clean": False, "cut_mtime_ns": cut.stat().st_mtime_ns}), encoding="utf-8")
            return "the original sound is back"
        return "off"
    key = stamp(d, s)
    try:
        last = json.loads(done.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        last = {}
    if not force and last.get("clean") and last.get("key") == key and last.get("cut_mtime_ns") == cut.stat().st_mtime_ns:
        return "already clean"
    df = deep_filter()
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        raw = t / "voice.wav"
        run(["ffmpeg", "-v", "error", "-y", "-i", str(orig), "-af", "highpass=f=80", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", str(raw)])
        dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw)]).stdout.strip() or 0)
        den = raw
        if df:
            out = t / "df"
            echo = bool(s.get("echo"))
            run([str(df), "-D", "-a", str(ATTEN_ECHO_DB if echo else ATTEN_DB), *(["--pf"] if echo else []), "-o", str(out), str(raw)])
            den = out / raw.name
        else:   # no DeepFilterNet on this Mac yet (the setup page installs it): FFmpeg's own, gentler noise removal
            den = t / "afftdn.wav"
            run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", "afftdn=nr=10:nf=-45:tn=1", str(den)])
        src = ltas(den) if s.get("match") else None
        af = chain(s, d, dur, src)
        _, _, m = loudness(den, af)
        norm = (f"loudnorm=I={LUFS}:TP={TP}:LRA={LRA}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        clean = d / "cut.clean.m4a"
        run(["ffmpeg", "-v", "error", "-y", "-i", str(den), "-af", f"{af},{norm},aresample={SR}", "-ac", "2",
             "-c:a", "aac", "-b:a", "192k", str(clean)])
    mux(cut, clean)
    lufs, tp, _ = loudness(clean)
    o_lufs, o_tp, _ = loudness(orig)   # the studio's A/B readout: the original's level beside the clean one
    done.write_text(json.dumps({"clean": True, "key": key, "cut_mtime_ns": cut.stat().st_mtime_ns, "lufs": lufs, "tp": tp,
                                "orig_lufs": o_lufs, "orig_tp": o_tp,
                                "noise_removal": "deepfilternet" if df else "afftdn"}), encoding="utf-8")
    return f"studio sound: {lufs:.1f} LUFS, peak {tp:.1f} dBTP" + ("" if df else " (FFmpeg noise removal: DeepFilterNet not installed)")


def mux(cut, audio):
    """cut.mp4 with this audio in place of its own, the video untouched (stream copy)."""
    tmp = cut.with_name(f".{cut.stem}.{os.getpid()}.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-i", str(audio), "-map", "0:v", "-map", "1:a", "-c", "copy",
         "-shortest", "-movflags", "+faststart", str(tmp)])
    os.replace(tmp, cut)   # a new time: the edit's footage copy (edit.py) is made again and carries the new voice


def measure(video):
    lufs, tp, _ = loudness(video)
    return {"lufs": lufs, "true_peak": tp}


def demo():
    # breaths: only pauses that can hold one
    ws = [{"text": "a", "start": 0.0, "end": 0.5}, {"text": "b", "start": 0.6, "end": 1.0}, {"text": "c", "start": 1.4, "end": 2.0},
          {"text": "d", "start": 4.0, "end": 4.5}]
    assert breath_ranges(ws, 5) == [(1.04, 1.36)], breath_ranges(ws, 5)
    assert "volume=enable='between(t,1.04,1.36)'" in breath_filter([(1.04, 1.36)])
    # matching: half the way, clamped, quiet bands left alone
    eq = match_eq([0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 3, 12, 0, 0.6])
    assert "g=1.5" in eq and "g=4.0" in eq and eq.count("equalizer") == 2, eq
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        os.environ.setdefault("MM_HOME", str(HOME))
        # a talking-head stand-in: a tone with pauses and noise, under a black picture
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=6:r=10",
             "-f", "lavfi", "-i", "sine=f=220:d=6:sample_rate=48000,volume=0.3,aeval='val(0)*gt(sin(2*PI*t*0.5),0)'",
             "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:a=0.02:r=48000", "-filter_complex", "[1][2]amix=inputs=2:normalize=0[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(t / "cut.mp4")])
        (t / "cut.transcript.json").write_text(json.dumps(ws))
        (t / "adjust.json").write_text(json.dumps({"audio": {"on": True, "breaths": True}}))
        msg = apply(t)
        assert msg.startswith("studio sound"), msg
        assert (t / "cut.orig.m4a").exists() and (t / "cut.clean.m4a").exists()
        lufs = measure(t / "cut.clean.m4a")["lufs"]
        assert abs(lufs - LUFS) < 2.5, lufs   # a gated tone, half of it in "breaths": real speech lands within 0.5
        assert apply(t) == "already clean"
        (t / "adjust.json").write_text(json.dumps({"audio": {"on": False}}))
        assert apply(t) == "the original sound is back"
    print("audio demo ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["apply", "measure", "demo"])
    ap.add_argument("target", nargs="?")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.cmd == "demo":
        return demo()
    if a.cmd == "measure":
        print(json.dumps(measure(a.target)))
        return
    print(apply(a.target, a.force))


if __name__ == "__main__":
    main()
