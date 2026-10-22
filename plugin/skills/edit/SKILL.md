---
name: edit
description: Turns an approved cut into the finished video in the measured style of a creator (the owner's own by default). Takes cut.mp4 from the cut skill plus a style.json (a creator teardown or a sample), plans captions and face zooms to match, and puts real things on screen timed to the spoken word in four placements Claude picks per beat (behind the speaker, half the screen, a small box, the whole screen): real captures with the line marked, X and Reddit posts, news, a public figure's quote clip, logos, demo recordings, free stock b-roll, and a motion graphic built for each beat. No type cards, no stock icons, no emoji. Sound cues and music as the style has them. Renders 9:16 or 16:9 with Remotion on the Mac; the studio shows it. Exports to Final Cut, Premiere, Resolve or CapCut. Use when a cut is approved and the user says "make the edit", "style it", "add captions and zooms", "add b-roll", "render the edit", "change the captions" or "export to Final Cut". Not for a raw take (cut first) and not for measuring a creator (creator-teardown).
license: MIT
compatibility: macOS, Python 3.10+, ffmpeg, Node 20+ and the renderer, motion clip tools and models the setup skill installs; internet for captures, posts and stock. Runs from the full motionmaxxing plugin folder (uses its lib/ and remotion/).
---

# Edit

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md, and `${CLAUDE_PLUGIN_ROOT}` the plugin folder two levels above it.

Read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` first: the rules every video follows (where, asking, looking real, motion, story, privacy, cost).

Every question goes in the question box: the AskUserQuestion tool (2-4 options, recommended first). Only in an agent without it, ask numbered questions in text. `Attached images: <paths>` in an answer: Read each first.

An approved cut and a creator's style in. The finished video out: captions, face zooms, real things and motion
graphics timed to the words, in the creator's look and the user's brand. Claude checks the stills itself (step 5),
renders on the Mac (step 6), and the studio shows the result; the user's notes come from the studio.

Paths are relative to the library (PRINCIPLES.md). `S="${CLAUDE_SKILL_DIR}/scripts"`,
`VPY="${CLAUDE_PLUGIN_ROOT}/lib/mm/run.py"`; `python3 "$VPY"` is the venv Python.

```
edits/<name>/cut.mp4 + cut.transcript.json + words.json       (cut)
edits/<name>/style.json                                       (step 1: a creator's measured style, copied)
  or creator-teardowns/<handle>/style.json                    (one creator, from creator-teardown)
~/.motionmaxxing/profile.json                                 (brand kit, names, assets, avoid, sound)
captions.json -> beats.json -> visuals.json -> images/ + images.json -> plan.json -> stills/sheet.png -> render.mp4
```

References, read only when a step says: `references/visuals.md` (each format in detail),
`references/plan.md` (plan.py, cutout, sound, music, checks), `references/motion.md` (templates,
transitions, marks), `references/render.md` (live preview, export), `references/ai-tells.md` (the banned AI
looks). `references/contracts.md` is for people: never read it.

## 0. Read the taste and profile

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/taste/scripts/taste.py" show --edit edits/<name>
python3 "${CLAUDE_PLUGIN_ROOT}/lib/mm/profile.py" show
```

Follow every taste rule; the scripts read the settings themselves. When the user reacts to a result
("too slow", "captions too small"), save it with the taste skill before redoing the edit.

## 1. Check the inputs

- **No cut.mp4, or the cut not approved?** The cut skill first; never style a raw take.
- **The style** (`edits/<name>/style.json`): Claude picks it per video, never asks. In order:
  1. what the user named ("like the Card edit sample", a creator they had measured): copy that
     `creator-teardowns/<handle>/style.json` to `edits/<name>/style.json`;
  2. else the owner's own measured style when it exists (`creator-teardowns/own/style.json`, measured from his
     posted reels): copy it;
  3. else `python3 "${CLAUDE_PLUGIN_ROOT}/lib/mm/profile.py" style edits/<name>` (the default style).
  Say the style in one line ("In your own style: one-word captions, a punch-in about every 6 s").
- **The user's images and b-roll:** everything they hand over goes in `edits/<name>/images/` and `images.json`:
  `[{"src": "images/dashboard.png", "word": "dashboard", "nth": 1}]` (optional `layout`, `layer`, `hold_s`,
  `entrance`; transparent PNG and Lottie `.json` work). Their b-roll folders: `python3 "${CLAUDE_PLUGIN_ROOT}/lib/mm/broll.py"
  list`, then `broll.py sheet <name>`: look at every sheet, copy only clips that show what a line says.
- **A demo recording** (the record skill, `<library>/recordings/<name>/demo-9x16.mp4` or `demo.mp4`): copy it into
  `images/` and use it as a `video_card` on the line it shows. A line that says "Claude does X" or "on the site you
  click Y" and has no recording yet: record one with the record skill first (it asks once per site).

## 2. Captions text

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/cut/scripts/retakes.py" captions edits/<name>
```

Writes `captions.json` and `captions.txt`: the words heard in the finished cut (the verify step's
`cut.transcript.json`), timed to it, with every word that pass heard differently ("Jeff" for "Jev")
spelled as the approved cut text has it, names spelled as the profile's `names`, and every earlier
`retakes.py fix` applied. It prints each word it changed. Never read either JSON: proofread
`captions.txt`, the file captions are built from. A word still wrong is one command, which fixes
captions.json in place, timings untouched, and is kept in `fixes.json` for every later captions run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/cut/scripts/retakes.py" fix edits/<name> cloud=Claude jiv=Jev
```

Use captions.json from here on.

## 3. Visuals

**Read `references/shapes.md` and `references/motion-design.md` first**: each pick's shape and plan.py's
rules, then the default look and motion (built animations over captures, big in the band, one capture a page).

1. **Propose:** `python3 "$S/route.py" beats edits/<name>` splits captions.json into sentences,
   marks the named things (profile, logo-pack) into beats.json. Pick one route per sentence yourself
   (`none`, `capture:shot|browser|sticker`, `post`, `logo`, `logo_cluster`, `chat`, `terminal`,
   `toasts`, `side_by_side`, `video_card`).
2. **Real things first:** write `visuals.json` (`references/shapes.md`): a named product
   or doc becomes a `capture` (with `marks` found by text), a quoted post a `post`, an app an `app`,
   a video a `youtube`, a repo a `github`, a brand in passing a `logo`, an expert's words a clip (`references/visuals.md` "Sourced proof").
3. **Fill the overlays:** for the overlay picks, write only the props (`references/shapes.md`). Hand it to the `template-filler` agent (haiku) with the full path of `references/shapes.md` when available, else write them. Only
   words and numbers the speaker said. There are no type cards.
4. **Fetch:** `node "$S/capture.mjs" edits/<name>` fetches captures, logos, posts into `images/`, marks measured.
5. **Motion:** moving-template beats become bespoke clips (motion skill); a failed clip keeps its card.

**Where each visual sits: Claude picks per beat** (in visuals.json or images.json):

| placement | write | fits |
|---|---|---|
| a small box over the footage | nothing (the default), or `"box": [x, y, w, h]` in % | a logo, a post, a capture's marked line while the face stays |
| half the screen (9:16) | `"layout": "split"` | a page, a chart, b-roll: the visual on top, the speaker below |
| the whole screen | `"layout": "scene"` | a demo recording, stock b-roll, a motion graphic that needs the room |
| behind the speaker | `"layer": "behind"` | a big capture, a post or a clip that rises behind the head (the cutout, matte.py) |

Mix them: the style's pace says how many, the line says which. Never the same placement more than three beats in a
row; the face comes back at least every 8 s; a `scene` lasts 1.5-4 s. `"layer": "front"` keeps a card in front when
the style puts cards behind.

**Real things, in this order:** the user's own image or clip; a capture of the real page with the line marked
(`capture`); an X post (`post`); a Reddit thread or a news article (a `capture:browser` of the page with `marks` on
the sentence that proves the line); a public figure saying it (`references/visuals.md` "Sourced proof": `source.py`);
a demo recording (above); a logo; free stock b-roll; a motion graphic (the motion skill: an Opus clip-builder per
beat, in the video's personality). Nothing real fits: no visual on that line.

**Free stock b-roll** (Pexels and Pixabay with the user's free keys, Wikimedia Commons without one):

```bash
python3 "$VPY" "$S/stock.py" search "<english words>" --kind video --orientation portrait --out edits/<name>/stock/<words>
python3 "$VPY" "$S/stock.py" get edits/<name> <source>:<id> [--start S --end S]
```

Read the sheet (`stock/<words>/sheet.jpg`), take only a clip that shows what the line says (a generic office is never
"your agent works overnight"), use the printed `images/...` path as a `video_card`. `stock.py credits edits/<name>`
before the render writes credits.txt (Wikimedia's CC BY licences need the line).

Pacing: a copied creator's rate wins. route.py prints her cards a minute, kinds and place in the frame,
and marks that many sentences `want` (named ones first). Give each a card of her kind with a `box` at her
place, clear of the head: the user's own photo, else a capture of the real thing the line is about (page,
profile, post), else their own clip as a `video_card`. Never a made-up or stock picture: a `want` with
nothing real stays empty. Never ask what to show: pick the real capture (their own product's too). No creator: a card only where a line names something real. Never two at once; no
stretch without a card over `card_gap_s` (plan.py adds zooms there, `references/plan.md` "Pacing").
Vertical captures need a `find` to read on a phone. Card edit: `shapes.md`.

## 4. Plan

Find the speaker's head first, so no box covers the face, then plan with step 1's style.json:

```bash
python3 "$VPY" "$S/face.py" edits/<name>
python3 "$S/plan.py" edits/<name>/style.json edits/<name>/captions.json [--aspect 9:16|16:9] [--layout overlay|split|letterbox]
```

Writes `edits/<name>/plan.json`. Read every warning. It ends with the **style check** (`style_check.py`):
each `style:` line is a way the plan differs from the creator. Fix each (style.json, visuals.json,
images.json) and plan again before the stills; what the user changed is already the target.

1. **Music** follows the style unless the user set it (`references/plan.md` "Music"; plan.py lays the creator's bed itself), then plan.py again. Sound cues need nothing: plan.py adds them.
2. **Behind the speaker:** if the profile says `"behind": true`, run `matte.py` after the last plan.py run and
   again after any later one (it cuts only new frames); say its `--estimate` first (`references/plan.md`).
3. **Check the plan:**

```bash
python3 "$S/check.py" plan edits/<name> [--plan plan.json] [--style edits/<name>/style.json]
```

Fix every FAIL and plan again. What it FAILs: `references/plan.md`.

## 5. Stills, checked by you, then straight to the render

The user approved the cut: that approve means make the edit. Never wait for a second approve.

```bash
python3 "$S/edit.py" stills edits/<name>
```

Writes one still per beat and `stills/sheet.png` (labelled with beat, time and card kind). Review the sheet yourself;
open a single still only to zoom in. Fix before rendering: a box on the face, a zoom cutting the head, the wrong part
of a capture, text too small for a phone, a default AI look, a placement that hides what the line is about.

## 6. Render on the Mac

```bash
python3 "$S/edit.py" render edits/<name>            # render.mp4
python3 "$S/edit.py" render edits/<name> --draft    # 2/3 size, quick look: render-draft.mp4
```

Say the time once (`python3 "$S/edit.py" estimate edits/<name>` prints `Laptop:`). Nothing is uploaded.

## 7. Check

```bash
python3 "$VPY" "$S/check.py" render edits/<name> [--plan plan.json] [--style edits/<name>/style.json]
```

FAILs go back to the plan or the cut; at most two fix rounds, then hand over with what is still listed. A caption
contrast FAIL: plan again, then render. A `loudness ... LUFS` WARN is the take's own level: `loudness` in the profile
decides; not set, ask once ("Leave my audio as it is (Recommended)" / "Make it as loud as the apps expect"), then
`profile.py set loudness='"leave|normalize"'`; normalize: `python3 "$S/quality.py" normalize edits/<name>/render.mp4`.

## 8. Hand over in the studio

The studio's page for the video shows render.mp4 by itself (its Edit view) with the timeline of captions, visuals and
sound from plan.json. End your turn with one short message: the length, the style, how many visuals and where they sit,
and anything to look at. Notes arrive as one message, each at a time on the edit ("12.4 s: the post is too small"):
fix each (visuals.json, images.json, style.json, plan, stills, render), then answer each note in one line starting with
its time. "The user approved the edit." arrives as a status line: then `motion.py save` (the clips go to the motion
library) and stop. Captions and zooms: plan, stills, render; the cut: the cut skill.

## 9. Export to another editor

Only when the user asks to finish it by hand ("open it in Final Cut", "send it to Premiere"):

```bash
python3 "$S/export_nle.py" edits/<name> --to fcpxml|premiere|resolve|capcut|edl|srt|all
```

Writes `edits/<name>/export/`. Moving cards render with alpha first (about 0.7 s a card frame; say so).
Which file to open, YouTube chapters for 16:9: `references/render.md` "Export to another editor".

## If a script stops

| message | do |
|---|---|
| `no cut.mp4 in ...` (plan.py, face.py) or `cut.mp4 missing` (edit.py) | run the cut skill first |
| `no creator style.json found for the profile's creators` | creator-teardown quick mode, then `profile.py style` again |
| `note: ... style.json not found; planning with the default style` | fine with no creator; `profile.py style edits/<name>` keeps it with the edit |
| `no cut.transcript.json` (retakes.py captions) | run the cut skill's verify step |
| `the split layout is vertical only` | plan again with `--layout overlay` |
| `check.py plan found a FAIL` (edit.py stills) | fix the FAIL in the plan, plan again |
| `... missing (run matte.py)` | run matte.py, then stills or render again |
| `... missing (run sfx.py build, then plan.py)` | do exactly that |
| `no Chrome Headless Shell` (capture.mjs) | `python3 "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/setup.py" remotion`, then capture again |
| capture.mjs `failed <kind> '<word>'` | drop that visual or give it another URL; the rest were saved |
| `the laptop render failed` | `references/render.md` "If a render stops" |

## Files

- `scripts/`: one script per step above, each with a `demo` self-check.
- `${CLAUDE_PLUGIN_ROOT}/agents/template-filler.md` (haiku), `stills-critic.md` (sonnet): the helpers.
- `${CLAUDE_PLUGIN_ROOT}/remotion/`: the renderer, copied to `~/.motionmaxxing/remotion` on every run.
