#!/usr/bin/env python3
"""Self-check for build_timeline.py. No ffmpeg, no fixtures, runs in milliseconds.

    python3 test_build_timeline.py
"""
import contextlib
import io
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_timeline as B  # noqa: E402


def levels(speech_db, floor_db, n_speech=200, n_floor=800):
    return [speech_db + 0.4] * n_speech + [floor_db + 0.4] * n_floor


def test_derive():
    assert B.derive_noise_db(levels(-14, -64))[0] == -40.0      # quiet room: speech - 26
    assert B.derive_noise_db(levels(-21, -65))[0] == -47.0      # quieter speaker moves it
    noise, d = B.derive_noise_db(levels(-13, -28))              # music bed: quietest 10% + 1/3
    assert d["bed"] == -27.6 and noise == round(-27.6 + 14.6 / 3, 1), d
    noise, d = B.derive_noise_db(levels(-13, -28, n_speech=50, n_floor=4000))
    assert d["speech"] == -13 and d["bed"] == -27.6, d           # busy floor is not speech
    assert B.derive_noise_db(levels(-11, -38))[0] == -32.0      # never under floor + 6
    # a take that talks almost without a break: its commonest level under the speech is quieter speech (-21), the
    # silence is spread thin over many levels; the quietest tenth is silence, so it is no bed
    lv = [-9.6] * 300 + [-20.6] * 400 + [b + 0.4 for b in range(-60, -44) for _ in range(20)] + [-51.6] * 20
    noise, d = B.derive_noise_db(lv)
    assert "bed" not in d and d["floor"] == -52 and noise == -36.0, d


def test_next_sound():
    # 20 ms windows from 0: the word to 0.1 s, a 40 ms stop closure, its "-t" burst, 0.36 s of quiet, the next take
    lv = [-15.0] * 5 + [-50.0] * 2 + [-25.0] * 2 + [-50.0] * 18 + [-20.0] * 10
    assert abs(B.next_sound(lv, -36.0, 0.08, 1.0) - (0.54 - B.ONSET_MARGIN_S)) < 1e-9   # not the burst after the closure
    assert B.next_sound(lv, -36.0, 0.08, 0.5) is None                                       # nothing before the limit
    assert B.next_sound([-15.0] * 50, -36.0, 0.1, 0.9) is None                              # it never goes quiet


def test_audible_end():
    lvl = [-20.0] * 10 + [-60.0] * 10
    assert abs(B.audible_end(lvl, -40.0, 0.34) - 0.20) < 1e-9
    assert B.audible_end(lvl, -40.0, 0.10) == 0.10
    assert B.audible_end([-60.0] * 10, -40.0, 0.10) is None


def splice(left, right, next_dur, budget=0.18):
    words = [{"start": 0.0, "end": 1.0, "text": "prev"}, {"start": 1.5, "end": 1.6, "text": "flub"},
             {"start": 3.0, "end": 3.0 + next_dur, "text": "next"}]
    cut = {"start": 1.0 + left, "end": 3.0 - right, "kind": "retake", "evidence": "flub",
           "confidence": "high"}
    B.enforce_splice_budget([cut], words, [{"start": 1.5, "end": 1.6}], budget)
    return (cut["start"] - 1.0) + (3.0 - cut["end"]), cut


def test_splice_budget():
    total, cut = splice(0.125, 0.125, 0.06)
    assert abs(total - 0.18) < 1e-6 and 3.0 - cut["end"] >= 0.125 - 1e-6, cut   # short word keeps runway
    assert abs(splice(0.10, 0.10, 0.30)[0] - 0.18) < 1e-6
    total, cut = splice(0.05, 0.05, 0.30)                                         # in budget: untouched
    assert abs(total - 0.10) < 1e-9 and abs(cut["start"] - 1.05) < 1e-9
    for left, right, nd in [(0.4, 0.4, 0.06), (0.02, 0.5, 0.30), (0.5, 0.02, 0.06)]:
        _, cut = splice(left, right, nd)                                          # only widens,
        assert cut["start"] <= 1.0 + left + 1e-9 and cut["end"] >= 3.0 - right - 1e-9
        assert cut["start"] > 1.0 and cut["end"] < 3.0                           # never into a word
    _, cut = splice(0.4, 1.0, 0.06, budget=0.001)
    assert 1.0 <= cut["start"] and cut["end"] <= 3.0


def test_spans():
    toks = [{"text": t, "start": i, "end": i + 0.5, "type": "word"}
            for i, t in enumerate("so the thing about the thing about ducks".split())]
    cuts = B.resolve_spans([{"text": "the thing about", "occurrence": 1, "kind": "false_start"}], toks)
    assert (cuts[0]["start"], cuts[0]["end"]) == (1, 3.5), cuts
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):  # the expected ERROR stays out of the CI log
            B.resolve_spans([{"text": "the thing about", "kind": "false_start"}], toks)
        raise AssertionError("an ambiguous span must fail")
    except SystemExit:
        assert "appears 2x" in err.getvalue(), err.getvalue()


def test_frames_and_retime():
    cuts = [{"start": 1.01, "end": 1.99, "_next": 2.0}, {"start": 3.0, "end": math.inf}]
    frames = B.kept_frames(cuts, 30, 4.0)
    assert frames == [[0, 30], [60, 90]], frames                 # floor start, clamp end
    spans = [{"start": s / 30, "end": e / 30} for s, e in frames]
    w = B.retime([{"text": "a", "start": 0.2, "end": 0.5, "type": "word"},
                  {"text": "gone", "start": 1.2, "end": 1.5, "type": "word"},
                  {"text": "b", "start": 2.1, "end": 2.4, "type": "word"}], spans)
    assert [x["text"] for x in w] == ["a", "b"] and abs(w[1]["start"] - 1.1) < 1e-6, w


def test_stretched_label_is_not_clipped():
    """Whisper labels "if" 0.4-3.4 s, 3 s ahead of its audio at 3.45 s (the sample take's "If" at
    173 s). Judged on that label, the pause cut "clips" a word the render plays, and the paper edit
    sends the model into raising --pad for nothing. Fitted to the audio, nothing is clipped and the
    paper edit plays exactly the words words.json keeps."""
    import preview_cut as P
    words = [{"text": "so", "start": 0.0, "end": 0.3, "type": "word"},
             {"text": "if", "start": 0.4, "end": 3.4, "type": "word"},
             {"text": "you", "start": 3.6, "end": 3.9, "type": "word"}]
    loud = [(0.0, 0.3), (3.45, 3.55), (3.6, 3.9)]
    lvl = [-20.0 if any(a <= i * B.RMS_WIN_S < b for a, b in loud) else -60.0 for i in range(int(4.5 / B.RMS_WIN_S))]

    def paper(ws):
        cuts = B.merge(B.silence_cuts(ws, 0.15, 0.1, [(0.3, 3.45)]) + B.lead_trail_cuts(ws, 4.5, 0.1))
        B.enforce_splice_budget(cuts, ws, [], 0.15, lvl, -40.0)
        spans = [{"start": a / 30, "end": b / 30} for a, b in B.kept_frames(cuts, 30, 4.5)]
        md = P.paper_edit(P.label(ws, [], spans), [], 4.5, sum(s["end"] - s["start"] for s in spans))
        return md, [w["text"] for w in B.retime(ws, spans)]

    assert "CLIPPED" in paper(words)[0]                       # the raw label: a false CLIPPED
    labels = B.fit_labels(words, lvl, -40.0)
    assert list(labels) == [1] and 3.4 <= labels[1][0] < labels[1][1] <= 3.6, labels
    md, kept = paper(B.apply_labels(words, labels))
    assert "CLIPPED" not in md and kept == ["so", "if", "you"], (md, kept)
    assert md.split("## What plays")[1].split("## Cuts")[0].split("\n")[-3] == "so if you", md


def test_label_after_the_previous_words_tail():
    """The real take: "you" 192.63-192.75 then "if" labelled 192.75-193.41. The audio: "you" sounds to
    192.86, silence to 193.30, "if" at 193.30. Fitted from its label start, "if" landed on the tail of
    "you", fell in the pause cut and was CLIPPED whatever the --pad. It is fitted after the silence."""
    words = [{"text": "you", "start": 192.63, "end": 192.75, "type": "word"},
             {"text": "if", "start": 192.75, "end": 193.41, "type": "word"},
             {"text": "you", "start": 193.41, "end": 193.51, "type": "word"}]
    loud = [(192.58, 192.86), (193.30, 193.60)]
    lvl = [-20.0 if any(a <= i * B.RMS_WIN_S < b for a, b in loud) else -60.0 for i in range(int(194 / B.RMS_WIN_S))]
    got = B.fit_labels(words, lvl, -40.0)
    assert list(got) == [1] and 193.2 <= got[1][0] < got[1][1] <= 193.41, got


def test_no_head_sliver():
    """decisions.json started [0.0, 0.033] then [0.434, ...]: a one-frame flash, then a jump."""
    frames = B.kept_frames([{"start": 0.05, "end": 0.43}, {"start": 3.0, "end": math.inf}], 30, 4.0)
    assert frames == [[13, 90]], frames
    assert B.kept_frames([{"start": 0.5, "end": 1.0}], 30, 2.0) == [[0, 15], [30, 60]]   # a real head stays


def test_short_word_span_is_kept():
    """A house take keeps "30," in a 0.167 s span between two silence cuts. Under MIN_KEPT_S, but a
    word starts in it, so it stays. A 1-frame span with no word, at the head or between cuts, goes."""
    w = lambda t, a, b: {"text": t, "start": a, "end": b, "type": "word"}
    ws = [w("to", 9.74, 9.84), w("30,", 10.02, 10.14), w("35,", 10.3, 10.68)]
    frames = B.kept_frames([{"start": 9.89, "end": 9.97}, {"start": 10.19, "end": 10.25}], 30, 12.0, words=ws)
    assert [300, 305] in frames, frames
    head = [{"start": 0.04, "end": 0.43}, {"start": 3.0, "end": math.inf}]
    assert B.kept_frames(head, 30, 4.0, words=[w("so", 0.5, 0.7)]) == [[13, 90]]
    mid = [{"start": 1.0, "end": 1.99}, {"start": 2.04, "end": 2.5}]
    assert B.kept_frames(mid, 30, 4.0, words=[w("a", 0.2, 0.5), w("b", 2.6, 2.9)]) == [[0, 30], [75, 120]]


def test_hidden_repeat_is_listed_and_shown():
    """The sample: Whisper labels "content" 117.07-119.01 s over "and to break down competitor ads and"
    (spoken 117.7-119.4 s). A label holding far more speech than its word is listed, re-transcribed
    when possible, and otherwise marked in transcript.txt. A long label over silence is not listed."""
    import retakes as R
    import transcribe as T
    words = [{"text": "ads", "start": 116.6, "end": 117.0, "type": "word"},
             {"text": "content", "start": 117.07, "end": 119.01, "type": "word"},
             {"text": "strategies", "start": 119.5, "end": 120.0, "type": "word"},
             {"text": "if", "start": 121.0, "end": 124.0, "type": "word"}]   # 3 s label, 0.1 s of audio
    loud = [(116.6, 117.0), (117.7, 119.4), (119.5, 120.0), (123.9, 124.0)]
    lvl = [-20.0 if any(a <= i * B.RMS_WIN_S < b for a, b in loud) else -60.0 for i in range(int(125 / B.RMS_WIN_S))]
    assert [i for i, _ in B.unheard(words, lvl, -40.0)] == [1], B.unheard(words, lvl, -40.0)

    old = B.window_rms_db, B.derive_noise_db
    B.window_rms_db, B.derive_noise_db = (lambda src: lvl), (lambda lv: (-40.0, {}))
    try:
        asked = []
        def again(s, e):
            asked.append((s, e))
            return [{"text": x, "start": 117.7 + n * 0.2, "end": 117.85 + n * 0.2, "type": "word"}
                    for n, x in enumerate("and to break down competitor ads and content".split())]
        got = [w["text"] for w in T.recheck("a.wav", T.with_spacing([dict(w) for w in words]), again)
               if w["type"] == "word"]
        assert asked == [(117.07, 119.01)] and got[1:9] == "and to break down competitor ads and content".split(), got
        kept = [w for w in T.recheck("a.wav", T.with_spacing([dict(w) for w in words]), lambda s, e: [])
                if w["type"] == "word"]
        assert kept[1]["unheard_s"] > 1.0 and "unheard_s" not in kept[3], kept
        view = R.text_view(kept)
        assert "content [1.3s of speech not transcribed]" in view, view
        assert "not transcribed" not in R.say(kept, 0, 3)    # spans see the plain words
        one = T.recheck("a.wav", T.with_spacing([dict(w) for w in words]),
                        lambda s, e: [{"text": "content", "start": 117.7, "end": 119.4, "type": "word"}])
        assert not any(w.get("unheard_s") for w in one), one    # heard again as one word: drawn out
    finally:
        B.window_rms_db, B.derive_noise_db = old


def test_splice_never_reaches_a_removed_word():
    """Speech runs 1.0-2.0 s with no gap ("the the thing"); the first "the" (1.0-1.3) is removed and the
    keep starts at 1.3, inside speech. Walking back to the quiet would bring the stumble back, so the
    edge stays and is listed. Without the removed word it moves to the quiet at 1.0 s."""
    lvl = [-20.0 if 1.0 <= i * B.RMS_WIN_S < 2.0 else -70.0 for i in range(int(3 / B.RMS_WIN_S))]
    frames = [[0, 15], [39, 90]]
    got, moved, left = B.fix_splices(frames, 30, lvl, -40.0, 90, removed=[(1.0, 1.3)])
    assert got == frames and left == [1.3] and not moved, (got, moved, left)
    got, moved, left = B.fix_splices(frames, 30, lvl, -40.0, 90)
    assert got == [[0, 15], [30, 90]] and moved == [(1.3, 1.0)] and not left, (got, moved, left)
    assert B.fix_splices(got, 30, lvl, -40.0, 90)[1:] == ([], [])      # a second pass finds nothing


def test_keep_ranges_survive_the_pause_trim():
    """A quiet "um" at 1.0-1.3 s sits inside measured silence 0.5-2.0 s, so the pause trim takes it. The user put it
    back on the review page: keep.json holds 1.0-1.3, and the cut over it splits around it (padded), so it plays."""
    import json
    import tempfile
    ws = [{"text": "so", "start": 0.0, "end": 0.4, "type": "word"},
          {"text": "um", "start": 1.0, "end": 1.3, "type": "word"},
          {"text": "yes", "start": 2.0, "end": 2.4, "type": "word"}]
    cuts = B.merge(B.silence_cuts(ws, 0.15, 0.1, [(0.5, 2.0)]))
    assert not B.is_kept(ws[1], [{"start": a / 30, "end": b / 30} for a, b in B.kept_frames(cuts, 30, 2.5)])   # trimmed
    with tempfile.TemporaryDirectory() as d:
        assert B.keep_ranges(d) == []
        (Path(d) / "keep.json").write_text(json.dumps([{"start": 1.0, "end": 1.3}]), encoding="utf-8")
        keeps = B.keep_ranges(d)
    got = B.carve(cuts, keeps)
    assert [(round(c["start"], 2), round(c["end"], 2)) for c in got] == [(0.55, 0.95), (1.35, 1.95)], got
    spans = [{"start": a / 30, "end": b / 30} for a, b in B.kept_frames(got, 30, 2.5, words=ws)]
    assert all(B.is_kept(w, spans) for w in ws), spans
    # a keep range over a whole gap (a pause put back) removes the cut there; one outside every cut changes nothing
    assert B.carve(cuts, [(0.4, 2.0)]) == [] and B.carve(cuts, [(3.0, 3.2)]) == cuts


def test_zero_length_word_inside_a_cut_is_removed():
    """Scribe labels some quick words with no length ("who" at 49.30-49.30). One inside a cut must not count as
    kept: it showed in paper-edit.md, words.json and the captions, and verify called it MISSING."""
    spans = [{"start": 30.0, "end": 37.0}, {"start": 64.0, "end": 74.0}]
    assert not B.is_kept({"text": "who", "start": 49.3, "end": 49.3, "type": "word"}, spans)
    assert B.is_kept({"text": "I", "start": 64.5, "end": 64.5, "type": "word"}, spans)


def test_short_pause_trims_are_not_made():
    """A 0.20 s pause inside a sentence trimmed to 0.10 s is a 0.10 s jump in the picture that saves nothing (one take
    had seven of them; its editor made none). Under MIN_TRIM_S removed, the pause stays; a 0.5 s one is still tightened."""
    ws = [{"text": "an", "start": 0.0, "end": 0.3, "type": "word"},
          {"text": "agent", "start": 0.5, "end": 1.0, "type": "word"},
          {"text": "done.", "start": 1.0, "end": 1.4, "type": "word"},
          {"text": "Next", "start": 1.9, "end": 2.1, "type": "word"}]
    cuts = B.silence_cuts(ws, 0.15, 0.1, [(0.3, 0.5), (1.4, 1.9)])
    assert [(round(c["start"], 2), round(c["end"], 2)) for c in cuts] == [(1.45, 1.85)], cuts


def test_move_before():
    """moves.json: the calmer last take of a line (source 300-310) plays before the earlier take of the next line
    (source 280-290), whatever the source order; a kept range holding the target is split there."""
    frames = [[0, 100], [280, 290], [300, 310]]
    assert B.move_before(frames, 300, 310, 280) == [[0, 100], [300, 310], [280, 290]]
    assert B.move_before(frames, 300, 310, 50) == [[0, 50], [300, 310], [50, 100], [280, 290]]
    assert B.move_before(frames, 300, 310, 0) == B.lead_first(frames, 300, 310)
    spans = [{"start": a / 10, "end": b / 10} for a, b in B.move_before(frames, 300, 310, 280)]
    w = B.retime([{"text": "how", "start": 30.2, "end": 30.5, "type": "word"},
                  {"text": "show", "start": 28.1, "end": 28.4, "type": "word"}], spans)
    assert [x["text"] for x in w] == ["how", "show"] and w[0]["start"] == 10.2, w


if __name__ == "__main__":
    test_derive()
    test_next_sound()
    test_audible_end()
    test_splice_budget()
    test_spans()
    test_frames_and_retime()
    test_stretched_label_is_not_clipped()
    test_label_after_the_previous_words_tail()
    test_no_head_sliver()
    test_short_word_span_is_kept()
    test_hidden_repeat_is_listed_and_shown()
    test_splice_never_reaches_a_removed_word()
    test_keep_ranges_survive_the_pause_trim()
    test_zero_length_word_inside_a_cut_is_removed()
    test_short_pause_trims_are_not_made()
    test_move_before()
    print("all ok")
