import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync, rmSync, statSync, watch, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Claude, type Ev, type SessionMeta } from "./claude.js";
import * as demos from "./demos.js";
import * as lib from "./library.js";
import * as scripts from "./scripts.js";
import * as bin from "./trash.js";
import { CUT, EDITS, HOME, LIBRARY, PLUGIN, PORT, RECORDINGS, SETUP, VIDEOS, WEB_DIST, ensureDirs, python, slug } from "./paths.js";

/**
 * The studio's server: the page (web/dist), its API, live events, the library's media, and Claude behind it. Local only:
 * it listens on 127.0.0.1, so nothing on the network reaches the user's videos or their Claude.
 */

ensureDirs();
const claude = new Claude();
const sse = new Set<http.ServerResponse>();

function broadcast(type: string, data: unknown): void {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of sse) r.write(line);
}
claude.onAny((meta: SessionMeta, e?: Ev) => broadcast("session", { meta, kind: e?.k, tone: e && e.k === "status" ? e.tone : undefined }));

// The pages stay live whoever does the work (the studio's jobs, Claude here or in a terminal, a script run by hand):
// every 2 s a few file times per video; a change pushes "video" to the open pages (a render: its frame count).
const seen = new Map<string, string>();
setInterval(() => {
  if (!sse.size) return;
  for (const id of lib.ids()) {
    const sig = lib.signature(id);
    if (seen.has(id) && seen.get(id) !== sig) broadcast("video", { id });
    seen.set(id, sig);
  }
}, 2000).unref();

// --- jobs: scripts the studio runs itself (no Claude, no tokens) ---------------------------------------------------

const jobs = new Map<string, { name: string; startedAt: string }>();

function runScript(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(python(), args, { cwd: opts.cwd ?? LIBRARY, env: { ...process.env, MM_LIBRARY: LIBRARY, ...opts.env } });
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
    const pr = spawn(python(), ["-c", pre + code], { env: { ...process.env, MM_LIBRARY: LIBRARY } });
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
  if (jobs.has(id)) return;
  jobs.set(id, { name: "rebuild", startedAt: new Date().toISOString() });
  const d = lib.editDir(id);
  const src = existsSync(path.join(d, "source.mp4")) ? path.join(d, "source.mp4") : lib.record(id).source;
  try {
    if (!src) throw new Error("no source");
    step(id, "Cutting out the mistakes");
    const b = await runScript([path.join(CUT, "build_timeline.py"), src, d]);
    if (b.code) throw new Error(b.err.trim().split("\n").slice(-2).join(" "));
    step(id, "Rendering the cut");
    const r = await runScript([path.join(CUT, "render.py"), src, d]);
    if (r.code) throw new Error(r.err.trim().split("\n").slice(-2).join(" "));
    step(id, "The cut is ready", { done: true, progress: 1 });
    const s = lib.record(id).session;
    if (s) claude.note(s, `${why}: the cut was rebuilt and rendered.`, "ok");
  } catch (e) {
    step(id, "The cut could not be rebuilt", { failed: (e as Error).message });
  } finally {
    jobs.delete(id);
    broadcast("video", { id });
  }
}

// --- prompts ------------------------------------------------------------------------------------------------------

function cutPrompt(id: string, extra: { instructions?: string; script?: string }): string {
  const d = lib.editDir(id), r = lib.record(id);
  return [
    "You are working inside the motionmaxxing studio, a Mac app. The user just added a raw take to cut, and they are watching",
    "this chat and the video's page. Make the cut with the motionmaxxing cut skill (load it with the Skill tool: motionmaxxing:cut)",
    "and follow it to the end of its step 5, with these settled:",
    "",
    `- Edit folder: ${d}`,
    `- The raw take: ${r.source}`,
    ...(extra.script ? [`- The user's script: ${extra.script} (pass it to transcribe.py and run script_match.py)`] : []),
    "- First `taste.py show --edit` as the skill says: the user's learned cut taste (pause length) is in it.",
    "- A phone or WhatsApp clip has a variable frame rate: make edits/<name>/source.mp4 with join.py first (step 0a), and cut that.",
    "- The take is usually German: keep the user's words exactly; a cut only removes.",
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

function editPrompt(id: string): string {
  const d = lib.editDir(id);
  const own = existsSync(path.join(LIBRARY, "creator-teardowns", "own", "style.json"));
  return [
    "The user approved the cut in the motionmaxxing studio. Make the edit with the motionmaxxing edit skill (load it with",
    "the Skill tool: motionmaxxing:edit) and follow it through step 8, with these settled:",
    "",
    `- Edit folder: ${d} (cut.mp4, words.json and cut.transcript.json are there)`,
    own ? `- The style: the owner's own measured style, ${path.join(LIBRARY, "creator-teardowns", "own", "style.json")} (copy it to style.json), unless the chat named another.`
        : "- The style: step 1 of the skill picks it.",
    "- The video is German: captions keep the user's words exactly (only spelling fixes with retakes.py fix).",
    "- Pick the placement per beat and mix them: background (you cut out in front of the visual), half the screen,",
    "  the whole screen, and few small boxes (at most 40%). Real things only: never a text card. Captions are placed by",
    "  plan.py (never on the face, inside the app's safe zone): never set their y by hand.",
    "- Render on this Mac. The studio shows render.mp4 and the plan's timeline by itself: never open a browser or a page.",
    "- Ask only with AskUserQuestion (the studio shows a card).",
    "- End with one short message: the length, the style, how many visuals and where they sit, anything to check.",
  ].join("\n");
}

function notesPrompt(id: string, notes: lib.Note[]): string {
  const d = lib.editDir(id);
  return [
    `The user left notes on the ${notes[0]?.stage ?? "cut"} of ${d} in the studio, each at a moment of the video (seconds on the ${notes[0]?.stage === "edit" ? "edit (render.mp4, the cut's clock)" : "cut"}):`,
    ...notes.map((n) => `- at ${n.t.toFixed(1)} s: ${n.text}`),
    "",
    notes[0]?.stage === "edit" ? "Fix each one as the edit skill says (visuals.json, images.json, style.json, then plan, stills and render again; a note about the cut itself: the cut skill)." : "Fix each one (the cut: change spans.json and keep.json by quoting, then build, render and verify as the cut skill says).",
    "Then answer each note in one short line, in the order given, starting each with its time.",
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
  const off = claude.subscribe(sid, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => { off(); clearInterval(ping); });
}

const server = http.createServer(async (req, res) => {
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
    if (p === "/api/state") return sendJson(res, 200, { library: LIBRARY, home: HOME, plugin: PLUGIN, version: JSON.parse(readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version });
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
        mkdirSync(VIDEOS, { recursive: true });
        const ext = path.extname(name) || ".mp4";
        let f = path.join(VIDEOS, slug(name) + ext), n = 2;
        while (existsSync(f)) f = path.join(VIDEOS, `${slug(name)}-${n++}${ext}`);
        await new Promise<void>((resolve, reject) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", resolve); w.on("error", reject); });
        source = f; title = name.replace(/\.[^.]+$/, "");
      } else {
        const b = await body(req);
        if (!b.path || !existsSync(b.path)) return sendJson(res, 400, { error: "no such file" });
        source = b.path; title = b.title || path.basename(b.path).replace(/\.[^.]+$/, "");
      }
      const id = lib.newEdit(title, source);
      broadcast("video", { id });
      return sendJson(res, 201, { id });
    }
    if (seg[0] === "api" && seg[1] === "videos" && seg[2]) {
      const id = seg[2];
      if (!existsSync(lib.editDir(id))) return sendJson(res, 404, { error: "no such video" });
      const action = seg[3];
      if (!action && m === "GET") {
        const r = lib.record(id);
        const c = r.session ? claude.get(r.session) : undefined;
        return sendJson(res, 200, { ...lib.summary(id), transcript: lib.transcript(id), plan: lib.plan(id), notes: lib.notes(id), job: jobs.get(id) ?? null, chat: c ? { id: c.id, status: c.status } : null });
      }
      if (action === "start" && m === "POST") {
        const b = await body(req);
        const r = lib.record(id);
        let script: string | undefined;
        if (b.script && String(b.script).trim()) {
          script = path.join(lib.editDir(id), "script.md");
          writeFileSync(script, String(b.script));
          r.script = script;
        }
        const sid = `v_${id}`;
        r.session = sid; lib.saveRecord(id, r);
        claude.ensure(sid, r.title, lib.editDir(id));
        claude.send(sid, b.instructions?.trim() ? `Cut this take. ${b.instructions.trim()}` : "Cut this take.", cutPrompt(id, { instructions: b.instructions, script }));
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
      if (action === "notes" && m === "POST") {
        const b = await body(req);
        const n = lib.notes(id);
        n.push({ id: `n${randomBytes(3).toString("hex")}`, t: Number(b.t) || 0, text: String(b.text ?? "").trim(), stage: lib.record(id).stage === "cut" ? "cut" : "edit", at: new Date().toISOString() });
        lib.saveNotes(id, n); broadcast("video", { id });
        return sendJson(res, 201, n);
      }
      if (action === "notes" && m === "DELETE" && seg[4]) {
        lib.saveNotes(id, lib.notes(id).filter((x) => x.id !== seg[4])); broadcast("video", { id });
        return sendJson(res, 200, lib.notes(id));
      }
      if (action === "send-notes" && m === "POST") {
        const r = lib.record(id), all = lib.notes(id), open = all.filter((x) => !x.sent);
        if (!open.length) return sendJson(res, 400, { error: "no new notes" });
        const sid = r.session ?? `v_${id}`;
        if (!r.session) { r.session = sid; lib.saveRecord(id, r); }
        claude.ensure(sid, r.title, lib.editDir(id));
        claude.send(sid, `Notes:\n${open.map((x) => `${x.t.toFixed(1)} s: ${x.text}`).join("\n")}`, notesPrompt(id, open));
        const now = new Date().toISOString();
        lib.saveNotes(id, all.map((x) => (x.sent ? x : { ...x, sent: now })));
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
        claude.ensure(sid, r.title, lib.editDir(id));
        if (stage === "cut") {
          // Approving the cut is the go for the edit (one approve, then the edit is made and shown).
          claude.send(sid, "The cut is approved. Make the edit.", editPrompt(id));
        } else {
          claude.send(sid, "The user approved the edit.", `The user approved the edit of ${lib.editDir(id)}. Do the edit skill's step 8 after approval (save the motion clips), then stop with one short line.`);
        }
        broadcast("video", { id });
        return sendJson(res, 200, lib.summary(id));
      }
      if (action === "export" && m === "POST") {
        // Final Cut, Premiere, Resolve, EDL, SRT, the CapCut steps and the handoff, all at once, no Claude needed.
        if (jobs.has(id)) return sendJson(res, 409, { error: "something is running on this video; try again in a moment" });
        if (!existsSync(path.join(lib.editDir(id), "plan.json"))) return sendJson(res, 400, { error: "make the edit first" });
        jobs.set(id, { name: "export", startedAt: new Date().toISOString() });
        step(id, "Exporting for Final Cut, Premiere, Resolve and CapCut");
        void runScript([path.join(PLUGIN, "skills", "edit", "scripts", "export_nle.py"), lib.editDir(id), "--to", "all"])
          .then((r) => {
            if (r.code) step(id, "The export stopped", { failed: r.err.trim().split("\n").slice(-1)[0] });
            else { step(id, "Exported", { done: true, progress: 1 }); spawn("open", [path.join(lib.editDir(id), "export")], { stdio: "ignore", detached: true }).unref(); }
          })
          .finally(() => { jobs.delete(id); broadcast("video", { id }); });
        return sendJson(res, 202, { ok: true });
      }
      if ((action === "delete" || action === "trash") && m === "POST") {
        // Recently deleted (Undo, Restore), never rm. Its raw take goes too when it was added into the library.
        if (jobs.has(id)) return sendJson(res, 409, { error: "it is being rebuilt; try again in a moment" });
        const r = lib.record(id);
        if (r.session) claude.stop(r.session);
        const src = r.source && path.resolve(r.source).startsWith(VIDEOS + path.sep) ? r.source : undefined;
        const d = bin.trash("video", id, r.title, [lib.editDir(id), ...(src ? [src] : [])]);
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
        const s = claude.get(sid) ?? (sid === "studio" ? claude.ensure("studio", "Studio") : undefined);
        // A conversation that has not started yet reads as an empty one (it is made on the first message).
        return sendJson(res, 200, s ?? { id: sid, title: "", status: "idle", events: [] });
      }
      if (action === "stream") return streamSession(req, res, sid);
      const b = m === "POST" ? await body(req) : {};
      if (action === "send") {
        const edit = b.edit ? lib.editDir(String(b.edit)) : undefined;
        const s = claude.ensure(sid, b.title ?? "Studio", edit);
        const ctx = edit ? `(The user is on the page of the video in ${edit}${typeof b.at === "number" ? `, at ${b.at.toFixed(1)} s` : ""}.)\n\n` : "";
        claude.send(s.id, String(b.text ?? ""), ctx + String(b.text ?? ""));
        return sendJson(res, 202, { ok: true });
      }
      if (action === "answer") { claude.answer(sid, b.event, b.answers ?? {}); return sendJson(res, 200, { ok: true }); }
      if (action === "permit") { claude.permit(sid, b.event, !!b.allow, !!b.always); return sendJson(res, 200, { ok: true }); }
      if (action === "stop") { claude.stop(sid); return sendJson(res, 200, { ok: true }); }
    }
    if (p === "/api/chats") return sendJson(res, 200, claude.list());

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
      claude.ensure(sid, mt.title, scripts.scriptDir(id));
      claude.send(sid, "Check the facts in this script.", scripts.prompt(id));
      broadcast("script", { id });
      return sendJson(res, 201, { id, session: sid });
    }
    if (seg[0] === "api" && seg[1] === "scripts" && seg[2] && seg[3] === "delete" && m === "POST") {
      if (!existsSync(scripts.scriptDir(seg[2]))) return sendJson(res, 404, { error: "no such script" });
      const mt = scripts.meta(seg[2]);
      if (mt.session) claude.stop(mt.session);
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
      const d = scripts.detail(seg[2]), c = d.session ? claude.get(d.session) : undefined;
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
      claude.ensure(sid, br.title, demos.demoDir(id));
      claude.send(sid, `Record a demo of ${url}: ${show}`, demos.prompt(id));
      broadcast("demo", { id });
      return sendJson(res, 201, { id, session: sid });
    }
    if (seg[0] === "api" && seg[1] === "demos" && seg[2]) {
      const id = seg[2];
      if (!existsSync(demos.demoDir(id))) return sendJson(res, 404, { error: "no such demo" });
      if (!seg[3] && m === "GET") {
        const s = demos.summary(id), c = s.session ? claude.get(s.session) : undefined;
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
        if (br.session) claude.stop(br.session);
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
      const taste = await runScript([path.join(PLUGIN, "skills", "taste", "scripts", "taste.py"), "show"]);
      const learned = await runScript([path.join(PLUGIN, "skills", "taste", "scripts", "taste.py"), "get"]);
      let settings: unknown = {};
      try { settings = JSON.parse(learned.out || "{}"); } catch { /* none yet */ }
      return sendJson(res, 200, {
        styles: styles.map(({ handle, style: s }) => ({ handle, name: s.name ?? handle, about: s.about, format: s.format, aspect: s.aspect, sample: !!s.sample, layout: (s.layout as { mode?: string })?.mode, motion: s.motion, captions: s.captions, zoom: s.zoom, cover: existsSync(path.join(LIBRARY, "creator-teardowns", handle, "cover.jpg")) ? `/library-file/creator-teardowns/${encodeURIComponent(handle)}/cover.jpg` : existsSync(path.join(LIBRARY, "creator-teardowns", handle, "thumb.jpg")) ? `/library-file/creator-teardowns/${encodeURIComponent(handle)}/thumb.jpg` : undefined })),
        taste: { text: taste.out.split(/\n\{\n/)[0]!.trim(), settings },
      });
    }
    if (p === "/api/library" && m === "GET") {
      const disk = await py<{ library: number; working: number; free: number }>(`from mm import library\nprint(json.dumps(library.disk()))`);
      const edits = await py<{ id: string; bytes: number }[]>(`from mm import library\nfrom pathlib import Path\nd = Path(${JSON.stringify(EDITS)})\nprint(json.dumps([{"id": e.name, "bytes": library.size(e)} for e in sorted(d.iterdir()) if e.is_dir() and not e.name.startswith(".")] if d.is_dir() else []))`);
      const titles = new Map(lib.list().map((v) => [v.id, v.title]));
      return sendJson(res, 200, { path: LIBRARY, home: HOME, disk, edits: edits.map((e) => ({ ...e, title: titles.get(e.id) ?? e.id })).sort((a, b) => b.bytes - a.bytes) });
    }
    if (p === "/api/library/clean" && m === "POST") {
      const r = await py<{ files: number; bytes: number }>(`from mm import library\nfs, n = library.clean(yes=True)\nprint(json.dumps({"files": len(fs), "bytes": n}))`);
      return sendJson(res, 200, r);
    }
    if (p === "/api/reveal" && m === "POST") {
      const b = await body(req);
      const target = b.id ? lib.editDir(String(b.id)) : LIBRARY;
      if (!existsSync(target)) return sendJson(res, 404, { error: "not there any more" });
      spawn("open", [target], { stdio: "ignore", detached: true }).unref();
      return sendJson(res, 200, { ok: true });
    }
    if (seg[0] === "library-file" && seg.length >= 3) {
      const f = path.join(LIBRARY, ...seg.slice(1));
      if (!f.startsWith(LIBRARY + path.sep) || seg.some((x) => x === "..")) { res.writeHead(400).end(); return; }
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
});

// Anything the scripts write into an edit (progress, a new cut) reaches the open pages.
try {
  const pending = new Map<string, NodeJS.Timeout>();
  watch(EDITS, { recursive: true }, (_ev, f) => {
    const id = String(f ?? "").split(path.sep)[0];
    if (!id || id.startsWith(".")) return;
    clearTimeout(pending.get(id));
    pending.set(id, setTimeout(() => broadcast("video", { id }), 250));
  });
  const pendingDemo = new Map<string, NodeJS.Timeout>();
  watch(RECORDINGS, { recursive: true }, (_ev, f) => {
    const id = String(f ?? "").split(path.sep)[0];
    if (!id || id.startsWith(".") || String(f).includes(`${path.sep}frames${path.sep}`)) return;
    clearTimeout(pendingDemo.get(id));
    pendingDemo.set(id, setTimeout(() => broadcast("demo", { id }), 300));
  });
  mkdirSync(scripts.SCRIPTS, { recursive: true });
  watch(scripts.SCRIPTS, { recursive: true }, (_ev, f) => {
    const id = String(f ?? "").split(path.sep)[0];
    if (id && !id.startsWith(".")) broadcast("script", { id });
  });
  const prog = path.join(HOME, "progress");
  mkdirSync(prog, { recursive: true });
  watch(prog, () => broadcast("setup", {}));
} catch { /* no recursive watch: the page polls */ }

server.listen(PORT, "127.0.0.1", () => {
  console.log(`motionmaxxing studio: http://localhost:${PORT}  (library ${LIBRARY})`);
});
