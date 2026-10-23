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
- A recording made for the video (the record skill) goes in it, and so does any in the library that shows what a line
  names (`library.py recordings`: each one's page and what it shows), whichever video it was made for: as a footage
  clip (below), never as a zoomed page crop in the panel (cut headings, a sliced nav bar). check.py plan FAILs a recording made for the video that is in
  no clip (its brief.json "for"), unless its brief says "skip": "<why>".
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
- **Background**: the speaker covers the middle and bottom. Content goes in the band above his head (13-40% of the
  height) and beside it. The captions sit on his chin (about 74-80%), over the speaker, not over the clip.
- **Cutaway**: a full phone screen; keep the caption band (74-80%) clear (a notification rises into the lower half,
  iOS-like, and stops above it).

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
ground line from beat to beat. `pose(tl, c, at, id)` plays one of the mascot pack's 70 poses (`motion.py poses --tag
idea` lists them).

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

## Footage: a recording in a clip

A demo recorded for the video (the record skill, `recordings/<name>/`) is shown in a clip like any other beat: in a
browser window (traffic lights, the page's address), framed on whole sections, with a ring or a highlighter on the
part that is said.

1. A plain render to frame from: `render.py <recording> --aspect 16:9 --zoom 1 --look bare --no-cursor --out plain.mp4`
   (the page as recorded, no camera moves of its own). events.json has each target's box and time; a frame with a
   percent grid tells where each section sits (fractions of the video).
2. Copy it into the clip's `assets/`. Each `<video>` needs an `id` (the renderer freezes one without): `<video
   id="v-hero" src="assets/site.mp4" data-start="0" data-duration="3.2" data-media-start="0.6" muted playsinline
   preload="auto">` inside `.rc-footage .rc-fv`. Two moments of one recording: two boxes, crossfaded.
3. Frame a region `[x, y, w, h]` (fractions, `w = h` keeps the video's shape) with the inner layer's transform, from one
   region to the next (`RC.zoomTo` always starts from the whole video). Regions stay inside the page (a plain render
   has dark side bars), and the text must read on a phone: a card's body text at 20 px or more.
4. Never a slice: a neighbouring card's edge in the view gets a veil in the page's own colour (sampled from the frame)
   over it, inside `.rc-fv`, so the section reads as one whole piece. A search box cropped to itself and its answer.
5. The line said: `RC.spot` (a ring) for a button or a row; a highlighter (`.rc-spot` with no border, an accent fill
   at about 28%, wiped in with scaleX) for a phrase inside a paragraph, where a ring would cut the lines around it.
6. List the recording in beat.json `"footage": ["recordings/<name>"]`, so check.py sees it used.

## After a re-cut

`python3 "$M" retime edits/<name>` finds each clip's words again on the new cut and moves the clip with them (its
words and DURATION in index.html, beat.json); clips run back to back. A clip whose line changed is listed: build it
again. Then check every clip (two at a time), place-kit, plan, align, plan, matte, plan, render.

