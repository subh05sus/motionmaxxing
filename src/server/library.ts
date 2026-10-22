import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { EDITS, slug } from "./paths.js";

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
}
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
        if (m) return { ...last, detail: `${m[1]} of ${m[2]} frames`, progress: Number(m[1]) / Number(m[2]) };
      } catch { /* not started yet */ }
      return { ...last, detail: undefined };
    }
    return last;
  } catch { return undefined; }
}

export function notes(id: string): Note[] { return readJson<Note[]>(path.join(editDir(id), "notes.json"), []); }
export function saveNotes(id: string, n: Note[]): void { writeFileSync(path.join(editDir(id), "notes.json"), JSON.stringify(n, null, 1)); }

/** What exists so far, in plain words: the stage a person sees. "editing" is the edit ready to watch. */
export function status(id: string): "new" | "transcribing" | "cutting" | "ready" | "making" | "editing" | "approved" {
  const d = editDir(id), r = record(id);
  if (r.stage === "done" || r.approved?.edit) return "approved";
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
  const meta = readJson<{ lang?: string }>(path.join(d, "meta.json"), {});
  const updated = Math.max(...["studio.json", "progress.jsonl", "cut.mp4", "render.mp4", "plan.json", "spans.json", "words.raw.json"].map((f) => mtime(path.join(d, f))));
  return {
    id, title: r.title, createdAt: r.createdAt, updatedAt: new Date(updated || Date.parse(r.createdAt)).toISOString(),
    stage: r.stage, approved: r.approved ?? {}, status: status(id), lang: meta.lang,
    seconds: { source: report.duration, cut: report.final_s }, media: media(id), progress: lastProgress(id), session: r.session,
  };
}

export function list() {
  if (!existsSync(EDITS)) return [];
  return readdirSync(EDITS)
    .filter((n) => !n.startsWith(".") && statSync(path.join(EDITS, n)).isDirectory())
    .filter((n) => ["studio.json", "words.raw.json", "source.mp4"].some((f) => existsSync(path.join(EDITS, n, f))))
    .map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

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
  return { words, cuts, kept: decisions.map((x) => ({ start: x.start, end: x.end })), lang: readJson<{ lang?: string }>(path.join(d, "meta.json"), {}).lang };
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
      place: c.layout === "background" ? "background" : c.layer === "behind" ? "behind" : c.layout === "scene" ? "scene"
        : c.panel === true || (c.panel === undefined && p.layout?.mode === "split") || c.layout === "split" ? "split" : "box",
    })),
    captions: (p.captions?.chunks ?? []).map((c: any) => ({ start: c.start, end: c.end, text: c.text })),
    zooms: (p.zooms ?? []).map((z: any) => ({ start: z.start, end: z.end, scale: z.scale })),
    sounds: (p.sfx ?? []).map((x: any) => ({ t: x.event ?? x.t, name: path.basename(String(x.src ?? "")).replace(/\.wav$/, "") })),
    music: !!p.music,
  };
}
