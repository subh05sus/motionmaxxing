#!/usr/bin/env python3
"""Which clips dropped on New video are takes of the talk and which are b-roll, so every clip can go in at once.

    python3 footage.py classify <file> [<file> ...]   one JSON line per file, in the order given
    python3 footage.py demo                            self-check (makes test clips with ffmpeg)

A take is the speaker at the camera: speech through it and a face in the picture, or their face close to the lens
with nothing said (a pause or a look the script asks for, "(silence)": the cut drops it as dead air unless it belongs).
Everything else is b-roll: no sound or no speech with no close face (a street, a product, a screen, the speaker typing
across the room), or speech with no face (a voice-over, a screen being talked over: the studio says so, and one click
makes it a take). Speech: Silero's voice detector (whisper.cpp's
whisper-vad-speech-segments, the model setup installs) on up to LISTEN_S from the middle of the clip; SPEECH_SHARE of
it or more is speech (talk measured 0.85, a tone 0). Without the detector, Whisper hears it instead (SPEECH_WPS words a
second, never the words it writes for a quiet room or music: "Thank you.", "Untertitel...", "[Musik]"); Whisper loads
1.6 GB each run (9 s), the detector takes 2 s. A face: YuNet (face.py) on FACE_FRAMES frames across the clip, at
least FACE_MIN_W of the frame wide, in FACE_SHARE of them.

Each line: {"path", "kind": "take" | "broll", "why", "duration", "speech": the share of the window that is speech
(null: not heard), "face": the share of frames with a face (null: not looked), "created": the recording time or
null}. A clip that cannot be checked (no model yet, a file ffmpeg cannot read) is a take, "why" says so: never b-roll
by accident. The order of takes is the studio's: by "created", else by name.
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "edit" / "scripts"))
sys.path.insert(0, str(HERE.parents[2] / "lib"))

LISTEN_S = 30.0
SPEECH_SHARE = 0.15     # of the window the voice detector calls speech: takes measured 0.34-0.85 (a slow line with
#                         pauses 0.34), a tone and a silent take 0
SPEECH_WPS = 1.0        # Whisper's fallback: talk runs at 2-3 words a second, its words for a quiet stretch under one
SILENT_DB = -55.0       # a mean volume under this: no sound to hear
FACE_FRAMES = 6
FACE_SHARE = 0.5
FACE_MIN_W = 0.04       # of the frame's width: a face in a crowd shot or on a far screen is not the speaker
FACE_CLOSE_W = 0.15     # a face this wide (the median of the frames) is someone at the lens: a selfie take measured 0.4
# Whisper's words for no speech: thanks for watching, subtitle credits, music and noise in brackets
NOT_SPEECH = re.compile(r"^(?:thank|thanks|you|for|watching|untertitel|amara|org|community|subscribe|bye|music|musik|"
                        r"applause|ok|okay|hmm|mm|uh|um)$|[\[\]()♪*]", re.I)


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                       capture_output=True, text=True)
    try:
        return json.loads(r.stdout or "{}")
    except ValueError:
        return {}


def created(info):
    """The recording time from the file's tags (an iPhone's creationdate first: it keeps the time zone)."""
    tags = (info.get("format") or {}).get("tags") or {}
    for k in ("com.apple.quicktime.creationdate", "creation_time"):
        if tags.get(k):
            return tags[k]
    for s in info.get("streams") or []:
        if (s.get("tags") or {}).get("creation_time"):
            return s["tags"]["creation_time"]
    return None


def mean_db(path, start, length):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(path),
                        "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"mean_volume:\s*(-?[\d.]+|-inf) dB", r.stderr)
    return float(m.group(1)) if m and m.group(1) != "-inf" else -120.0


def window(duration):
    """(start, length): up to LISTEN_S from the middle of the clip."""
    length = min(LISTEN_S, duration)
    return max(0.0, (duration - length) / 2), length


def vad():
    """(whisper-vad-speech-segments, the Silero model) when both are here, else None."""
    from mm import models
    tool = shutil.which("whisper-vad-speech-segments")
    model = models.DIR / models.WHISPER_CPP.get("silero", "ggml-silero-v5.1.2.bin")
    return (tool, model) if tool and model.exists() else None


def speech_shares(clips, found):
    """{path: the share of its window that is speech}, from the voice detector."""
    tool, model = found
    out = {}
    with tempfile.TemporaryDirectory() as t:
        for i, (path, start, length) in enumerate(clips):
            w = Path(t) / f"{i}.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(path),
                            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(w)], check=True)
            r = subprocess.run([tool, "-vm", str(model), "-f", str(w)], capture_output=True, text=True)
            # "Speech segment 0: start = 0.00, end = 541.00" in hundredths of a second
            said = sum(float(b) - float(a) for a, b in re.findall(r"Speech segment \d+: start = ([\d.]+), end = ([\d.]+)", r.stdout))
            out[str(path)] = round(min(1.0, said / 100 / max(length, 0.1)), 2)
    return out


def speech_rates(clips):
    """{path: words a second} for clips with sound, from one whisper-cli run (the model loads once)."""
    import transcribe as T
    if not clips:
        return {}
    out = {}
    with tempfile.TemporaryDirectory() as t:
        wavs = []
        for i, (path, start, length) in enumerate(clips):
            w = Path(t) / f"{i}.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(path),
                            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(w)], check=True)
            wavs.append(w)
        for (path, _, length), payload in zip(clips, T.cpp_files(wavs, "auto", "")):
            words = [w for w in T.cpp_words(payload) if w.get("type", "word") == "word"]
            said = [w for w in words if re.search(r"\w", w["text"]) and not NOT_SPEECH.search(
                re.sub(r"[.,!?;:\"'’]+", "", w["text"]).strip())]
            out[str(path)] = round(len(said) / max(length, 1.0), 2)
    return out


def face_share(path, duration, vw, vh):
    """(the share of FACE_FRAMES frames across the clip with a face at least FACE_MIN_W of the frame wide, the median
    width of the largest face in those frames as a share of the frame's width)."""
    import numpy as np
    import face
    sw = 360
    sh = max(2, round(sw * vh / vw / 2) * 2)
    det, hits, n, widths = None, 0, 0, []
    for i in range(FACE_FRAMES):
        t = duration * (i + 0.5) / FACE_FRAMES
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1",
                            "-vf", f"scale={sw}:{sh}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True)
        if len(r.stdout) < sw * sh * 3:
            continue
        im = np.frombuffer(r.stdout[:sw * sh * 3], np.uint8).reshape(sh, sw, 3)
        det = det or face.detector(sw, sh)
        _, faces = det.detect(im)
        n += 1
        big = float(max((f[2] for f in faces), default=0)) if faces is not None else 0.0   # numpy's float32: no JSON
        hits += big >= FACE_MIN_W * sw
        if big >= FACE_MIN_W * sw:
            widths.append(big / sw)
    return (round(hits / n, 2) if n else None), (round(sorted(widths)[len(widths) // 2], 2) if widths else 0.0)


def decide(has_audio, db, speech, face, enough=SPEECH_SHARE, size=0.0):
    """(kind, why) from what was measured: None is "not measured". speech: a share (the detector) or words a second
    (Whisper), with enough its threshold; size: how wide the face is (face_share)."""
    silent = not has_audio or (db is not None and db < SILENT_DB)
    if silent or (speech is not None and speech < enough):
        if face is not None and face >= FACE_SHARE and size >= FACE_CLOSE_W:
            return "take", "you at the camera, not talking: a pause or a look (b-roll if it is not part of the talk)"
        return "broll", "no sound" if silent else "no speech in it"
    if face is not None and face < FACE_SHARE:
        return "broll", "speech but no face: a voice-over or a screen being talked over? Make it a take if it is part of the talk"
    if speech is None or face is None:
        return "take", "could not check it: kept as a take"
    return "take", "talking to the camera"


def classify(paths):
    rows, listen = [], []
    for p in map(Path, paths):
        info = probe(p)
        streams = info.get("streams") or []
        v = next((s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
        a = next((s for s in streams if s.get("codec_type") == "audio"), None)
        try:
            dur = float((info.get("format") or {}).get("duration") or 0)
        except ValueError:
            dur = 0.0
        row = {"path": str(p), "duration": round(dur, 2), "created": created(info), "speech": None, "face": None,
               "audio": a is not None, "db": None}
        if v is None or dur <= 0:
            row.update(kind="take", why="could not read it: kept as a take")
            rows.append(row)
            continue
        rot = abs(int(((v.get("side_data_list") or [{}])[0] or {}).get("rotation", 0) or 0))
        vw, vh = (v["height"], v["width"]) if rot in (90, 270) else (v["width"], v["height"])
        start, length = window(dur)
        if a is not None:
            row["db"] = mean_db(p, start, length)
            if row["db"] >= SILENT_DB:
                listen.append((p, start, length))
        try:
            row["face"], row["face_w"] = face_share(p, dur, vw, vh)
        except Exception as e:   # noqa: BLE001  no face model yet (setup not finished): the speech decides
            row["face_error"] = str(e)[:120]
        rows.append(row)
    found, enough = vad(), SPEECH_SHARE
    try:
        rates = speech_shares(listen, found) if found and listen else {}
        if listen and not found:
            rates, enough = speech_rates(listen), SPEECH_WPS
    except (SystemExit, Exception) as e:   # noqa: BLE001  no model yet: never b-roll by accident
        rates = {}
        for r in rows:
            r["speech_error"] = str(e)[:120]
    for r in rows:
        if "kind" in r:
            continue
        heard = r["path"] in rates
        r["speech"] = rates.get(r["path"]) if heard else (0.0 if not r["audio"] or (r["db"] or -120) < SILENT_DB else None)
        r["kind"], r["why"] = decide(r["audio"], r["db"], r["speech"], r["face"], enough, r.get("face_w") or 0.0)
    return rows


def demo():
    assert decide(False, None, None, None)[0] == "broll"                  # a silent screen recording
    assert decide(True, -70.0, None, 1.0, size=0.08)[0] == "broll"        # a small face, no sound: the speaker across the room
    assert decide(True, -20.0, 0.05, 1.0, size=0.1) == ("broll", "no speech in it")   # music, the speaker walking by
    assert decide(True, -20.0, 0.0, 1.0, size=0.42)[0] == "take"          # at the lens, silent: the script's "(silence)"
    assert decide(True, -20.0, 0.85, 0.0)[0] == "broll"                   # a voice-over
    assert decide(True, -20.0, 0.34, 1.0, size=0.4) == ("take", "talking to the camera")   # a slow line with pauses
    assert decide(True, -20.0, 0.85, 0.83) == ("take", "talking to the camera")
    assert decide(True, -20.0, 2.4, 0.83, SPEECH_WPS)[0] == "take" and decide(True, -20.0, 0.5, 1.0, SPEECH_WPS)[0] == "broll"
    assert decide(True, -20.0, None, 0.9)[0] == "take" and decide(True, -20.0, 0.8, None)[0] == "take"   # unchecked: a take
    assert NOT_SPEECH.search("Untertitel") and NOT_SPEECH.search("[Musik]") and not NOT_SPEECH.search("Claude")
    assert window(100.0) == (35.0, 30.0) and window(12.0) == (0.0, 12.0)
    with tempfile.TemporaryDirectory() as t:
        quiet, tone = Path(t) / "screen.mp4", Path(t) / "tone.mov"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x568:rate=30:duration=3",
                        "-pix_fmt", "yuv420p", str(quiet)], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=568x320:rate=30:duration=3",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-pix_fmt", "yuv420p",
                        "-metadata", "creation_time=2026-10-23T09:00:00Z", str(tone)], check=True)
        a, b = classify([quiet, tone])
        assert a["kind"] == "broll" and a["why"] == "no sound" and not a["audio"], a
        assert b["kind"] == "broll" and b["created"].startswith("2026-10-23") and b["face"] == 0.0, b
    print("footage demo ok")


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    if len(a) < 2 or a[0] != "classify":
        sys.exit(__doc__)
    for row in classify(a[1:]):
        print(json.dumps(row, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
