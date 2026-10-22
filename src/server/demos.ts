import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PLUGIN, RECORDINGS, slug } from "./paths.js";

/**
 * Demo recordings as the studio sees them: a folder in <library>/recordings/<id>/ with what the record skill writes
 * (shots.json, frames/, events.json, run.log, demo.mp4, demo-9x16.mp4, demo.json) and brief.json, the studio's own
 * record of what was asked.
 */

export interface Brief { title: string; url: string; show: string; formats: "wide" | "tall" | "both"; createdAt: string; session?: string }

const readJson = <T>(p: string, fallback: T): T => { try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; } };
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

export const RECORDER = path.join(PLUGIN, "skills", "record", "scripts", "recorder.mjs");
export const demoDir = (id: string): string => path.join(RECORDINGS, path.basename(id));

export function newDemo(b: Omit<Brief, "createdAt">): string {
  mkdirSync(RECORDINGS, { recursive: true });
  const base = slug(b.title || (() => { try { return new URL(b.url).hostname; } catch { return "demo"; } })());
  let id = base, n = 2;
  while (existsSync(demoDir(id))) id = `${base}-${n++}`;
  mkdirSync(demoDir(id), { recursive: true });
  writeFileSync(path.join(demoDir(id), "brief.json"), JSON.stringify({ ...b, createdAt: new Date().toISOString() }, null, 1));
  return id;
}

export function brief(id: string): Brief {
  return readJson<Brief>(path.join(demoDir(id), "brief.json"), { title: id, url: "", show: "", formats: "wide", createdAt: new Date(mtime(demoDir(id)) || Date.now()).toISOString() });
}

export function saveBrief(id: string, b: Brief): void { writeFileSync(path.join(demoDir(id), "brief.json"), JSON.stringify(b, null, 1)); }

/** Every finished video of a recording: demo.mp4 (16:9), demo-9x16.mp4, and any other shape render.py made (demo-10x7.mp4). */
export const videos = (d: string): string[] =>
  existsSync(d) ? readdirSync(d).filter((f) => /^demo(-\d+x\d+)?\.mp4$/.test(f)).sort() : [];

/** A finish the studio started (POST /api/demos/:id/finish) holds this until render.py is done. */
export const FINISH_LOCK = "finishing.lock";

/** Where it is, in plain words. Recorded but not finished, with no finish running, is "recorded" (a Finish button),
 *  never a "finishing" that spins forever: a recording finished elsewhere, or by hand, has no one rendering it. */
export function status(id: string): "planning" | "recording" | "recorded" | "finishing" | "ready" | "failed" {
  const d = demoDir(id);
  if (videos(d).length) return "ready";
  const ev = readJson<{ ok?: boolean } | null>(path.join(d, "events.json"), null);
  if (ev && ev.ok === false) return "failed";
  const lock = mtime(path.join(d, FINISH_LOCK));
  if (lock && Date.now() - lock < 15 * 60_000) return "finishing";
  if (ev) return Date.now() - mtime(path.join(d, "events.json")) < 120_000 ? "finishing" : "recorded";   // Claude finishes it right after
  if (existsSync(path.join(d, "run.log"))) return "recording";
  return "planning";
}

export function summary(id: string) {
  const d = demoDir(id), b = brief(id);
  const url = (f: string) => (existsSync(path.join(d, f)) ? `/library-file/recordings/${encodeURIComponent(id)}/${f}?v=${Math.round(mtime(path.join(d, f)))}` : undefined);
  const all = videos(d);
  const info = readJson<{ duration?: number }>(path.join(d, "demo.json"), {});
  const tall = readJson<{ duration?: number }>(path.join(d, "demo-9x16.json"), {});
  const other = all.find((f) => f !== "demo.mp4" && f !== "demo-9x16.mp4");
  const otherInfo = other ? readJson<{ duration?: number }>(path.join(d, other.replace(/\.mp4$/, ".json")), {}) : {};
  const updated = Math.max(...["brief.json", "shots.json", "run.log", "events.json", "demo.mp4", "demo-9x16.mp4"].map((f) => mtime(path.join(d, f))));
  let log: string[] = [];
  try { log = readFileSync(path.join(d, "run.log"), "utf8").trim().split("\n").slice(-3); } catch { /* not recording yet */ }
  return {
    id, title: b.title, url: b.url, show: b.show, formats: b.formats, createdAt: b.createdAt,
    updatedAt: new Date(updated || Date.parse(b.createdAt)).toISOString(), status: status(id), session: b.session,
    seconds: info.duration ?? tall.duration ?? otherInfo.duration, log,
    media: { wide: url("demo.mp4") ?? (other ? url(other) : undefined), tall: url("demo-9x16.mp4"),
             poster: url("demo.jpg") ?? url("demo-9x16.jpg") ?? url("look.png") },
  };
}

export function list() {
  if (!existsSync(RECORDINGS)) return [];
  return readdirSync(RECORDINGS)
    .filter((n) => !n.startsWith(".") && statSync(path.join(RECORDINGS, n)).isDirectory())
    .map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function prompt(id: string): string {
  const b = brief(id), d = demoDir(id);
  const wants = b.formats === "both" ? "16:9 (demo.mp4) and 9:16 (demo-9x16.mp4)" : b.formats === "tall" ? "9:16 (demo-9x16.mp4)" : "16:9 (demo.mp4)";
  return [
    "You are working inside the motionmaxxing studio, a Mac app. The user asked for a demo recording and watches this chat",
    "and the demo's page. Make it with the motionmaxxing record skill (load it with the Skill tool: motionmaxxing:record) and",
    "follow it to the end, with these settled:",
    "",
    `- The folder: ${d} (shots.json, the recording and the videos go here)`,
    `- The site: ${b.url}`,
    `- What it should show: ${b.show}`,
    `- Formats: ${wants}`,
    "- Ask only with AskUserQuestion (the studio shows a card): once for a site not allowed yet, and to sign in.",
    "- The studio shows the video by itself: never open a browser page or a player.",
    "- End with one short message: what the demo shows, its length, and anything the user should check.",
  ].join("\n");
}
