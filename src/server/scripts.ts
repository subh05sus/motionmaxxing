import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY, slug } from "./paths.js";

/** Scripts the user pasted to fact-check: <library>/scripts/<id>/ with script.md (theirs), meta.json, and the
 * fact-check skill's claims.md, facts.md (in the script's language) and facts.json (the counts). */

export const SCRIPTS = path.join(LIBRARY, "scripts");
export const scriptDir = (id: string): string => path.join(SCRIPTS, path.basename(id));
interface Meta { title: string; createdAt: string; session?: string }
const read = (f: string): string | null => { try { return readFileSync(f, "utf8"); } catch { return null; } };
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

export function newScript(text: string, title?: string): string {
  mkdirSync(SCRIPTS, { recursive: true });
  const first = text.trim().split(/[.!?।](?=\s|$)|\n/)[0]!.trim();   // । ends a Hindi sentence
  const t = (title?.trim() || (first.length > 60 ? first.slice(0, 60).replace(/\s+\S*$/, "") + "…" : first)) || "Script";
  const base = slug(t);
  let id = base, n = 2;
  while (existsSync(scriptDir(id))) id = `${base}-${n++}`;
  mkdirSync(scriptDir(id), { recursive: true });
  writeFileSync(path.join(scriptDir(id), "script.md"), text.trim() + "\n");
  writeFileSync(path.join(scriptDir(id), "meta.json"), JSON.stringify({ title: t, createdAt: new Date().toISOString() }, null, 1));
  return id;
}

export function meta(id: string): Meta {
  try { return JSON.parse(readFileSync(path.join(scriptDir(id), "meta.json"), "utf8")); } catch { return { title: id, createdAt: new Date().toISOString() }; }
}
export function saveMeta(id: string, m: Meta): void { writeFileSync(path.join(scriptDir(id), "meta.json"), JSON.stringify(m, null, 1)); }

export const VERDICTS = ["correct", "wrong", "outdated", "imprecise", "unchecked"] as const;
const GERMAN: Record<string, string> = { korrekt: "correct", falsch: "wrong", veraltet: "outdated", ungenau: "imprecise", "ungeprüft": "unchecked" };

/** The counts by verdict: facts.json (any language), else the German summary line of a facts.md written before it
 *  ("Stand: …. 12 Aussagen geprüft: 7 korrekt, 2 falsch, …"). */
function counts(d: string, facts: string | null): Record<string, number> | null {
  try {
    const j = JSON.parse(readFileSync(path.join(d, "facts.json"), "utf8")) as Record<string, unknown>;
    if (typeof j.total === "number") {
      const out: Record<string, number> = { total: j.total };
      for (const k of VERDICTS) if (typeof j[k] === "number") out[k] = j[k] as number;
      return out;
    }
  } catch { /* none yet, or an older check */ }
  const m = facts?.match(/(\d+) Aussagen geprüft:([^\n]*)/);
  if (!m) return null;
  const out: Record<string, number> = { total: Number(m[1]) };
  for (const [, n, k] of m[2]!.matchAll(/(\d+)\s+([a-zäöüß]+)/gi)) out[GERMAN[k!.toLowerCase()] ?? k!.toLowerCase()] = Number(n);
  return out;
}

export function summary(id: string) {
  const d = scriptDir(id), m = meta(id), facts = read(path.join(d, "facts.md"));
  return {
    id, title: m.title, createdAt: m.createdAt, session: m.session,
    updatedAt: new Date(Math.max(mtime(path.join(d, "facts.md")), mtime(path.join(d, "script.md")))).toISOString(),
    status: facts ? "done" : existsSync(path.join(d, "claims.md")) ? "checking" : "starting", counts: counts(d, facts),
  };
}

export function detail(id: string) {
  const d = scriptDir(id);
  return { ...summary(id), script: read(path.join(d, "script.md")) ?? "", facts: read(path.join(d, "facts.md")) };
}

export function list() {
  if (!existsSync(SCRIPTS)) return [];
  return readdirSync(SCRIPTS).filter((n) => !n.startsWith(".") && statSync(path.join(SCRIPTS, n)).isDirectory())
    .map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function prompt(id: string): string {
  const d = scriptDir(id);
  return [
    "The user pasted a video script in the motionmaxxing studio and wants its facts checked before recording.",
    "Use the motionmaxxing fact-check skill (load it with the Skill tool: motionmaxxing:fact-check) and follow it to the end:",
    "",
    `- The script's folder: ${d} (script.md is the user's text: never change it)`,
    "- Write claims.md, facts.md (in the script's own language) and facts.json there. The studio shows facts.md by itself.",
    "- Ask only with AskUserQuestion, and only if the script cannot be read.",
  ].join("\n");
}
