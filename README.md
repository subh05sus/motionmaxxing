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

## Status

Early, built in phases: [docs/ROADMAP.md](docs/ROADMAP.md).

## How it's made

| Folder | What |
|---|---|
| `plugin/` | A Claude Code plugin: the skills Claude follows, its agents, and the Python and Node tools they run (cut, edit, render, record). The studio's Claude loads it; Claude Code can use it directly. |
| `src/` | The studio: a local TypeScript server that runs Claude on your login, and the interface. |

## License

MIT. See [LICENSE](LICENSE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the tools it uses.
