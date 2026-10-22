# motionmaxxing: working on this repo

A script and a raw recording in, a finished short-form video out. Phases and status: `docs/ROADMAP.md`.

## Layout

- `plugin/`: the Claude Code plugin the studio's Claude loads. `skills/<name>/SKILL.md` + `references/` +
  `scripts/`, `agents/*.md`, shared Python in `lib/mm/`, the Remotion renderer in `remotion/`. Scripts find
  `lib/` by relative path (`Path(__file__).resolve().parents[3] / "lib"`), so keep the layout.
- `src/`: the TypeScript studio (server + interface).

## Rules

- **Public repo.** Never commit recordings, scripts, client names or material, keys, or anything from
  `~/Movies/motionmaxxing`. Test media is generated or read from paths outside the repo.
- **No paid services, no API keys.** Claude runs on the user's own login (Agent SDK in the studio). Free stock
  keys live in the key file, never in the repo or the chat.
- **German first.** Anything that reads words (fillers, restarts, numbers, stop words, prompts) goes through
  `plugin/lib/mm/lang.py`, never an English-only list.
- **Real things only on screen:** no cards of words alone, no invented numbers, no stock icons or emoji.
- Python tools run in the engine venv (`python3 plugin/lib/mm/run.py <script>`), Python 3.10 to 3.13.
- Every script keeps a `demo` self-check. Run them before committing (see Tests).

## Tests

```bash
plugin/tests/demos.sh          # every Python script's self-check, no network
npm test                       # the studio (vitest), once src/ exists
```
