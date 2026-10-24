import { spawn } from "node:child_process";
import { copyFileSync, cpSync, createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Claude, type Ev, type SessionMeta } from "./claude.js";
import * as demos from "./demos.js";
import * as clipsMod from "./clips.js";
import * as lib from "./library.js";
import * as scripts from "./scripts.js";
import * as bin from "./trash.js";
import { CUT, EDITS, HOME, LIBRARY, PLUGIN, PORT, RECORDINGS, ROOT, SESSIONS, SETUP, VIDEOS, WEB_DIST, ensureDirs, pickProfile, profile,
  profileEnv, profileId, profiles, python, slug, withProfile } from "./paths.js";
import * as prof from "./profiles.js";
import { compile, cube1d, isNeutral } from "../shared/colour.js";

/**
 * The studio's server: the page (web/dist), its API, live events, the library's media, and Claude behind it. Local only:
 * it listens on 127.0.0.1, so nothing on the network reaches the user's videos or their Claude.
 */

ensureDirs();
const sse = new Set<http.ServerResponse>();

/** A live event for the open pages, with the profile it belongs to (a page shows only its own profile's). */
function broadcast(type: string, data: unknown): void {
  const d = data && typeof data === "object" && !Array.isArray(data) ? { profile: profileId(), ...data } : data;
  const line = `event: ${type}\ndata: ${JSON.stringify(d)}\n\n`;
  for (const r of sse) r.write(line);
}

// One Claude per profile: its conversations in its own folder, run in its own library folder (main.ts claude()).
const claudes = new Map<string, Claude>();
function claude(): Claude {
  const p = profileId() ?? "";
  let c = claudes.get(p);
  if (!c) {
    c = new Claude({ dir: SESSIONS(), cwd: LIBRARY(), env: profileEnv() });
    c.onAny((meta: SessionMeta, e?: Ev) => broadcast("session", { meta, kind: e?.k, tone: e && e.k === "status" ? e.tone : undefined, profile: p || null }));
    claudes.set(p, c);
  }
  return c;
}
/** Every profile's ids (or [null] without profiles), to do something for each, as that profile. */
const eachProfile = (fn: () => void): void => { for (const p of profiles().length ? profiles().map((x) => x.id) : [null]) withProfile(p, fn); };

// The pages stay live whoever does the work (the studio's jobs, Claude here or in a terminal, a script run by hand):
// every 2 s a few file times per video; a change pushes "video" to the open pages (a render: its frame count).
const seen = new Map<string, string>();
setInterval(() => {
  if (!sse.size) return;
  eachProfile(() => {
    for (const id of lib.ids()) {
      const k = `${profileId() ?? ""}/${id}`, sig = lib.signature(id);
      if (seen.has(k) && seen.get(k) !== sig) broadcast("video", { id });
      seen.set(k, sig);
    }
  });
}, 2000).unref();

// --- jobs: scripts the studio runs itself (no Claude, no tokens) ---------------------------------------------------

const jobs = new Map<string, { name: string; startedAt: string }>();
const jk = (id: string): string => (id.startsWith("__") ? id : `${profileId() ?? ""}/${id}`);   // a video's job, in its profile

function runScript(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(python(), args, { cwd: opts.cwd ?? LIBRARY(), env: { ...process.env, ...profileEnv(), ...opts.env } });
    let out = "", err = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { err += b; });
    p.on("close", (code) => resolve({ code: code ?? 1, out, err: err.split("\n").filter((l) => !l.startsWith("objc[")).join("\n") }));
  });
}

/** A few lines of Python with the plugin's mm package importable; prints JSON. */
async function py<T>(code: string, stdin?: string): Promise<T> {
  const pre = `import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(PLUGIN, "lib"))})\n`;
  const r = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const pr = spawn(python(), ["-c", pre + code], { env: { ...process.env, ...profileEnv() } });
    let out = "", err = "";
    pr.stdout.on("data", (x) => { out += x; }); pr.stderr.on("data", (x) => { err += x; });
    pr.on("close", (c) => resolve({ code: c ?? 1, out, err }));
    pr.stdin.end(stdin ?? "");
  });
  if (r.code) throw new Error(r.err.trim().split("\n").slice(-1)[0] || "the script failed");
  return JSON.parse(r.out) as T;
}

function step(id: string, text: string, extra: Record<string, unknown> = {}): void {
  try {
    const f = path.join(lib.editDir(id), "progress.jsonl");
    writeFileSync(f, JSON.stringify({ t: Date.now() / 1000, job: "video", step: text, ...extra }) + "\n", { flag: "a" });
  } catch { /* the edit may be gone */ }
  broadcast("video", { id });
}

/** After an edit to the cut: build the timeline again and render the cut, then tell the conversation. */
async function rebuild(id: string, why: string): Promise<void> {
  if (jobs.has(jk(id))) return;
  jobs.set(jk(id), { name: "rebuild", startedAt: new Date().toISOString() });
  const d = lib.editDir(id);
  const src = existsSync(path.join(d, "source.mp4")) ? path.join(d, "source.mp4") : lib.record(id).source;
  try {
    if (!src) throw new Error("no source");
    step(id, "Cutting out the mistakes");
    const b = await runScript([path.join(CUT, "build_timeline.py"), src, d]);
    if (b.code) throw new Error(b.err.trim().split("\n").slice(-2).join(" "));
    // every join heard again: the half word or false start a transcript hides (rehear.py); a failure here leaves the
    // cut as built rather than stopping it
    step(id, "Listening to every join");
    await runScript([path.join(CUT, "rehear.py"), d, "--fix"]);
    step(id, "Rendering the cut");
    const r = await runScript([path.join(CUT, "render.py"), src, d]);
    if (r.code) throw new Error(r.err.trim().split("\n").slice(-2).join(" "));
    step(id, "The cut is ready", { done: true, progress: 1 });
    const s = lib.record(id).session;
    if (s) claude().note(s, `${why}: the cut was rebuilt and rendered.`, "ok");
  } catch (e) {
    step(id, "The cut could not be rebuilt", { failed: (e as Error).message });
  } finally {
    jobs.delete(jk(id));
    broadcast("video", { id });
  }
}

/** Export a video for Final Cut, Premiere, Resolve, CapCut and an editor (export_nle.py, no Claude). deliver: then
 *  copied with the video into the profile's export folder (its settings' export_dir, else <profile>/Exports); else the
 *  export folder opens in the Finder. */
function exportVideo(id: string, deliver: boolean): void {
  jobs.set(jk(id), { name: "export", startedAt: new Date().toISOString() });
  step(id, "Exporting for Final Cut, Premiere, Resolve and CapCut");
  void runScript([path.join(PLUGIN, "skills", "edit", "scripts", "export_nle.py"), lib.editDir(id), "--to", "all"])
    .then((r) => {
      if (r.code) return step(id, "The export stopped", { failed: r.err.trim().split("\n").slice(-1)[0] });
      const to = deliver ? deliverTo(id) : null;
      step(id, to ? `Exported to ${to.replace(os.homedir(), "~")}` : "Exported", { done: true, progress: 1 });
      if (!to) spawn("open", [path.join(lib.editDir(id), "export")], { stdio: "ignore", detached: true }).unref();
    })
    .catch((e) => step(id, "The export stopped", { failed: (e as Error).message }))
    .finally(() => { jobs.delete(jk(id)); broadcast("video", { id }); });
}

/** The profile's export folder: its settings' export_dir, else <profile>/Exports (null without profiles). */
function exportBase(): string | null {
  const p = profile();
  return p ? String(prof.settings(p).export_dir ?? "").trim().replace(/^~(?=$|\/)/, os.homedir()) || path.join(prof.folder(p), "Exports") : null;
}

/** The video (named by its title), its SRT, the NLE files and the editor handoff, into <export folder>/<title>/. */
function deliverTo(id: string): string | null {
  const base = exportBase();
  if (!base) return null;
  const name = lib.record(id).title.replace(/[/\\:*?"<>|]+/g, "-").trim() || id;
  const dest = path.join(base, name);
  mkdirSync(dest, { recursive: true });
  const exp = path.join(lib.editDir(id), "export");
  if (existsSync(exp)) cpSync(exp, dest, { recursive: true });
  const render = path.join(lib.editDir(id), "render.mp4");
  if (existsSync(render)) copyFileSync(render, path.join(dest, `${name}.mp4`));
  return dest;
}

// --- a video's own sound and look (adjust.json: edit/scripts/audio.py, adjust.py) ------------------------------------

const EDIT_SCRIPTS = path.join(PLUGIN, "skills", "edit", "scripts");
const readAdjust = (id: string): Record<string, any> => { try { return JSON.parse(readFileSync(path.join(lib.editDir(id), "adjust.json"), "utf8")); } catch { return {}; } };
const writeAdjust = (id: string, d: Record<string, unknown>): void => writeFileSync(path.join(lib.editDir(id), "adjust.json"), JSON.stringify(d, null, 1));

/** The cut's voice cleaned (or put back) per its audio settings, then the edit made again so it carries it. */
async function cleanSound(id: string): Promise<void> {
  if (jobs.has(jk(id))) { setTimeout(() => void cleanSound(id), 5000).unref(); return; }
  jobs.set(jk(id), { name: "sound", startedAt: new Date().toISOString() });
  try {
    step(id, "Cleaning up the sound");
    const r = await runScript([path.join(EDIT_SCRIPTS, "audio.py"), "apply", lib.editDir(id)]);
    if (r.code) throw new Error(r.err.trim().split("\n").slice(-1)[0] || "the sound could not be cleaned");
    // the music bed dips under the voice as it is now, or not at all (the switch): made again the way it was made
    if (existsSync(path.join(lib.editDir(id), ".sfx", "music.wav"))) {
      step(id, "Mixing the music under your voice");
      await runScript([path.join(EDIT_SCRIPTS, "sfx.py"), "music", lib.editDir(id), "--again"]);
    }
    step(id, r.out.trim().split("\n").slice(-1)[0] || "The sound is clean", { done: true, progress: 1 });
  } catch (e) {
    step(id, "The sound could not be cleaned", { failed: (e as Error).message });
  } finally {
    jobs.delete(jk(id));
    broadcast("video", { id });
  }
  renderSoon(id, "The new sound");
}

// the edit made again a few seconds after the last change (the owner's choice: a live preview, then a render by itself)
const pendingRenders = new Map<string, NodeJS.Timeout>();
function renderSoon(id: string, why: string, ms = 4000): void {
  const k = jk(id), pid = profileId();
  clearTimeout(pendingRenders.get(k));
  pendingRenders.set(k, setTimeout(() => { pendingRenders.delete(k); withProfile(pid, () => void renderEdit(id, why)); }, ms));
}
async function renderEdit(id: string, why: string): Promise<void> {
  const d = lib.editDir(id);
  if (!existsSync(path.join(d, "plan.json"))) return;   // no edit yet: the cut shows the changes live
  const r = lib.record(id), c = r.session ? claude().get(r.session) : undefined;
  if (jobs.has(jk(id)) || lib.working(id) || c?.status === "running") { renderSoon(id, why, 15000); return; }   // after what runs now
  jobs.set(jk(id), { name: "render", startedAt: new Date().toISOString() });
  try {
    step(id, `${why}: making the video`);
    const out = await runScript([path.join(EDIT_SCRIPTS, "edit.py"), "render", d]);
    if (out.code) throw new Error(out.err.trim().split("\n").slice(-1)[0] || "the render stopped");
    step(id, "The video is ready", { done: true, progress: 1 });
  } catch (e) {
    step(id, "The video could not be made", { failed: (e as Error).message });
  } finally {
    jobs.delete(jk(id));
    broadcast("video", { id });
  }
}

// --- profiles -----------------------------------------------------------------------------------------------------

/** This device picks a profile: its cookie (every later request, video and picture runs as it) and the studio's last
 *  pick (background work outside a request). */
function selectProfile(res: http.ServerResponse, id: string): void {
  pickProfile(id);
  res.setHeader("set-cookie", `mm_profile=${encodeURIComponent(id)}; Path=/; Max-Age=315360000; SameSite=Lax`);
}
const hasHandles = (h: unknown): h is Record<string, string> =>
  !!h && typeof h === "object" && Object.values(h as Record<string, unknown>).some((v) => typeof v === "string" && v.trim());

/** A profile's own style, measured from its handles in the background (creator-teardown), marked as its own. */
function measureStyle(id: string, handles: Record<string, string>): void {
  withProfile(id, () => {
    const who = profile()?.name ?? id;
    const list = Object.entries(handles).filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v.trim().replace(/^@/, "")}`).join(", ");
    claude().ensure("measure", `Measuring ${who}'s style`, LIBRARY());
    claude().send("measure", `Measure ${who}'s style from their reels.`, [
      `You are working inside the motionmaxxing studio, in the profile of ${who} (its library folder is ${LIBRARY()}).`,
      `Measure ${who}'s own style with the motionmaxxing creator-teardown skill (load it with the Skill tool:`,
      "motionmaxxing:creator-teardown), from their recent short videos. Their accounts: " + list + ".",
      "- Only the style is needed: follow the skill's own note for when another skill needs only the style.json.",
      "- Write it under creator-teardowns/<handle>/ in this folder, and add \"owner\": true to its style.json (the one key the",
      "  skill lets you set): it is this profile's own style, and every edit in this profile starts from it.",
      "- A platform that cannot be reached (TikTok blocked, Instagram behind a login): use the others, and say which in the end.",
      "- Never ask: decide. End with one short line: how many videos were measured and the style in a few words.",
    ].join("\n"));
  });
}

/** Every week a profile's own style is measured again from its newest reels, as a proposal beside the style it has:
 *  style.next.json and style.change.md (what changed), until the owner says use it (the profile home). */
const WEEK_MS = 7 * 24 * 3600 * 1000;
function refreshStyles(): void {
  eachProfile(() => {
    const p = profile();
    if (!p || !hasHandles(prof.settings(p).handles)) return;
    const own = ownStyle(), c = claude();
    if (!own || c.get("measure")?.status === "running" || c.get("remeasure")?.status === "running") return;
    const dir = path.join(prof.folder(p), "creator-teardowns", own);
    if (existsSync(path.join(dir, "style.next.json"))) return;   // a proposal waits for the owner
    const age = Date.now() - Math.max(statSync(path.join(dir, "style.json")).mtimeMs, (() => { try { return statSync(path.join(dir, ".measured")).mtimeMs; } catch { return 0; } })());
    if (age < WEEK_MS) return;
    writeFileSync(path.join(dir, ".measured"), new Date().toISOString());   // tried this week, whatever comes of it
    c.ensure("remeasure", `Measuring ${p.name}'s style again`, LIBRARY());
    c.send("remeasure", `Measure ${p.name}'s style again from the newest reels.`, [
      `You are working inside the motionmaxxing studio, in the profile of ${p.name} (its library folder is ${LIBRARY()}).`,
      `Measure ${p.name}'s style again from their newest short videos with the motionmaxxing creator-teardown skill (the`,
      `Skill tool: motionmaxxing:creator-teardown), style only, as the skill's note for that says, into creator-teardowns/${own}/.`,
      `Their accounts: ${Object.entries(prof.settings(p).handles as Record<string, string>).filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v}`).join(", ")}.`,
      `- Before you start, copy creator-teardowns/${own}/style.json to style.prev.json. When it is measured, move the new style.json`,
      "  to style.next.json and put style.prev.json back as style.json: the new one is a proposal the owner approves.",
      "- Write style.change.md beside it: at most five short lines, what changed in numbers a person can see (caption size and",
      "  place, cuts or zooms a minute, how much half-screen or full-screen, music), or one line saying nothing that matters changed.",
      `- Keep "owner": true in style.next.json. Never ask: decide. End with one short line.`,
    ].join("\n"));
  });
}
setTimeout(() => { refreshStyles(); setInterval(refreshStyles, 6 * 3600 * 1000).unref(); }, 120_000).unref();

// --- prompts ------------------------------------------------------------------------------------------------------

/** What the cut and the edit are told about the video's language. */
function langLine(code: string | undefined, stage: "cut" | "edit"): string[] {
  const name = code ? lib.LANGS[code] : undefined;
  if (stage === "cut") {
    if (!name) return ["- The take's language is heard when it is transcribed (German, English, Hindi or Hinglish; meta.json keeps it).",
      "  Keep the user's words exactly; a cut only removes."];
    return [`- The take is ${name}: the user picked it, and transcribe.py reads it from meta.json (or pass \`--lang ${code}\`).`,
      "  Keep the user's words exactly; a cut only removes.",
      ...(code === "hi" || code === "hinglish" ? ["  Hindi comes back in Devanagari and English words in Latin letters, and a word can come back in either:",
        "  the cut compares words by sound, so a retake in the other script still matches its first try."] : [])];
  }
  const whole = ["  Whisper can write a Hindi line as its English translation after English sentences: read captions.txt against the",
    "  script and set such a line right as said with retakes.py line <edit> <start>-<end> \"the line\"."];
  if (code === "hi") return ["- The video is Hindi: captions in Devanagari, the user's words exactly, English words in Latin letters as Whisper",
    "  wrote them (only spelling fixes with retakes.py fix). Text on screen as the speaker would write it: Hindi in Devanagari,",
    "  names and English terms in Latin letters (the captions and the kit carry a Devanagari font).", ...whole];
  if (code === "hinglish") return ["- The video is Hinglish: retakes.py captions writes its Hindi words in Roman letters (aaj, karna, nahi), in the",
    "  script's own spelling where it has one. Read captions.txt and fix a spelling that reads oddly with retakes.py fix, to",
    "  the common Hinglish spelling (\"hai\", \"nahi\", \"kaise\", \"bhai\"): never change a word. Text on screen in Roman letters,",
    "  Hinglish or English.", ...whole];
  return [`- The video is ${name ?? "German"}: captions keep the user's words exactly (only spelling fixes with retakes.py fix).`,
    `  Text on screen in ${name ?? "German"}.`];
}

function cutPrompt(id: string, extra: { instructions?: string; script?: string }): string {
  const d = lib.editDir(id), r = lib.record(id);
  return [
    "You are working inside the motionmaxxing studio, a Mac app. The user just added a raw take to cut, and they are watching",
    "this chat and the video's page. Make the cut with the motionmaxxing cut skill (load it with the Skill tool: motionmaxxing:cut)",
    "and follow it to the end of its step 5, with these settled:",
    "",
    `- Edit folder: ${d}`,
    ...(r.takes && r.takes.length > 1 ? [
      `- The raw takes, in the order the video goes (the user dropped ${r.takes.length} clips: takes and parts of one talk):`,
      ...r.takes.map((t, i) => `  ${i + 1}. ${t}`),
      "  Join them in this order into edits/<name>/source.mp4 with join.py first (step 0a) and cut that: one video made of all of",
      "  them. A line said in two clips is a retake like any other: the last good take wins.",
    ] : [`- The raw take: ${r.source}`]),
    ...(extra.script ? [`- The user's script: ${extra.script} (pass it to transcribe.py and run script_match.py)`] : []),
    "- First `taste.py show --edit` as the skill says: the user's learned cut taste (pause length) is in it.",
    "- A phone or WhatsApp clip has a variable frame rate: make edits/<name>/source.mp4 with join.py first (step 0a), and cut that.",
    ...langLine(r.lang, "cut"),
    "- Last take wins, unless it is worse. Where takes are close, run takes.py sheets and look at the sheets; still unclear,",
    "  watch the stretch with the motionmaxxing watch skill.",
    "- Always heal the transcript right after transcribing (transcribe.py heal): it finds the retakes Whisper wrote once",
    "  and the words it stamped on one moment. After verify: run its HEAL line, propose again, fix the spans, one round.",
    "- The studio shows the progress and the cut by itself: never run review.py, never open a browser or a page.",
    "- Ask only with AskUserQuestion (the studio shows a card). Never ask whether to cut first: cut first.",
    "- When cut.mp4 is rendered and verified, end with a short message: the length before and after, what went, and anything",
    "  the user should look at. Their notes and approve come from the studio's page.",
    ...(extra.instructions ? ["", "What the user wrote:", extra.instructions] : []),
  ].join("\n");
}

/** The owner's own measured style: the creator teardown whose style.json says "owner": true (library.py own-style). */
function ownStyle(): string | null {
  const root = path.join(LIBRARY(), "creator-teardowns");
  try {
    for (const h of readdirSync(root).sort()) {
      try { if (JSON.parse(readFileSync(path.join(root, h, "style.json"), "utf8")).owner === true) return h; } catch { /* not a style */ }
    }
  } catch { /* no teardowns yet */ }
  return null;
}

function editPrompt(id: string): string {
  const d = lib.editDir(id), r = lib.record(id);
  const own = ownStyle();
  return [
    "The user approved the cut in the motionmaxxing studio. Make the edit with the motionmaxxing edit skill (load it with",
    "the Skill tool: motionmaxxing:edit) and follow it through step 8, with these settled:",
    "",
    `- Edit folder: ${d} (cut.mp4, words.json and cut.transcript.json are there)`,
    own ? `- The style: the owner's own measured style, ${path.join(LIBRARY(), "creator-teardowns", own, "style.json")} (copy it to style.json), unless the chat named another.`
        : "- The style: step 1 of the skill picks it.",
    ...langLine(lib.lang(id), "edit"),
    ...(r.broll?.length ? [
      `- B-roll the user dropped with this video, saved in the library's b-roll (${clipsMod.BROLL}): ${r.broll.map((f) => path.basename(f)).join(", ")}.`,
      "  Look at each (broll.py sheet library) and put the ones that show what a line says on that line (copy into images/:",
      "  a video_card, or the full frame); the rest of the library's b-roll is there for any line too.",
    ] : []),
    "- Pick the placement per beat and mix them: background (you cut out in front of the visual), half the screen,",
    "  the whole screen, and few small boxes (at most 40%). Real things only: never a text card. Captions are placed by",
    "  plan.py (never on the face, inside the app's safe zone): never set their y by hand.",
    "- Motion graphics on most lines: the motion skill's kit engine (its references/kit-clips.md), built here in this",
    "  session (no subagents): scaffold a clip per beat, write it, check it (two at a time), place-kit, plan, align, plan.",
    "  Never a zoomed website crop as a visual. Hold a full-screen moment about 2 s; at most three layout changes in 10 s.",
    `- Demo recordings: \`python3 ${path.join(PLUGIN, "lib", "mm", "library.py")} recordings\` lists the library's. One that shows`,
    "  what a line names (a site, a product, a page) goes on that line in a footage clip (kit-clips.md, Footage), whichever",
    "  video it was made for. A line that names a site or a product with none: record it with the record skill first.",
    "- Render on this Mac. The studio shows render.mp4 and the plan's timeline by itself: never open a browser or a page.",
    "- Ask only with AskUserQuestion (the studio shows a card).",
    "- End with one short message: the length, the style, how many visuals and where they sit, anything to check.",
  ].join("\n");
}

function notesPrompt(id: string, notes: lib.Note[]): string {
  const d = lib.editDir(id);
  const say = (n: lib.Note) => {
    const lines = [`- note ${n.id} at ${n.t.toFixed(1)} s: ${n.text}`];
    for (const r of n.thread ?? []) lines.push(`    ${r.from === "claude" ? "you answered" : "the user"}: ${r.text}`);
    if (n.sent) lines.push("    (the user brought this one back: read the thread, it is not fixed yet)");
    return lines.join("\n");
  };
  return [
    `The user left notes on the ${notes[0]?.stage ?? "cut"} of ${d} in the studio, each at a moment of the video (seconds on the ${notes[0]?.stage === "edit" ? "edit (render.mp4, the cut's clock)" : "cut"}):`,
    ...notes.map(say),
    "",
    notes[0]?.stage === "edit" ? "Fix each one as the edit skill says (visuals.json, images.json, style.json, then plan, stills and render again; a note about the cut itself: the cut skill)." : "Fix each one (the cut: change spans.json and keep.json by quoting, then build, render and verify as the cut skill says).",
    `Then answer each note in its own thread, once its fix is made: python3 "${path.join(PLUGIN, "lib", "mm", "notes.py")}" reply "${d}" <note id> "<one short line: what changed>" --done`,
    "(leave out --done when you need the user's answer first, and ask your question in that line). Answer in the user's language. The studio shows each answer under its note and turns the note green when it is done.",
  ].join("\n");
}

// --- http ---------------------------------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webm": "video/webm",
};

function sendJson(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}

/** A file with Range support, so the player can seek. */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, f: string): void {
  if (!existsSync(f)) { res.writeHead(404).end(); return; }
  const size = statSync(f).size, type = MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    createReadStream(f, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
  createReadStream(f).pipe(res);
}

function streamSession(req: http.IncomingMessage, res: http.ServerResponse, sid: string): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const off = claude().subscribe(sid, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => { off(); clearInterval(ping); });
}

const cookieProfile = (req: http.IncomingMessage): string | null => {
  const m = /(?:^|;\s*)mm_profile=([^;]+)/.exec(String(req.headers.cookie ?? ""));
  const id = m ? decodeURIComponent(m[1]!) : null;
  return id && profiles().some((p) => p.id === id) ? id : null;
};
const server = http.createServer((req, res) => withProfile(cookieProfile(req) ?? (profiles().length ? profileId() : null), () => handle(req, res)));
async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname, m = req.method ?? "GET";
    const seg = p.split("/").filter(Boolean).map(decodeURIComponent);

    if (p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: {}\n\n`);
      sse.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
      req.on("close", () => { sse.delete(res); clearInterval(ping); });
      return;
    }
    // --- profiles: one creator each (paths.ts, profiles.ts) --------------------------------------------------------
    if (p === "/api/profiles" && m === "GET") {
      return sendJson(res, 200, { profiles: profiles().map(prof.card), current: cookieProfile(req) });
    }
    if (p === "/api/profiles" && m === "POST") {
      const b = await body(req);
      if (!String(b.name ?? "").trim()) return sendJson(res, 400, { error: "give the profile a name" });
      const made = await prof.add(String(b.name), { lang: typeof b.lang === "string" && lib.LANGS[b.lang] ? b.lang : undefined,
        copyFrom: typeof b.copy_from === "string" ? b.copy_from : undefined });
      const before = claudes.get("");   // the first profile took the library and its chats (profiles.py adopt)
      if (before && !before.busy()) claudes.delete("");
      prof.saveSettings(made, { ...(b.handles ? { handles: b.handles } : {}), ...(b.brand ? { brand: b.brand } : {}), ...(b.cta ? { cta: b.cta } : {}) });
      selectProfile(res, made.id);
      if (hasHandles(b.handles)) measureStyle(made.id, b.handles);   // the owner's choice: start right away
      broadcast("profiles", { profile: null });
      return sendJson(res, 201, prof.card(made));
    }
    if (seg[0] === "api" && seg[1] === "profiles" && seg[2]) {
      const pr = prof.byId(seg[2]);
      if (!pr) return sendJson(res, 404, { error: "no such profile" });
      const action = seg[3];
      if (action === "select" && m === "POST") { selectProfile(res, pr.id); return sendJson(res, 200, { ok: true }); }
      if (action === "settings" && m === "GET") {
        return sendJson(res, 200, { ...prof.card(pr), settings: prof.settings(pr), folder: prof.folder(pr), ownStyle: withProfile(pr.id, ownStyle),
          measuring: withProfile(pr.id, () => claude().get("measure")?.status === "running") });
      }
      if (action === "settings" && m === "POST") {
        const b = await body(req);
        if (typeof b.name === "string" && b.name.trim()) prof.rename(pr.id, b.name);
        const before = JSON.stringify(prof.settings(pr).handles ?? {});
        const saved = prof.saveSettings(pr, b);
        if ("handles" in b && JSON.stringify(b.handles ?? {}) !== before && hasHandles(b.handles)) measureStyle(pr.id, b.handles);
        broadcast("profiles", { profile: null });
        return sendJson(res, 200, { ...prof.card(prof.byId(pr.id)!), settings: saved });
      }
      if (action === "picture" && m === "POST") {
        const ext = (path.extname(decodeURIComponent(String(req.headers["x-filename"] ?? "p.jpg"))).toLowerCase().match(/^\.(jpe?g|png|webp|heic)$/) ?? [".jpg"])[0];
        const f = path.join(prof.folder(pr), `picture${ext}`);
        await new Promise<void>((resolve, reject) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
        prof.setPicture(pr.id, f);
        broadcast("profiles", { profile: null });
        return sendJson(res, 200, prof.card(prof.byId(pr.id)!));
      }
      if (action === "logo" && m === "POST") {   // the brand kit's logo, in the profile's folder (brand.logo names it)
        const ext = (path.extname(decodeURIComponent(String(req.headers["x-filename"] ?? "l.png"))).toLowerCase().match(/^\.(svg|png|jpe?g|webp)$/) ?? [".png"])[0];
        mkdirSync(path.join(prof.folder(pr), "brand"), { recursive: true });
        const f = path.join(prof.folder(pr), "brand", `logo${ext}`);
        await new Promise<void>((resolve, reject) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
        const brand: Record<string, unknown> = { ...((prof.settings(pr).brand as Record<string, unknown> | undefined) ?? {}), logo: f };
        delete brand.use_creator;
        return sendJson(res, 200, { settings: prof.saveSettings(pr, { brand }) });
      }
      if (action === "logo" && m === "GET") {
        const f = String((prof.settings(pr).brand as { logo?: string } | undefined)?.logo ?? "");
        return f && existsSync(f) ? sendFile(req, res, f) : void res.writeHead(404).end();
      }
      if (action === "picture" && m === "GET") {
        const f = prof.picturePath(pr);
        return f ? sendFile(req, res, f) : void res.writeHead(404).end();
      }
    }
    if (p === "/api/state") return sendJson(res, 200, { library: LIBRARY(), root: ROOT, profile: profileId(), home: HOME, plugin: PLUGIN, version: JSON.parse(readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version });
    if (p === "/api/setup" && m === "GET") {
      const r = await runScript([SETUP, "doctor", "--json"]);
      return sendJson(res, 200, { rows: JSON.parse(r.out || "[]"), installing: jobs.has("__setup") });
    }
    if (p === "/api/setup/install" && m === "POST") {
      if (!jobs.has("__setup")) {
        jobs.set("__setup", { name: "setup", startedAt: new Date().toISOString() });
        broadcast("setup", { installing: true });
        void runScript([SETUP, "install-all"]).then(() => { jobs.delete("__setup"); broadcast("setup", { installing: false }); });
      }
      return sendJson(res, 202, { ok: true });
    }
    if (p === "/api/setup/progress") {
      try {
        const lines = readFileSync(path.join(HOME, "progress", "setup.jsonl"), "utf8").trim().split("\n");
        return sendJson(res, 200, JSON.parse(lines[lines.length - 1]!));
      } catch { return sendJson(res, 200, null); }
    }

    if (p === "/api/videos" && m === "GET") return sendJson(res, 200, lib.list());
    if (p === "/api/videos" && m === "POST") {
      // Either a local file's path (JSON), or the file itself streamed in the body (x-filename header).
      const name = req.headers["x-filename"] ? decodeURIComponent(String(req.headers["x-filename"])) : undefined;
      let source: string, title: string;
      if (name) {
        mkdirSync(VIDEOS(), { recursive: true });
        const ext = path.extname(name) || ".mp4";
        let f = path.join(VIDEOS(), slug(name) + ext), n = 2;
        while (existsSync(f)) f = path.join(VIDEOS(), `${slug(name)}-${n++}${ext}`);
        await new Promise<void>((resolve, reject) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
        source = f; title = name.replace(/\.[^.]+$/, "");
      } else {
        const b = await body(req);
        if (!b.path || !existsSync(b.path)) return sendJson(res, 400, { error: "no such file" });
        source = b.path; title = b.title || path.basename(b.path).replace(/\.[^.]+$/, "");
      }
      const id = lib.newEdit(title, source);
      // the profile's defaults for a new video: studio sound, the look (adjust.json; audio.py and adjust.py read it)
      writeFileSync(path.join(lib.editDir(id), "adjust.json"), JSON.stringify(prof.newVideoAdjust(profile()), null, 1));
      clipsMod.addClip(id, source, name ?? path.basename(source));
      clipsMod.classifySoon(id, () => broadcast("video", { id }));
      broadcast("video", { id });
      return sendJson(res, 201, { id });
    }
    if (seg[0] === "api" && seg[1] === "videos" && seg[2]) {
      const id = seg[2];
      if (!existsSync(lib.editDir(id))) return sendJson(res, 404, { error: "no such video" });
      const action = seg[3];
      if (!action && m === "GET") {
        const r = lib.record(id);
        const c = r.session ? claude().get(r.session) : undefined;
        clipsMod.resume(id, () => broadcast("video", { id }));
        // the studio sound's A/B: the original voice beside the cleaned one, and both levels (audio.py)
        const snd = (() => { try { return JSON.parse(readFileSync(path.join(lib.editDir(id), ".adjust", "audio.json"), "utf8")); } catch { return null; } })();
        const sound = snd?.clean && existsSync(path.join(lib.editDir(id), "cut.orig.m4a"))
          ? { original: `/media/${encodeURIComponent(id)}/cut.orig.m4a?v=${snd.cut_mtime_ns ?? 0}`, lufs: snd.lufs, orig_lufs: snd.orig_lufs } : null;
        return sendJson(res, 200, { ...lib.summary(id), transcript: lib.transcript(id), plan: lib.plan(id), notes: lib.notes(id), job: jobs.get(jk(id)) ?? null, chat: c ? { id: c.id, status: c.status } : null, sound });
      }
      // more clips dropped onto the same new video (takes, parts, b-roll), each checked like the first
      if (action === "files" && m === "POST" && !seg[4]) {
        const name = decodeURIComponent(String(req.headers["x-filename"] ?? "clip.mp4"));
        mkdirSync(VIDEOS(), { recursive: true });
        const ext = path.extname(name) || ".mp4";
        let f = path.join(VIDEOS(), slug(name) + ext), n = 2;
        while (existsSync(f)) f = path.join(VIDEOS(), `${slug(name)}-${n++}${ext}`);
        await new Promise<void>((resolve, reject) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
        const at = clipsMod.addClip(id, f, name);
        clipsMod.classifySoon(id, () => broadcast("video", { id }));
        broadcast("video", { id });
        return sendJson(res, 201, { n: at });
      }
      if (action === "files" && m === "GET" && seg[4] && seg[5] === "poster") {   // a dropped clip's thumbnail
        const c = clipsMod.clips(id)[Number(seg[4])];
        const f = c ? await clipsMod.clipPoster(id, c.path) : undefined;
        return f ? sendFile(req, res, f) : void res.writeHead(404).end();
      }
      if (action === "files" && m === "POST" && seg[4]) {
        const b = await body(req), n = Number(seg[4]);
        if (lib.record(id).session) return sendJson(res, 409, { error: "the cut has started: its clips are set" });
        try {
          if (b.remove) {
            const c = clipsMod.removeClip(id, n);
            if (path.resolve(c.path).startsWith(VIDEOS() + path.sep)) bin.trash("video", path.basename(c.path), c.name, [c.path]);
          } else clipsMod.setClip(id, n, { kind: b.kind === "broll" ? "broll" : b.kind === "take" ? "take" : undefined, move: Number(b.move) || 0 });
        } catch (e) { return sendJson(res, 400, { error: (e as Error).message }); }
        broadcast("video", { id });
        return sendJson(res, 200, lib.summary(id));
      }
      if (action === "start" && m === "POST") {
        const b = await body(req);
        const r = lib.record(id);
        // the clips: takes in order (two or more are joined before the cut), b-roll into the library's b-roll
        const cl = clipsMod.clips(id);
        // one clip is the take, whatever it looks like (no waiting for its check); several wait for theirs
        if (cl.length > 1 && cl.some((c) => c.kind === "pending")) return sendJson(res, 409, { error: "still checking the clips: a moment" });
        const takes = cl.length === 1 ? cl : cl.filter((c) => c.kind === "take");
        if (!takes.length) return sendJson(res, 400, { error: "no take: mark the clips of you talking as takes" });
        const saved = cl.filter((c) => c.kind === "broll" && !takes.includes(c)).map((c) => {
          try { return clipsMod.saveBroll(c.path, c.name.replace(/\.[^.]+$/, ""), { id, title: r.title }, c.duration); }
          catch { return c.path; }   // gone, or on another disk: the edit can still read it where it is
        });
        r.files = cl.map((c) => (c.kind === "broll" && !takes.includes(c) ? { ...c, path: saved.shift() ?? c.path } : c));
        r.broll = r.files.filter((c) => c.kind === "broll" && !takes.includes(c)).map((c) => c.path);
        r.source = takes[0]!.path;
        r.takes = takes.length > 1 ? takes.map((c) => c.path) : undefined;
        let script: string | undefined;
        if (b.script && String(b.script).trim()) {
          script = path.join(lib.editDir(id), "script.md");
          writeFileSync(script, String(b.script));
          r.script = script;
        }
        const lang = typeof b.lang === "string" && lib.LANGS[b.lang] ? b.lang : undefined;   // "auto": heard
        r.lang = lang;
        lib.setMeta(id, { lang_asked: lang ?? "auto" });
        const sid = `v_${id}`;
        r.session = sid; lib.saveRecord(id, r);
        claude().ensure(sid, r.title, lib.editDir(id));
        claude().send(sid, b.instructions?.trim() ? `Cut this take. ${b.instructions.trim()}` : "Cut this take.", cutPrompt(id, { instructions: b.instructions, script }));
        broadcast("video", { id });
        return sendJson(res, 202, { session: sid });
      }
      if (action === "edits" && m === "POST") {
        const b = await body(req);
        const r = await runScript([path.join(CUT, "edits.py"), "apply", lib.editDir(id), JSON.stringify({ cut: b.cut ?? [], restore: b.restore ?? [] })]);
        if (r.code) return sendJson(res, 409, { error: r.err.replace(/^REFUSED:\s*/, "").trim() });
        void rebuild(id, "Your transcript edit");
        return sendJson(res, 202, { ok: true, message: r.out.trim() });
      }
      if (action === "notes" && m === "POST" && !seg[4]) {
        const b = await body(req);
        const n = lib.notes(id);
        n.push({ id: `n${randomBytes(3).toString("hex")}`, t: Number(b.t) || 0, text: String(b.text ?? "").trim(), stage: lib.record(id).stage === "cut" ? "cut" : "edit", at: new Date().toISOString() });
        lib.saveNotes(id, n); broadcast("video", { id });
        return sendJson(res, 201, n);
      }
      if (action === "notes" && m === "DELETE" && seg[4]) {   // a note Claude never saw (one with a thread stays)
        lib.saveNotes(id, lib.notes(id).filter((x) => x.id !== seg[4] || !!x.sent || !!x.thread?.length)); broadcast("video", { id });
        return sendJson(res, 200, lib.notes(id));
      }
      // the user's answer in a note's thread, and reopening a fixed note: both go to Claude with the next Send notes
      if (action === "notes" && m === "POST" && seg[4] && (seg[5] === "reply" || seg[5] === "reopen")) {
        const b = await body(req), all = lib.notes(id), n = all.find((x) => x.id === seg[4]);
        if (!n) return sendJson(res, 404, { error: "no such note" });
        const text = String(b.text ?? "").trim();
        if (seg[5] === "reply" && !text) return sendJson(res, 400, { error: "write a reply" });
        const at = new Date().toISOString();
        if (text) (n.thread ??= []).push({ from: "you", text, at });
        if (seg[5] === "reopen") { delete n.resolved; n.reopened = at; }
        lib.saveNotes(id, all); broadcast("video", { id });
        return sendJson(res, 200, all);
      }
      if (action === "send-notes" && m === "POST") {
        // new notes, and notes with a reply of the user's or reopened since Claude last had them
        const r = lib.record(id), all = lib.notes(id), open = all.filter((x) => lib.noteState(x) === "new");
        if (!open.length) return sendJson(res, 400, { error: "no new notes" });
        const sid = r.session ?? `v_${id}`;
        if (!r.session) { r.session = sid; lib.saveRecord(id, r); }
        claude().ensure(sid, r.title, lib.editDir(id));
        const shown = open.map((x) => {
          const fresh = (x.thread ?? []).filter((y) => y.from === "you" && !y.sent).map((y) => y.text);
          return `${x.t.toFixed(1)} s: ${x.text}${x.sent ? ` (again${fresh.length ? `: ${fresh.join(" / ")}` : ""})` : ""}`;
        });
        claude().send(sid, `Notes:\n${shown.join("\n")}`, notesPrompt(id, open));
        const now = new Date().toISOString();
        lib.saveNotes(id, all.map((x) => (open.some((o) => o.id === x.id)
          ? { ...x, sent: now, thread: x.thread?.map((y) => (y.from === "you" && !y.sent ? { ...y, sent: now } : y)) } : x)));
        broadcast("video", { id });
        return sendJson(res, 202, { session: sid });
      }
      if (action === "approve" && m === "POST") {
        const b = await body(req);
        const r = lib.record(id);
        const stage = b.stage === "edit" ? "edit" : "cut";
        r.approved = { ...(r.approved ?? {}), [stage]: new Date().toISOString() };
        r.stage = stage === "cut" ? "edit" : "done";
        const sid = r.session ?? `v_${id}`;
        if (!r.session) r.session = sid;
        lib.saveRecord(id, r);
        claude().ensure(sid, r.title, lib.editDir(id));
        if (stage === "cut") {
          // Approving the cut is the go for the edit (one approve, then the edit is made and shown).
          claude().send(sid, "The cut is approved. Make the edit.", editPrompt(id));
        } else {
          claude().send(sid, "The user approved the edit.", `The user approved the edit of ${lib.editDir(id)}. Do the edit skill's step 8 after approval (save the motion clips), then stop with one short line.`);
          // the approved video, its captions and the editor handoff into the profile's export folder (the owner's choice)
          if (profile() && !jobs.has(jk(id)) && existsSync(path.join(lib.editDir(id), "plan.json"))) exportVideo(id, true);
        }
        broadcast("video", { id });
        return sendJson(res, 200, lib.summary(id));
      }
      if (action === "export" && m === "POST") {
        // Final Cut, Premiere, Resolve, EDL, SRT, the CapCut steps and the handoff, all at once, no Claude needed.
        if (jobs.has(jk(id))) return sendJson(res, 409, { error: "something is running on this video; try again in a moment" });
        if (!existsSync(path.join(lib.editDir(id), "plan.json"))) return sendJson(res, 400, { error: "make the edit first" });
        exportVideo(id, !!profile());
        return sendJson(res, 202, { ok: true });
      }
      if (action === "adjust" && m === "GET" && !seg[4]) {
        const d = lib.editDir(id);
        const done = (() => { try { return JSON.parse(readFileSync(path.join(d, ".adjust", "audio.json"), "utf8")); } catch { return null; } })();
        return sendJson(res, 200, { adjust: readAdjust(id), sound: done, original: existsSync(path.join(d, "cut.orig.m4a")) ? `/media/${encodeURIComponent(id)}/cut.orig.m4a` : null,
          hasEdit: existsSync(path.join(d, "plan.json")), face: existsSync(path.join(d, "face.json")),
          refs: profiles().map((p) => ({ profile: p.id, name: p.name })) });
      }
      if (action === "adjust" && m === "POST" && !seg[4]) {
        const b = await body(req), cur = readAdjust(id), next: Record<string, any> = { ...cur };
        const changed = new Set<string>();
        for (const k of ["audio", "look", "colour", "keyframes", "volume"]) {
          if (!(k in b)) continue;
          const v = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? { ...(cur[k] ?? {}), ...b[k] } : b[k];
          if (JSON.stringify(v) !== JSON.stringify(cur[k])) { next[k] = v; changed.add(k); }
        }
        // a new reference, or the look switched on: match it again (adjust.py auto) on the next render
        if (changed.has("look") && (b.look?.ref || b.look?.on) && !b.look?.wb) { delete next.look.cut; }
        if (changed.has("colour")) {
          // the colour by hand as the render applies it: a matrix and a 1D LUT (the preview computes the same)
          const cube = path.join(lib.editDir(id), ".adjust", "colour.cube");
          if (isNeutral(next.colour)) { delete next.colour_compiled; rmSync(cube, { force: true }); }
          else {
            const c = compile(next.colour, 1024);
            mkdirSync(path.dirname(cube), { recursive: true });
            writeFileSync(cube, cube1d(c.lut));
            next.colour_compiled = { matrix: c.matrix.map((x) => Math.round(x * 1e5) / 1e5), cube: ".adjust/colour.cube" };
          }
        }
        writeAdjust(id, next);
        if (changed.has("audio")) void cleanSound(id);
        else if (["look", "colour", "keyframes", "volume"].some((k) => changed.has(k))) renderSoon(id, "Your changes");
        broadcast("video", { id });
        return sendJson(res, 200, { adjust: next, changed: [...changed] });
      }
      // copy this video's sound, look and colour to other videos of the profile, or make them its default
      if (action === "adjust" && m === "POST" && seg[4] === "copy") {
        const b = await body(req), src = readAdjust(id);
        const parts = (Array.isArray(b.parts) ? b.parts : ["audio", "look", "colour"]).filter((k: string) => ["audio", "look", "colour"].includes(k));
        const pick = Object.fromEntries(parts.filter((k: string) => src[k]).map((k: string) => [k, k === "look" ? { on: src.look.on, strength: src.look.strength, ref: src.look.ref } : src[k]]));
        if (b.to === "default") {
          const pr = profile();
          if (!pr) return sendJson(res, 400, { error: "no profile" });
          const cur = (prof.settings(pr).defaults as Record<string, unknown> | undefined) ?? {};
          prof.saveSettings(pr, { defaults: { ...cur, ...pick } });
          return sendJson(res, 200, { ok: true, to: "default" });
        }
        const to = (Array.isArray(b.to) ? b.to : []).map(String).filter((x: string) => x !== id && existsSync(lib.editDir(x)));
        for (const x of to) {
          const cur = readAdjust(x);
          writeAdjust(x, { ...cur, ...pick });
          if (pick.audio) void cleanSound(x);
          else renderSoon(x, "Copied settings");
        }
        return sendJson(res, 200, { ok: true, to });
      }
      if (action === "move" && m === "POST") {   // into another profile: the video, its raw takes and its chat
        const b = await body(req), to = prof.byId(String(b.to ?? "")), from = profileId();
        if (!to || !from || to.id === from) return sendJson(res, 400, { error: "pick another profile" });
        const r = lib.record(id), sid = r.session ?? `v_${id}`, c = claude(), s = c.get(sid);
        if (jobs.has(jk(id)) || lib.working(id) || (s && (s.status === "running" || s.status === "waiting")))
          return sendJson(res, 409, { error: "something is working on this video; move it when it is done" });
        if (withProfile(to.id, () => existsSync(lib.editDir(id)))) return sendJson(res, 409, { error: `${to.name} has a video with this name; rename one first` });
        if (c.busy(sid)) c.stop(sid);
        const out = await runScript([path.join(PLUGIN, "lib", "mm", "profiles.py"), "move-video", id, "--from", from, "--to", to.id]);
        if (out.code) return sendJson(res, 500, { error: out.err.trim().split("\n").slice(-1)[0] || "the move stopped" });
        c.forget(sid);
        const there = claudes.get(to.id);
        if (there && !there.busy()) claudes.delete(to.id);   // read again on its next use, with the chat that came
        broadcast("video", { id });
        withProfile(to.id, () => broadcast("video", { id }));
        return sendJson(res, 200, { ok: true, to: to.id, log: out.out.trim() });
      }
      if ((action === "delete" || action === "trash") && m === "POST") {
        // Recently deleted (Undo, Restore), never rm. Its raw take goes too when it was added into the library.
        if (jobs.has(jk(id))) return sendJson(res, 409, { error: "it is being rebuilt; try again in a moment" });
        const r = lib.record(id);
        if (r.session) claude().stop(r.session);
        const own = [...new Set([r.source, ...(r.files ?? []).filter((c) => c.kind !== "broll").map((c) => c.path)])]
          .filter((f): f is string => !!f && path.resolve(f).startsWith(VIDEOS() + path.sep));
        const d = bin.trash("video", id, r.title, [lib.editDir(id), ...own]);
        broadcast("video", { id });
        return sendJson(res, 200, d);
      }
      if (action === "rename" && m === "POST") {
        const b = await body(req);
        const r = lib.record(id); r.title = String(b.title ?? r.title).slice(0, 80); lib.saveRecord(id, r);
        broadcast("video", { id });
        return sendJson(res, 200, lib.summary(id));
      }
    }

    if (seg[0] === "api" && seg[1] === "chat" && seg[2]) {
      const sid = seg[2], action = seg[3];
      if (!action && m === "GET") {
        const s = claude().get(sid) ?? (sid === "studio" ? claude().ensure("studio", "Studio") : undefined);
        // A conversation that has not started yet reads as an empty one (it is made on the first message).
        return sendJson(res, 200, s ?? { id: sid, title: "", status: "idle", events: [] });
      }
      if (action === "stream") return streamSession(req, res, sid);
      // A file for the next message: the body is the file itself (x-filename), kept in <library>/attachments/<chat>/
      if (action === "attach" && m === "POST") {
        const name = path.basename(decodeURIComponent(String(req.headers["x-filename"] ?? "file"))).replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(-120) || "file";
        const dir = path.join(LIBRARY(), "attachments", path.basename(sid));
        mkdirSync(dir, { recursive: true });
        const f = path.join(dir, `${Date.now()}-${name}`);
        await new Promise<void>((resolve, reject) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
        const ext = path.extname(name).toLowerCase();
        const kind = /^\.(png|jpe?g|gif|webp|heic)$/.test(ext) ? "image" : /^\.(mp4|mov|m4v|webm)$/.test(ext) ? "video" : "file";
        return sendJson(res, 200, { name, path: f, kind, url: `/library-file/attachments/${encodeURIComponent(path.basename(sid))}/${encodeURIComponent(path.basename(f))}` });
      }
      const b = m === "POST" ? await body(req) : {};
      if (action === "send") {
        const edit = b.edit ? lib.editDir(String(b.edit)) : undefined;
        const s = claude().ensure(sid, b.title ?? "Studio", edit);
        const ctx = edit ? `(The user is on the page of the video in ${edit}${typeof b.at === "number" ? `, at ${b.at.toFixed(1)} s` : ""}.)\n\n` : "";
        // only files this chat attached (POST attach): a path from anywhere else is ignored
        const own = path.join(LIBRARY(), "attachments", path.basename(sid));
        const files = (Array.isArray(b.files) ? b.files : []).filter((f: { path?: string }) => typeof f?.path === "string" && path.resolve(f.path).startsWith(own + path.sep) && existsSync(f.path))
          .map((f: { name?: string; path: string; url?: string; kind?: string }) => ({ name: String(f.name ?? path.basename(f.path)), path: f.path, url: String(f.url ?? ""), kind: (["image", "video"].includes(String(f.kind)) ? f.kind : "file") as "image" | "video" | "file" }));
        claude().send(s.id, String(b.text ?? ""), ctx + String(b.text ?? ""), files);
        return sendJson(res, 202, { ok: true });
      }
      if (action === "answer") { claude().answer(sid, b.event, b.answers ?? {}); return sendJson(res, 200, { ok: true }); }
      if (action === "permit") { claude().permit(sid, b.event, !!b.allow, !!b.always); return sendJson(res, 200, { ok: true }); }
      if (action === "stop") { claude().stop(sid); return sendJson(res, 200, { ok: true }); }
    }
    if (p === "/api/chats") return sendJson(res, 200, claude().list());

    // Recently deleted: videos, demos and scripts, restored as they were or handed to the Mac's Trash.
    if (p === "/api/trash" && m === "GET") return sendJson(res, 200, bin.list());
    if (seg[0] === "api" && seg[1] === "trash" && seg[2] && seg[3] === "restore" && m === "POST") {
      try {
        const r = bin.restore(seg[2]);
        broadcast(r.kind, { id: r.id });
        return sendJson(res, 200, r);
      } catch (e) { return sendJson(res, 404, { error: (e as Error).message }); }
    }
    if (seg[0] === "api" && seg[1] === "trash" && seg[2] && seg[3] === "purge" && m === "POST") {
      try { await bin.purge(seg[2]); return sendJson(res, 200, bin.list()); } catch (e) { return sendJson(res, 500, { error: (e as Error).message }); }
    }

    // Scripts: pasted to check their facts before recording.
    if (p === "/api/scripts" && m === "GET") return sendJson(res, 200, scripts.list());
    if (p === "/api/scripts" && m === "POST") {
      const b = await body(req);
      const text = String(b.text ?? "").trim();
      if (text.length < 20) return sendJson(res, 400, { error: "paste the script first" });
      const id = scripts.newScript(text, b.title);
      const sid = `s_${id}`;
      const mt = scripts.meta(id); mt.session = sid; scripts.saveMeta(id, mt);
      claude().ensure(sid, mt.title, scripts.scriptDir(id));
      claude().send(sid, "Check the facts in this script.", scripts.prompt(id));
      broadcast("script", { id });
      return sendJson(res, 201, { id, session: sid });
    }
    if (seg[0] === "api" && seg[1] === "scripts" && seg[2] && seg[3] === "delete" && m === "POST") {
      if (!existsSync(scripts.scriptDir(seg[2]))) return sendJson(res, 404, { error: "no such script" });
      const mt = scripts.meta(seg[2]);
      if (mt.session) claude().stop(mt.session);
      const d = bin.trash("script", seg[2], mt.title, [scripts.scriptDir(seg[2])]);
      broadcast("script", { id: seg[2] });
      return sendJson(res, 200, d);
    }
    if (seg[0] === "api" && seg[1] === "scripts" && seg[2] && seg[3] === "rename" && m === "POST") {
      const b = await body(req), mt = scripts.meta(seg[2]);
      mt.title = String(b.title ?? mt.title).trim().slice(0, 80) || mt.title; scripts.saveMeta(seg[2], mt);
      broadcast("script", { id: seg[2] });
      return sendJson(res, 200, scripts.summary(seg[2]));
    }
    if (seg[0] === "api" && seg[1] === "scripts" && seg[2] && m === "GET") {
      if (!existsSync(scripts.scriptDir(seg[2]))) return sendJson(res, 404, { error: "no such script" });
      const d = scripts.detail(seg[2]), c = d.session ? claude().get(d.session) : undefined;
      return sendJson(res, 200, { ...d, chat: c ? { id: c.id, status: c.status } : null });
    }

    // Demo recordings: Claude drives a site in its own browser, the record skill finishes the video.
    if (p === "/api/demos" && m === "GET") return sendJson(res, 200, demos.list());
    if (p === "/api/demos" && m === "POST") {
      const b = await body(req);
      let url = String(b.url ?? "").trim();
      if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
      try { new URL(url); } catch { return sendJson(res, 400, { error: "that is not a web address" }); }
      const show = String(b.show ?? "").trim();
      if (!show) return sendJson(res, 400, { error: "say what the demo should show" });
      const formats = ["wide", "tall", "both"].includes(b.formats) ? b.formats : "both";
      // the title: the first sentence ("J.A.R.V.I.S." is not one), cut at a word
      const first = show.split(/[.!?](?=\s|$)|\n/)[0]!.trim();
      const title = String(b.title ?? "").trim() || (first.length > 60 ? first.slice(0, 60).replace(/\s+\S*$/, "") + "…" : first);
      const id = demos.newDemo({ title, url, show, formats });
      const sid = `d_${id}`;
      const br = demos.brief(id); br.session = sid; demos.saveBrief(id, br);
      claude().ensure(sid, br.title, demos.demoDir(id));
      claude().send(sid, `Record a demo of ${url}: ${show}`, demos.prompt(id));
      broadcast("demo", { id });
      return sendJson(res, 201, { id, session: sid });
    }
    if (seg[0] === "api" && seg[1] === "demos" && seg[2]) {
      const id = seg[2];
      if (!existsSync(demos.demoDir(id))) return sendJson(res, 404, { error: "no such demo" });
      if (!seg[3] && m === "GET") {
        const s = demos.summary(id), c = s.session ? claude().get(s.session) : undefined;
        return sendJson(res, 200, { ...s, chat: c ? { id: c.id, status: c.status } : null });
      }
      if (seg[3] === "reveal" && m === "POST") { spawn("open", [demos.demoDir(id)], { stdio: "ignore", detached: true }).unref(); return sendJson(res, 200, { ok: true }); }
      // Finish a recording that has no video yet: render.py in the formats the brief asked for, no Claude needed
      if (seg[3] === "finish" && m === "POST") {
        const d = demos.demoDir(id), b = demos.brief(id), lock = path.join(d, demos.FINISH_LOCK);
        if (!existsSync(path.join(d, "events.json"))) return sendJson(res, 409, { error: "nothing recorded yet" });
        if (existsSync(lock)) return sendJson(res, 409, { error: "it is being finished already" });
        writeFileSync(lock, new Date().toISOString());
        broadcast("demo", { id });
        const render = path.join(PLUGIN, "skills", "record", "scripts", "render.py");
        const aspects = b.formats === "both" ? ["16:9", "9:16"] : b.formats === "tall" ? ["9:16"] : ["16:9"];
        void (async () => {
          for (const a of aspects) await runScript([render, d, "--aspect", a]);
          rmSync(lock, { force: true });
          broadcast("demo", { id });
        })();
        return sendJson(res, 202, { ok: true });
      }
      if (seg[3] === "delete" && m === "POST") {
        const br = demos.brief(id);
        if (br.session) claude().stop(br.session);
        const d = bin.trash("demo", id, br.title, [demos.demoDir(id)]);
        broadcast("demo", { id });
        return sendJson(res, 200, d);
      }
      if (seg[3] === "rename" && m === "POST") {
        const b = await body(req), br = demos.brief(id);
        br.title = String(b.title ?? br.title).trim().slice(0, 80) || br.title; demos.saveBrief(id, br);
        broadcast("demo", { id });
        return sendJson(res, 200, demos.summary(id));
      }
    }
    if (p === "/api/recorder/sites" && m === "GET") {
      try { return sendJson(res, 200, JSON.parse(readFileSync(path.join(HOME, "recorder", "sites.json"), "utf8"))); } catch { return sendJson(res, 200, {}); }
    }
    if (seg[0] === "api" && seg[1] === "recorder" && seg[2] === "sites" && seg[3] && m === "DELETE") {
      const f = path.join(HOME, "recorder", "sites.json");
      let sites: Record<string, unknown> = {};
      try { sites = JSON.parse(readFileSync(f, "utf8")); } catch { /* none */ }
      delete sites[seg[3]];
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, JSON.stringify(sites, null, 1));
      return sendJson(res, 200, sites);
    }
    if (p === "/api/recorder/login" && m === "POST") {
      const b = await body(req);
      let url = String(b.url ?? "").trim();
      if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
      try { new URL(url); } catch { return sendJson(res, 400, { error: "that is not a web address" }); }
      // The user opens the recording browser to sign in themselves: their own action, so the site counts as allowed.
      const h = new URL(url).hostname.replace(/^www\./, "");
      const f = path.join(HOME, "recorder", "sites.json");
      let sites: Record<string, unknown> = {};
      try { sites = JSON.parse(readFileSync(f, "utf8")); } catch { /* none */ }
      if (!sites[h]) { sites[h] = { allowed: new Date().toISOString(), by: "sign-in" }; mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(sites, null, 1)); }
      spawn(process.execPath, [demos.RECORDER, "login", url], { stdio: "ignore", detached: true, env: process.env }).unref();
      return sendJson(res, 200, { ok: true });
    }

    if (seg[0] === "media" && seg[1] && seg[2]) {
      const id = seg[1], name = seg[2], d = lib.editDir(id);
      if (name === "__poster") { const f = await lib.poster(id); return f ? sendFile(req, res, f) : void res.writeHead(404).end(); }
      if (name === "__source") { const s = lib.record(id).source; return s ? sendFile(req, res, s) : void res.writeHead(404).end(); }
      if (!/^[\w.-]+$/.test(name)) { res.writeHead(400).end(); return; }
      return sendFile(req, res, path.join(d, name));
    }

    if (p === "/api/keys" && m === "POST") {
      const b = await body(req);
      if (!["pexels", "pixabay"].includes(b.name)) return sendJson(res, 400, { error: "unknown key" });
      if (b.remove) {
        await py(`from mm import keys\nkeys.remove(${JSON.stringify(b.name)})\nprint("{}")`);
        return sendJson(res, 200, { ok: true, message: "removed" });
      }
      // The key travels on stdin, never in argv (other processes can read argv).
      const r = await py<{ ok: boolean; message: string }>(`from mm import keys\nk=sys.stdin.read().strip()\nok,msg=keys.verify(${JSON.stringify(b.name)},k)\nif ok: keys.save(${JSON.stringify(b.name)},k)\nprint(json.dumps({"ok":ok,"message":msg}))`, String(b.key ?? ""));
      return sendJson(res, r.ok ? 200 : 400, r);
    }
    if (p === "/api/keys" && m === "GET") {
      return sendJson(res, 200, await py(`from mm import keys\nprint(json.dumps({n: bool(keys.get(n)[0]) for n in keys.VARS}))`));
    }
    if (p === "/api/styles") {
      const styles = await py<{ handle: string; style: Record<string, unknown> }[]>(`from mm import library\nprint(json.dumps([{"handle": h, "style": s} for h, s in library.styles()]))`);
      // the other profiles' own styles, to borrow (copied into this profile's styles: library.borrow)
      const others = await py<{ pid: string; profile: string; handle: string; style: Record<string, unknown>; dir: string }[]>(
        `from mm import library\nprint(json.dumps([{"pid": p["id"], "profile": p["name"], "handle": h, "style": s, "dir": str(d)} for p, h, s, d in library.others()]))`);
      const coverOf = (dir: string) => ["cover.jpg", "thumb.jpg"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
      const fileUrl = (f: string | undefined) => (f ? `/library-file/${path.relative(ROOT, f).split(path.sep).map(encodeURIComponent).join("/")}` : undefined);
      const taste = await runScript([path.join(PLUGIN, "skills", "taste", "scripts", "taste.py"), "show"]);
      const learned = await runScript([path.join(PLUGIN, "skills", "taste", "scripts", "taste.py"), "get"]);
      let settings: unknown = {};
      try { settings = JSON.parse(learned.out || "{}"); } catch { /* none yet */ }
      return sendJson(res, 200, {
        styles: styles.map(({ handle, style: s }) => ({ handle, name: s.name ?? handle, about: s.about, format: s.format, aspect: s.aspect, sample: !!s.sample, own: s.owner === true, layout: (s.layout as { mode?: string })?.mode, motion: s.motion, captions: s.captions, zoom: s.zoom, cover: fileUrl(coverOf(path.join(LIBRARY(), "creator-teardowns", handle)) ?? coverOf(path.join(ROOT, "creator-teardowns", handle))) })),
        others: others.map((o) => ({ pid: o.pid, profile: o.profile, handle: o.handle, name: o.style.name ?? o.handle, about: o.style.about,
          own: o.style.owner === true, cover: fileUrl(coverOf(o.dir)) })),
        taste: { text: taste.out.split(/\n\{\n/)[0]!.trim(), settings },
      });
    }
    // the profile's re-measured style, waiting to be used (refreshStyles): what changed, and use it or keep the old
    if (p === "/api/style-update" && m === "GET") {
      const pr = profile(), own = pr ? ownStyle() : null;
      const dir = pr && own ? path.join(prof.folder(pr), "creator-teardowns", own) : "";
      if (!dir || !existsSync(path.join(dir, "style.next.json"))) return sendJson(res, 200, null);
      return sendJson(res, 200, { handle: own, change: (() => { try { return readFileSync(path.join(dir, "style.change.md"), "utf8"); } catch { return ""; } })() });
    }
    if (p === "/api/style-update" && m === "POST") {
      const b = await body(req), pr = profile(), own = pr ? ownStyle() : null;
      const dir = pr && own ? path.join(prof.folder(pr), "creator-teardowns", own) : "";
      if (!dir || !existsSync(path.join(dir, "style.next.json"))) return sendJson(res, 404, { error: "no new style waiting" });
      if (b.use) {   // the old one kept beside it; edits made before keep their own copy of the style anyway
        copyFileSync(path.join(dir, "style.json"), path.join(dir, `style.${new Date().toISOString().slice(0, 10)}.json`));
        copyFileSync(path.join(dir, "style.next.json"), path.join(dir, "style.json"));
      }
      for (const f of ["style.next.json", "style.change.md", "style.prev.json"]) rmSync(path.join(dir, f), { force: true });
      return sendJson(res, 200, { ok: true });
    }
    if (p === "/api/styles/borrow" && m === "POST") {   // another profile's style, copied into this one's
      const b = await body(req);
      const o = prof.byId(String(b.pid ?? ""));
      const dir = o ? path.join(prof.folder(o), "creator-teardowns", path.basename(String(b.handle ?? ""))) : "";
      if (!o || !existsSync(path.join(dir, "style.json"))) return sendJson(res, 404, { error: "that style is not there any more" });
      const got = await py<{ handle: string }>(`from mm import library\nprint(json.dumps({"handle": library.borrow(${JSON.stringify(dir)}).name}))`);
      return sendJson(res, 200, got);
    }
    // the library's b-roll: what New video saved, what was added here, and any clip put in the folder by hand
    if (p === "/api/broll" && m === "GET") return sendJson(res, 200, clipsMod.brollList());
    if (p === "/api/broll" && m === "POST") {
      const name = path.basename(decodeURIComponent(String(req.headers["x-filename"] ?? "b-roll.mp4")));
      mkdirSync(clipsMod.BROLL, { recursive: true });
      const tmp = path.join(clipsMod.BROLL, `.incoming-${Date.now()}${path.extname(name) || ".mp4"}`);
      await new Promise<void>((resolve, reject) => { const w = createWriteStream(tmp); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
      const f = clipsMod.saveBroll(tmp, name.replace(/\.[^.]+$/, ""));
      broadcast("broll", {});
      return sendJson(res, 201, { file: path.basename(f) });
    }
    if (seg[0] === "api" && seg[1] === "broll" && seg[2]) {
      const file = path.basename(seg[2]), action = seg[3], f = path.join(clipsMod.BROLL, file);
      if (action === "poster") { const x = await clipsMod.brollPoster(file); return x ? sendFile(req, res, x) : void res.writeHead(404).end(); }
      if (!existsSync(f)) return sendJson(res, 404, { error: "that clip is not in the library any more" });
      if (action === "rename" && m === "POST") {
        const b = await body(req);
        if (!String(b.title ?? "").trim()) return sendJson(res, 400, { error: "give it a name" });
        const to = clipsMod.renameBroll(file, String(b.title).slice(0, 80));
        broadcast("broll", {});
        return sendJson(res, 200, { file: to });
      }
      if (action === "delete" && m === "POST") {
        const title = clipsMod.brollList().find((x) => x.file === file)?.title ?? file;
        const d = bin.trash("broll", file, title, [f]);
        broadcast("broll", {});
        return sendJson(res, 200, d);
      }
    }
    if (p === "/api/library" && m === "GET") {
      const disk = await py<{ library: number; working: number; free: number }>(`from mm import library\nprint(json.dumps(library.disk()))`);
      const edits = await py<{ id: string; bytes: number }[]>(`from mm import library\nfrom pathlib import Path\nd = Path(${JSON.stringify(EDITS())})\nprint(json.dumps([{"id": e.name, "bytes": library.size(e)} for e in sorted(d.iterdir()) if e.is_dir() and not e.name.startswith(".")] if d.is_dir() else []))`);
      const titles = new Map(lib.list().map((v) => [v.id, v.title]));
      return sendJson(res, 200, { path: LIBRARY(), home: HOME, disk, edits: edits.map((e) => ({ ...e, title: titles.get(e.id) ?? e.id })).sort((a, b) => b.bytes - a.bytes) });
    }
    if (p === "/api/library/clean" && m === "POST") {
      const r = await py<{ files: number; bytes: number }>(`from mm import library\nfs, n = library.clean(yes=True)\nprint(json.dumps({"files": len(fs), "bytes": n}))`);
      return sendJson(res, 200, r);
    }
    if (p === "/api/reveal" && m === "POST") {
      const b = await body(req);
      if (b.broll) {   // a b-roll clip, selected in its Finder window
        const f = path.join(clipsMod.BROLL, path.basename(String(b.broll)));
        if (!existsSync(f)) return sendJson(res, 404, { error: "not there any more" });
        spawn("open", ["-R", f], { stdio: "ignore", detached: true }).unref();
        return sendJson(res, 200, { ok: true });
      }
      if (b.exports) {   // the profile's export folder, made when it is not there yet
        const d = exportBase();
        if (!d) return sendJson(res, 400, { error: "no profile" });
        mkdirSync(d, { recursive: true });
        spawn("open", [d], { stdio: "ignore", detached: true }).unref();
        return sendJson(res, 200, { ok: true });
      }
      const target = b.id ? lib.editDir(String(b.id)) : LIBRARY();
      if (!existsSync(target)) return sendJson(res, 404, { error: "not there any more" });
      spawn("open", [target], { stdio: "ignore", detached: true }).unref();
      return sendJson(res, 200, { ok: true });
    }
    if (seg[0] === "library-file" && seg.length >= 3) {
      if (seg.some((x) => x === "..")) { res.writeHead(400).end(); return; }
      const f = [path.join(LIBRARY(), ...seg.slice(1)), path.join(ROOT, ...seg.slice(1))].find((x) => existsSync(x)) ?? path.join(LIBRARY(), ...seg.slice(1));
      if (!f.startsWith(ROOT + path.sep)) { res.writeHead(400).end(); return; }
      return sendFile(req, res, f);
    }

    // The page: built files, and index.html for every app route.
    if (m === "GET") {
      const f = path.join(WEB_DIST, p === "/" ? "index.html" : p);
      if (f.startsWith(WEB_DIST) && existsSync(f) && statSync(f).isFile()) return sendFile(req, res, f);
      const index = path.join(WEB_DIST, "index.html");
      if (existsSync(index)) return sendFile(req, res, index);
      res.writeHead(503, { "content-type": "text/plain" }).end("The studio's page is not built yet: npm run build");
      return;
    }
    res.writeHead(404).end();
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
  }
}

// Anything the scripts write into an edit (progress, a new cut) reaches the open pages: the library's top is watched, and
// each change goes out as the profile whose folder it is in (the shared recordings and b-roll to every page).
try {
  const pending = new Map<string, NodeJS.Timeout>();
  const later = (key: string, ms: number, fn: () => void) => { clearTimeout(pending.get(key)); pending.set(key, setTimeout(fn, ms)); };
  mkdirSync(ROOT, { recursive: true });
  watch(ROOT, { recursive: true }, (_ev, f) => {
    const parts = String(f ?? "").split(path.sep).filter(Boolean);
    if (!parts.length || parts[0]!.startsWith(".")) return;
    if (parts[0] === "recordings") {
      const id = parts[1];
      if (id && !id.startsWith(".") && !String(f).includes(`${path.sep}frames${path.sep}`)) later(`demo/${id}`, 300, () => broadcast("demo", { id, profile: null }));
      return;
    }
    if (parts[0] === "broll") { if (parts[1] && !parts[1].startsWith(".")) later("broll", 300, () => broadcast("broll", { profile: null })); return; }
    const owner = profiles().find((p) => p.folder === parts[0]);
    const rest = owner ? parts.slice(1) : profiles().length ? null : parts;   // without profiles the top is the library
    if (!rest) return;
    const pid = owner?.id ?? null, id = rest[1];
    if (!id || id.startsWith(".")) return;
    if (rest[0] === "edits") later(`v/${pid}/${id}`, 250, () => withProfile(pid, () => broadcast("video", { id })));
    else if (rest[0] === "scripts") later(`s/${pid}/${id}`, 250, () => withProfile(pid, () => broadcast("script", { id })));
  });
  const prog = path.join(HOME, "progress");
  mkdirSync(prog, { recursive: true });
  watch(prog, () => broadcast("setup", {}));
} catch { /* no recursive watch: the page polls */ }

server.listen(PORT, "127.0.0.1", () => {
  console.log(`motionmaxxing studio: http://localhost:${PORT}  (library ${ROOT}${profiles().length ? `, profiles ${profiles().map((p) => p.name).join(", ")}` : ""})`);
});
