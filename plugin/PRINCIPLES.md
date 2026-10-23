# Principles

The rules every skill follows. Each names where it is enforced.

## Where and on what

- Work in the library (`lib/mm/library.py path`, `~/Movies/motionmaxxing`) or a folder the user names. Never in the
  code folder, never anything private in it. (`library.py`)
- Everything runs on this Mac, on the user's own Claude login. No API keys, no paid services: transcription is
  whisper.cpp on the GPU, looking at frames is Claude. Free stock libraries take a free key in Settings.
- German, English, Hindi and Hinglish: anything that reads speech goes through `lib/mm/lang.py` (fillers, restarts,
  numbers, stop words, sentence ends, Whisper's prompt), and Hindi words are compared by sound in either script
  (`lib/mm/hindi.py`). The speaker's own words are never rewritten: a cut removes, it never rephrases.

## Asking

- Every question goes in the question box (AskUserQuestion), recommended option first, free text always allowed. The
  studio shows it as a card on the page the user is on.
- Taste is asked once and saved; each video asks only what belongs to it. (`profile.py`, taste)
- Undo beats asking: anything reversible just happens and can be undone; only destructive steps ask first.

## The cut

- Every cut quotes the transcript; no model types a timestamp. (`build_timeline.py`)
- The last complete take of a line wins, unless it is worse: when takes are close, look at them (`takes.py`, /watch).
- A cut is checked by hearing it again (`verify_cut.py`) and graded on paper (`judge_cut.py`, the Opus cut-judge).
- Joins land on quiet audio, pauses are tightened to the measured taste, never closed to nothing.

## Looking real, never AI-made

- Real things carry each beat: the user's own footage and photos, real captures of what is named, real posts, threads
  and articles, real logos, the real UI, real demo recordings. A number is shown inside the page that published it.
- No cards of words alone, no invented stats, quotes or copy: on-screen words come from the speaker or the source.
- No stock icons, no emoji, no default AI looks (purple-blue gradients, neon on dark glass, Inter as a display face).
- Never cover the speaker's face; graphics may sit behind the speaker only with the cutout.

## Motion

- Smooth before varied: one easing language per film, moves that overlap, zooms framed on the head, nothing stops
  dead. Every element lands on its spoken word.

## Learning

- Every correction becomes a rule for the next video (`lib/mm/taste.py`), counted, with regressions shown.
- A raw take and the reel that was posted teach the cut (`skills/taste/scripts/learn.py`).
