---
name: setup
description: Checks and installs what motionmaxxing needs on a Mac (ffmpeg, Node, whisper.cpp, a Python 3.10-3.13 for the engine, the pinned Python packages, the Whisper large-v3-turbo model) and says the fix for anything missing. Use when the user says "set up motionmaxxing", "install it", "setup", "run the doctor", when a step fails because a tool is missing, or when the studio's first-run page starts setup. Not for editing a video (start, cut) and not for changing an edit preference (taste).
license: MIT
compatibility: macOS with Homebrew. Needs internet for the installs and the 1.6 GB model download.
---

# Setup

Paths: `${CLAUDE_SKILL_DIR}` is the folder containing this SKILL.md, `${CLAUDE_PLUGIN_ROOT}` the plugin folder two
levels above it. `U="${CLAUDE_SKILL_DIR}/scripts/setup.py"`, run with `python3`.

Every question goes in the question box (AskUserQuestion, recommended option first). The user may never have used a
terminal: say what each tool is for in one line before installing it.

## 1. Doctor

```bash
python3 "$U" doctor            # one row per tool: ok, or FIX with the command
python3 "$U" doctor --json     # the same rows for the studio's setup page
```

`Ready.` means everything is in place. Otherwise:

## 2. Install what is missing

```bash
python3 "$U" install-all       # run_in_background: Homebrew installs, the engine's venv, the model, in order
```

It never asks. Each step is a progress event (job `setup`) the studio's setup page shows. A line it prints as `FIX`
(Homebrew itself missing, anything needing a password) is the user's to run in their own terminal: give them the exact
command. What each tool is for:

- **ffmpeg** cuts, joins and measures the video.
- **Node** runs the renderer and the studio.
- **whisper.cpp** writes down every word on the Mac's GPU (Whisper large-v3-turbo, 1.6 GB, downloaded once and checked).
- **Python 3.10-3.13** holds the engine's own packages (the system python3 can be too new for them).

Then `doctor` again until it says `Ready.`

## If a script stops

| message | do |
|---|---|
| `no Python 3.10-3.13 on this Mac` | `brew install python@3.12`, then `venv` |
| `pip failed` | run `python3 "$U" venv` again once; the same error twice: show its last line |
| a model download that does not match its sha256 | run `model` again; it repeats: the file changed upstream, report it |
