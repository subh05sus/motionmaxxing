#!/usr/bin/env python3
"""The user's own edits to the cut, from the studio's transcript: cut these words, bring those back.

    python3 edits.py apply <edit_dir> '{"cut": [[a, b], ...], "restore": [[a, b], ...]}'
    python3 edits.py demo

Ranges are raw-take seconds. A word belongs to a range when its middle is inside it.
  cut      the words become a span of kind "manual" quoting them (merged with any span it touches)
  restore  a span covering the words gives them back: it narrows, or splits in two, each part quoted again; a restored
           word no span covers was taken by the pause trim, so its time goes into keep.json (build_timeline.py never
           trims inside a keep range)
Nothing is written unless the new spans.json resolves (build_timeline.resolve_spans): a change that would not build is
refused with the reason. The files before are kept as spans.prev.json and keep.prev.json. Then: build_timeline.py and
render.py (the studio runs them), verify when Claude is asked to check.
Exit codes: 0 applied, 1 refused, 2 usage
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[2] / "lib"))
import build_timeline as B  # noqa: E402
import textnorm  # noqa: E402
from mm import lang  # noqa: E402


def mid(t):
    return (t["start"] + t["end"]) / 2


def quote(toks, a, b, kind, note=""):
    """A span quoting tokens a..b, pinned to its own time with "after"."""
    sp = {"text": " ".join(t["text"].strip() for t in toks[a:b + 1]), "kind": kind,
          "after": max(0.0, round(toks[a]["start"] - 0.001, 3))}
    if note:
        sp["note"] = note
    return sp


def span_tokens(sp, toks):
    """(first, last) token index of a span, by the same lookup build_timeline uses."""
    hits = textnorm.locate(sp.get("text", ""), toks)
    if "after" in sp:
        hits = [h for h in hits if toks[h[0]]["start"] >= float(sp["after"])]
    if not hits:
        return None
    k = int(sp.get("occurrence", 1)) - 1 if "occurrence" in sp else 0
    return hits[k] if 0 <= k < len(hits) else None


def apply(d, change):
    d = Path(d)
    textnorm.use(lang.of(d))
    toks = [t for t in json.loads((d / "words.raw.json").read_text(encoding="utf-8")) if t.get("type") in ("word", "audio_event")]
    spans = json.loads((d / "spans.json").read_text(encoding="utf-8")) if (d / "spans.json").exists() else []
    keep = json.loads((d / "keep.json").read_text(encoding="utf-8")) if (d / "keep.json").exists() else []
    placed = []   # [(first, last, span)]
    for sp in spans:
        r = span_tokens(sp, toks)
        if r is None:
            return f"a span no longer matches the transcript: {sp.get('text', '')[:60]!r}"
        placed.append((r[0], r[1], sp))
    restored = 0
    for a, b in change.get("restore", []):
        inside = {i for i, t in enumerate(toks) if a <= mid(t) <= b}
        if not inside:
            continue
        covered = set()
        nxt = []
        for f, l, sp in placed:
            gone = [i for i in range(f, l + 1) if i in inside]
            if not gone:
                nxt.append((f, l, sp))
                continue
            covered.update(gone)
            kind, note = sp.get("kind", "retake"), sp.get("note", "")
            run = []
            for i in range(f, l + 2):
                if i <= l and i not in inside:
                    run.append(i)
                elif run:
                    nxt.append((run[0], run[-1], quote(toks, run[0], run[-1], kind, note)))
                    run = []
        placed = nxt
        restored += len(inside)
        free = sorted(inside - covered)
        if free:   # taken by the pause trim, not by a span: never trim there again
            keep.append({"start": round(toks[free[0]]["start"], 3), "end": round(toks[free[-1]]["end"], 3)})
    cut = 0
    for a, b in change.get("cut", []):
        idx = [i for i, t in enumerate(toks) if a <= mid(t) <= b]
        if not idx:
            continue
        f, l = idx[0], idx[-1]
        cut += l - f + 1
        merged_f, merged_l, kinds, rest = f, l, ["manual"], []
        for pf, pl, sp in placed:
            if pl >= f - 1 and pf <= l + 1:   # touches or overlaps: one span
                merged_f, merged_l = min(merged_f, pf), max(merged_l, pl)
            else:
                rest.append((pf, pl, sp))
        placed = rest + [(merged_f, merged_l, quote(toks, merged_f, merged_l, "manual", "your cut"))]
        lo, hi = toks[f]["start"], toks[l]["end"]
        keep = [k for k in keep if k["end"] <= lo or k["start"] >= hi]
    new = [sp for _, _, sp in sorted(placed, key=lambda x: x[0])]
    try:
        B.resolve_spans(new, toks)
    except SystemExit:
        return "this change would not build (two spans overlap or a quote no longer matches)"
    for name in ("spans.json", "keep.json"):
        if (d / name).exists():
            shutil.copyfile(d / name, d / name.replace(".json", ".prev.json"))
    (d / "spans.json").write_text(json.dumps(new, indent=1, ensure_ascii=False), encoding="utf-8")
    (d / "keep.json").write_text(json.dumps(keep, indent=1), encoding="utf-8")
    print(f"{cut} word(s) cut, {restored} word(s) restored; {len(new)} spans")
    return None


def demo():
    import tempfile
    W = lambda t, a, b: {"text": t, "start": a, "end": b, "type": "word"}   # noqa: E731
    words = [W("So", 0.0, 0.2), W("baust", 0.25, 0.5), W("du", 0.55, 0.7), W("dir", 0.75, 0.9),
             W("so", 1.5, 1.7), W("baust", 1.75, 2.0), W("du", 2.05, 2.2), W("dir", 2.25, 2.4), W("deinen", 2.45, 2.8),
             W("Jarvis.", 2.85, 3.3)]
    with tempfile.TemporaryDirectory() as t:
        d = Path(t)
        (d / "words.raw.json").write_text(json.dumps(words), encoding="utf-8")
        lang.set_meta(d, lang="de")
        (d / "spans.json").write_text(json.dumps([{"text": "So baust du dir", "kind": "retake", "occurrence": 1}]),
                                      encoding="utf-8")
        assert apply(d, {"restore": [[0.5, 0.95]]}) is None   # "du dir" back: the span narrows to "So baust"
        s = json.loads((d / "spans.json").read_text(encoding="utf-8"))
        assert [x["text"] for x in s] == ["So baust"] and s[0]["kind"] == "retake", s
        assert apply(d, {"cut": [[0.5, 0.95]]}) is None       # and cut again: one manual span "So baust du dir"
        s = json.loads((d / "spans.json").read_text(encoding="utf-8"))
        assert [x["text"] for x in s] == ["So baust du dir"] and s[0]["kind"] == "manual", s
        assert apply(d, {"restore": [[2.8, 3.4]]}) is None    # a word no span covers: into keep.json
        assert json.loads((d / "keep.json").read_text(encoding="utf-8")) == [{"start": 2.85, "end": 3.3}]
        assert (d / "spans.prev.json").exists()
        (d / "spans.json").write_text(json.dumps([{"text": "nicht da", "kind": "retake"}]), encoding="utf-8")
        assert apply(d, {"cut": [[0, 1]]}) is not None, "a span that matches nothing: refused, nothing written"
    print("edits demo ok")


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    if len(a) != 3 or a[0] != "apply":
        sys.exit(__doc__)
    why = apply(a[1], json.loads(a[2]))
    if why:
        print(f"REFUSED: {why}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
