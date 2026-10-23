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

It cuts German, English, Hindi and Hinglish. The cut knows each language's fillers ("äh", "umm", "अम्म"), restarts
("warte", "wait", "रुको", "phir se") and number words, and it hears Hindi by sound: a retake Whisper wrote in Latin
letters still matches its first try in Devanagari. Hindi captions are in Devanagari, Hinglish ones in Roman letters
("aaj hum AI tools ki baat karenge"), and Devanagari has its own font in captions and motion graphics.

## Start

You need a Mac with [Homebrew](https://brew.sh) and a Claude plan that includes Claude Code (Pro or Max): the studio's
Claude runs on it, never an API key. Google Chrome is used for demo recordings.

```bash
brew install subh05sus/tap/motionmaxxing
mm login    # once: sign in to Claude in the browser window that opens
mm          # starts the studio and opens it: http://localhost:5199
```

Homebrew brings Node, FFmpeg, whisper.cpp and Python with it. The first time, the studio opens on its setup page:
**Set up everything** installs the rest in the background (the editing tools, the transcription model, the renderer,
the motion clip tools and the face and cutout models: 3.3 GB, once, under four minutes on a fast connection). Then
drop a raw take on Home.

| Command | What it does |
|---|---|
| `mm` | Starts the studio if needed and opens it. |
| `mm start`, `stop`, `status`, `logs` | Starts it without opening a browser, stops it, says whether it runs, shows its log. |
| `mm login` | Signs in to Claude. |
| `mm doctor` | Lists what this Mac has and what it still needs. |
| `mm setup` | Installs what is missing, here in the terminal instead of on the setup page. |
| `mm app` | Puts motionmaxxing.app in ~/Applications, for the Dock. |

To update: `brew upgrade motionmaxxing && mm stop && mm`.

To work on it: `git clone https://github.com/subh05sus/motionmaxxing && cd motionmaxxing && npm install`, then the
same commands as `bin/mm` (update with `git pull && npm install && bin/mm stop && bin/mm`). `scripts/release.sh X.Y.Z`
tags a release and points the Homebrew formula at it.

The studio:

- **New video**: the raw takes (one, or every part and the b-roll at once: each clip is checked for you talking to
  the camera, takes are joined in order, b-roll goes to the Library), the language (or Auto), an optional script, a
  note for Claude, and one button.
- **The editor**: the video in the middle, the transcript on the left with every cut word struck through (select
  words to cut them or bring them back), Claude, your notes and the facts on the right, the timeline below. Notes are
  pinned to a moment and go to Claude together. Claude's questions show up as cards.
- **Approve the cut** and Claude makes the edit on top, in your measured style (a creator teardown of your own
  reels): captions, face zooms, real captures with the line marked, posts, logos, demo recordings, free stock
  b-roll and a motion graphic per beat, each placed behind you, on half the screen, in a small box or full screen.
  The timeline shows every visual by placement, the captions, zooms and sound. **Export** writes Final Cut,
  Premiere, Resolve, EDL, SRT, the CapCut steps and a handoff folder for an editor.
- **Demos**: a site and a sentence ("ask Claude for a meal plan and show the answer arriving"). Claude drives the
  site in its own browser and records it; the waiting plays fast, the camera follows each click, personal data is
  blurred. Wide and vertical.
- **Scripts**: paste a script before you record; Claude checks every number, name and step against sources found
  today and suggests fixes in your words.
- **Library**: your b-roll (rename it, delete it, add more; every edit can use it), what each video takes up, and
  Recently deleted.
- **Styles**, **Settings**. ⌘K finds anything, ⌘B folds the sidebar, ⌘/ shows or hides Claude.
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

Each part of a video is made with the engine that does it best:

| Part | Made with | Why |
|---|---|---|
| The cut | FFmpeg | Frame-exact pieces of the raw take; nothing is drawn again. |
| Motion graphics, one clip per beat | HyperFrames and GSAP, on reelcut's kit | Claude writes each clip as a web page (springs, iPhone and Mac UI, Clawd), and every frame is checked before it is used. |
| The finished video | Remotion | One composition holds the speaker, captions, zooms, layouts, the clips and the sound, frame by frame. |
| Export | FFmpeg | Finished clips go out as files; nothing is rendered twice. |

## License

MIT. See [LICENSE](LICENSE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the tools it uses.
