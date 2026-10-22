---
name: record
description: Records a product demo by driving a website itself, claude.ai included, in motionmaxxing's own browser, then finishes it like a screen recording made by hand. Every frame sharp at 2x, the waiting (a reply streaming, a page loading) sped up smoothly, a camera that zooms to each click and field and pulls back for the overview, a drawn macOS cursor with click rings, a Mac window around it, personal data blurred. Wide 16:9 and vertical 9:16. Use when the user says "record a demo", "show Claude doing X", "record claude.ai", "screen recording of <site>", "show the product", "demo this website", or when an edit needs a screen recording of a site or of Claude answering. Not for a still screenshot of a post or article (that is a capture in the edit), and not for recording the user's own screen.
license: MIT
compatibility: macOS, Google Chrome, Node 20+ with the repo's npm packages (puppeteer-core), ffmpeg, the engine venv (Pillow, numpy).
---

# Record

Paths: `${CLAUDE_SKILL_DIR}` is the folder of this SKILL.md, `${CLAUDE_PLUGIN_ROOT}` the plugin folder two levels up.
`R="${CLAUDE_SKILL_DIR}/scripts/recorder.mjs"` (run it as `node "$R" ...`), `PY="${CLAUDE_PLUGIN_ROOT}/lib/mm/run.py"`,
`S="${CLAUDE_SKILL_DIR}/scripts"`. Every question goes in the question box (AskUserQuestion).

A recording lives in the library: `<library>/recordings/<name>/` (`python3 "${CLAUDE_PLUGIN_ROOT}/lib/mm/library.py" path`),
`<name>` a short slug of what it shows. Inside: `shots.json` (the plan), `frames/`, `events.json`, `demo.mp4`
(16:9), `demo-9x16.mp4`, posters and `demo.json` (length, the time map, each click's time in the video).

## 1. The site: ask once, sign in once

`node "$R" sites` lists the sites the user allowed; `"*"` means every site (the user said "allow all websites":
`node "$R" allow all`), so never ask. Otherwise, a site not in it: ask once, before anything touches it:
"Claude drives <site> in its own recording browser: it clicks, types and records there (signed in only if you
sign in to it). Allow <site>?" Options: "Allow <site>", "Not this site". On yes: `node "$R" allow <host>`. Never ask again
for that site. localhost is always allowed.

The recording browser is Chrome with its own profile (`~/.motionmaxxing/browser`): the user's own Chrome, cookies
and accounts are never used. A site that needs an account (claude.ai does): when `look` says `"signIn": true`, ask
"Sign in to <site> in the recording browser? A window opens: sign in there, then close it." and on yes run
`node "$R" login <url>` (it waits until the window is closed). Never type a password yourself, never ask for one.

## 2. Look before you plan

`node "$R" look <url> --out <dir> --headless` loads the page, writes `look.png` (read it: what a viewer sees) and prints
the page's title, headings, text, and every visible control with a `selector` that finds it again. Look at every
page the demo passes through (after a click that opens a new page, look at that URL too).

## 3. The shot list

Write `<dir>/shots.json`. Each step is what a person does; the time between steps is real. Keep it to what the
line in the script needs: 10-40 s of recording, one idea.

```json
{
  "url": "https://claude.ai/new",
  "blur": ["nav [data-testid='recents']", "[data-testid='user-menu-button']"],
  "steps": [
    {"do": "click", "target": {"selector": "div[contenteditable='true']"}},
    {"do": "type", "text": "Erstelle mir einen Wochenplan für ...", "cps": 20},
    {"do": "press", "key": "Enter"},
    {"do": "wait", "for": {"idle": true}, "max": 240},
    {"do": "scroll", "to": {"text": "Montag"}},
    {"do": "focus", "target": {"text": "Montag"}, "ms": 1800},
    {"do": "pause", "ms": 1200}
  ]
}
```

| step | does |
|---|---|
| `click` `{target}` | moves the hand there on a curved, eased path and clicks. `"confirmed": true` only after the user said yes (see Safety) |
| `hover` `{target}` | moves there and rests |
| `type` `{text, cps, target?}` | types like a person (cps 14-24; `\n` is Shift+Enter). With `target` it clicks the field first |
| `press` `{key}` | `Enter`, `Escape`, `Tab`, combos `Meta+K` |
| `wait` `{for}` | `{selector}`, `{text}`, `{gone: selector}`, or `{idle: true}`: nothing on the page changes for 2.5 s and no Stop button shows (a reply finished streaming). `max` seconds (default 30, idle 180). Waits play fast in the video; `"speed": "normal"` keeps one real-time |
| `scroll` | `"to": <a target>` brings it into view (`{"do": "scroll", "to": {"text": "Film"}, "at": 0.25}`; `at`: where, 0.3 = upper third), `"to": "bottom"`, `"by": px`; smooth, in the right container |
| `focus` `{target, ms}` | the camera holds on it (the answer's key line) without a click |
| `goto` `{url}` | another page (its load plays fast) |
| `pause` `{ms}` | real time, for the viewer to read |

Targets: `{selector}` from `look`, `{text}` (visible text or label: the best match, clickable first), `{role, name}`.
Prefer `data-testid`, `aria-label` and text over long `nth-of-type` paths. Any step takes `timeout` (seconds to
find its target) and `after` (ms to rest after it).

**Blur**: everything personal: the account name and avatar, chat or project histories, inboxes, other people's
names. Emails, phone numbers, keys and IBANs are blurred by themselves. List selectors in `blur`.

**claude.ai**: start at `https://claude.ai/new`; the prompt field is `div[contenteditable='true']`; Enter sends; the
reply is done when `{"idle": true}` returns. Blur the sidebar's recents and the account button (find them in
`look`), or start with the sidebar closed. Write the prompt in the language of the video.

## 4. Record

```bash
node "$R" run <dir>/shots.json --out <dir>
```

Headless by default (nothing takes over the screen); a site that refuses headless browsers: `"headless": false` in
the shot list. Exit 1: `fail.png` shows the page when it stopped and `run.log` the step: fix the step (look again)
and run again. Exit 3: the site is not allowed yet (step 1). It stops at the first failing step: never hand over a
recording with a failed step.

## 5. Finish

```bash
python3 "$PY" "$S/render.py" <dir>                    # demo.mp4, 16:9, 1920x1080
python3 "$PY" "$S/render.py" <dir> --aspect 9:16      # demo-9x16.mp4, for a reel
```

Options: `--aspect 1:1|4:5`, `--zoom 2.4` (most it zooms), `--look bare` (no window), `--badge` (shows "▶▶ 6×" while
fast), `--no-fast`, `--fps 60`. Then check it: `ffmpeg -v error -i <dir>/demo.mp4 -vf "fps=1/2,scale=480:-2,tile=4x3"
-frames:v 1 <dir>/sheet.jpg` and read the sheet: is anything personal unblurred, does the camera land on what
matters, did the page show what the line says? Fix and run again if not. End with the length and the path; the
studio's Demos page shows it.

## Safety

- A click on anything that deletes, pays, buys, subscribes, posts, publishes, transfers or signs out is refused by
  the recorder. When the demo truly needs one (a post on a test account), ask the user first, then add
  `"confirmed": true` to that step.
- Never record a page with someone else's private data. Never type a password, a key or a card number.
- The recording stays on the Mac.
