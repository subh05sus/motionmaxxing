# motionmaxxing

A script and a raw recording in, a finished short-form video out.

It cuts the recording the way an editor would: the last take of every line, no fillers, no dead air, checked by
watching the takes where they are close. Then it edits on top:

- motion graphics designed for each beat, placed behind the speaker, on half the screen, in a small box or full
  screen
- zooms on the speaker's face
- real proof on screen: the post, the thread, the article, the quote clip
- b-roll from your own library or free stock
- captions and sound

You approve the cut and the edit in a studio that looks and feels like a Mac app, and every edit can go on in
CapCut, DaVinci Resolve or Premiere by hand. It also records product demos itself: Claude drives the site, the
waiting gets sped up and the camera follows the action.

It runs on your Mac with your own Claude login. No API keys, no paid services.

German first: the cut knows German fillers ("äh", "ähm"), restarts ("warte", "nochmal") and number words.

## Start

On a Mac with [Claude Code](https://claude.com/claude-code) signed in, and Node 20 or newer:

```bash
git clone https://github.com/subh05sus/motionmaxxing && cd motionmaxxing
npm install
bin/mm          # starts the studio and opens it: http://localhost:5199
bin/mm app      # optional: motionmaxxing.app in ~/Applications, for the Dock
```

The first run checks the Mac and installs what is missing in one click (ffmpeg, whisper.cpp, the editing tools and
the transcription model). Then drop a raw take on Home.

The studio:

- **New video**: the raw take, an optional script, a note for Claude, and one button.
- **The editor**: the video in the middle, the transcript on the left with every cut word struck through (select
  words to cut them or bring them back), Claude, your notes and the facts on the right, the timeline below. Notes are
  pinned to a moment and go to Claude together. Claude's questions show up as cards.
- **Styles**, **Library**, **Settings**. ⌘K finds anything, ⌘B folds the sidebar, ⌘/ shows or hides Claude.
- On a phone: watch, leave notes and approve.

Everything stays on the Mac, in `~/Movies/motionmaxxing`.

## Status

Early, built in phases: [docs/ROADMAP.md](docs/ROADMAP.md).

## How it's made

| Folder | What |
|---|---|
| `plugin/` | A Claude Code plugin: the skills Claude follows, its agents, and the Python and Node tools they run (cut, edit, render, record). The studio's Claude loads it; Claude Code can use it directly. |
| `src/server/` | The studio's server: runs Claude Code through the Agent SDK on your login, the library's videos, live events. Local only (127.0.0.1). |
| `web/` | The studio's interface: React, Tailwind and Apple's dark palette, glass only on floating controls. |
| `bin/mm` | Starts and opens the studio; `scripts/make-app.sh` makes the Dock app. |

## License

MIT. See [LICENSE](LICENSE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the tools it uses.
