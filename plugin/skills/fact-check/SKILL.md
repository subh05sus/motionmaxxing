---
name: fact-check
description: Fact-checks a video script before it is recorded. Splits it into every checkable claim (numbers, prices, names, dates, product features, steps, "X does Y"), has fact-checker agents check them in parallel against sources found now, and writes facts.md in German: each line of the script, its verdict with dated sources, and a fix in the speaker's own words for anything wrong, outdated or vague. Use when the user pastes a script and says "check the facts", "fact check my script", "is this right", "stimmt das", or the studio's Check the facts button starts it. Not for another creator's finished video (that is a separate, deeper process) and never rewrites the script itself.
license: MIT
compatibility: Claude Code with web search and fetch.
---

# Fact-check a script

Paths: `${CLAUDE_SKILL_DIR}` is the folder of this SKILL.md, `${CLAUDE_PLUGIN_ROOT}` the plugin folder two levels up.
The script's folder: `<library>/scripts/<name>/` with `script.md` (the user's text, never changed).

## Rules

1. **No verdict from memory.** Every verdict needs a source opened in this session, with its date. Without one the
   verdict is `ungeprüft`.
2. **The script stays the user's.** Never rewrite script.md. A fix is a suggestion beside the line, in the speaker's
   voice (German, du, short), only where a viewer would otherwise be misled or stuck.
3. **No em dashes** in anything German. A comma, a full stop or "und".
4. **Every wrong line gets a way out**: the right number, the new name, the step that works today, the free path.

## 1. Claims

Read script.md. Write `claims.md`: one claim per line with an ID, the script's own words in quotes, and what would
prove it:

```
C1 | "Base44 hat einen Superagent, der rund um die Uhr läuft" | Base44's own page or docs on the Superagent
C2 | "mit nur einem Klick" (Gmail, Kalender, Drive, Notion) | the connector list and how connecting works
```

Checkable: numbers, prices, limits, dates, names of products, plans and features, what a tool does, steps that must
work, comparisons. Not checkable: opinions, jokes, the speaker's own experience ("ich nutze"). Skip those.

## 2. Check, in parallel

Split the claims into batches of 3 to 5 (claims about the same product together). Launch one `fact-checker` agent per
batch, all in one message, each with the full path of claims.md and its IDs. Merge their JSON. A claim two agents
disagree on: open the sources yourself and decide; still unclear: `ungeprüft`.

## 3. facts.md

Write `facts.md` in German, for the speaker, in the script's order:

```
# Faktencheck: <title>

Stand: <date>. <n> Aussagen geprüft: <k> korrekt, <f> falsch, <v> veraltet, <u> ungenau, <x> ungeprüft.

## Zuerst ändern
- **Zeile 4** "…": falsch. <truth in German>. Vorschlag: "<fix_de>" ([Quelle](url), 2026-09-14)

## Alle Aussagen
| # | Aussage | Ergebnis | Quelle | Vorschlag |
|---|---|---|---|---|
```

"Zuerst ändern" lists only falsch, veraltet and ungenau, the worst first. End your turn with three lines in English:
the counts, the one change that matters most, and the path of facts.md.
