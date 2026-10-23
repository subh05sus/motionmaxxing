import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { EDITS, LIBRARY, slug } from "./paths.js";

const run = promisify(execFile);

/**
 * The library's videos as the studio sees them. An edit is a folder in ~/Movies/motionmaxxing/edits/<id>/: what the
 * plugin's scripts write (words.raw.json, spans.json, decisions.json, cut.mp4, render.mp4, progress.jsonl...) plus
 * studio.json, the studio's own record (title, where the raw take came from, the stage, approvals) and notes.json.
 */

export interface Note { id: string; t: number; text: string; stage: "cut" | "edit"; at: string; sent?: string; resolved?: string }
export interface StudioRecord {
  title: string; createdAt: string; source?: string; script?: string;
  stage: "cut" | "edit" | "done"; approved?: { cut?: string; edit?: string }; session?: string;
  /** The language picked on New video (plugin/lib/mm/lang.py PACKS); none: heard when transcribed. */
  lang?: string;
}

/** The languages the cut reads (plugin/lib/mm/lang.py PACKS). */
export const LANGS: Record<string, string> = { en: "English", de: "German", hi: "Hindi", hinglish: "Hinglish" };
export interface Word { i: number; text: string; start: number; end: number; kept: boolean; kind?: string }

const readJson = <T>(p: string, fallback: T): T => { try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; } };
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

export const editDir = (id: string): string => path.join(EDITS, path.basename(id));

export function record(id: string): StudioRecord {
  const d = editDir(id);
  const had = readJson<StudioRecord | null>(path.join(d, "studio.json"), null);
  if (had) return had;
  // An edit made outside the studio (by Claude Code directly): read what is there.
  const born = Math.min(...["words.raw.json", "meta.json", "spans.json"].map((f) => mtime(path.join(d, f))).filter(Boolean), Date.now());
  return { title: id.replace(/-/g, " "), createdAt: new Date(born).toISOString(), stage: existsSync(path.join(d, "render.mp4")) ? "edit" : "cut" };
}

/** Merge keys into the edit's meta.json, the plugin's record of its language (lang.py set_meta). */
export function setMeta(id: string, kv: Record<string, unknown>): void {
  const f = path.join(editDir(id), "meta.json");
  mkdirSync(editDir(id), { recursive: true });
  writeFileSync(f, JSON.stringify({ ...readJson<Record<string, unknown>>(f, {}), ...kv }, null, 1));
}

/** The edit's language: the one the cut heard (meta.json), else the one picked on New video. */
export function lang(id: string): string | undefined {
  return readJson<{ lang?: string }>(path.join(editDir(id), "meta.json"), {}).lang ?? record(id).lang;
}

export function saveRecord(id: string, r: StudioRecord): void {
  mkdirSync(editDir(id), { recursive: true });
  writeFileSync(path.join(editDir(id), "studio.json"), JSON.stringify(r, null, 1));
}

/** A new edit folder for a raw take: a unique id from its name. */
export function newEdit(title: string, source: string): string {
  mkdirSync(EDITS, { recursive: true });
  const base = slug(title || path.basename(source));
  let id = base, n = 2;
  while (existsSync(editDir(id))) id = `${base}-${n++}`;
  saveRecord(id, { title: title || path.basename(source).replace(/\.[^.]+$/, ""), createdAt: new Date().toISOString(), source, stage: "cut" });
  return id;
}

export function lastProgress(id: string): { step: string; detail?: string; progress?: number; t: number; done?: boolean; failed?: string } | undefined {
  try {
    const lines = readFileSync(path.join(editDir(id), "progress.jsonl"), "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    // The render reports its log file; its newest "Rendered 312/2196" line is the bar.
    if (last.step === "Making the video" && /\.log$/.test(last.detail ?? "")) {
      try {
        const tail = readFileSync(path.join(editDir(id), path.basename(last.detail)), "utf8").slice(-4000);
        const m = [...tail.matchAll(/Rendered (\d+)\/(\d+)/g)].pop();
        // t: the log's newest line, so a long render stays "working" for as long as it writes
        const t = Math.max(last.t, mtime(path.join(editDir(id), path.basename(last.detail))) / 1000);
        const done = /^rendered .+ in [\d.]+ s$/m.test(tail) || undefined;   // the renderer's last line
        if (m) return { ...last, t, done, detail: `${m[1]} of ${m[2]} frames`, progress: Number(m[1]) / Number(m[2]) };
      } catch { /* not started yet */ }
      return { ...last, detail: undefined };
    }
    return last;
  } catch { return undefined; }
}

export function notes(id: string): Note[] { return readJson<Note[]>(path.join(editDir(id), "notes.json"), []); }
export function saveNotes(id: string, n: Note[]): void { writeFileSync(path.join(editDir(id), "notes.json"), JSON.stringify(n, null, 1)); }

/** A render running now, started here or anywhere else (a terminal, Claude's own session): its log (edit.py deletes it
 *  first) was written in the last 90 s and has not printed its last line, or the render was just announced in
 *  progress.jsonl and the renderer is still bundling. The old render.mp4 stays until the new one replaces it, so
 *  its time alone can't tell: a re-render with the same plan read as "edit ready" the whole time. */
export function rendering(id: string): boolean {
  const lm = mtime(path.join(editDir(id), "render.renderer.log"));
  if (!lm) {
    const p = lastProgress(id);
    return !!p && p.step === "Making the video" && Date.now() / 1000 - p.t < 60;
  }
  if (Date.now() - lm > 90_000) return false;
  try { return !/^rendered .+ in [\d.]+ s$/m.test(readFileSync(path.join(editDir(id), "render.renderer.log"), "utf8").slice(-600)); }
  catch { return false; }
}

// --- what is running on a video right now -------------------------------------------------------------------------
// The plugin's scripts and renderers in the process list, whoever started them (the studio, Claude's Bash in the
// background, a terminal). A render after the edit was approved ran with nothing on the page: the status said
// "approved", and the newest progress line alone cannot tell a step still running from one that ended minutes ago.

interface Proc { pid: number; cmd: string; cwd?: string }
let procCache: { at: number; procs: Proc[] } | null = null;
const OURS = /motionmaxxing|remotion|hyperframes|whisper-cli|ffmpeg|render\.mjs|capture\.mjs|recorder\.mjs/;

/** The processes that may work on an edit, with their working folders (a relative edits/<id> resolves against it). */
function procs(): Proc[] {
  if (procCache && Date.now() - procCache.at < 1500) return procCache.procs;
  let list: Proc[] = [];
  try {
    list = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 8 << 20 }).split("\n")
      .map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ pid: Number(m[1]), cmd: m[2]! }))
      .filter((p) => p.pid !== process.pid && OURS.test(p.cmd) && !/\bps -axo\b|src\/server\/main\.ts|claude-agent-sdk/.test(p.cmd));
    if (list.length) {
      let out = "";
      try { out = execFileSync("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", list.map((p) => p.pid).join(",")], { encoding: "utf8" }); }
      catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }   // a process that ended meanwhile: lsof exits 1
      let pid = 0;
      for (const l of out.split("\n")) {
        if (l.startsWith("p")) pid = Number(l.slice(1));
        else if (l.startsWith("n")) { const p = list.find((x) => x.pid === pid); if (p) p.cwd = l.slice(1); }
      }
    }
  } catch { list = []; }   // no ps (never on a Mac): only the render log tells
  procCache = { at: Date.now(), procs: list };
  return list;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// lsof gives a working folder as its real path (/private/var/... for /var/...): compare real paths
const real = (f: string) => { try { return realpathSync(f); } catch { return path.resolve(f); } };
/** Does this process work on the edit folder d: d in its arguments, edits/<id> run from the library, or run inside d. */
function on(p: Proc, d: string, id: string): boolean {
  const rd = real(d);
  if (p.cwd && (p.cwd === rd || p.cwd.startsWith(rd + path.sep))) return true;
  if ([...new Set([d, rd])].some((x) => new RegExp(`${esc(x)}(?=$|[/\\s'"])`).test(p.cmd))) return true;
  return !!p.cwd && p.cwd === real(LIBRARY) && new RegExp(`(?:^|[\\s'"=])(?:\\./)?edits/${esc(id)}(?=$|[/\\s'"])`).test(p.cmd);
}

// a running script -> the step to show, and the progress steps that script writes (their detail and bar are its own)
const LABELS: [RegExp, string, string[]][] = [
  [/render\.mjs|remotion|edit\.py\s+(?:render|patch)/, "Making the video", ["Making the video"]],
  [/edit\.py\s+stills/, "Making the stills", []],
  [/check\.py\s+render/, "Checking the video", []],
  [/check\.py/, "Checking the plan", []],
  [/motion\.py\s+check|hyperframes/, "Making a motion clip", []],
  [/matte\.py/, "Cutting you out for the background", []],
  [/face\.py/, "Finding your face", []],
  [/plan\.py/, "Planning zooms, cards and sound", ["Planning zooms, cards and sound"]],
  [/sound\.py/, "Sound effects and music", ["Sound effects and music"]],
  [/retakes\.py\s+captions/, "Writing the captions", ["Writing the captions"]],
  [/transcribe\.py|whisper-cli/, "Writing down every word",
    ["Writing down every word", "Hearing the take again, word for word", "Finding retakes and pauses", "Transcribed every word"]],
  [/rehear\.py|verify_cut\.py|splice_check\.py/, "Checking the cut", ["Checking the cut"]],
  [/join\.py/, "Joining your clips", ["Joining your clips"]],
  [/build_timeline\.py|edits\.py/, "Cutting out the mistakes", ["Cutting out the mistakes"]],
  [/cut\/scripts\/render\.py/, "Rendering the cut", ["Rendering the cut"]],
  [/export_nle\.py/, "Exporting", []],
  [/capture\.mjs/, "Capturing a page", []],
  [/recorder\.mjs/, "Recording a demo", []],
];

/** What runs on this video now, for the page: the render (its frame count), else the script working on its folder
 *  (the most telling one, with its own progress line's detail). null: nothing runs. */
export function working(id: string): { step: string; detail?: string; progress?: number } | null {
  const d = editDir(id), prog = lastProgress(id);
  if (rendering(id)) return { step: "Making the video", detail: prog?.step === "Making the video" ? prog.detail : undefined,
    progress: prog?.step === "Making the video" ? prog.progress : undefined };
  const live = procs().filter((p) => on(p, d, id));
  if (!live.length) return null;
  const fresh = prog && !prog.done && !prog.failed && Date.now() / 1000 - prog.t < 900 ? prog : undefined;
  const hit = LABELS.find(([re]) => live.some((p) => re.test(p.cmd)));
  if (hit && fresh && hit[2].includes(fresh.step)) return { step: fresh.step, detail: fresh.detail, progress: fresh.progress };
  if (hit) return { step: hit[1] };
  return fresh ? { step: fresh.step, detail: fresh.detail, progress: fresh.progress } : { step: "Working on it" };
}

/** What exists so far, in plain words: the stage a person sees. "editing" is the edit ready to watch. Something
 *  running comes first: an approved video being re-rendered is being made again, not "approved". */
export function status(id: string): "new" | "transcribing" | "cutting" | "ready" | "making" | "editing" | "approved" {
  const d = editDir(id), r = record(id);
  if (working(id)) return r.approved?.cut || r.stage !== "cut" ? "making" : existsSync(path.join(d, "words.raw.json")) ? "cutting" : "transcribing";
  if (r.stage === "done" || r.approved?.edit) return "approved";
  if (rendering(id)) return "making";
  const render = mtime(path.join(d, "render.mp4"));
  if (render && render >= mtime(path.join(d, "plan.json"))) return "editing";
  if (r.stage === "edit" || render) return "making";   // the cut is approved: the edit is being made (or re-made)
  if (existsSync(path.join(d, "cut.mp4"))) return "ready";
  if (existsSync(path.join(d, "words.raw.json"))) return "cutting";
  if (lastProgress(id)) return "transcribing";
  return "new";
}

export function media(id: string): Record<string, string | undefined> {
  const d = editDir(id), r = record(id);
  const url = (f: string) => existsSync(path.join(d, f)) ? `/media/${encodeURIComponent(id)}/${f}?v=${Math.round(mtime(path.join(d, f)))}` : undefined;
  return {
    source: url("source.mp4") ?? (r.source && existsSync(r.source) ? `/media/${encodeURIComponent(id)}/__source?v=1` : undefined),
    cut: url("cut.mp4"), render: url("render.mp4"), poster: `/media/${encodeURIComponent(id)}/__poster`,
  };
}

export function summary(id: string) {
  const d = editDir(id), r = record(id);
  const report = readJson<{ duration?: number; final_s?: number }>(path.join(d, "report.json"), {});
  const updated = Math.max(...["studio.json", "progress.jsonl", "cut.mp4", "render.mp4", "plan.json", "spans.json", "words.raw.json"].map((f) => mtime(path.join(d, f))));
  return {
    id, title: r.title, createdAt: r.createdAt, updatedAt: new Date(updated || Date.parse(r.createdAt)).toISOString(),
    stage: r.stage, approved: r.approved ?? {}, status: status(id), lang: lang(id),
    seconds: { source: report.duration, cut: report.final_s }, media: media(id), progress: lastProgress(id), working: working(id),
    session: r.session,
  };
}

/** The videos in the library (an edit folder with a record, a transcript or a source). */
export function ids(): string[] {
  if (!existsSync(EDITS)) return [];
  return readdirSync(EDITS)
    .filter((n) => !n.startsWith(".") && statSync(path.join(EDITS, n)).isDirectory())
    .filter((n) => ["studio.json", "words.raw.json", "source.mp4"].some((f) => existsSync(path.join(EDITS, n, f))));
}

export function list() {
  return ids().map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const WATCHED = ["studio.json", "progress.jsonl", "render.renderer.log", "render.mp4", "cut.mp4", "plan.json", "decisions.json",
  "words.raw.json", "notes.json"];
/** A cheap fingerprint of a video (its files' times): when it changes, the open pages reload it. */
// a script starting or ending on the video changes it too, with no file written yet
export const signature = (id: string): string => WATCHED.map((f) => mtime(path.join(editDir(id), f))).join(",") + `|${working(id)?.step ?? ""}`;

/** A word plays when at least 0.1 s of it (or half, if shorter) is inside a kept span (build_timeline.is_kept). */
export function isKept(w: { start: number; end: number }, spans: { start: number; end: number }[]): boolean {
  const need = Math.min(0.1, (w.end - w.start) / 2);
  return spans.some((s) => Math.min(w.end, s.end) - Math.max(w.start, s.start) >= need - 1e-9);
}

/** The take's words, each marked kept or cut, with the reason a cut word went (retake, filler, pause...). */
export function transcript(id: string): { words: Word[]; cuts: { start: number; end: number; kind: string; note?: string }[]; kept: { start: number; end: number }[]; lang?: string } {
  const d = editDir(id);
  const raw = readJson<{ text: string; start: number; end: number; type?: string }[]>(path.join(d, "words.raw.json"), []);
  const decisions = readJson<{ start: number; end: number }[]>(path.join(d, "decisions.json"), []);
  const report = readJson<{ cuts?: { start: number; end: number; kind: string; note?: string }[] }>(path.join(d, "report.json"), {});
  const cuts = (report.cuts ?? []).filter((c) => c.kind !== "silence").map((c) => ({ start: c.start, end: c.end, kind: c.kind, note: c.note }));
  const words: Word[] = [];
  raw.forEach((w) => {
    if ((w.type ?? "word") !== "word") return;
    const kept = decisions.length ? isKept(w, decisions) : true;
    const c = kept ? undefined : cuts.find((x) => x.start <= (w.start + w.end) / 2 && (w.start + w.end) / 2 <= x.end);
    words.push({ i: words.length, text: w.text, start: w.start, end: w.end, kept, ...(c ? { kind: c.kind } : {}) });
  });
  return { words, cuts, kept: decisions.map((x) => ({ start: x.start, end: x.end })), lang: lang(id) };
}

/** A poster frame for the video's card: one frame of the cut (else the source), made once. */
export async function poster(id: string): Promise<string | undefined> {
  const d = editDir(id), out = path.join(d, ".poster.jpg");
  const src = [path.join(d, "render.mp4"), path.join(d, "cut.mp4"), path.join(d, "source.mp4"), record(id).source].find((f) => f && existsSync(f));
  if (!src) return undefined;
  if (existsSync(out) && mtime(out) >= mtime(src)) return out;
  try { await run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=360:-2", out]); return out; } catch { return undefined; }
}

export interface PlanSummary {
  width: number; height: number; duration: number;
  cards: { start: number; end: number; label: string; kind: string; place: "scene" | "split" | "box" | "behind" | "background" }[];
  captions: { start: number; end: number; text: string }[];
  zooms: { start: number; end: number; scale: number }[];
  sounds: { t: number; name: string }[];
  music: boolean;
}

/** The edit as the timeline shows it: plan.json's cards (by placement), captions, zooms and sound, on the cut's clock. */
export function plan(id: string): PlanSummary | null {
  const p = readJson<any>(path.join(editDir(id), "plan.json"), null);
  if (!p) return null;
  const label = (c: any): string => c.trigger_word || c.anim?.type || (c.src ? path.basename(String(c.src)).replace(/\.[^.]+$/, "") : "visual");
  return {
    width: p.width, height: p.height, duration: (p.durationInFrames ?? 0) / (p.fps || 30),
    cards: (p.cards ?? []).map((c: any) => ({
      start: c.start, end: c.end, label: String(label(c)).slice(0, 40), kind: c.format || c.anim?.type || (c.src ? "picture" : "card"),
      // a cutaway (a full-frame clip with no cutout) is the timeline's "Full screen", like a scene
      place: c.layer === "cutaway" ? "scene" : c.layout === "background" ? "background" : c.layer === "behind" ? "behind" : c.layout === "scene" ? "scene"
        : c.panel === true || (c.panel === undefined && p.layout?.mode === "split") || c.layout === "split" ? "split" : "box",
    })),
    captions: (p.captions?.chunks ?? []).map((c: any) => ({ start: c.start, end: c.end, text: c.text })),
    zooms: (p.zooms ?? []).map((z: any) => ({ start: z.start, end: z.end, scale: z.scale })),
    sounds: (p.sfx ?? []).map((x: any) => ({ t: x.event ?? x.t, name: path.basename(String(x.src ?? "")).replace(/\.wav$/, "") })),
    music: !!p.music,
  };
}
