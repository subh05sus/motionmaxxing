# Kit clips: a motion graphic on almost every line

The default for vertical edits whose style asks for motion (style.json `motion.engine` "clips", `amount` over 0).
Each beat is one clip built for its line on the kit in `kit/` (Apple springs, iPhone and Mac UI, Clawd), placed
where the line plays best. `check.py plan` FAILs an edit whose style asks for motion and that has none.

Build the clips here, in this session, one after another: no clip-builder agents (they cost the user's tokens).

```
plan the beats -> motion.py scaffold (one per beat) -> write each index.html -> motion.py check (2 at a time)
  -> motion.py place-kit -> plan.py -> motion.py align -> plan.py -> matte.py -> plan.py -> check.py plan
  -> edit.py render -> check.py render -> look at frames from every beat
```

## 1. The beat map

Read the cut's sentences with their times (captions.json). Dense, like a creator's posted reels: a clip for most
sentences. For each, one idea and where it plays:

| where | `layout` | for | size |
|---|---|---|---|
| half the screen (the speaker below) | `panel` | UI moments, lists, flows, a chat, a file, switches | 1200x840 |
| behind the speaker (cut out in front) | `background` | the hook, a big number, a step badge, a payoff | 1080x1920 |
| the clip alone, full screen | `cutaway` | a phone moment: a lock screen at 7:30, an incoming call | 1080x1920 |

- Clips run back to back: each clip's `t0` is the previous clip's end. Half-screen clips crossfade into each other.
- Not too fast: a cutaway holds about 2 s or more; never more than three layout changes in ten seconds.
- A real recording (the record skill) only as a whole designed shot. Never a zoomed page crop in the panel (cut
  headings, a sliced nav bar): build the idea as a clip instead.
- The speaker's face for an avatar or a thumbnail: `motion.py portrait <edit>` (a pause between words, the head
  centred), then look at `images/avatar.jpg` and `images/portrait-9x16.jpg`; `--at T` for another moment.

## 2. Scaffold

```bash
python3 "$M" scaffold edits/<name> 05-google panel 12.45 2.55 --images avatar.jpg --line "Schritt 2, melde dich …"
```

`motion/<id>/` gets `index.html` (the template), `assets/` (the kit, its fonts, GSAP, the edit's `logo-*.svg` and
the images named), `beat.json` (`"engine": "kit"`). The words said in the clip are in `window.__rcVoice` on the
clip's clock: `RC.word("Google", 0, 0.93)` is when "Google" is said (0.93 s if it is not found).

## 3. Write the beat

Markup inside `.cam`, CSS in the style block, the timeline before `RC.hold`. The kit's API: `kit/docs/kit.md`
(helpers, springs), `kit/docs/apple-ui.md` (iPhone, Mac, apps, feedback), `kit/docs/clawd.md` (Clawd). The ground
is the edit's panel ground (#F4F4F2): the clip and the panel are one surface.

Composition (the gates check these):
- **Panel**: the drawing's bounding box covers at least 55% of the panel and is centred within 2% of its width; the
  corners stay ground (no full-width bar touching them). Big type: 50-96 px. Real logos from `assets/logo-*.svg`.
- **Background**: the speaker covers the middle and bottom. Content goes in the band above his head (13-30% of the
  height) and beside it; the captions sit at about 34%: keep 31-37% clear or let them sit on a quiet ground.
- **Cutaway**: a full phone screen; keep the caption band clear (a notification rises into the lower half, iOS-like).

Motion:
- Every part lands on its word (`RC.word`, 0.1-0.3 s early). Something moves until the end: `RC.camera` on `.cam`,
  a loop, a pulse. Eight still frames in a row fail ("stall").
- Nothing big appears in one frame ("spike"): resolve type per letter (`RC.chars`), fade 0.35 s, rise on a spring.
- Frame 0 is the ground: everything enters ("frame-0 flash"). Clawd fades up or enters.
- Text stays readable 0.25 s + 0.3 s a word ("reading"): no label on a moving prop, nothing arriving in the last
  half second. Text is the speaker's words; mark it with a `real-text:` comment.
- Springs: `spring.default` (panels, cards), `spring.gentle` (words), `spring.snappy` (presses), `spring.reward` once a
  reel. `apple.out` for fades, `apple.glide` for a hand or a bar. Never `expo`, `back` or `elastic`.
- A state that changes (Folgen to Gefolgt) crossfades two layers; never `tl.call` (it does not run backwards).

Clawd (reels about Claude, or as a host): `RC.clawd(".cam", { x, y, size })`, then `enter`, `look`, `jump`,
`wave`, `hold` / `drop` (a file into a chat), `carry`, `react`, `dress`, `confetti`, `life` last. Same size and
ground line from beat to beat. `pose` is not available (its pack is not shipped).

## 4. Check, place, align, render

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/lib/mm/run.py" "$M" check edits/<name>/motion/<id>   # at most 2 at a time
python3 "$M" place-kit edits/<name>
python3 <edit>/plan.py … ; python3 "$M" align edits/<name> ; python3 <edit>/plan.py …
python3 <edit>/matte.py edits/<name> ; python3 <edit>/plan.py …     # backgrounds need the speaker cut out
```

`place-kit` puts every passed clip in visuals.json (its render in `images/motion-<id>-<hash>.mp4`), on the first
word said once the clip has begun, held to the clip's end; a beat or image inside a clip's time is left out (kept
in `*.before-kit.json`). `align` sets each clip's `start_s` from where the plan started its card, so its parts stay
on their words. Then render, `check.py render`, and look at a frame from every beat before handing it over.
