import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, type CanUseTool, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { HOME, LIBRARY, PLUGIN, REPO, SESSIONS, inside } from "./paths.js";

/**
 * Claude behind the studio. Each conversation (one per video, plus one for the studio itself) runs Claude Code
 * through the Agent SDK on the user's own Claude login (never an API key), with the motionmaxxing plugin loaded. It
 * becomes a stream of events the page shows: streamed replies, collapsed tool steps, question cards for
 * AskUserQuestion and Allow / Deny cards for anything outside the studio's own tools and folders. Conversations are
 * saved in ~/.motionmaxxing/studio/sessions/ and resume the same Claude session when the user writes again.
 */

/** A file the user attached to a message: saved in the library (POST /api/chat/:id/attach). */
export interface Attached { name: string; path: string; url: string; kind: "image" | "video" | "file" }

export type Body =
  | { k: "user"; text: string; files?: Attached[] }
  | { k: "text"; text: string; done: boolean }
  | { k: "tool"; name: string; summary: string; input: string; status: "running" | "ok" | "error"; output?: string }
  | { k: "question"; questions: Question[]; answers?: Record<string, string>; status: "waiting" | "answered" | "cancelled" }
  | { k: "permission"; tool: string; detail: string; reason: string; status: "waiting" | "allowed" | "denied" | "cancelled" }
  | { k: "status"; text: string; tone: "info" | "ok" | "error" };
export type Ev = { seq: number; id: string; at: string } & Body;
export interface Question { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string; preview?: string }[] }

export interface SessionMeta {
  id: string;
  title: string;
  /** The edit folder this conversation works on, when it is a video's. */
  edit?: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "waiting" | "done" | "failed" | "stopped";
  claudeSession?: string;
  usage: { costUsd: number; inputTokens: number; outputTokens: number; turns: number; ms: number };
}
interface Session extends SessionMeta { events: Ev[] }
type Listener = (e: Ev | { k: "meta"; meta: SessionMeta }) => void;

interface Live {
  q: Query;
  abort: AbortController;
  input: { push: (m: SDKUserMessage) => void; close: () => void };
  pending: Map<string, (v: unknown) => void>;
  blocks: Map<number, string>;
  idleTimer?: NodeJS.Timeout;
  allowAlways: Set<string>;
}

const file = (id: string) => path.join(SESSIONS, `${id}.json`);
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Commands that reach outside the machine or destroy things broadly: these always ask. */
const OUTWARD = /\bgit\s+push\b|\bnpm\s+publish\b|\bgh\s+(pr|release|repo|issue)\s+(create|delete|merge)\b|\bcurl\b[^|]*\s(-X\s*(POST|PUT|PATCH|DELETE)|--data\b|-d\s|-F\s|--upload-file\b)|\bscp\b|\bssh\b|\brsync\b[^|]*:|\bsudo\b|\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)/i;

/** Why a tool call needs the user's yes, or null when it is one of the studio's own and runs freely. */
export function needsPermission(tool: string, input: Record<string, unknown>, blockedPath?: string): string | null {
  if (blockedPath) return `reaches ${blockedPath}, outside the studio's folders`;
  if (tool === "AskUserQuestion") return null;
  if (/^mcp__/.test(tool)) return "uses a connected service";
  if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(tool)) {
    const f = String(input.file_path ?? input.notebook_path ?? "");
    return f && !inside(f) ? `writes ${f}, outside the studio's folders` : null;
  }
  if (tool === "Bash") {
    const cmd = String(input.command ?? "");
    if (OUTWARD.test(cmd)) return "reaches outside this Mac, or deletes broadly";
    // absolute paths in the command, without the shell punctuation that can follow one ("cd /a/b; ls", "(cd /a && x)")
    const abs = cmd.match(/(?:^|[\s'"=(])(\/(?:Users|home|etc|var|opt|Applications|System|Volumes)[^\s'"`;|&()<>]*)/g) ?? [];
    const outside = abs.map((a) => a.replace(/^[\s'"=(]/, "").replace(/[.,:]+$/, "")).find((a) => !inside(a) && !/^\/(usr|bin|opt\/homebrew)\//.test(a));
    return outside ? `touches ${outside}, outside the studio's folders` : null;
  }
  return null;
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  const f = (k: string) => String(input[k] ?? "");
  const short = (p: string) => p.replace(REPO + "/", "").replace(LIBRARY + "/", "").replace(os.homedir(), "~");
  switch (name) {
    case "Bash": return f("description") || trim(f("command"), 80);
    case "Read": return `Read ${short(f("file_path"))}`;
    case "Write": return `Wrote ${short(f("file_path"))}`;
    case "Edit": case "MultiEdit": return `Edited ${short(f("file_path"))}`;
    case "Glob": case "Grep": return `Searched for ${trim(f("pattern"), 60)}`;
    case "Skill": return `Opened the ${f("skill")} skill`;
    case "WebFetch": return `Read ${trim(f("url"), 60)}`;
    case "WebSearch": return `Searched the web: ${trim(f("query"), 60)}`;
    case "TodoWrite": return "Updated the plan";
    case "Agent": case "Task": return `Asked a helper: ${trim(f("description"), 60)}`;
    default: return name.replace(/^mcp__[^_]+__/, "");
  }
}

/** What every studio conversation knows about the studio around it, after Claude Code's own system prompt. */
const STUDIO_RULES = [
  "You are working inside the motionmaxxing studio, a Mac app: the user reads your replies in its chat panel.",
  "Whenever the user has something to choose (a direction, a style, which of several fixes, what to do next), ask with the AskUserQuestion tool instead of listing the options in text: 2-4 options, the one you recommend first with \"(Recommended)\" at the end of its label, each with a one-line description. The studio shows them as buttons, plus a field for the user's own answer.",
  "The user can attach files to a message (images, videos, PDFs, documents). Images come with the message, so you see them; every attached file is also listed with its path in the library. The words of the message are what to do with them.",
].join("\n");

const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const INLINE_IMAGE_MAX = 5 * 1024 * 1024;   // one image block's limit

/** The message Claude reads: the words, every attached file's path, and the images themselves (so it sees them). */
function withFiles(text: string, files: Attached[]): SDKUserMessage["message"]["content"] {
  if (!files.length) return text;
  const blocks: unknown[] = [{ type: "text", text: `${text}\n\nAttached (saved in the library):\n${files.map((f) => `- ${f.name}: ${f.path}`).join("\n")}` }];
  for (const f of files) {
    const mime = IMAGE_MIME[path.extname(f.path).toLowerCase()];
    try {
      if (mime && statSync(f.path).size <= INLINE_IMAGE_MAX) blocks.push({ type: "image", source: { type: "base64", media_type: mime, data: readFileSync(f.path).toString("base64") } });
    } catch { /* gone since: its path is still listed */ }
  }
  return blocks as SDKUserMessage["message"]["content"];
}

function inputQueue(): { iter: AsyncIterable<SDKUserMessage>; push: (m: SDKUserMessage) => void; close: () => void } {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null, closed = false;
  return {
    push: (m) => { items.push(m); wake?.(); },
    close: () => { closed = true; wake?.(); },
    iter: { async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length) yield items.shift()!;
        if (closed) return;
        await new Promise<void>((r) => { wake = r; });
        wake = null;
      }
    } },
  };
}

const meta = (s: Session): SessionMeta => { const { events: _e, ...m } = s; return m; };

export class Claude {
  private sessions = new Map<string, Session>();
  private live = new Map<string, Live>();
  private listeners = new Map<string, Set<Listener>>();
  private global = new Set<(m: SessionMeta, e?: Ev) => void>();
  private saveTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts: { idleMs?: number; queryFn?: typeof query } = {}) {
    if (!existsSync(SESSIONS)) return;
    for (const f of readdirSync(SESSIONS)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(path.join(SESSIONS, f), "utf8")) as Session;
        if (s.status === "running" || s.status === "waiting") s.status = "stopped";   // the studio restarted
        for (const e of s.events) if ((e.k === "question" || e.k === "permission") && e.status === "waiting") e.status = "cancelled";
        this.sessions.set(s.id, s);
      } catch { /* not a conversation */ }
    }
  }

  list(): SessionMeta[] { return [...this.sessions.values()].map(meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string): Session | undefined { return this.sessions.get(id); }
  /** Every change to any conversation, for the page's sidebar and alerts. */
  onAny(fn: (m: SessionMeta, e?: Ev) => void): () => void { this.global.add(fn); return () => this.global.delete(fn); }

  subscribe(id: string, fn: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn); this.listeners.set(id, set);
    return () => set.delete(fn);
  }

  /** The conversation with this id, made when it does not exist yet. */
  ensure(id: string, title: string, edit?: string): Session {
    const had = this.sessions.get(id);
    if (had) return had;
    const now = new Date().toISOString();
    const s: Session = { id, title: trim(title, 60), edit, createdAt: now, updatedAt: now, status: "idle", usage: { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, ms: 0 }, events: [] };
    this.sessions.set(id, s); this.save(s);
    return s;
  }

  /** Send a message: starts (or resumes) Claude when it is not running, or reaches it at its next turn. `prompt`
   * is what Claude reads when it differs from what the page shows (a first message with the studio's context). */
  send(id: string, text: string, prompt?: string, files: Attached[] = []): void {
    const s = this.sessions.get(id); if (!s) throw new Error("no such conversation");
    this.push(s, { k: "user", text, ...(files.length ? { files } : {}) });
    const msg: SDKUserMessage = { type: "user", message: { role: "user", content: withFiles(prompt ?? text, files) }, parent_tool_use_id: null };
    const l = this.live.get(id);
    if (l) { clearTimeout(l.idleTimer); l.input.push(msg); this.setStatus(s, "running"); return; }
    this.run(s, msg);
  }

  answer(id: string, eventId: string, answers: Record<string, string>): void {
    const s = this.sessions.get(id), l = this.live.get(id);
    const e = s?.events.find((x) => x.id === eventId);
    const resolve = l?.pending.get(eventId);
    if (!s || !e || e.k !== "question" || !resolve) throw new Error("that question is no longer waiting");
    e.answers = answers; e.status = "answered"; this.emit(s, e);
    l!.pending.delete(eventId);
    resolve({ behavior: "allow", updatedInput: { questions: e.questions, answers } });
    this.setStatus(s, "running");
  }

  permit(id: string, eventId: string, allow: boolean, always = false): void {
    const s = this.sessions.get(id), l = this.live.get(id);
    const e = s?.events.find((x) => x.id === eventId);
    const resolve = l?.pending.get(eventId);
    if (!s || !e || e.k !== "permission" || !resolve) throw new Error("that request is no longer waiting");
    e.status = allow ? "allowed" : "denied"; this.emit(s, e);
    if (allow && always) l!.allowAlways.add(`${e.tool}\n${e.reason}`);   // the same kind of request, never the whole tool
    l!.pending.delete(eventId);
    resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: "The user declined this in the studio. Find another way, or ask them." });
    this.setStatus(s, "running");
  }

  stop(id: string): void {
    const s = this.sessions.get(id), l = this.live.get(id);
    if (!s || !l) return;
    l.abort.abort();
    for (const [, r] of l.pending) r({ behavior: "deny", message: "Stopped by the user.", interrupt: true });
    l.input.close();
    this.live.delete(id);
    for (const e of s.events) if ((e.k === "question" || e.k === "permission") && e.status === "waiting") { e.status = "cancelled"; this.emit(s, e); }
    this.push(s, { k: "status", text: "Stopped", tone: "info" });
    this.setStatus(s, "stopped");
  }

  /** A line in the chat from the studio itself: a finished render, a saved edit. */
  note(id: string, text: string, tone: "info" | "ok" | "error" = "info"): void {
    const s = this.sessions.get(id); if (s) this.push(s, { k: "status", text, tone });
  }

  private run(s: Session, first: SDKUserMessage): void {
    const abort = new AbortController();
    const queue = inputQueue();
    const live: Live = { q: undefined as unknown as Query, abort, input: queue, pending: new Map(), blocks: new Map(), allowAlways: new Set() };
    this.live.set(s.id, live);
    this.setStatus(s, "running");
    const canUseTool: CanUseTool = async (name, input, o) => {
      if (name === "AskUserQuestion") {
        const ev = this.push(s, { k: "question", questions: (input.questions as Question[]) ?? [], status: "waiting" });
        this.setStatus(s, "waiting");
        return new Promise((resolve) => live.pending.set(ev.id, resolve as (v: unknown) => void));
      }
      const why = needsPermission(name, input, o.blockedPath);
      const reason = why && live.allowAlways.has(`${name}\n${why}`) ? null : why;
      if (!reason) return { behavior: "allow", updatedInput: input };
      const ev = this.push(s, { k: "permission", tool: name, detail: trim(name === "Bash" ? String(input.command ?? "") : JSON.stringify(input), 600), reason, status: "waiting" });
      this.setStatus(s, "waiting");
      return new Promise((resolve) => live.pending.set(ev.id, (v) => resolve(v as never)));
    };
    // The user's own Claude login, never an API key: drop one from the environment so Claude Code cannot prefer it.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ANTHROPIC_API_KEY" && k !== "CLAUDECODE") env[k] = v;
    env.MM_STUDIO = "1";
    if (s.edit) env.MM_EDIT = s.edit;
    queue.push(first);
    const q = (this.opts.queryFn ?? query)({
      prompt: queue.iter,
      options: {
        cwd: LIBRARY, abortController: abort, includePartialMessages: true, canUseTool, env,
        settingSources: ["user", "project", "local"], permissionMode: "default", additionalDirectories: [REPO, HOME],
        plugins: [{ type: "local", path: PLUGIN }],
        systemPrompt: { type: "preset", preset: "claude_code", append: STUDIO_RULES },
        ...(s.claudeSession ? { resume: s.claudeSession } : {}),
      },
    });
    live.q = q;
    void (async () => {
      try {
        for await (const m of q) this.onMessage(s, live, m);
      } catch (error) {
        if (!abort.signal.aborted) { this.push(s, { k: "status", text: `Claude stopped with an error: ${(error as Error).message}`, tone: "error" }); this.setStatus(s, "failed"); }
      } finally {
        if (this.live.get(s.id) === live) this.live.delete(s.id);
        if (s.status === "running" || s.status === "waiting") this.setStatus(s, "done");
      }
    })();
  }

  private onMessage(s: Session, live: Live, m: SDKMessage): void {
    const any = m as Record<string, any>;
    if (m.type === "system" && any.subtype === "init") { s.claudeSession = any.session_id; this.emitMeta(s); return; }
    if (m.type === "stream_event" && !any.parent_tool_use_id) {
      const ev = any.event;
      if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
        const e = this.push(s, { k: "text", text: "", done: false });
        live.blocks.set(ev.index, e.id);
      } else if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        const id = live.blocks.get(ev.index); const e = id && s.events.find((x) => x.id === id);
        if (e && e.k === "text") { e.text += ev.delta.text; this.emit(s, e, false); }
      } else if (ev?.type === "message_start") live.blocks.clear();
      return;
    }
    if (m.type === "assistant" && !any.parent_tool_use_id) {
      for (const b of any.message.content ?? []) {
        if (b.type === "text") {
          const streamed = [...s.events].reverse().find((e) => e.k === "text" && !e.done);
          if (streamed && streamed.k === "text") { streamed.text = b.text; streamed.done = true; this.emit(s, streamed); }
          else this.push(s, { k: "text", text: b.text, done: true });
        } else if (b.type === "tool_use" && b.name !== "AskUserQuestion") {
          const input = (b.input ?? {}) as Record<string, unknown>;
          this.push(s, { k: "tool", name: b.name, summary: toolSummary(b.name, input), input: trim(b.name === "Bash" ? String(input.command ?? "") : JSON.stringify(input, null, 1), 2000), status: "running" }, b.id);
        }
      }
      return;
    }
    if (m.type === "user" && !any.parent_tool_use_id) {
      const content = any.message?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type !== "tool_result") continue;
        const e = s.events.find((x) => x.id === b.tool_use_id);
        if (!e || e.k !== "tool") continue;
        const text = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("\n") : String(b.content ?? "");
        e.status = b.is_error ? "error" : "ok";
        e.output = trim(text, 4000);
        this.emit(s, e);
      }
      return;
    }
    if (m.type === "result") {
      s.usage.costUsd += any.total_cost_usd ?? 0;
      s.usage.inputTokens += (any.usage?.input_tokens ?? 0) + (any.usage?.cache_creation_input_tokens ?? 0) + (any.usage?.cache_read_input_tokens ?? 0);
      s.usage.outputTokens += any.usage?.output_tokens ?? 0;
      s.usage.turns += any.num_turns ?? 0;
      s.usage.ms += any.duration_ms ?? 0;
      if (any.subtype !== "success") this.push(s, { k: "status", text: `Claude ended: ${String(any.subtype).replace(/_/g, " ")}`, tone: "error" });
      this.setStatus(s, any.subtype === "success" ? "done" : "failed");
      clearTimeout(live.idleTimer);
      live.idleTimer = setTimeout(() => { live.input.close(); }, this.opts.idleMs ?? 10 * 60_000);
    }
  }

  private push(s: Session, e: Body, id?: string): Ev {
    const ev = { ...e, id: id ?? `e${s.events.length + 1}_${randomBytes(2).toString("hex")}`, seq: s.events.length + 1, at: new Date().toISOString() } as Ev;
    s.events.push(ev);
    this.emit(s, ev);
    return ev;
  }
  private emit(s: Session, e: Ev, persist = true): void {
    s.updatedAt = new Date().toISOString();
    for (const fn of this.listeners.get(s.id) ?? []) fn(e);
    if (e.k === "question" || e.k === "permission" || (e.k === "text" && e.done) || e.k === "status") for (const fn of this.global) fn(meta(s), e);
    this.save(s, !persist);
  }
  private emitMeta(s: Session): void {
    for (const fn of this.listeners.get(s.id) ?? []) fn({ k: "meta", meta: meta(s) });
    for (const fn of this.global) fn(meta(s));
    this.save(s);
  }
  private setStatus(s: Session, status: SessionMeta["status"]): void { if (s.status === status) return; s.status = status; this.emitMeta(s); }
  private save(s: Session, later = false): void {
    clearTimeout(this.saveTimers.get(s.id));
    const write = () => { mkdirSync(SESSIONS, { recursive: true }); writeFileSync(file(s.id), JSON.stringify(s)); };
    if (!later) return write();
    this.saveTimers.set(s.id, setTimeout(write, 800));
  }
}
