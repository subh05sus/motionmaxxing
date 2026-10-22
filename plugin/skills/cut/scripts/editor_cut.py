#!/usr/bin/env python3
"""Where an editor's finished cut comes from in the raw take, to the frame, and how ours differs.

    python3 editor_cut.py <raw take> <editor's cut> [--edit edits/NAME] [--out FILE]
    python3 editor_cut.py demo          self-check (made-up noise, no files)

Run it with the venv python (numpy). The editor's version is matched against the raw take by its AUDIO, not its
words: 0.5 s windows of the posted audio every 0.1 s, each found in the raw take by normalised cross-correlation
(near where the words put it when transcripts are given, else anywhere in the take); runs of one offset are the
editor's kept pieces. Each join is then read frame by frame (20 ms, 16 kHz, the offsets refined to the sample): the
last frame that matches the piece before, the first that matches the piece after. Fricatives and breaths match
badly after AAC, so a join's unmatched frames are often the start of the next word: the editor's cut lies between.

With --edit, the edit's decisions.json is compared with the editor's pieces: the stretches of the take only one of
the two keeps (0.15 s or more), and how each piece starts in ours against the editor's. Writes editor-cut.json (in
the edit, or --out). taste/scripts/learn.py runs this when both of its inputs are video files.
Exit codes: 0 ok, 1 error, 2 usage
"""
import argparse
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

WIN_S, HOP_S, NEAR_S = 0.5, 0.1, 1.5
MATCH, FALLBACK = 0.6, 0.7      # a window counts at this correlation; under FALLBACK near the words, search everywhere
FRAME_S, STRONG = 0.02, 0.8     # the join read in 20 ms frames; a frame belongs to a piece at this correlation
DIFF_MIN_S = 0.15


def pcm(src, sr):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def _norm(s):
    return re.sub(r"[^\w]+", "", s.lower())


def guide_of(raw_words, pub_words):
    """[(posted t, raw t)] for the words the two transcripts share, in order."""
    sm = difflib.SequenceMatcher(None, [_norm(w["text"]) for w in pub_words], [_norm(w["text"]) for w in raw_words],
                                 autojunk=False)
    return sorted((pub_words[a + k]["start"], raw_words[b + k]["start"]) for a, b, n in sm.get_matching_blocks()
                  for k in range(n))


def pieces(R, P, sr=8000, guide=()):
    """The editor's kept pieces: [{"posted": [a, b], "raw": [a, b], "off": s, "match": q}] from the two signals."""
    import numpy as np
    W, H = int(WIN_S * sr), int(HOP_S * sr)
    gt = np.array([g[0] for g in guide]) if guide else None
    RF = np.fft.rfft(R, len(R) + W)
    RE = np.sqrt(np.maximum(np.convolve(R ** 2, np.ones(W), "valid"), 1e-12))
    rows = []
    for s0 in range(0, len(P) - W, H):
        win = P[s0:s0 + W]
        if np.sqrt((win ** 2).mean()) < 0.01:          # silence matches anything
            continue
        t, wn = s0 / sr, float(np.linalg.norm(win))
        best = (0.0, -1.0)
        if gt is not None and len(gt):
            i = int(np.clip(np.searchsorted(gt, t), 1, len(gt) - 1)) if len(gt) > 1 else 0
            g = guide[i - 1] if len(gt) > 1 and abs(gt[i - 1] - t) < abs(gt[i] - t) else guide[i]
            c = g[1] + (t - g[0])
            a, b = max(0, int((c - NEAR_S) * sr)), min(len(R), int((c + NEAR_S) * sr) + W)
            seg = R[a:b]
            if len(seg) >= W:
                n = len(seg) + W
                f = np.fft.irfft(np.fft.rfft(seg, n) * np.conj(np.fft.rfft(win, n)), n)[:len(seg) - W + 1]
                cc = f / (np.sqrt(np.convolve(seg ** 2, np.ones(W), "valid")) * wn + 1e-9)
                k = int(np.argmax(cc))
                best = ((a + k) / sr - t, float(cc[k]))
        if best[1] < FALLBACK:                           # the words pointed elsewhere (or there are none): the whole take
            f2 = np.fft.irfft(RF * np.conj(np.fft.rfft(win, len(R) + W)), len(R) + W)[:len(R) - W + 1]
            cc2 = f2 / (RE * wn + 1e-9)
            k2 = int(np.argmax(cc2))
            if cc2[k2] > best[1]:
                best = (k2 / sr - t, float(cc2[k2]))
        rows.append((round(t, 3), round(best[0], 4), best[1]))
    out = []
    for t, off, q in rows:
        if q < MATCH:
            continue
        if out and abs(out[-1]["off"] - off) < 0.015 and t - out[-1]["_p1"] < 0.35:
            out[-1]["_p1"], out[-1]["_q"] = t + WIN_S, out[-1]["_q"] + [q]
        else:
            out.append({"_p0": t, "_p1": t + WIN_S, "off": off, "_q": [q]})
    return [{"posted": [round(p["_p0"], 2), round(p["_p1"], 2)], "raw": [round(p["_p0"] + p["off"], 2), round(p["_p1"] + p["off"], 2)],
             "off": p["off"], "match": round(float(np.median(p["_q"])), 2)} for p in out if p["_p1"] - p["_p0"] >= 0.55]


def joins(R, P, found, sr=16000):
    """Each join to the frame: {"posted", "a_end", "b_start"} in seconds (a_end, b_start in the raw take), the
    offsets first refined to the sample on the middle of each piece."""
    import numpy as np
    corr = lambda a, b: float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)) if len(a) == len(b) and len(a) else -1.0
    ps = []
    for p in found:
        mid = (p["posted"][0] + p["posted"][1]) / 2
        seg = P[int((mid - 0.4) * sr):int((mid + 0.4) * sr)]
        best = (-1.0, p["off"])
        for d in range(-80, 81, 2):
            b0 = int((mid - 0.4 + p["off"]) * sr) + d
            if 0 <= b0 and b0 + len(seg) <= len(R):
                c = corr(seg, R[b0:b0 + len(seg)])
                if c > best[0]:
                    best = (c, p["off"] + d / sr)
        ps.append({**p, "off": best[1]})
    F = int(FRAME_S * sr)
    out = []
    for A, B in zip(ps, ps[1:]):
        lo = min(A["posted"][1], B["posted"][0]) - 0.45
        hi = max(A["posted"][1], B["posted"][0]) + 0.45
        last_a = first_b = None
        t = lo
        while t < hi:
            p = P[int(t * sr):int(t * sr) + F]
            if len(p) == F and np.sqrt((p ** 2).mean()) >= 0.003:
                ca = corr(p, R[int((t + A["off"]) * sr):int((t + A["off"]) * sr) + F])
                cb = corr(p, R[int((t + B["off"]) * sr):int((t + B["off"]) * sr) + F])
                if ca > STRONG and ca >= cb and (first_b is None):
                    last_a = t + FRAME_S
                if cb > STRONG and cb > ca and first_b is None and last_a is not None:
                    first_b = t
            t += FRAME_S / 2
        if last_a is None or first_b is None:
            continue
        out.append({"posted": round((last_a + first_b) / 2, 2), "a_end": round(last_a + A["off"], 3),
                    "b_start": round(first_b + B["off"], 3)})
    return out


def refine(found, js):
    """The pieces with their ends at the joins read to the frame (the windows' edges are 0.1-0.2 s rough there)."""
    out = [dict(p, raw=list(p["raw"])) for p in found]
    for k, j in enumerate(js):
        i = min(range(len(out) - 1), key=lambda n: abs(out[n]["posted"][1] - j["posted"])) if len(out) > 1 else 0
        out[i]["raw"][1], out[i + 1]["raw"][0] = j["a_end"], j["b_start"]
    return out


def versus(found, spans):
    """How our cut (spans: [{"start", "end"}] in the raw take) differs from the editor's pieces: the stretches only
    one keeps (DIFF_MIN_S or more), and our start against the editor's for each of his pieces."""
    def minus(a, b):    # intervals of a not in b
        out = []
        for s, e in a:
            cur = [(s, e)]
            for bs, be in b:
                cur = [x for c in cur for x in ((c[0], min(c[1], bs)), (max(c[0], be), c[1])) if x[1] - x[0] > 1e-6]
            out += cur
        return [(round(s, 2), round(e, 2)) for s, e in out if e - s >= DIFF_MIN_S]
    ed = [tuple(p["raw"]) for p in found]
    ours = [(s["start"], s["end"]) for s in spans]
    starts = []
    for s, e in ed:
        o = min(ours, key=lambda x: abs(x[0] - s)) if ours else None
        if o and abs(o[0] - s) < 1.5:
            starts.append({"editor": round(s, 2), "ours": round(o[0], 2), "diff": round(o[0] - s, 2)})
    return {"only_ours": minus(ours, ed), "only_editor": minus(ed, ours), "starts": starts}


def run(raw_src, pub_src, raw_words=(), pub_words=()):
    R8, P8 = pcm(raw_src, 8000), pcm(pub_src, 8000)
    found = pieces(R8, P8, 8000, guide_of(raw_words, pub_words) if raw_words and pub_words else ())
    js = joins(pcm(raw_src, 16000), pcm(pub_src, 16000), found)
    return refine(found, js), js


def demo():
    import numpy as np
    rng = np.random.default_rng(7)
    sr = 8000
    R = (rng.standard_normal(sr * 8) * 0.2).astype(np.float32)           # an 8 s "take" of noise, every window unique
    cut = [(1.0, 2.0), (3.0, 3.6), (5.0, 6.2)]
    P = np.concatenate([R[int(a * sr):int(b * sr)] for a, b in cut])
    found = pieces(R, P, sr)
    assert [p["raw"] for p in found] == [[1.0, 2.0], [3.0, 3.6], [5.0, 6.2]] or \
        all(abs(p["raw"][0] - c[0]) < 0.11 for p, c in zip(found, cut)), found
    R16 = np.repeat(R, 2) / 1.0
    P16 = np.repeat(P, 2) / 1.0
    j = joins(R16, P16, found, 16000)
    assert len(j) == 2 and abs(j[0]["a_end"] - 2.0) <= 0.03 and abs(j[0]["b_start"] - 3.0) <= 0.03, j
    assert abs(j[1]["a_end"] - 3.6) <= 0.03 and abs(j[1]["b_start"] - 5.0) <= 0.03, j
    v = versus(refine(found, j), [{"start": 0.7, "end": 2.0}, {"start": 3.0, "end": 3.6}, {"start": 5.0, "end": 6.2}])
    assert v["only_ours"] == [(0.7, 1.0)] and not v["only_editor"], v
    assert v["starts"][0] == {"editor": 1.0, "ours": 0.7, "diff": -0.3} and all(abs(x["diff"]) <= 0.03 for x in v["starts"][1:]), v
    print("editor_cut demo ok")


def main():
    if sys.argv[1:] == ["demo"]:
        return demo()
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("posted")
    ap.add_argument("--edit", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    found, js = run(a.raw, a.posted)
    doc = {"pieces": found, "joins": js}
    if a.edit:
        doc["vs_cut"] = versus(found, json.loads((Path(a.edit) / "decisions.json").read_text(encoding="utf-8")))
    out = Path(a.out) if a.out else (Path(a.edit) / "editor-cut.json" if a.edit else Path("editor-cut.json"))
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    for p in found:
        print(f"piece  posted {p['posted'][0]:6.2f}-{p['posted'][1]:6.2f}  raw {p['raw'][0]:7.2f}-{p['raw'][1]:7.2f}  match {p['match']}")
    for j in js:
        print(f"join   posted {j['posted']:6.2f}: the piece before ends at {j['a_end']:7.2f} s, the next starts at {j['b_start']:7.2f} s")
    if "vs_cut" in doc:
        v = doc["vs_cut"]
        print("ours, not the editor's: " + (", ".join(f"{s:.2f}-{e:.2f}" for s, e in v["only_ours"]) or "nothing"))
        print("the editor's, not ours: " + (", ".join(f"{s:.2f}-{e:.2f}" for s, e in v["only_editor"]) or "nothing"))
        late = [s for s in v["starts"] if abs(s["diff"]) >= DIFF_MIN_S]
        print("starts that differ: " + (", ".join(f"{s['editor']:.2f} (ours {s['ours']:.2f})" for s in late) or "none"))
    print(out)


if __name__ == "__main__":
    main()
