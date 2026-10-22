#!/usr/bin/env python3
"""Hear the edges of every kept piece again, one stretch of speech at a time, and cut the half word, false start or
breath the transcript hid.

    python3 rehear.py <edit_dir> [--fix]
    python3 rehear.py demo          self-check (made-up levels and hearings, no audio)

Run it with the venv python, after build_timeline.py and before render.py.

Why: Whisper times words worst where a line is started again. On one take a restarted line was labelled a second
early and "So... so you have" came out as one "so you have", so cuts quoted from the words began inside the take
before: "From then on it lear- | From then on it learns from every chat", "-teach | Step 3", a breath before "And
then". A transcript of the cut passes all of them (the second hearing writes the restart once too). The audio does not:

1. The take is split into runs: 20 ms windows of the speech band (250-4000 Hz) over its silence threshold (the
   take's 10th percentile + 12 dB), a one-window gap closed. A stretch of a run BREATH_MIN_S or longer that stays
   LOW_DB under the take's loud speech (its 95th percentile) is a breath (or a pause with room noise): it splits
   the run. A stop consonant's closure is shorter, so a word is never split.
2. The speech at each kept piece's edges (its first and last REACH_S) is heard alone by whisper.cpp, each stretch
   clipped to the piece and padded with silence.
3. A piece's head loses everything before its first stretch that is the line:
   - the part of a stretch the piece starts inside (the end of the take before), under PARTIAL_MAX_S, unless it is
     heard as the piece's first word;
   - a breath, and a stretch heard as no words, a sound ("* Musik *") or one of Whisper's phrases for noise
     ("Vielen Dank."), under NOISE_MAX_S;
   - a stretch that starts the way the next one starts (a false start: "From then on it lear..." then "From then on it
     learns from...").
   Its tail loses the same after its last stretch that is the line. Across a join, a piece whose last stretch is the
   start of the next piece's first (the line said twice over the join) loses that stretch, or all of itself.
   Pieces that are one take with a pause trimmed between them (closer than TRIM_JOIN_S in the take) keep the speech
   at that join: it is the same sentence.
4. --fix rewrites decisions.json, report.json, words.json, paper-edit.md and cut-check.html (as splice_check.py does).
   rehear.json keeps what was heard and what was cut. Render again after a fix; a rebuild drops the fixes, so run
   this again after every build.
Exit codes: 0 nothing to cut (or all cut with --fix), 1 cuts found (without --fix), 2 usage
"""
import difflib
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_timeline as B  # noqa: E402

RMS_S = 0.02
BAND = (250, 4000)          # the speech band: hum under it and hiss over it make no run
OVER_FLOOR_DB = 12.0        # a window is a run this far over the take's 10th percentile
LOW_DB = 22.0               # ...and a breath (or a pause over room noise) this far under its loud speech
BREATH_MIN_S = 0.12         # a low stretch this long splits a run (a stop consonant's closure is shorter)
REACH_S = 1.6               # how far into a piece from each edge its speech is heard
PARTIAL_MAX_S = 1.0         # the part of a stretch a piece starts (or ends) inside is cut when shorter than this
NOISE_MAX_S = 0.5           # a stretch heard as no words is cut when shorter than this
CLICK_S = 0.08              # a stretch this short is never a word: not heard, cut at an edge
PAD_BEFORE_S = 0.06         # left before the line's first stretch (a soft onset starts under the breath line)
PAD_AFTER_S = 0.06          # left after its last stretch (the release)
RESTART_GAP_S = 1.2         # a false start is said again within this
TRIM_JOIN_S = 0.6           # pieces this close in the take are one take with a pause trimmed
HEAR_PAD_S = 0.25           # silence around a stretch when it is heard, so its first and last sound are not lost
NOISE_TEXT = {"vielen dank", "danke", "danke schön", "untertitel", "untertitel im auftrag des zdf", "amen", "tschüss",
              "musik", "applaus", "lachen", "thank you", "thanks for watching", "you", "bye", "music", "the end"}


def norm_words(text):
    """'From then on it lear...' -> ['from', 'then', 'on', 'it', 'lear']; a bracketed or starred sound -> []."""
    t = text.strip()
    if re.fullmatch(r"[\[(*].*[\])*]", t):
        return []
    return [w for w in re.sub(r"[^\w\s'-]", " ", t.lower()).split() if any(c.isalnum() for c in w)]


def is_noise(text, dur):
    """Heard as nothing a person said: no words, a sound, or one of Whisper's phrases for noise, and short."""
    if dur <= CLICK_S:
        return True
    w = norm_words(text)
    return dur < NOISE_MAX_S and (not w or " ".join(w) in NOISE_TEXT)


NUMBERS = {w: str(n) for n, ws in enumerate((
    "null zero", "eins ein eine one", "zwei two", "drei three", "vier four", "fünf five", "sechs six", "sieben seven",
    "acht eight", "neun nine", "zehn ten", "elf eleven", "zwölf twelve")) for w in ws.split()}


def sim(a, b):
    """How alike two heard words are; a digit and its word are the same ("1" and "eins": one hearing writes digits)."""
    if NUMBERS.get(a, a) == NUMBERS.get(b, b):
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def starts_like(x, y, x_dur, y_dur, one_max=0.7):
    """Stretch x (words, seconds) is a false start of stretch y: it begins the way y begins and stops short. Its last
    word may be cut off ("lear" for "learns", "assi" for "assistant"); one word only counts when it is short (a lone
    "So" before "So you have"), one_max at most."""
    if not x or not y or len(x) > len(y) or x_dur >= y_dur:
        return False
    if len(x) == 1 and x_dur > one_max:
        return False
    if sim(x[0], y[0]) < 0.75:
        return False
    for k in range(1, len(x)):
        last = k == len(x) - 1
        if not (sim(x[k], y[k]) >= 0.6 or (last and len(x[k]) >= 3 and y[k].startswith(x[k][:3]))):
            return False
    return True


def stretches(lvl, thr, low):
    """[(start, end, "speech" | "breath")] over the take: runs over thr (a one-window gap closed), each split where it
    stays under low for BREATH_MIN_S or longer."""
    runs, s = [], None
    for i, v in enumerate(lvl):
        if v > thr and s is None:
            s = i
        elif v <= thr and s is not None:
            runs.append([s, i])
            s = None
    if s is not None:
        runs.append([s, len(lvl)])
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] <= 1:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    need = round(BREATH_MIN_S / RMS_S)
    out = []
    for a, b in merged:
        segs = []
        for i in range(a, b):
            q = lvl[i] < low
            if segs and segs[-1][2] == q:
                segs[-1][1] = i + 1
            else:
                segs.append([i, i + 1, q])
        for sg in segs:                      # a short dip belongs to the speech around it
            if sg[2] and sg[1] - sg[0] < need:
                sg[2] = False
        joined = []
        for sg in segs:
            if joined and joined[-1][2] == sg[2]:
                joined[-1][1] = sg[1]
            else:
                joined.append(list(sg))
        out += [(round(x * RMS_S, 3), round(y * RMS_S, 3), "breath" if q else "speech") for x, y, q in joined
                if (y - x) * RMS_S >= 0.04]
    return out


def band_levels(src):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-af",
                          f"highpass=f={BAND[0]},lowpass=f={BAND[1]}", "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    n = int(16000 * RMS_S)
    m = (x[: len(x) // n * n].reshape(-1, n) ** 2).mean(1)
    lvl = 10 * np.log10(np.maximum(m, 1e-12))
    return lvl.tolist(), float(np.percentile(lvl, 10)), float(np.percentile(lvl, 95))


def edge_units(piece, units):
    """The stretches inside a kept piece, clipped to it: (a, b, part, kind). part says the stretch went on past the
    piece's edge: "head" (it began before the piece), "tail" (it ends after it), "both" or ""."""
    s, e = piece
    out = []
    for a, b, kind in units:
        if b <= s or a >= e:
            continue
        early, late = a < s - 0.06, b > e + 0.06
        part = "both" if early and late else "head" if early else "tail" if late else ""
        out.append((max(a, s), min(b, e), part, kind))
    return out


ADJ_S = 0.12                # a click this close to the line is its first or last sound (a plosive's burst, a release)
TAIL_BREATH_S = 0.2         # a breath after a piece's last word goes only when it is an inhale this long


def head_line(units, heard, first_word):
    """Index of the first stretch that is the line, and {index: why} for the ones before it that go. Clicks right
    before the line are its first sound and stay."""
    why = {}
    for k, (a, b, part, kind) in enumerate(units):
        text = heard.get((a, b), "")
        w = norm_words(text)
        if b - a <= CLICK_S:
            why[k] = "a click"
            continue
        if kind == "breath":
            why[k] = "a breath"
            continue
        if k == 0 and part in ("head", "both") and b - a < PARTIAL_MAX_S and not (
                w and first_word and sim(w[0], first_word) >= 0.75):
            why[k] = f"the end of the take before ({text.strip() or 'no words'!r})"
            continue
        if is_noise(text, b - a):
            why[k] = f"a sound, no words ({text.strip() or 'nothing'!r})"
            continue
        one = PARTIAL_MAX_S if k == 0 and part in ("head", "both") else 0.7   # a stretch the piece starts inside has junk before its word
        nxt = next((v for v in units[k + 1:] if v[3] == "speech" and v[1] - v[0] > CLICK_S), None)
        if nxt and nxt[0] - b < RESTART_GAP_S and starts_like(w, norm_words(heard.get((nxt[0], nxt[1]), "")), b - a,
                                                               nxt[1] - nxt[0], one):
            why[k] = f"a false start ({text.strip()!r}, then {heard.get((nxt[0], nxt[1]), '').strip()!r})"
            continue
        j = k
        while j > 0 and units[j - 1][1] - units[j - 1][0] <= CLICK_S and units[j][0] - units[j - 1][1] <= ADJ_S:
            j -= 1
            why.pop(j, None)
        return j, why
    return None, why


def tail_line(units, heard):
    """Index of the last stretch that is the line, and {index: why} for the ones after it that go: a long breath, a
    stretch heard as noise, a click apart from the line. Never a stretch the piece ends inside: heard alone, the end
    of its own last word ("-App" of "WhatsApp") comes back as anything."""
    why = {}
    for k in range(len(units) - 1, -1, -1):
        a, b, part, kind = units[k]
        if b - a <= CLICK_S:
            why[k] = "a click"
            continue
        if kind == "breath" and (b - a >= TAIL_BREATH_S or k < len(units) - 1):
            why[k] = "a breath"
            continue
        if kind == "speech" and not part and is_noise(heard.get((a, b), ""), b - a):
            why[k] = f"a sound, no words ({heard.get((a, b), '').strip() or 'nothing'!r})"
            continue
        j = k
        while j < len(units) - 1 and units[j + 1][1] - units[j + 1][0] <= CLICK_S and units[j + 1][0] - units[j][1] <= ADJ_S:
            j += 1
            why.pop(j, None)
        return j, why
    return None, why


def plan(pieces, units, heard, firsts, lasts):
    """New (start, end) per piece (None: the piece goes) and the cuts with their reasons. Pure: no audio."""
    units = [list(us) for us in units]
    for i, (s, e) in enumerate(pieces):
        # a pause trimmed inside one take leaves pieces whose edges are inside the same speech: not the take before
        if i > 0 and 0 <= s - pieces[i - 1][1] < TRIM_JOIN_S and units[i]:
            a, b, part, kind = units[i][0]
            units[i][0] = (a, b, {"head": "", "both": "tail"}.get(part, part), kind)
        if i < len(pieces) - 1 and 0 <= pieces[i + 1][0] - e < TRIM_JOIN_S and units[i]:
            a, b, part, kind = units[i][-1]
            units[i][-1] = (a, b, {"tail": "", "both": "head"}.get(part, part), kind)
    fragment = lambda u: u[3] == "speech" and u[1] - u[0] > CLICK_S   # never keep any of a cut stretch's sound
    new, cuts, lines = [], [], []
    for i, (s, e) in enumerate(pieces):
        us = units[i]
        lines.append(None)
        if not us:
            new.append((s, e))
            continue
        h, why_h = head_line(us, heard, firsts[i])
        if h is None:
            new.append(None)
            cuts.append({"start": round(s, 3), "end": round(e, 3), "why": "no line in it: " + "; ".join(why_h.values())})
            continue
        ns = s
        if h > 0 or us[0][2] in ("head", "both"):
            ns = max(s, us[h][0] - PAD_BEFORE_S)
            if h > 0 and fragment(us[h - 1]):
                ns = max(ns, us[h - 1][1] + 0.01)
        t, why_t = tail_line(us[h:], heard)
        t = h + (t if t is not None else 0)
        ne = e
        if i == len(pieces) - 1:      # the video's last piece rings out: only speech that is not the line goes
            while t < len(us) - 1 and not fragment(us[t + 1]):
                t += 1
        if t < len(us) - 1:
            ne = min(e, us[t][1] + PAD_AFTER_S)
            if fragment(us[t + 1]):
                ne = min(ne, us[t + 1][0] - 0.01)
        lines[i] = (us[h], us[t])
        if ns > s + 0.005:
            cuts.append({"start": round(s, 3), "end": round(ns, 3), "why": "; ".join(why_h.values())})
        if ne < e - 0.005:
            cuts.append({"start": round(ne, 3), "end": round(e, 3), "why": "; ".join(why_t.values())})
        new.append((ns, ne))
    # across each join: the line said twice (the left piece's last stretch starts the way the right one's first does)
    for i in range(len(pieces) - 1):
        if new[i] is None or new[i + 1] is None:
            continue
        inside = lambda u, n: n[0] - 0.01 <= u[0] and u[1] <= n[1] + 0.01 and fragment(u)
        left = [u for u in units[i] if inside(u, new[i])]
        right = [u for u in units[i + 1] if inside(u, new[i + 1])]
        if not left or not right:
            continue
        L, R = left[-1], right[0]
        if starts_like(norm_words(heard.get((L[0], L[1]), "")), norm_words(heard.get((R[0], R[1]), "")),
                       L[1] - L[0], R[1] - R[0]):
            why = (f"said twice over the join: {heard.get((L[0], L[1]), '').strip()!r}, "
                   f"then {heard.get((R[0], R[1]), '').strip()!r}")
            if len(left) == 1:
                cuts.append({"start": round(new[i][0], 3), "end": round(new[i][1], 3), "why": why})
                new[i], lines[i] = None, None
            else:
                ne = left[-2][1] + PAD_AFTER_S
                cuts.append({"start": round(ne, 3), "end": round(new[i][1], 3), "why": why})
                new[i], lines[i] = (new[i][0], ne), (lines[i][0], left[-2])
    return new, cuts, lines


def relabel(raw, spans, heads, tails, step=0.04):
    """The raw words with the ones the transcript labelled just outside a kept piece, that were heard as its line's
    first (or last) words, moved inside it. Without this the line's "So" (labelled 0.1 s before the breath that was
    cut) is missing from words.json, and the captions, which pair the cut's own hearing with words.json, lose it.
    heads[i] / tails[i]: the heard words of span i's first / last line stretch (or [])."""
    from build_timeline import is_kept
    out = [dict(w) for w in raw]
    words = [k for k, w in enumerate(out) if w.get("type", "word") == "word"]
    for i, sp in enumerate(spans):
        inside = [k for k in words if is_kept(out[k], [sp])]
        if not inside:
            continue
        for side, heardw in (("head", heads[i]), ("tail", tails[i])):
            edge = inside[0] if side == "head" else inside[-1]
            seq = heardw if side == "head" else heardw[::-1]
            k = next((j for j, h in enumerate(seq[:6]) if sim(h, (norm_words(out[edge]["text"]) or [""])[0 if side == "head" else -1]) >= 0.75), 0)
            pos = words.index(edge)
            near = words[pos - 1::-1][:k] if side == "head" else words[pos + 1:pos + 1 + k]
            take = []
            for m, j in enumerate(near):      # the words next to the edge, in the order they were heard
                if sim((norm_words(out[j]["text"]) or [""])[-1 if side == "head" else 0], seq[k - 1 - m]) < 0.6:
                    break
                take.append(j)
            if not take:
                continue
            if side == "head":
                take.reverse()
                for n, j in enumerate(take):
                    out[j]["start"], out[j]["end"] = round(sp["start"] + n * step, 3), round(sp["start"] + (n + 1) * step, 3)
                out[edge]["start"] = max(out[edge]["start"], round(sp["start"] + len(take) * step, 3))
            else:
                for n, j in enumerate(take):
                    out[j]["start"] = round(sp["end"] - (len(take) - n) * step, 3)
                    out[j]["end"] = round(out[j]["start"] + step, 3)
                out[edge]["end"] = min(out[edge]["end"], round(sp["end"] - len(take) * step, 3))
    return out


def hear(src, units, code):
    """{(a, b): text} for every speech stretch, in whisper.cpp calls of up to 64 files (one model load each)."""
    import transcribe as T
    todo = sorted({(a, b) for us in units for a, b, _, kind in us if kind == "speech" and b - a > CLICK_S})
    if not todo:
        return {}
    tmp = Path(tempfile.mkdtemp(prefix="rehear-"))
    wavs = []
    ms = int(HEAR_PAD_S * 1000)
    for k, (a, b) in enumerate(todo):
        w = tmp / f"u{k:03d}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(src), "-vn",
                        "-ac", "1", "-ar", "16000", "-af", f"adelay={ms}|{ms},apad=pad_dur={HEAR_PAD_S}",
                        "-c:a", "pcm_s16le", str(w)], check=True)
        wavs.append(w)
    out = {}
    for k in range(0, len(wavs), 64):
        for (a, b), p in zip(todo[k:k + 64], T.cpp_files(wavs[k:k + 64], code, T.prompt_for(code, []))):
            out[(a, b)] = " ".join(s.get("text", "").strip() for s in p.get("transcription", [])).strip()
    return out


def first_last_words(pieces, words):
    """The first and last transcript word of each piece (normalised): a soft check only, the labels are what failed."""
    firsts, lasts = [], []
    for s, e in pieces:
        inside = [w for w in words if min(w["end"], e) - max(w["start"], s) >= min(0.05, (w["end"] - w["start"]) / 2)]
        f = norm_words(inside[0]["text"]) if inside else []
        la = norm_words(inside[-1]["text"]) if inside else []
        firsts.append(f[0] if f else "")
        lasts.append(la[-1] if la else "")
    return firsts, lasts


def check(d, fix=False):
    d = Path(d)
    rep = d / "report.json"
    if not rep.exists():
        sys.exit(f"ERROR: no report.json in {d}: run build_timeline.py first")
    r = json.loads(rep.read_text(encoding="utf-8"))
    src, fps = r["source"], r["fps"]
    meta = d / "meta.json"
    code = (json.loads(meta.read_text(encoding="utf-8")).get("lang") if meta.exists() else None) or "auto"
    lvl, floor, loud = band_levels(src)
    thr = floor + OVER_FLOOR_DB
    all_units = stretches(lvl, thr, max(thr + 3, loud - LOW_DB))
    frames = r["frames"]
    pieces = [(f[0] / fps, f[1] / fps) for f in frames]
    units = []
    for s, e in pieces:
        us = edge_units((s, e), all_units)
        units.append([u for u in us if u[0] < s + REACH_S or u[1] > e - REACH_S])
    heard = hear(src, units, code)
    toks = [t for t in B.load_fitted(d) if t.get("type") in ("word", "audio_event")]
    words = [t for t in toks if t["type"] == "word"]
    firsts, lasts = first_last_words(pieces, words)
    new, cuts, lines = plan(pieces, units, heard, firsts, lasts)
    (d / "rehear.json").write_text(json.dumps({
        "threshold_db": round(thr, 1), "breath_db": round(max(thr + 3, loud - LOW_DB), 1),
        "pieces": [{"start": round(s, 3), "end": round(e, 3),
                    "heard": [[a, b, kind, heard.get((a, b), "")] for a, b, _, kind in units[i]],
                    "now": None if new[i] is None else [round(new[i][0], 3), round(new[i][1], 3)]}
                   for i, (s, e) in enumerate(pieces)],
        "cuts": cuts}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"rehear     {len(pieces)} pieces, {len(heard)} stretches heard again; {len(cuts)} cut(s)")
    starts, t = [], 0.0
    for s, e in pieces:
        starts.append(t)
        t += e - s
    for c in sorted(cuts, key=lambda c: c["start"]):
        i = next(k for k, (s, e) in enumerate(pieces) if s - 0.01 <= c["start"] <= e + 0.01)
        at = starts[i] + max(0.0, c["start"] - pieces[i][0])
        print(f"  cut      {c['start']:7.2f}-{c['end']:7.2f}s (at {at:5.2f}s in the cut, {c['end'] - c['start']:.2f}s): {c['why']}")
    if not cuts:
        return 0
    if not fix:
        return 1
    out, heads, tails = [], [], []
    for f, n, ln in zip(frames, new, lines):
        if n is None:
            continue
        a, b = max(f[0], math.floor(n[0] * fps + 1e-6)), min(f[1], math.ceil(n[1] * fps - 1e-6))
        if b - a > B.SLIVER_FRAMES:
            out.append([a, b])
            heads.append(norm_words(heard.get(tuple(ln[0][:2]), "")) if ln else [])
            tails.append(norm_words(heard.get(tuple(ln[1][:2]), "")) if ln else [])
    spans = [{"start": round(s / fps, 6), "end": round(e / fps, 6)} for s, e in out]
    final = sum(s["end"] - s["start"] for s in spans)
    r.update(frames=out, final_s=final, rehear=cuts)
    (d / "decisions.json").write_text(json.dumps(spans, indent=1), encoding="utf-8")
    rep.write_text(json.dumps(r, indent=1), encoding="utf-8")
    (d / "words.json").write_text(json.dumps(B.retime(relabel(words, spans, heads, tails), spans), indent=1),
                                  encoding="utf-8")
    import preview_cut
    preview_cut.write_all(d, toks, r["model_cuts"], spans, r["duration"], final)
    print(f"fixed      {len(cuts)} cut(s), the cut is now {final:.2f}s: render again")
    return 0


def demo():
    assert norm_words("From then on it lear...") == ["from", "then", "on", "it", "lear"] and norm_words("* Musik *") == []
    assert is_noise("* Musik *", 0.28) and is_noise("Vielen Dank.", 0.2) and not is_noise("Und", 0.3)
    assert is_noise("Hallo", 0.06) and not is_noise("Vielen Dank.", 0.9)
    assert starts_like(["from", "then", "on", "it", "lear"], ["from", "then", "on", "it", "learns", "from"], 0.72, 1.84)
    assert starts_like(["so"], ["so", "you", "have", "your"], 0.3, 2.0)
    assert not starts_like(["so"], ["so", "you", "have"], 0.9, 2.0)        # a whole "So." is a word, not a start
    assert not starts_like(["teach"], ["step", "3", "teach"], 0.3, 2.0)
    assert not starts_like(["and", "so"], ["and", "when", "it", "fits"], 0.5, 2.0)   # two lines, not a restart
    assert sim("1", "eins") == 1.0 and sim("drei", "3") == 1.0 and sim("1", "2") < 0.75
    # levels: a run with a 0.3 s breath at -40 before speech at -15, and a 60 ms dip inside the speech
    lvl = [-60] * 5 + [-40] * 15 + [-55] * 2 + [-15] * 10 + [-38] * 3 + [-15] * 10 + [-60] * 5
    st = stretches(lvl, -48, -37)
    assert st == [(0.1, 0.4, "breath"), (0.44, 0.9, "speech")], st      # the 40 ms gap splits; the dip stays in
    # the joins one take had (source seconds): a tail and a breath before "And then", the end of the first
    # "Step 3" before the second, a cut-off "From then on it lear-" before the whole line, a lone "So" before "So you have"
    pieces = [(81.70, 85.13), (95.93, 100.40), (125.33, 129.50), (130.93, 131.77), (131.87, 133.77), (201.03, 202.77)]
    S = "speech"
    units = [[(81.70, 81.86, "head", S), (82.06, 82.46, "", "breath"), (82.50, 85.10, "", S)],
             [(95.93, 96.22, "head", S), (96.30, 98.36, "", S), (99.0, 100.14, "", S), (100.20, 100.40, "", S)],
             [(125.34, 129.48, "", S)],
             [(130.94, 131.66, "", S)],
             [(131.88, 133.72, "", S)],
             [(201.03, 201.82, "head", S), (201.88, 202.77, "", S)]]
    heard = {(81.70, 81.86): "Ja.", (82.50, 85.10): "And then you text it like a friend",
             (95.93, 96.22): "Okay.", (96.30, 98.36): "Step 3, teach it who", (99.0, 100.14): "how your business",
             (100.20, 100.40): "runs.", (125.34, 129.48): "Here is a trick, just ask your assistant",
             (130.94, 131.66): "From then on it lear...", (131.88, 133.72): "From then on it learns from every chat.",
             (201.03, 201.82): "So...", (201.88, 202.77): "So you have in no time"}
    new, cuts, _ = plan(pieces, units, heard, ["and", "step", "here", "from", "from", "so"],
                     ["friend", "runs", "assistant", "lear", "chat", "time"])
    assert abs(new[0][0] - 82.44) < 1e-9 and new[0][1] == 85.13, new           # the breath goes, "Und" stays whole
    assert abs(new[1][0] - 96.24) < 1e-9 and new[1][1] == 100.40, new
    assert new[2] == (125.33, 129.50) and new[3] is None and new[4] == (131.87, 133.77), new
    assert abs(new[5][0] - 201.83) < 1e-9 and new[5][1] == 202.77, new
    assert len(cuts) == 4 and any("said twice" in c["why"] for c in cuts), cuts
    # a plosive's burst just before the line, and its release just after, are the line's own sounds
    new, cuts, _ = plan([(10.0, 12.0)], [[(10.0, 10.3, "", "breath"), (10.34, 10.40, "", S), (10.45, 11.5, "", S),
                                       (11.55, 11.6, "", S)]], {(10.45, 11.5): "Come to the community"}, ["come"], ["community"])
    assert abs(new[0][0] - 10.28) < 1e-9 and new[0][1] == 12.0, (new, cuts)
    # a clean piece is left alone, and so is a stretch it starts inside of when that is heard as its first word
    new, cuts, _ = plan([(10.0, 12.0)], [[(10.0, 11.2, "head", S), (11.3, 11.9, "", S)]],
                     {(10.0, 11.2): "Then it knows", (11.3, 11.9): "your mails."}, ["then"], ["mails"])
    assert new == [(10.0, 12.0)] and not cuts, (new, cuts)
    # a pause trimmed inside one sentence: both pieces keep the speech at their join
    new, cuts, _ = plan([(201.88, 202.77), (202.87, 205.0)], [[(201.88, 202.77, "tail", S)], [(202.87, 204.9, "head", S)]],
                     {(201.88, 202.77): "So you have in no time your", (202.87, 204.9): "own assistant, who"},
                     ["so", "own"], ["your", "who"])
    assert new == [(201.88, 202.77), (202.87, 205.0)] and not cuts, (new, cuts)
    raw = [{"text": "So", "start": 42.30, "end": 42.34, "type": "word"}, {"text": "build", "start": 42.34, "end": 42.44, "type": "word"},
           {"text": "you", "start": 42.47, "end": 42.56, "type": "word"}, {"text": "imagine,", "start": 309.65, "end": 309.75, "type": "word"},
           {"text": "How", "start": 309.77, "end": 309.94, "type": "word"}, {"text": "you", "start": 309.95, "end": 310.06, "type": "word"},
           {"text": "set", "start": 310.09, "end": 310.20, "type": "word"}, {"text": "it", "start": 310.20, "end": 310.34, "type": "word"}]
    got = relabel(raw, [{"start": 42.38, "end": 45.0}, {"start": 310.04, "end": 312.0}],
                  [["so", "build", "you"], ["how", "you", "set", "it"]], [[], []])
    from build_timeline import retime
    w = retime(got, [{"start": 42.38, "end": 45.0}, {"start": 310.04, "end": 312.0}])
    assert [x["text"] for x in w] == ["So", "build", "you", "How", "you", "set", "it"], w
    assert all(a["start"] <= b["start"] for a, b in zip(w, w[1:])), w
    print("rehear demo ok")


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    fix = "--fix" in a
    a = [x for x in a if x != "--fix"]
    if len(a) != 1:
        sys.exit(__doc__)
    sys.exit(check(a[0], fix))


if __name__ == "__main__":
    main()
