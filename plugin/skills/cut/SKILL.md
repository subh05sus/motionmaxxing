---
name: cut
description: Cuts raw talking-head footage into a clean jump cut. Takes one take or several joined (mp4 or mov, any aspect, 4K phone footage is fine), transcribes it word by word, removes retakes, false starts, fillers and dead pauses, and renders cut.mp4 at the source resolution plus words.json timed to the cut. The user approves the cut on a page with the whole transcript and every removed word struck through. Use when the user says "cut my video", "just cut it", "remove my mistakes", "cut out the retakes", "remove the pauses", "clean up this take", "jump cut this", "tighten this clip", or asks only for the cut of a raw take; start calls it for a full edit. Runs before edit. Not for a general request to edit a video or to make it look like a creator (that is start), not for adding captions, zooms or cards (edit), and not for analysing someone else's videos (teardown).
license: MIT
compatibility: macOS, ffmpeg, whisper.cpp with Whisper large-v3-turbo and the engine venv (the setup skill installs them). Runs from the full motionmaxxing plugin folder (uses its lib/). German, English, Hindi and Hinglish takes.
---

# Cut

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md, and `${CLAUDE_PLUGIN_ROOT}` the plugin folder two levels above it.

The take's language (German, English, Hindi or Hinglish) is the one the user picked in the studio, else the one heard
when it is transcribed, saved in `edits/<name>/meta.json`; every script reads the take in it (fillers "äh", "umm",
"अम्म"; restarts "warte", "wait", "रुको", "phir se"; number words). The user's spoken words are never rewritten: a cut
only removes.

Hindi and Hinglish: Whisper writes Hindi in Devanagari and English words in Latin letters, and the same word can come
back in the other script in another take ("करना" / "karna"). The scripts compare Hindi words by sound, so read a mixed
transcript as one language and quote spans as Whisper wrote them. Hindi is Hinglish when English words make about an
eighth of it: its captions come out in Roman letters in the edit, while words.json stays as Whisper wrote it.

Read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` first: the rules every video in this plugin follows.

Every question goes in the question box: the AskUserQuestion tool (2-4 options, recommended first). Only in an agent without it, ask numbered questions in text.

```
edits/<name>/  transcript.txt (read this, never words.raw.json), spans.json (what to remove, quoted),
  candidates.md (what code flagged), paper-edit.md (the cut as text), cut-check.html (the
  transcript), review.json (notes), cut.mp4 + words.json (the render and its words).
```

`<name>` is a slug of the file name (`IMG_1234.MOV` -> `img-1234`), in the library
(PRINCIPLES.md "Where"). Never modify, move or copy the source file: pass its path. A library with profiles and no
`MM_PROFILE` set (outside the studio): ask which profile first, as PRINCIPLES.md says.

`PY="${CLAUDE_PLUGIN_ROOT}/lib/mm/run.py"`; `python3 "$PY"` runs the engine venv.
No venv yet: run the `setup` skill first. `S="${CLAUDE_SKILL_DIR}/scripts"`.

## No video yet?

Ask for their take's path. Several files: `references/takes.md`.

## 0a. A phone or WhatsApp clip, or several takes: make the source

A phone, screen recording or WhatsApp clip often has a variable frame rate (`ffprobe` shows `r_frame_rate` like
`600/19`), and render.py then refuses ("frame mismatch"). Make a constant-rate source first, and use it as
`<source>` from here on (the audio is untouched, so the words keep their times):

```bash
python3 "$S/join.py" edits/<name>/source.mp4 <their file>      # one clip: 30 fps, 48 kHz, sync checked
python3 "$S/join.py" edits/<name>/source.mp4 take1.mp4 take2.mp4 ...   # several: one source, in the order given
```

A video recorded in parts or in many takes (the studio's New video takes every clip at once): join the takes in
their order (the studio's, else their recording time: `--sort created`) and cut the joined source as one take. A
line said in two clips is a retake like any other: the last good one wins. `footage.py classify <clips>` tells takes
(the speaker at the camera) from b-roll when the user handed over a folder: b-roll is never joined into the talk.

## 0. Ask: the cut first, or everything at once

Before anything else, ask one question in the question box (start decides this for a whole edit):

> Do you want just the cut first, or the cut and the styled edit in one go?
> - **Just the cut first (Recommended).** You approve the cut before I add captions, zooms or
>   visuals, so a changed cut never rebuilds the visuals (fewer tokens).
> - **Everything at once.** I cut, then style without waiting. You still see the cut page and the
>   stills sheet before anything renders.

Skip it only when the user already answered ("just cut it", "cut and style it in one go") or start or
clips called this skill. **Just the cut first:** steps 1-6, then stop until the user approves the cut
**and** asks for the style. **Everything at once:** steps 1-5, open the cut page, go straight on to
edit; a later cut change re-runs edit from its plan step.

## 0b. Read the user's taste

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/taste/scripts/taste.py" show --edit edits/<name>
```

Follow every rule in it. Save a reaction to a result ("too slow") with the taste skill before redoing.

## 1. Transcribe

```bash
python3 "$PY" "$S/transcribe.py" <source> edits/<name>/words.raw.json [--script <their script>]
```

A script (or `--keyterm Name`, repeatable) gets names and jargon right. For a German take, pass every product, tool
and person the script names as a `--keyterm` (German capitalises every noun, so names are not picked out by case).
In a Hindi or Hinglish script, names and English terms are the words in Latin letters: they are picked out by themselves.

Say the time first: about a third of the take's length (whisper.cpp, large-v3-turbo, on the Mac's GPU; a 5-minute take
took 1:25). The language is detected first (`--lang de|en|hi|hinglish` to set it; the studio's pick is read from meta.json).
Hindi and Hinglish word times come from Whisper's alignment (DTW): its plain times ran up to a second early. Never download a model mid-edit: a model that is not
installed exits 4; run the setup skill.

Then, always, heal the transcript before deciding anything (about a minute):

```bash
python3 "$PY" "$S/transcribe.py" heal edits/<name>
```

The first pass hears the whole take at once, which gives the steadiest word times but two faults the cut cannot see
past: a line said twice in a row comes back once (Whisper reads its own words as context, and the repeats ARE the
retakes), and a fast run of words gets stamped on one moment ("Du ziehst die Datei in" all at 143.66 s), so the cut
keeps a 2-frame sliver and loses the words. heal hears the take again in 10 s pieces (verbatim) and takes those words
wherever they are more or better timed, then spreads any word run still stamped on one moment over the voice around
it. It prints each stretch it rewrote. Skipping it leaves hidden retakes in the cut (one take: "Schritt drei,
bring" kept before the full "Schritt 3, bring ihm bei, wer du bist").

**Never read `words.raw.json`**: step 2 writes `transcript.txt`, 1/12 the size.

## 2. Decide what to cut

```bash
python3 "$S/retakes.py" propose edits/<name>
```

Code finds every possible cut (a repeated line, an unfinished sentence, "wait, sorry", fillers)
into `candidates.md`. Each is a place to look, not a decision. Read `transcript.txt` and
`candidates.md`, follow `references/retake-detection.md`, and write `spans.json`
(`references/shapes.md`).

With a `script.md`: `python3 "$S/script_match.py" edits/<name>`, read `script-match.md` (`references/script.md`).

Last take wins, except alternate hooks, and the ending is no exception: a call to action said again and again at the
end of the take is a set of takes like any line (the last clean one wins; one owner's best ending was spread over
three lines recorded minutes apart). Never type a timestamp or span a pause.

A calmer later take of a line that has to play before an earlier take of the next line (the take's order is not the
video's): `moves.json`, `[{"text": "<the later take, quoted>", "after": <s>, "before": {"text": "<the next line>",
"after": <s>}}]`. The build plays the quoted range just before that line, and the piece that plays last gets the
ending's ring-out.

**When takes are close** (two complete takes of the same line, neither broken, or the last one a little worse), look
before you pick:

```bash
python3 "$S/takes.py" sheets edits/<name> <a>-<b> <a>-<b> [--line "the line"]
```

It writes `takes/takes.md`: a sheet of eight frames per take (Read each image: eyes on the camera or off it, energy, a
stumble) and its numbers (seconds, words a second, pauses, fillers, loudness). The last take wins unless it is worse.
Still close: watch the stretch with the watch skill (`motionmaxxing:watch`, video understanding) and decide from what you see and hear.

Only if the user wants it shorter (or their taste says to run the editorial pass), also read `references/editorial-rules.md` and add `redundant`
cuts (content calls).

A misheard name is one command, never a JSON rewrite: `python3 "$S/retakes.py" fix edits/<name>
cloud=Claude jiv=Lumo` (whole words, kept in `fixes.json` for the captions).

## 3. Build

```bash
python3 "$S/build_timeline.py" <source> edits/<name> && python3 "$PY" "$S/mirror.py" <source> edits/<name>
```

Every pause (breaths too) over `--max-pause` (0.15 s) becomes 0.10 s; under music only word gaps
are trimmed. A trim that would remove under 0.12 s is not made: inside a sentence it is a jump in the picture that
saves nothing. A build `ERROR` writes nothing: fix that span and run it again.

Then hear the joins again (every build, before every render):

```bash
python3 "$PY" "$S/rehear.py" edits/<name> --fix
```

Whisper times words worst where a line is started again (a restarted line labelled a second early), so a cut quoted
from its words can begin inside the take before: a half word, a false start, a breath ("From then on it lear- | From
then on it learns..."), which every transcript of the cut misses (the second hearing writes the restart once too).
`rehear.py` splits each piece's edges into stretches of speech by the audio, hears each alone, and cuts the ones that
are not the line: the end of the take before, a sound or a breath, a false start, a line said twice over a join. It
prints each cut with its time in the video, and moves the words heard there into the piece (words.json, captions).

`mirror.py` says `mirrored` when a book, shirt or sign reads backwards (a front-camera take): ask once,
**Keep it as shot (Recommended)** (most creators post it that way) / **Flip it so the text reads**; on a
flip add `--flip` to every render.py below.

In one message, start the spans encoding in the background (`run_in_background`) and the paper
checks; step 4 then encodes only what changed:

```bash
python3 "$S/render.py" <source> edits/<name> --segments-only
```

The `cut-judge` agent grades `paper-edit.md` (a flub left in, a bad join, a good line lost) and
fixes `spans.json`. Readers for takes over 5 min
go first, the judge after: `references/judge.md`. Never read `paper-edit.md` yourself.
- `CLIPPED` in `paper-edit.md`: a pause cut ate a word. Raise `--pad`. Still there: a label is off.
- Joins inside speech move to a quiet frame (with none in reach, to one 6 dB quieter), and a piece that ends on a
  sound still ringing rings out to one (at most 0.15 s); the video's last word rings out up to the next sound.
  Any `still in speech`: listen in step 5. They are placed by the build: never move a join by hand in `keep.json`.

## 4-5. Render and verify

Foreground (render.py waits for the background encode):

```bash
python3 "$S/build_timeline.py" <source> edits/<name> && \
python3 "$PY" "$S/rehear.py" edits/<name> --fix && \
python3 "$S/render.py" <source> edits/<name> && \
python3 "$PY" "$S/verify_cut.py" edits/<name> --engine <same engine as step 1>
```

Verify clean: the cut is ready, and the studio's page for the video shows it by itself. Verify diffs the cut's transcript with the kept words (exit 1 stops the chain):
- **MISSING**: a kept word is not in the render. Raise `--pad` (or narrow the span), rebuild, re-render.
- **SURVIVED**: verify prints a `HEAL first` line: run it (the stretches are heard again on their own), then step 2
  (`retakes.py propose`) on the healed words, add the span for the real repeat or stumble, never one that cuts a kept
  line, and run 3-5 again. That is the one fix cycle.
- **THE LINE, LABELS OFF**: kept words the raw transcript timed elsewhere, which rehear.py heard as the line right
  there: not a cut error, no rebuild.
- **HEARD DIFFERENTLY** ("lumo -> jeff") and filler notes are transcriber variance: no rebuild.
- **DOUBLED**: words said twice in a row. Natural ("very, very"): keep. A stumble: add its span.
- **N join(s) in speech**: listen. Clipped: `splice_check.py edits/<name> --fix`, re-render.

One fix cycle (the same chain), then show the user what is left.

**An editor's version of the same take** (the user's own posted cut): `python3 "$PY" "$S/editor_cut.py" <source>
<their cut> --edit edits/<name>` reads their kept pieces and every join from the audio and lists where ours differs
(stretches only one keeps, starts that differ); the taste skill's `learn.py <raw> <posted> --edit edits/<name>` saves
what it learns. A start that differs only by a fricative (the "Sch" of a word) is fine.

## 6. The user approves

In the studio, the video's page (`http://localhost:5199/videos/<name>`) shows the cut, the raw take, the transcript with
every cut word struck through, and a notes panel. Never open a browser or a review page yourself. End your turn with the
seconds before and after, what went, and anything worth a look. Outside the studio, give the path of `cut.mp4` and say
`mm` opens the studio.

- The user's own transcript edits (select words, Cut or Bring back) are applied by the studio itself (`edits.py`, then
  build and render). Their result is in `spans.json` (kind `manual`): never undo a `manual` span.
- Notes arrive as one message, each at a time on the cut ("12.4 s: keep the second hook"). Map the time to the raw
  take through `decisions.json`, fix each (a span narrowed, deleted or added; pauses: `--max-pause`), run steps 4-5
  once for all of them, then answer each note in one line, in order, starting with its time.
- "The user approved the cut." arrives as a status line. Then one Bash call: `python3 "$S/trend.py" log edits/<name>`
  (`tally`: trend), and the hook check. Then hook variants if `hooks.json` exists (`references/retake-detection.md`).

Only approval finishes the cut; `cut.mp4` and `words.json` go on to the edit. On "just the cut first", say they can
ask for the edit. Never start the edit on your own.

## If a script stops

| message | do |
|---|---|
| `no such file` / `ffmpeg could not read audio` | ask for the right path; never copy or convert the source |
| `whisper.cpp failed` / exit 4 (model not installed) | the setup skill (`setup.py doctor`, then `install-all`) |
| `ERROR frame mismatch` (render.py) | a variable frame rate source: step 0a, then build and render from `source.mp4` |
| build `ERROR` on a quote | fix that span's quote or add `occurrence`, build again |
| `cannot derive a silence threshold` / `marked no silence` | speech and background are under 10 dB apart: `ffmpeg -i <source> -af volumedetect -vn -f null -`, pass `--noise` about 10 dB above the mean |
| render `ERROR ...` | say it; re-run render once |

## Rules

1. Every cut quotes the transcript. No quote, no cut.
2. A script breaks ties between takes and keeps every take of a line it says twice. Nothing is cut for
   being off-script.
3. Never stream-copy (`-c copy`) across cuts: it lands up to 2 s off.
4. Never hand over a render that has not been verified and approved.

## Self-check

`test_build_timeline.py`, `test_retakes.py`, `test_media.py` (ffmpeg); `demo` on `transcribe.py`, `trend.py`, `splice_check.py`, `script_match.py`, `mirror.py`, `takes.py`, `rehear.py`, `editor_cut.py`.
