import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import * as lib from "./library.js";
import { CUT, LIBRARY, python, slug } from "./paths.js";

const run = promisify(execFile);

/**
 * The clips of a new video: every file dropped on New video at once (takes, parts of one talk, b-roll). footage.py
 * tells a take from b-roll (speech and a face in it); the user can switch either one and order the takes. On "Make
 * the cut" two or more takes are joined in order into one source (the cut skill's join.py), and the b-roll moves into
 * the library's own b-roll folder, where every later edit can use it (broll.py's "library") and the Library page
 * manages it.
 */

export function clips(id: string): lib.Clip[] {
  const r = lib.record(id);
  if (r.files?.length) return r.files;
  return r.source ? [{ path: r.source, name: path.basename(r.source), kind: "take" }] : [];
}

/** A clip dropped onto the video: checked a moment after the last one arrives (one run for all, the models load once). */
export function addClip(id: string, file: string, name: string): number {
  const r = lib.record(id);
  r.files = [...clips(id).filter((c) => c.path !== file), { path: file, name, kind: "pending" }];
  lib.saveRecord(id, r);
  return r.files.length - 1;
}

const when = (c: lib.Clip) => {   // the recording time; "+0530" (an iPhone's) as "+05:30" so Date reads it
  const t = Date.parse(String(c.created ?? "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isNaN(t) ? Infinity : t;
};

/** Takes first, by recording time, else by name (video_20261012_152753 sorts by its time too); then the ones still
 *  being checked, then the b-roll. Once the user moved a take, their order stays. */
function order(r: lib.StudioRecord): void {
  if (!r.files || r.ordered) return;
  const rank = (c: lib.Clip) => (c.kind === "take" ? 0 : c.kind === "pending" ? 1 : 2);
  r.files.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? when(a) - when(b) || a.name.localeCompare(b.name, undefined, { numeric: true }) : 0));
}

const timers = new Map<string, NodeJS.Timeout>(), busy = new Set<string>(), again = new Set<string>();

export function classifySoon(id: string, done: () => void): void {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => void classify(id, done), 1500));
}

async function classify(id: string, done: () => void): Promise<void> {
  if (busy.has(id)) { again.add(id); return; }
  busy.add(id);
  try {
    const pend = clips(id).filter((c) => c.kind === "pending" && existsSync(c.path));
    if (!pend.length) return;
    let rows: (Partial<lib.Clip> & { path: string })[] = [];
    try {
      const { stdout } = await run(python(), [path.join(CUT, "footage.py"), "classify", ...pend.map((c) => c.path)],
        { maxBuffer: 16 << 20, env: { ...process.env, MM_LIBRARY: LIBRARY } });
      rows = stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
    } catch {   // the check failed (no models yet): never b-roll by accident
      rows = pend.map((c) => ({ path: c.path, kind: "take" as const, why: "could not check it: kept as a take" }));
    }
    const r = lib.record(id);   // read again: a clip may have been switched or removed meanwhile
    for (const row of rows) {
      const c = r.files?.find((x) => x.path === row.path && x.kind === "pending");
      if (c) Object.assign(c, { kind: row.kind === "broll" ? "broll" : "take", why: row.why, duration: row.duration, created: row.created, speech: row.speech, face: row.face });
    }
    order(r);
    // named after its first file, which turned out to be b-roll: named after the first take
    const first = r.files?.find((c) => c.kind === "take");
    if (first && r.files?.some((c) => c.kind === "broll" && r.title === c.name.replace(/\.[^.]+$/, ""))) r.title = first.name.replace(/\.[^.]+$/, "");
    lib.saveRecord(id, r);
  } finally {
    busy.delete(id);
    if (again.delete(id)) void classify(id, done);
    done();
  }
}

/** The user's change to one clip: what it is (take or b-roll), or its place among the takes. */
export function setClip(id: string, n: number, change: { kind?: "take" | "broll"; move?: number }): void {
  const r = lib.record(id);
  r.files = clips(id);
  const c = r.files[n];
  if (!c) throw new Error("no such clip");
  if (change.kind && c.kind !== "pending") Object.assign(c, { kind: change.kind, chosen: true });
  if (change.move) {
    const to = n + Math.sign(change.move);
    if (to >= 0 && to < r.files.length) { [r.files[n], r.files[to]] = [r.files[to]!, c]; r.ordered = true; }
  }
  if (!r.ordered) order(r);
  lib.saveRecord(id, r);
}

export function removeClip(id: string, n: number): lib.Clip {
  const r = lib.record(id);
  r.files = clips(id);
  const [c] = r.files.splice(n, 1);
  if (!c) throw new Error("no such clip");
  if (r.source === c.path) r.source = r.files.find((x) => x.kind !== "broll")?.path ?? r.files[0]?.path;
  lib.saveRecord(id, r);
  return c;
}

// --- the library's b-roll ----------------------------------------------------------------------------------------

export const BROLL = path.join(LIBRARY, "broll");
const INDEX = path.join(BROLL, "broll.json");
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
interface Meta { title: string; added: string; from?: { id: string; title: string }; duration?: number }
const readIndex = (): Record<string, Meta> => { try { return JSON.parse(readFileSync(INDEX, "utf8")).clips ?? {}; } catch { return {}; } };
const writeIndex = (c: Record<string, Meta>) => { mkdirSync(BROLL, { recursive: true }); writeFileSync(INDEX, JSON.stringify({ clips: c }, null, 1)); };
const free = (base: string, ext: string) => { let f = `${base}${ext}`, n = 2; while (existsSync(path.join(BROLL, f))) f = `${base}-${n++}${ext}`; return f; };
const mtimeIso = (f: string) => { try { return statSync(f).mtime.toISOString(); } catch { return new Date().toISOString(); } };

/** Every b-roll clip in the library, newest first: those saved here and any put in the folder by hand. */
export function brollList() {
  if (!existsSync(BROLL)) return [];
  const idx = readIndex();
  return readdirSync(BROLL).filter((f) => VIDEO.test(f) && !f.startsWith(".")).map((f) => {
    const m = idx[f], full = path.join(BROLL, f);
    return {
      file: f, title: m?.title ?? f.replace(VIDEO, ""), added: m?.added ?? mtimeIso(full), from: m?.from, duration: m?.duration,
      bytes: statSync(full).size, url: `/library-file/broll/${encodeURIComponent(f)}`, poster: `/api/broll/${encodeURIComponent(f)}/poster`,
    };
  }).sort((a, b) => b.added.localeCompare(a.added));
}

/** Move a clip into the library's b-roll under a readable name. -> its new path. */
export function saveBroll(src: string, title: string, from?: { id: string; title: string }, duration?: number): string {
  mkdirSync(BROLL, { recursive: true });
  const f = free(slug(title) || "b-roll", (path.extname(src) || ".mp4").toLowerCase());
  renameSync(src, path.join(BROLL, f));
  const idx = readIndex();
  idx[f] = { title, added: new Date().toISOString(), from, duration };
  writeIndex(idx);
  return path.join(BROLL, f);
}

/** A new name: the title shown, and the file under it (Claude reads b-roll by its file name too). -> the file. */
export function renameBroll(file: string, title: string): string {
  const from = path.join(BROLL, path.basename(file));
  if (!existsSync(from)) throw new Error("that clip is not in the library any more");
  const idx = readIndex(), meta = idx[path.basename(file)];
  const to = free(slug(title) || "b-roll", path.extname(from).toLowerCase());
  renameSync(from, path.join(BROLL, to));
  delete idx[path.basename(file)];
  idx[to] = { ...(meta ?? { added: mtimeIso(path.join(BROLL, to)) }), title: title.trim() };
  writeIndex(idx);
  return to;
}

export async function brollPoster(file: string): Promise<string | undefined> {
  const src = path.join(BROLL, path.basename(file)), out = path.join(BROLL, ".posters", `${path.basename(file)}.jpg`);
  if (!existsSync(src)) return undefined;
  try { if (statSync(out).mtimeMs >= statSync(src).mtimeMs) return out; } catch { /* not made yet */ }
  mkdirSync(path.dirname(out), { recursive: true });
  try { await run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=360:-2", out]); return out; }
  catch { return undefined; }
}

/** A dropped clip's thumbnail, kept in the edit folder by the clip's file name (the clips can be reordered). */
export async function clipPoster(id: string, src: string): Promise<string | undefined> {
  const out = path.join(lib.editDir(id), ".clips", `${path.basename(src)}.jpg`);
  if (!existsSync(src)) return undefined;
  try { if (statSync(out).mtimeMs >= statSync(src).mtimeMs) return out; } catch { /* not made yet */ }
  mkdirSync(path.dirname(out), { recursive: true });
  try { await run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=240:-2", out]); return out; }
  catch { return undefined; }
}
