import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, ChevronRight, CircleStop, FileText, Film, Loader2, Paperclip, ShieldQuestion, Sparkles, TriangleAlert, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { notify } from "@/lib/alerts";
import { SPRING_DEFAULT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface Question { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string; preview?: string }[] }
/** A file attached to a message, saved in the library (POST /api/chat/:id/attach). */
export interface Attached { name: string; path: string; url: string; kind: "image" | "video" | "file" }
export type Ev = { id: string; seq: number; at: string } & (
  | { k: "user"; text: string; files?: Attached[] }
  | { k: "text"; text: string; done: boolean }
  | { k: "tool"; name: string; summary: string; input: string; status: "running" | "ok" | "error"; output?: string }
  | { k: "question"; questions: Question[]; answers?: Record<string, string>; status: "waiting" | "answered" | "cancelled" }
  | { k: "permission"; tool: string; detail: string; reason: string; status: "waiting" | "allowed" | "denied" | "cancelled" }
  | { k: "status"; text: string; tone: "info" | "ok" | "error" });
export interface SessionMeta { id: string; title: string; status: "idle" | "running" | "waiting" | "done" | "failed" | "stopped"; edit?: string }

/** One conversation, live: its events as they stream in, and its status. */
export function useSession(sid: string | null) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [meta, setMeta] = useState<SessionMeta>();
  useEffect(() => {
    if (!sid) { setEvents([]); setMeta(undefined); return; }
    let alive = true;
    api<SessionMeta & { events: Ev[] }>(`/api/chat/${encodeURIComponent(sid)}`).then((s) => {
      if (!alive) return;
      const { events: ev, ...m } = s; setEvents(ev ?? []); setMeta(m);
    }).catch(() => { if (alive) { setEvents([]); setMeta(undefined); } });
    const es = new EventSource(`/api/chat/${encodeURIComponent(sid)}/stream`);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.k === "meta") { setMeta(e.meta); return; }
      setEvents((prev) => {
        const i = prev.findIndex((x) => x.id === e.id);
        if (i >= 0) { const next = prev.slice(); next[i] = e; return next; }
        return [...prev, e];
      });
      if (e.k === "question" && e.status === "waiting") notify("Claude has a question", e.questions?.[0]?.question ?? "");
      if (e.k === "permission" && e.status === "waiting") notify("Claude needs your OK", e.reason);
    };
    return () => { alive = false; es.close(); };
  }, [sid]);
  return { events, meta };
}

/** Plain text with **bold**, `code`, bullet lines and paragraphs: enough for Claude's replies. */
export function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((p, i) => {
    if (p.startsWith("**")) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`")) return <code key={i} className="rounded bg-foreground/8 px-1 py-px font-mono text-[11.5px]">{p.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(p);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-primary hover:underline">{link[1]}</a>;
    return <span key={i}>{p}</span>;
  });
  return (
    <div className="space-y-2 text-[13px] leading-[18px]">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) {
          return <ul key={i} className="space-y-1 pl-4">{lines.map((l, j) => <li key={j} className="list-disc marker:text-faint-foreground">{inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ""))}</li>)}</ul>;
        }
        if (lines.length > 1 && lines.every((l) => l.trim().startsWith("|"))) {
          const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
          const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(cells);
          return (
            <div key={i} className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-[12px] leading-[16px]">
                <thead className="bg-foreground/5"><tr>{rows[0]!.map((h, j) => <th key={j} className="px-2 py-1.5 font-semibold">{inline(h)}</th>)}</tr></thead>
                <tbody className="divide-y">{rows.slice(1).map((r, k) => <tr key={k}>{r.map((x, j) => <td key={j} className="px-2 py-1.5 align-top">{inline(x)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (/^#\s/.test(b)) return <p key={i} className="title-2">{inline(b.replace(/^#\s/, ""))}</p>;
        if (/^#{1,3}\s/.test(b)) return <p key={i} className="headline">{inline(b.replace(/^#{1,3}\s/, ""))}</p>;
        if (b.startsWith(">")) return <blockquote key={i} className="border-l-2 border-primary/50 pl-3 text-muted-foreground">{inline(b.replace(/^>\s?/gm, ""))}</blockquote>;
        return <p key={i} className="whitespace-pre-wrap">{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </div>
  );
}

function ToolRun({ items }: { items: Extract<Ev, { k: "tool" }>[] }) {
  const [open, setOpen] = useState(false);
  const running = items.some((t) => t.status === "running");
  const failed = items.filter((t) => t.status === "error").length;
  const last = items[items.length - 1]!;
  return (
    <div className="rounded-lg bg-foreground/[0.04]">
      <button onClick={() => setOpen(!open)} className="row w-full text-left text-muted-foreground row-hover">
        {running ? <Loader2 className="size-3.5 animate-spin text-primary" /> : failed ? <TriangleAlert className="size-3.5 text-warning" /> : <Wrench className="size-3.5" />}
        <span className="min-w-0 flex-1 truncate">{running ? last.summary : `${items.length} step${items.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`}</span>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.16 } }} transition={SPRING_DEFAULT} className="overflow-hidden px-2 pb-1.5">
            {items.map((t) => (
              <li key={t.id} className="flex items-start gap-2 py-1 text-[12px] text-muted-foreground" title={t.input}>
                {t.status === "running" ? <Loader2 className="mt-px size-3 shrink-0 animate-spin" /> : t.status === "error" ? <TriangleAlert className="mt-px size-3 shrink-0 text-warning" /> : <Check className="mt-px size-3 shrink-0 text-success" />}
                <span className="min-w-0 break-words">{t.summary}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function QuestionCard({ ev, onAnswer }: { ev: Extract<Ev, { k: "question" }>; onAnswer: (answers: Record<string, string>) => Promise<void> }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const waiting = ev.status === "waiting";
  const ready = ev.questions.every((q) => (picked[q.question]?.length ?? 0) > 0 || (other[q.question] ?? "").trim());
  const submit = async () => {
    setBusy(true);
    const answers: Record<string, string> = {};
    for (const q of ev.questions) {
      const o = (other[q.question] ?? "").trim();
      answers[q.question] = o || (picked[q.question] ?? []).join(", ");
    }
    try { await onAnswer(answers); } finally { setBusy(false); }
  };
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_DEFAULT}
      className={cn("panel overflow-hidden", waiting && "ring-1 ring-primary/40")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ShieldQuestion className="size-4 text-primary" />
        <span className="headline">{waiting ? "Claude has a question" : ev.status === "answered" ? "Answered" : "No longer needed"}</span>
      </div>
      <div className="space-y-3 p-3">
        {ev.questions.map((q) => (
          <div key={q.question} className="space-y-1.5">
            {q.header && <span className="caption uppercase tracking-wide">{q.header}</span>}
            <p className="font-medium">{q.question}</p>
            {waiting ? (
              <div className="space-y-1">
                {q.options.map((o) => {
                  const on = picked[q.question]?.includes(o.label);
                  return (
                    <button key={o.label}
                      onClick={() => setPicked((p) => ({ ...p, [q.question]: q.multiSelect ? (on ? (p[q.question] ?? []).filter((x) => x !== o.label) : [...(p[q.question] ?? []), o.label]) : [o.label] }))}
                      className={cn("w-full rounded-md border px-2.5 py-1.5 text-left transition-colors", on ? "border-primary bg-primary/12" : "border-border hover:bg-foreground/5")}>
                      <span className="block font-medium">{o.label}</span>
                      {o.description && <span className="mt-0.5 block text-[12px] leading-[15px] text-muted-foreground">{o.description}</span>}
                      {o.preview && on && <pre className="mt-1.5 overflow-x-auto rounded bg-foreground/6 p-2 font-mono text-[10.5px] leading-[13px]">{o.preview}</pre>}
                    </button>
                  );
                })}
                <input value={other[q.question] ?? ""} onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
                  placeholder="Or say it in your words…" className="h-7 w-full rounded-md bg-input px-2 outline-none placeholder:text-faint-foreground focus:ring-2 focus:ring-primary/50" />
              </div>
            ) : (
              <p className="text-muted-foreground">→ {ev.answers?.[q.question] ?? "–"}</p>
            )}
          </div>
        ))}
        {waiting && (
          <div className="flex justify-end">
            <button disabled={!ready || busy} onClick={submit}
              className="h-7 rounded-md bg-primary px-3 font-medium text-primary-foreground transition active:scale-[0.97] disabled:opacity-40">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Answer"}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function PermissionCard({ ev, onDecide }: { ev: Extract<Ev, { k: "permission" }>; onDecide: (allow: boolean, always?: boolean) => void }) {
  const waiting = ev.status === "waiting";
  return (
    <div className={cn("panel p-3", waiting && "ring-1 ring-warning/50")}>
      <div className="mb-1.5 flex items-center gap-2"><TriangleAlert className="size-4 text-warning" /><span className="headline">Claude wants to {ev.reason}</span></div>
      <pre className="max-h-28 overflow-auto rounded bg-foreground/6 p-2 font-mono text-[11px] leading-[14px] whitespace-pre-wrap">{ev.detail}</pre>
      {waiting ? (
        <div className="mt-2 flex justify-end gap-1.5">
          <button onClick={() => onDecide(false)} className="h-7 rounded-md px-3 hover:bg-foreground/8">Don't allow</button>
          <button onClick={() => onDecide(true, true)} className="h-7 rounded-md px-3 hover:bg-foreground/8">Always allow</button>
          <button onClick={() => onDecide(true)} className="h-7 rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]">Allow once</button>
        </div>
      ) : <p className="mt-1.5 caption">{ev.status === "allowed" ? "Allowed" : ev.status === "denied" ? "Not allowed" : "No longer needed"}</p>}
    </div>
  );
}

/** The conversation: Claude's replies, its steps folded into one line, cards for its questions. */
export function ChatThread({ sid, events, emptyHint }: { sid: string; events: Ev[]; emptyHint?: ReactNode }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [events.length, events[events.length - 1]?.k === "text" ? (events[events.length - 1] as { text: string }).text.length : 0]);
  const groups = useMemo(() => {
    const out: (Ev | { k: "tools"; id: string; items: Extract<Ev, { k: "tool" }>[] })[] = [];
    for (const e of events) {
      const last = out[out.length - 1];
      if (e.k === "tool") { if (last && last.k === "tools") last.items.push(e); else out.push({ k: "tools", id: e.id, items: [e] }); }
      else if (e.k === "text" && !e.text.trim()) continue;
      else out.push(e);
    }
    return out;
  }, [events]);
  if (!events.length) return <div className="p-4 text-center text-muted-foreground">{emptyHint}</div>;
  return (
    <div className="space-y-2.5 p-3">
      {groups.map((g) => {
        if (g.k === "tools") return <ToolRun key={g.id} items={g.items} />;
        if (g.k === "user") return (
          <div key={g.id} className="ml-8 space-y-1.5 rounded-xl bg-primary/14 px-3 py-2 text-[13px] leading-[18px] whitespace-pre-wrap">
            {g.files?.length ? <div className="flex flex-wrap gap-1.5">{g.files.map((f) => <FileChip key={f.path} f={f} />)}</div> : null}
            {g.text}
          </div>
        );
        if (g.k === "text") return <div key={g.id} className="px-0.5"><Prose text={g.text} /></div>;
        if (g.k === "question") return <QuestionCard key={g.id} ev={g} onAnswer={(answers) => api(`/api/chat/${sid}/answer`, { json: { event: g.id, answers } }).then(() => undefined)} />;
        if (g.k === "permission") return <PermissionCard key={g.id} ev={g} onDecide={(allow, always) => void api(`/api/chat/${sid}/permit`, { json: { event: g.id, allow, always } })} />;
        if (g.k === "status") return <p key={g.id} className={cn("caption text-center", g.tone === "error" && "text-destructive", g.tone === "ok" && "text-success")}>{g.text}</p>;
        return null;
      })}
      <div ref={end} />
    </div>
  );
}

/** The composer: a capsule of glass floating at the bottom of the panel. */
/** A file on a message or waiting in the composer: an image as a thumbnail, anything else as its name. */
function FileChip({ f, onRemove, progress }: { f: Pick<Attached, "name" | "kind"> & { url?: string }; onRemove?: () => void; progress?: number }) {
  const Icon = f.kind === "video" ? Film : FileText;
  return (
    <span className="relative inline-flex h-11 max-w-[180px] items-center gap-1.5 overflow-hidden rounded-lg bg-foreground/8 pr-2">
      {f.kind === "image" && f.url ? <img src={f.url} alt="" className="size-11 shrink-0 object-cover" /> : <span className="grid size-11 shrink-0 place-items-center"><Icon className="size-4 text-muted-foreground" /></span>}
      <span className="truncate caption">{f.name}</span>
      {progress !== undefined && progress < 1 && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" style={{ transform: `scaleX(${progress})`, transformOrigin: "0 50%" }} />}
      {onRemove && <button onClick={onRemove} title="Remove" className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/55 text-white"><X className="size-2.5" /></button>}
    </span>
  );
}

type Pending = { key: string; name: string; kind: Attached["kind"]; progress: number; file?: Attached; url?: string; error?: string };
const kindOf = (f: File): Attached["kind"] => (f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file");

export function Composer({ onSend, onStop, busy, placeholder, attach }: { onSend: (text: string, files: Attached[]) => Promise<void> | void; onStop?: () => void; busy?: boolean;
  placeholder?: string; attach?: (f: File, onProgress: (p: number) => void) => Promise<Attached> }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = pending.some((p) => !p.file && !p.error);
  const ready = pending.filter((p) => p.file).map((p) => p.file!);
  const add = (list: FileList | File[]) => {
    if (!attach) return;
    for (const f of Array.from(list)) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      const url = f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined;
      setPending((p) => [...p, { key, name: f.name, kind: kindOf(f), progress: 0, url }]);
      attach(f, (pr) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: pr } : x))))
        .then((file) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: 1, file } : x))))
        .catch((e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error: e.message } : x))));
    }
  };
  const send = async () => {
    const t = text.trim();
    if ((!t && !ready.length) || uploading) return;
    setText(""); setPending([]);
    await onSend(t || "Here are the files.", ready);
  };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "0px"; el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [text]);
  return (
    <div onDragOver={(e) => { if (attach && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!attach) return; e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      className={cn("liquid-glass liquid-glass-dense rounded-[18px] p-1.5", over && "ring-2 ring-primary")}>
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1.5 pt-0.5 pb-1.5">
          {pending.map((p) => <span key={p.key} title={p.error}><FileChip f={{ name: p.error ? `Failed: ${p.name}` : p.name, kind: p.kind, url: p.url }} progress={p.progress}
            onRemove={() => setPending((x) => x.filter((y) => y.key !== p.key))} /></span>)}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        {attach && (
          <>
            <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
            <button onClick={() => picker.current?.click()} title="Attach files or images" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 active:scale-90">
              <Paperclip className="size-4" />
            </button>
          </>
        )}
        <textarea ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={pending.length ? "What should Claude do with these?" : placeholder ?? "Ask Claude to change anything…"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          onPaste={(e) => { if (attach && e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files); } }}
          className={cn("min-h-6 flex-1 resize-none bg-transparent py-1 leading-[18px] outline-none placeholder:text-faint-foreground", !attach && "pl-1.5")} />
        {busy && onStop ? (
          <button onClick={onStop} title="Stop" className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 active:scale-90"><CircleStop className="size-4" /></button>
        ) : null}
        <button onClick={() => void send()} disabled={(!text.trim() && !ready.length) || uploading} title={uploading ? "Uploading…" : "Send"}
          className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-90 disabled:bg-foreground/15 disabled:text-faint-foreground">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}

export function StatusDot({ status }: { status?: SessionMeta["status"] }) {
  const s = status ?? "idle";
  const live = s === "running" || s === "waiting";
  return (
    <span className="inline-flex items-center gap-1.5 caption">
      <span className={cn("size-1.5 rounded-full", s === "waiting" ? "bg-warning" : live ? "bg-primary animate-pulse" : s === "failed" ? "bg-destructive" : "bg-faint-foreground")} />
      {s === "waiting" ? "Waiting for you" : s === "running" ? "Working" : s === "failed" ? "Stopped with an error" : s === "stopped" ? "Stopped" : "Ready"}
    </span>
  );
}

/** Upload one file for this chat's next message (the server keeps it in the library). */
export function attachFile(sid: string, file: File, onProgress: (p: number) => void): Promise<Attached> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `/api/chat/${encodeURIComponent(sid)}/attach`);
    x.setRequestHeader("x-filename", encodeURIComponent(file.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText || `HTTP ${x.status}`)));
    x.onerror = () => reject(new Error("the upload stopped"));
    x.send(file);
  });
}

/** The chat panel: the thread and the composer, for one conversation. */
export function ChatPanel({ sid, title, edit, at, hint }: { sid: string; title?: string; edit?: string; at?: () => number; hint?: ReactNode }) {
  const { events, meta } = useSession(sid);
  const busy = meta?.status === "running" || meta?.status === "waiting";
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="flex items-center gap-1.5 headline"><Sparkles className="size-3.5 text-primary" />Claude</span>
        <StatusDot status={meta?.status} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-20">
        <ChatThread sid={sid} events={events} emptyHint={hint ?? <span>Ask Claude to cut, fix or change anything here.</span>} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2.5">
        <div className="pointer-events-auto">
          <Composer busy={busy} onStop={() => void api(`/api/chat/${sid}/stop`, { method: "POST" })} attach={(f, onProgress) => attachFile(sid, f, onProgress)}
            onSend={(text, files) => api(`/api/chat/${sid}/send`, { json: { text, title, edit, at: at?.(), files } }).then(() => undefined)} />
        </div>
      </div>
    </div>
  );
}
