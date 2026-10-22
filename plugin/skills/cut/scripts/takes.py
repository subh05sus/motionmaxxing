#!/usr/bin/env python3
"""Watch the takes of one line side by side, so the best take is picked by how it looks and sounds, not only by
which came last.

    python3 takes.py sheets <edit_dir> <a>-<b> [<a>-<b> ...] [--source FILE] [--line "the line"]
    python3 takes.py demo        self-check (makes a test clip with ffmpeg)

Each <a>-<b> is one take in source seconds (from transcript.txt). For each take this writes takes/take-N.jpg, eight
frames across it in a 4 x 2 sheet (look at the eyes: on the camera or off it, the energy, a stumble, a hand in
the face), and lines up the numbers that tell takes apart:

    take 2   92.26-100.44 s   8.2 s, 2.4 words/s, 1 pause over 0.3 s, 0 fillers, -21.3 dB, ends on "läuft."

into takes/takes.md with the words of each take. The last take wins unless it is worse on the sheet or the numbers
(a stumble, a long pause, low energy, eyes off camera): last-take-wins is the default, not a law (the owner's editor
kept the first take of a line 5 times in 16 on one reel). Still close: watch the stretch with the watch skill.
The source: --source, else <edit>/source.mp4 or joined.mp4, else report.json's "source".
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[2] / "lib"))
from mm import lang  # noqa: E402

PAUSE_S = 0.3


def source_of(d, given=None):
    if given:
        return Path(given)
    for n in ("source.mp4", "joined.mp4"):
        if (d / n).exists():
            return d / n
    try:
        return Path(json.loads((d / "report.json").read_text(encoding="utf-8"))["source"])
    except (OSError, ValueError, KeyError):
        sys.exit(f"ERROR: no source for {d}: pass --source <the raw take>")


def sheet(src, a, b, out, n=8):
    """n frames across [a, b] tiled 4 x 2, 240 px wide each."""
    step = max((b - a) / n, 0.05)
    times = [a + step * (i + 0.5) for i in range(n)]
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix("")
    tmp.mkdir(exist_ok=True)
    for i, t in enumerate(times):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
                        "-vf", "scale=240:-2", str(tmp / f"{i:02d}.jpg")], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "%02d.jpg"), "-vf", "tile=4x2:padding=4:color=black",
                    "-frames:v", "1", str(out)], check=True)
    for f in tmp.glob("*.jpg"):
        f.unlink()
    tmp.rmdir()
    return out


def loudness(src, a, b):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(src), "-vn",
                        "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "mean_volume" in line:
            return float(line.split(":")[1].split()[0])
    return None


def numbers(words, a, b, fillers):
    ws = [w for w in words if w.get("type", "word") == "word" and a - 0.05 <= w["start"] and w["end"] <= b + 0.05]
    gaps = [y["start"] - x["end"] for x, y in zip(ws, ws[1:]) if y["start"] - x["end"] >= PAUSE_S]
    norm = lambda t: "".join(c for c in t.lower() if c.isalnum())   # noqa: E731
    return {"seconds": round(b - a, 2), "words": len(ws), "rate": round(len(ws) / max(b - a, 0.1), 1),
            "pauses": len(gaps), "fillers": sum(1 for w in ws if norm(w["text"]) in fillers),
            "text": " ".join(w["text"] for w in ws), "last": ws[-1]["text"] if ws else ""}


def sheets(d, ranges, source=None, line=None):
    d = Path(d)
    src = source_of(d, source)
    P = lang.pack(lang.of(d))
    words = json.loads((d / "words.raw.json").read_text(encoding="utf-8"))
    out = d / "takes"
    rows = [f"# Takes{f' of: {line}' if line else ''}", "",
            "Look at every sheet (eyes on camera, energy, a stumble), then the numbers. The last take wins unless it "
            "is worse. Still close: watch the stretch with the watch skill.", ""]
    for n, (a, b) in enumerate(ranges, 1):
        img = sheet(src, a, b, out / f"take-{n}.jpg")
        m = numbers(words, a, b, P.hard_fillers)
        db = loudness(src, a, b)
        rows += [f"## take {n}   {a:.2f}-{b:.2f} s" + ("   (last)" if n == len(ranges) else ""),
                 f"{m['seconds']} s, {m['rate']} words/s, {m['pauses']} pause(s) over {PAUSE_S} s, {m['fillers']} "
                 f"filler(s), {db if db is not None else '?'} dB, ends on \"{m['last']}\"",
                 f"sheet: {img}", f"words: {m['text']}", ""]
    (out / "takes.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(out / "takes.md")
    return out / "takes.md"


def parse_range(s):
    a, _, b = s.partition("-")
    return float(a), float(b)


def demo():
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        d = Path(t) / "e"
        d.mkdir()
        clip = d / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x568:rate=30:duration=4",
                        "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-shortest", "-pix_fmt", "yuv420p",
                        str(clip)], check=True)
        W = lambda txt, a, b: {"text": txt, "start": a, "end": b, "type": "word"}   # noqa: E731
        (d / "words.raw.json").write_text(json.dumps([W("Schritt", 0.1, 0.4), W("äh", 0.5, 0.7), W("eins", 1.2, 1.5),
                                                      W("Schritt", 2.1, 2.4), W("eins.", 2.5, 2.9)]), encoding="utf-8")
        lang.set_meta(d, lang="de")
        md = sheets(d, [(0.0, 1.8), (2.0, 3.0)], line="Schritt eins")
        text = md.read_text(encoding="utf-8")
        assert "take 1" in text and "take 2" in text and "(last)" in text and "1 filler(s)" in text, text
        assert "1 pause(s)" in text, text   # 0.7 -> 1.2 in take 1
        assert (d / "takes" / "take-1.jpg").stat().st_size > 1000
    print("takes demo ok")


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    if len(a) < 3 or a[0] != "sheets":
        sys.exit(__doc__)
    src = a[a.index("--source") + 1] if "--source" in a else None
    line = a[a.index("--line") + 1] if "--line" in a else None
    rest = [x for i, x in enumerate(a[2:], 2) if not x.startswith("--") and a[i - 1] not in ("--source", "--line")]
    sheets(a[1], [parse_range(x) for x in rest], src, line)


if __name__ == "__main__":
    main()
