import { AnimatePresence, motion } from "motion/react";
import { Check, Ellipsis, FolderOpen, Info, Loader2, MessageSquare, Pause, Pencil, Play, Scissors, Send, Share, SlidersHorizontal, StickyNote, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdjustPanel } from "@/components/adjust";
import { ChatPanel, StatusDot } from "@/components/chat";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import { STATUS, type VideoSummary } from "@/components/video-card";
import { Menu } from "@/components/menu";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useItemActions } from "@/lib/actions";
import { navigate } from "@/lib/router";
import { api, useApi, useEvents } from "@/lib/api";
import { langName } from "@/lib/langs";
import { Link } from "@/lib/router";
import { SPRING_DEFAULT, SPRING_SNAPPY } from "@/lib/motion";
import { clock, cn } from "@/lib/utils";
import type { PageProps } from "@/app";

interface Word { i: number; text: string; start: number; end: number; kept: boolean; kind?: string }
interface Reply { from: "claude" | "you"; text: string; at: string; sent?: string }
interface Note { id: string; t: number; text: string; stage: string; at: string; sent?: string; resolved?: string; reopened?: string; thread?: Reply[] }
/** The note's dot (the server's library.ts noteState): new = orange (not sent, reopened, or your reply not sent yet),
 *  working = blue (Claude has it), done = green (Claude fixed it). */
const noteState = (n: Note): "new" | "working" | "done" =>
  !n.sent || (n.thread ?? []).some((r) => r.from === "you" && !r.sent) || (!!n.reopened && n.reopened > n.sent) ? "new" : n.resolved ? "done" : "working";
const DOT = { new: "bg-warning", working: "bg-primary", done: "bg-success" } as const;
const CHIP = { new: "bg-warning/20 text-warning", working: "bg-primary/15 text-primary", done: "bg-success/15 text-success" } as const;
interface PlanSummary {
  width: number; height: number; duration: number;
  cards: { start: number; end: number; label: string; kind: string; place: "scene" | "split" | "box" | "behind" | "background" }[];
  captions: { start: number; end: number; text: string }[];
  zooms: { start: number; end: number; scale: number }[];
  sounds: { t: number; name: string }[];
  music: boolean;
}
interface Detail extends VideoSummary {
  transcript: { words: Word[]; cuts: { start: number; end: number; kind: string; note?: string }[]; kept: { start: number; end: number }[]; lang?: string };
  plan: PlanSummary | null;
  notes: Note[]; job: { name: string } | null; chat: { id: string; status: string } | null;
  sound?: { original: string; lufs?: number; orig_lufs?: number } | null;
}

/** Where a visual sits, as a colour on the timeline. */
const PLACE: Record<PlanSummary["cards"][number]["place"], { label: string; cls: string }> = {
  background: { label: "Behind you (cut out)", cls: "bg-[#ff9f0a]/80" },
  scene: { label: "Full screen", cls: "bg-[#bf5af2]/70" },
  split: { label: "Half the screen", cls: "bg-[#64d2ff]/65" },
  box: { label: "Small box", cls: "bg-[#30d158]/60" },
  behind: { label: "Tucked behind your hair", cls: "bg-[#ffd60a]/60" },
};

const KIND: Record<string, string> = { retake: "Retake", false_start: "False start", filler: "Filler", meta: "Talking to yourself", audio_event: "Sound", redundant: "Said again", alt_hook: "Other hook", manual: "Your cut", silence: "Pause" };

/** Raw-take seconds <-> seconds on the cut, through the kept spans. */
function timeMaps(kept: { start: number; end: number }[]) {
  const starts: number[] = [];
  let acc = 0;
  for (const k of kept) { starts.push(acc); acc += k.end - k.start; }
  return {
    total: acc,
    // the kept pieces are in play order, which is not always the take's (moves.json plays a later take earlier)
    toCut(t: number): number {
      const i = kept.findIndex((k) => t >= k.start && t <= k.end);
      if (i >= 0) return starts[i]! + (t - kept[i]!.start);
      let next = -1;   // a cut word: where the next kept piece of the take plays
      kept.forEach((k, j) => { if (k.start > t && (next < 0 || k.start < kept[next]!.start)) next = j; });
      return next >= 0 ? starts[next]! : acc;
    },
    toSrc(c: number): number {
      for (let i = 0; i < kept.length; i++) {
        const k = kept[i]!, end = starts[i]! + (k.end - k.start);
        if (c <= end) return k.start + (c - starts[i]!);
      }
      return kept.length ? kept[kept.length - 1]!.end : c;
    },
    spans: kept.map((k, i) => ({ start: starts[i]!, end: starts[i]! + (k.end - k.start), src: k })),
  };
}

/** The studio sound's A/B: the original voice from a muted video's twin <audio>, kept in step with the picture. */
function useOriginalVoice(playerRef: React.RefObject<HTMLVideoElement | null>, audio: React.RefObject<HTMLAudioElement | null>, on: boolean, src?: string) {
  useEffect(() => {
    const v = playerRef.current, a = audio.current;
    if (!v || !a) return;
    v.muted = on;
    if (!on) { a.pause(); return; }
    const sync = () => { if (Math.abs(a.currentTime - v.currentTime) > 0.08) a.currentTime = v.currentTime; };
    const play = () => { a.currentTime = v.currentTime; a.playbackRate = v.playbackRate; void a.play().catch(() => undefined); };
    const pause = () => a.pause();
    sync();
    if (!v.paused) play();
    const timer = window.setInterval(sync, 400);
    v.addEventListener("play", play); v.addEventListener("pause", pause); v.addEventListener("seeked", sync);
    return () => { window.clearInterval(timer); v.removeEventListener("play", play); v.removeEventListener("pause", pause); v.removeEventListener("seeked", sync); a.pause(); v.muted = false; };
  }, [playerRef, audio, on, src]);
}

function Player({ src, playerRef, onTime, poster, sound, overlay }: { src?: string; playerRef: React.RefObject<HTMLVideoElement | null>; onTime: (t: number) => void; poster?: string;
  sound?: { original: string; lufs?: number; orig_lufs?: number } | null; overlay?: ReactNode }) {
  const [orig, setOrig] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useOriginalVoice(playerRef, audio, orig && !!sound, src);
  useEffect(() => {   // A: hear the original voice, A again: the studio sound
    const k = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey && !(e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable]") && sound) setOrig((x) => !x); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [sound]);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [hover, setHover] = useState(true);
  const hide = useRef<number>(undefined);
  useEffect(() => {
    const v = playerRef.current; if (!v) return;
    const tick = () => { setT(v.currentTime); onTime(v.currentTime); };
    const on = [["timeupdate", tick], ["play", () => setPlaying(true)], ["pause", () => setPlaying(false)], ["loadedmetadata", () => setDur(v.duration)]] as const;
    for (const [e, f] of on) v.addEventListener(e, f);
    let raf = 0; const loop = () => { if (!v.paused) tick(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
    return () => { for (const [e, f] of on) v.removeEventListener(e, f); cancelAnimationFrame(raf); };
  }, [playerRef, onTime, src]);
  const poke = () => { setHover(true); clearTimeout(hide.current); hide.current = window.setTimeout(() => setHover(false), 2200); };
  if (!src) return <div className="grid size-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden" onMouseMove={poke} onMouseLeave={() => playing && setHover(false)}>
      <video ref={playerRef} src={src} poster={poster} playsInline preload="auto" crossOrigin="anonymous" onClick={() => { const v = playerRef.current; if (v) void (v.paused ? v.play() : v.pause()); }}
        className="max-h-full max-w-full rounded-[10px] bg-black object-contain shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]" />
      {overlay}
      {sound && <audio ref={audio} src={sound.original} preload="auto" />}
      {sound && (
        <button onClick={() => setOrig(!orig)} title="Hear the original voice at the same moment (A)"
          className="liquid-glass liquid-glass-clear absolute top-3 right-3 flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-white active:scale-95">
          <span className={cn("size-1.5 rounded-full", orig ? "bg-white/60" : "bg-[#30D158]")} />
          {orig ? `Original${sound.orig_lufs != null ? ` · ${sound.orig_lufs.toFixed(1)} LUFS` : ""}` : `Studio sound${sound.lufs != null ? ` · ${sound.lufs.toFixed(1)} LUFS` : ""}`}
        </button>
      )}
      {/* Player controls float over the video: glass, monochrome, gone while it plays untouched. */}
      <AnimatePresence>
        {(hover || !playing) && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6, transition: { duration: 0.16 } }} transition={SPRING_SNAPPY}
            className="liquid-glass liquid-glass-clear absolute bottom-4 left-1/2 flex w-[min(420px,86%)] -translate-x-1/2 items-center gap-2 rounded-full px-2 py-1.5">
            <button onClick={() => { const v = playerRef.current; if (v) void (v.paused ? v.play() : v.pause()); }} className="grid size-8 place-items-center rounded-full text-white active:scale-90" title="Play or pause (space)">
              {playing ? <Pause className="size-4 fill-white" /> : <Play className="size-4 translate-x-px fill-white" />}
            </button>
            <span className="w-10 text-right text-[11px] text-white/85 tabular">{clock(t)}</span>
            <input type="range" min={0} max={dur || 0} step={0.01} value={t} onChange={(e) => { const v = playerRef.current; if (v) v.currentTime = Number(e.target.value); }}
              className="h-1 flex-1 cursor-pointer accent-white" />
            <span className="w-10 text-[11px] text-white/60 tabular">{clock(dur)}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Transcript({ words, now, onSeek, onEdit, busy }: { words: Word[]; now: number; onSeek: (w: Word) => void; onEdit: (kind: "cut" | "restore", a: Word, b: Word) => Promise<void>; busy: boolean }) {
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const active = useMemo(() => words.findIndex((w) => w.kept && w.start <= now && now < w.end + 0.15), [words, now]);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-w="${active}"]`);
    if (el && box.current) {
      const r = el.getBoundingClientRect(), b = box.current.getBoundingClientRect();
      if (r.top < b.top + 40 || r.bottom > b.bottom - 60) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [active]);
  useEffect(() => { const up = () => setDrag(null); window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, []);
  const [a, b] = sel ? [Math.min(...sel), Math.max(...sel)] : [-1, -1];
  const range = sel ? words.slice(a, b + 1) : [];
  const canCut = range.some((w) => w.kept), canRestore = range.some((w) => !w.kept);
  // Lines: a new line after a sentence end or a cut stretch, so the struck takes read as blocks.
  return (
    <div ref={box} className="relative h-full overflow-y-auto px-4 pt-3 pb-24 text-[14px] leading-[24px] select-none" onMouseDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
      {words.length === 0 && <p className="text-muted-foreground">The transcript shows up here once Claude has listened to the take.</p>}
      <p>
        {words.map((w) => {
          const inSel = sel && w.i >= a && w.i <= b;
          return (
            <span key={w.i} data-w={w.i}
              onMouseDown={(e) => { if (e.button !== 0) return; setDrag(w.i); setSel([w.i, w.i]); }}
              onMouseEnter={() => { if (drag != null) setSel([drag, w.i]); }}
              onDoubleClick={() => onSeek(w)}
              title={w.kept ? `${clock(w.start)}` : `${KIND[w.kind ?? ""] ?? "Cut"} · ${clock(w.start)}`}
              className={cn("rounded-[4px] px-[1px] transition-colors",
                !w.kept && "text-faint-foreground line-through decoration-cut/70 decoration-1",
                w.i === active && "bg-primary/25",
                inSel && "bg-primary/40 text-foreground no-underline opacity-100")}>
              {w.text}{" "}
            </span>
          );
        })}
      </p>
      <AnimatePresence>
        {sel && (canCut || canRestore) && drag == null && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.14 } }} transition={SPRING_SNAPPY}
            className="liquid-glass liquid-glass-dense sticky bottom-4 mx-auto mt-4 flex w-fit items-center gap-1 rounded-full p-1">
            <span className="px-2 caption">{b - a + 1} word{b > a ? "s" : ""}</span>
            {canCut && <button disabled={busy} onClick={() => { void onEdit("cut", words[a]!, words[b]!); setSel(null); }} className="flex h-7 items-center gap-1 rounded-full px-3 hover:bg-foreground/10 active:scale-95"><Scissors className="size-3.5" />Cut</button>}
            {canRestore && <button disabled={busy} onClick={() => { void onEdit("restore", words[a]!, words[b]!); setSel(null); }} className="flex h-7 items-center gap-1 rounded-full px-3 hover:bg-foreground/10 active:scale-95"><Undo2 className="size-3.5" />Bring back</button>}
            <button onClick={() => onSeek(words[a]!)} className="flex h-7 items-center gap-1 rounded-full px-3 hover:bg-foreground/10"><Play className="size-3.5" />Play</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Timeline({ spans, total, now, notes, onSeek, plan }: { spans: { start: number; end: number }[]; total: number; now: number; notes: Note[]; onSeek: (t: number) => void; plan?: PlanSummary | null }) {
  const bar = useRef<HTMLDivElement>(null);
  // Press anywhere on the tracks (or on the playhead) and drag to scrub: the playhead follows the pointer at once,
  // the video seeks once a frame, and the pointer stays captured when it leaves the timeline.
  const [drag, setDrag] = useState<number | null>(null);
  const frame = useRef(0);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / (total || 1)) * 100))}%`;
  const at = (x: number) => { const r = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(total, ((x - r.left) / r.width) * total)); };
  const scrub = (x: number) => { const t = at(x); setDrag(t); cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => onSeek(t)); };
  const down = (e: React.PointerEvent<HTMLDivElement>) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); };
  const up = (e: React.PointerEvent<HTMLDivElement>) => { if (drag === null) return; cancelAnimationFrame(frame.current); onSeek(at(e.clientX)); setDrag(null); };
  const head = drag ?? now;
  const block = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(Math.max(0.05, b - a))} - 1px)` });
  const tracks: [string, ReactNode][] = [
    ["Video", <>
      {spans.map((s, i) => <div key={i} className={cn("absolute top-1 bottom-1 rounded-[4px]", i % 2 ? "bg-primary/45" : "bg-primary/60")} style={block(s.start, s.end)} />)}
      {plan?.zooms.map((z, i) => <div key={`z${i}`} title={`Zoom ×${z.scale}`} className="absolute bottom-0.5 h-1 rounded-full bg-white/70" style={block(z.start, z.end)} />)}
    </>],
    ["Visuals", plan ? plan.cards.map((c, i) => (
      <div key={i} title={`${c.label} · ${PLACE[c.place].label}`} className={cn("absolute top-1 bottom-1 overflow-hidden rounded-[4px] px-1 text-[10px] leading-[18px] text-white", PLACE[c.place].cls)} style={block(c.start, c.end)}>{c.label}</div>
    )) : <span className="absolute inset-0 flex items-center pl-2 caption">The visuals come with the edit</span>],
    ["Captions", plan ? plan.captions.map((c, i) => (
      <div key={i} title={c.text} className="absolute top-1.5 bottom-1.5 overflow-hidden rounded-[3px] bg-foreground/15 px-0.5 text-[9px] leading-[14px] text-muted-foreground" style={block(c.start, c.end)}>{c.text}</div>
    )) : <span className="absolute inset-0 flex items-center pl-2 caption">Captions come with the edit</span>],
    ["Sound", plan ? <>
      {plan.music && <div className="absolute top-2.5 bottom-2.5 left-0 right-0 rounded-full bg-[#ff375f]/30" title="Music" />}
      {plan.sounds.map((x, i) => <span key={i} title={x.name} className="absolute top-1.5 h-4 w-[3px] -translate-x-1/2 rounded-full bg-[#ff375f]" style={{ left: pct(x.t) }} />)}
    </> : <span className="absolute inset-0 flex items-center pl-2 caption">Music and sound cues come with the edit</span>],
  ];
  return (
    <div className="flex h-full select-none">
      <div className="w-20 shrink-0 border-r pt-5">{tracks.map(([n]) => <div key={n} className="flex h-7 items-center px-3 caption">{n}</div>)}</div>
      <div className={cn("relative min-w-0 flex-1 touch-none", drag === null ? "cursor-pointer" : "cursor-grabbing")} ref={bar}
        onPointerDown={down} onPointerMove={(e) => { if (drag !== null) scrub(e.clientX); }} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
        <div className="relative h-5 border-b">
          {Array.from({ length: Math.max(1, Math.floor(total / 5)) + 1 }, (_, i) => i * 5).filter((t) => t <= total).map((t) => (
            <span key={t} className="absolute top-0 h-full border-l border-foreground/15 pl-1 text-[10px] text-faint-foreground tabular" style={{ left: pct(t) }}>{t % 15 === 0 ? clock(t) : ""}</span>
          ))}
          {notes.map((n) => <span key={n.id} title={`${n.text} · ${noteState(n) === "done" ? "done" : noteState(n) === "working" ? "Claude is on it" : "not sent yet"}`}
            className={cn("absolute top-0.5 size-2.5 -translate-x-1/2 rounded-full transition-colors duration-300", DOT[noteState(n)])} style={{ left: pct(n.t) }} />)}
        </div>
        {tracks.map(([n, body]) => <div key={n} className="relative h-7 border-b border-foreground/5">{body}</div>)}
        <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary" style={{ left: pct(head) }}>
          {/* the handle: a bigger target than it looks, and it swells while held */}
          <span className={cn("pointer-events-auto absolute -top-px -left-[5px] size-[11px] rounded-full bg-primary transition-transform duration-150 before:absolute before:-inset-2 before:content-['']",
            drag === null ? "cursor-grab hover:scale-125" : "scale-[1.35] cursor-grabbing")} />
        </div>
      </div>
    </div>
  );
}

function NoteThread({ id, n, onSeek, reload }: { id: string; n: Note; onSeek: (t: number) => void; reload: () => void }) {
  const st = noteState(n);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const post = async (kind: "reply" | "reopen") => {
    const t = text.trim();
    if (kind === "reply" && !t) return;
    await api(`/api/videos/${encodeURIComponent(id)}/notes/${n.id}/${kind}`, { json: { text: t } });
    setText(""); setOpen(false); reload();
  };
  const label = st === "done" ? "Done" : st === "working" ? "Claude is on it" : n.sent ? "Not sent yet: goes with Send notes" : "Not sent yet";
  return (
    <div className="group rounded-lg p-2 hover:bg-foreground/[0.04]">
      <div className="flex items-start gap-2">
        <button onClick={() => onSeek(n.t)} className={cn("mt-px rounded-[5px] px-1.5 text-[11px] font-medium tabular", CHIP[st])}>{clock(n.t)}</button>
        <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap">{n.text}</p><p className="caption">{label}</p></div>
        {!n.sent && !n.thread?.length && <button aria-label="Delete note" onClick={async () => { await api(`/api/videos/${encodeURIComponent(id)}/notes/${n.id}`, { method: "DELETE" }); reload(); }} className="invisible text-faint-foreground hover:text-destructive group-hover:visible"><Trash2 className="size-3.5" /></button>}
      </div>
      {!!n.thread?.length && (
        <div className="mt-1.5 ml-3 space-y-1 border-l border-foreground/10 pl-3">
          {n.thread.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <p className="min-w-0 flex-1 whitespace-pre-wrap"><span className={cn("font-medium", r.from === "claude" ? "text-primary" : "text-foreground")}>{r.from === "claude" ? "Claude" : "You"}</span>
                <span className="text-muted-foreground"> {r.text}</span>{r.from === "you" && !r.sent && <span className="caption"> · not sent yet</span>}</p>
              {r.from === "claude" && st === "done" && i === n.thread!.map((x) => x.from).lastIndexOf("claude") && <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
            </div>
          ))}
        </div>
      )}
      {n.sent && (open ? (
        <div className="mt-1.5 ml-3 flex items-center gap-1.5 rounded-[8px] bg-input px-2">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={st === "done" ? "What's still off?" : "Reply…"}
            onKeyDown={(e) => { if (e.key === "Enter") void post(st === "done" ? "reopen" : "reply"); if (e.key === "Escape") setOpen(false); }}
            className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint-foreground" />
          <button onClick={() => void post(st === "done" ? "reopen" : "reply")} disabled={st !== "done" && !text.trim()} className="text-primary disabled:text-faint-foreground"><Send className="size-3.5" /></button>
        </div>
      ) : (
        <div className="mt-1 ml-3 flex gap-3 text-[12px]">
          <button onClick={() => setOpen(true)} className="text-muted-foreground hover:text-foreground">Reply</button>
          {st === "done" && <button onClick={() => setOpen(true)} className="text-muted-foreground hover:text-foreground">Reopen</button>}
        </div>
      ))}
    </div>
  );
}

function Notes({ id, notes, now, onSeek, reload }: { id: string; notes: Note[]; now: number; onSeek: (t: number) => void; reload: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const open = notes.filter((n) => noteState(n) === "new");
  const add = async () => { const t = text.trim(); if (!t) return; setText(""); await api(`/api/videos/${encodeURIComponent(id)}/notes`, { json: { t: now, text: t } }); reload(); };
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {notes.length === 0 && <p className="p-3 text-center text-muted-foreground">Pause where something is off and write what to change. Each note is pinned to its moment, and Claude answers under it.</p>}
        {[...notes].sort((a, b) => a.t - b.t).map((n) => <NoteThread key={n.id} id={id} n={n} onSeek={onSeek} reload={reload} />)}
      </div>
      <div className="space-y-2 border-t p-2.5">
        <div className="flex items-center gap-2 rounded-[10px] bg-input px-2.5">
          <span className="text-[11px] font-medium text-warning tabular">{clock(now)}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="Note at this moment…" className="h-8 flex-1 bg-transparent outline-none placeholder:text-faint-foreground" />
        </div>
        <button disabled={!open.length || sending} onClick={async () => { setSending(true); try { await api(`/api/videos/${encodeURIComponent(id)}/send-notes`, { method: "POST" }); reload(); } finally { setSending(false); } }}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary font-medium text-primary-foreground active:scale-[0.98] disabled:bg-foreground/10 disabled:text-faint-foreground">
          <Send className="size-3.5" />{open.length ? `Send ${open.length} note${open.length > 1 ? "s" : ""} to Claude` : "No new notes"}
        </button>
      </div>
    </div>
  );
}

function Inspector({ v }: { v: Detail }) {
  const counts = v.transcript.cuts.reduce<Record<string, number>>((m, c) => ({ ...m, [c.kind]: (m[c.kind] ?? 0) + 1 }), {});
  const rows: [string, ReactNode][] = [
    ["Language", langName(v.lang)],
    ["Raw take", clock(v.seconds.source)],
    ["Cut", clock(v.seconds.cut)],
    ["Removed", v.seconds.source && v.seconds.cut ? `${clock(v.seconds.source - v.seconds.cut)} (${Math.round((1 - v.seconds.cut / v.seconds.source) * 100)}%)` : "–"],
    ["Stage", STATUS[v.status]?.label ?? v.status],
  ];
  return (
    <div className="space-y-4 overflow-y-auto p-3">
      <div className="panel divide-y overflow-hidden">{rows.map(([k, val]) => <div key={k} className="row justify-between px-3"><span className="label-2">{k}</span><span className="tabular">{val}</span></div>)}</div>
      {v.plan && (
        <div><p className="mb-1 px-1 caption uppercase tracking-wide">The edit</p>
          <div className="panel divide-y overflow-hidden">
            {(Object.keys(PLACE) as (keyof typeof PLACE)[]).map((k) => {
              const n = v.plan!.cards.filter((c) => c.place === k).length;
              return <div key={k} className="row justify-between px-3"><span className="flex items-center gap-2"><span className={cn("size-2.5 rounded-sm", PLACE[k].cls)} />{PLACE[k].label}</span><span className="label-2 tabular">{n}</span></div>;
            })}
            <div className="row justify-between px-3"><span>Captions</span><span className="label-2 tabular">{v.plan.captions.length}</span></div>
            <div className="row justify-between px-3"><span>Zooms</span><span className="label-2 tabular">{v.plan.zooms.length}</span></div>
            <div className="row justify-between px-3"><span>Sound cues</span><span className="label-2 tabular">{v.plan.sounds.length}{v.plan.music ? " + music" : ""}</span></div>
          </div>
        </div>
      )}
      {Object.keys(counts).length > 0 && (
        <div><p className="mb-1 px-1 caption uppercase tracking-wide">What went</p>
          <div className="panel divide-y overflow-hidden">{Object.entries(counts).map(([k, n]) => <div key={k} className="row justify-between px-3"><span>{KIND[k] ?? k}</span><span className="label-2 tabular">{n}</span></div>)}</div>
        </div>
      )}
    </div>
  );
}

/** The editor: the video in the middle, the transcript on the left, Claude, notes and facts on the right, the timeline below. */
export function EditorPage({ id, setTitle, chatOpen }: PageProps & { id: string; chatOpen: boolean }) {
  const { data: v, reload, error } = useApi<Detail>(`/api/videos/${encodeURIComponent(id)}`, [id]);
  const gone = !!error && /no such video/.test(error);
  useEvents((t, d) => { if (t === "video" && d?.id === id) reload(); });
  const player = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState<"edit" | "cut" | "raw">("edit");
  const [tab, setTab] = useState<"claude" | "notes" | "adjust" | "info">("claude");
  const [now, setNow] = useState(0);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const maps = useMemo(() => timeMaps(v?.transcript.kept ?? []), [v?.transcript.kept]);
  const hasCut = !!v?.media.cut;
  const hasEdit = !!v?.media.render;
  // The edit runs on the cut's clock, so everything that maps cut time works for it too.
  const showing: "edit" | "cut" | "raw" = view === "edit" && hasEdit ? "edit" : (view === "cut" || view === "edit") && hasCut ? "cut" : "raw";
  const onCut = showing !== "raw";
  const src = showing === "edit" ? v?.media.render : showing === "cut" ? v?.media.cut : v?.media.source;
  const viewOptions = [...(hasEdit ? [{ value: "edit" as const, label: "Edit" }] : []), { value: "cut" as const, label: "Cut" }, { value: "raw" as const, label: "Raw" }];
  const nowSrc = onCut ? maps.toSrc(now) : now;
  const onTime = useCallback((t: number) => setNow(t), []);
  const seekSrc = (t: number) => { const p = player.current; if (p) { p.currentTime = onCut ? maps.toCut(t) : t; void p.play(); } };
  const seekCut = (t: number) => { const p = player.current; if (p) p.currentTime = onCut ? t : maps.toSrc(t); };
  const edit = async (kind: "cut" | "restore", a: Word, b: Word) => {
    setSaving(true);
    try { await api(`/api/videos/${encodeURIComponent(id)}/edits`, { json: { [kind]: [[a.start - 0.001, b.end + 0.001]] } }); }
    catch (e) { alert((e as Error).message); }
    finally { setSaving(false); reload(); }
  };
  // the server sees a render or a script running on this video whatever its stage (a re-render after approval too);
  // between Claude's steps, the newest progress line of a stage still under way keeps the pill up
  const working = !!v?.job || !!v?.working || v?.progress && !v.progress.done && !v.progress.failed && Date.now() / 1000 - v.progress.t < 900 && (v.status === "transcribing" || v.status === "cutting" || v.status === "making");
  const doing = v?.working ?? v?.progress;
  const wide = useMediaQuery("(min-width: 1024px)");
  const [phoneTab, setPhoneTab] = useState<"notes" | "claude">("notes");
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const act = useItemActions("videos", reload);
  const moreItems = [
    { label: "Rename…", icon: <Pencil className="size-3.5" />, run: () => v && act.rename(id, v.title) },
    { label: "Show in Finder", icon: <FolderOpen className="size-3.5" />, run: () => void api("/api/reveal", { json: { id } }) },
    { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, run: () => v && act.del([id], v.title) },
  ];
  const approve = async (stage: "cut" | "edit") => {
    setApproving(true);
    try { await api(`/api/videos/${encodeURIComponent(id)}/approve`, { json: { stage } }); if (stage === "cut") setView("edit"); reload(); }
    finally { setApproving(false); }
  };
  useEffect(() => {
    if (!v) return;
    const cutView = hasCut && <GlassSegmented value={showing} onChange={(x) => setView(x as "edit" | "cut" | "raw")} options={viewOptions} />;
    setTitle(
      <span className="flex items-center gap-2"><span className="truncate">{v.title}</span><span className="hidden caption font-normal sm:inline">{STATUS[v.status]?.label}</span></span>,
      <div className="flex items-center gap-2">
        {working && doing && <span className="hidden items-center gap-1.5 caption xl:flex"><Loader2 className="size-3 animate-spin text-primary" />{doing.step}{doing.detail ? ` · ${doing.detail}` : ""}</span>}
        {wide && cutView}
        {v.status === "new" && !v.chat && <Link href={`/new?video=${encodeURIComponent(id)}`} className="flex h-7 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]">Make the cut</Link>}
        {hasCut && v.status === "ready" && (
          <button disabled={approving} onClick={() => approve("cut")} title="Approve the cut, and Claude makes the edit on top" className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]"><Check className="size-3.5" />{wide ? "Approve the cut" : "Approve"}</button>
        )}
        <button aria-label="More" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMore({ x: r.right - 208, y: r.bottom + 4 }); }}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8"><Ellipsis className="size-4" /></button>
        {hasEdit && (
          <button disabled={!!v.job} onClick={() => void api(`/api/videos/${encodeURIComponent(id)}/export`, { method: "POST" }).then(reload).catch((e: Error) => alert(e.message))}
            title="Final Cut, Premiere, Resolve, CapCut and a folder for an editor" className="flex h-7 items-center gap-1.5 rounded-md px-2.5 hover:bg-foreground/8 disabled:opacity-40">
            <Share className="size-3.5" />{wide ? "Export" : ""}
          </button>
        )}
        {hasEdit && v.status === "editing" && (
          <button disabled={approving} onClick={() => approve("edit")} className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]"><Check className="size-3.5" />{wide ? "Approve the edit" : "Approve"}</button>
        )}
      </div>,
    );
  }, [v, view, showing, hasCut, hasEdit, approving, working, id, reload, setTitle, wide]);
  // the video was deleted (here or in another window): back to the list
  useEffect(() => { if (gone) navigate("/videos", true); }, [gone]);
  if (!v) return <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  const sid = v.chat?.id ?? v.session ?? `v_${id}`;
  const total = onCut ? maps.total || v.seconds.cut || 0 : v.seconds.source ?? 0;
  const spans = onCut ? maps.spans : [{ start: 0, end: v.seconds.source ?? 0 }];
  const openNotes = v.notes.filter((n) => noteState(n) === "new").length;
  const cutNow = onCut ? now : maps.toCut(now);
  const progressPill = working && (
    <div className="absolute top-6 left-1/2 -translate-x-1/2"><div className="liquid-glass liquid-glass-milky flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap"><Loader2 className="size-3.5 animate-spin text-primary" />{doing?.step ?? "Working"}{doing?.detail ? ` · ${doing.detail}` : ""}</div></div>
  );

  // Phone and narrow windows: watch, leave notes, approve (the desktop is where the cut is changed by hand).
  const overlays = <><Menu at={more} items={moreItems} onClose={() => setMore(null)} />{act.dialogs}</>;
  if (!wide) {
    return (
      <div className="h-full overflow-y-auto pb-28">
        {overlays}
        <div className="mx-auto max-w-[560px] space-y-3 px-4 pt-3">
          {hasCut && <div className="flex justify-center"><GlassSegmented value={showing} onChange={(x) => setView(x as "edit" | "cut" | "raw")} options={viewOptions} /></div>}
          <div className="relative h-[64vh]"><Player src={src} poster={v.media.poster} playerRef={player} onTime={onTime} />{progressPill}</div>
          <GlassSegmented equal value={phoneTab} onChange={(x) => setPhoneTab(x as "notes" | "claude")} options={[{ value: "notes", label: openNotes ? `Notes (${openNotes})` : "Notes" }, { value: "claude", label: "Claude" }]} />
          <div className="panel h-[440px] overflow-hidden">
            {phoneTab === "notes" ? <Notes id={id} notes={v.notes} now={cutNow} onSeek={seekCut} reload={reload} /> : <ChatPanelBody sid={sid} id={id} title={v.title} status={v.status} at={() => cutNow} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {overlays}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r">
          <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
            <span className="headline">Transcript</span>
            <span className="caption">{saving ? "Saving…" : "Select words to cut or bring back"}</span>
          </div>
          <div className="min-h-0 flex-1"><Transcript words={v.transcript.words} now={nowSrc} busy={saving || !!v.job} onSeek={(w) => seekSrc(w.start)} onEdit={edit} /></div>
        </aside>
        <section className="relative min-w-0 flex-1 p-4">
          <Player src={src} poster={v.media.poster} playerRef={player} onTime={onTime} sound={showing === "raw" ? null : v.sound} />
          {progressPill}
        </section>
        <AnimatePresence initial={false}>
          {chatOpen && (
            <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 340, opacity: 1 }} exit={{ width: 0, opacity: 0, transition: { duration: 0.16 } }} transition={SPRING_DEFAULT} className="shrink-0 overflow-hidden border-l bg-sidebar">
              <div className="flex h-full w-[340px] flex-col">
                <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
                  {([["claude", "Claude", MessageSquare], ["notes", `Notes${openNotes ? ` (${openNotes})` : ""}`, StickyNote], ["adjust", "Adjust", SlidersHorizontal], ["info", "Inspector", Info]] as const).map(([k, label, Icon]) => (
                    <button key={k} onClick={() => setTab(k)} className={cn("flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[12px]", tab === k ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="size-3.5" />{label}</button>
                  ))}
                  <div className="flex-1" />
                  {tab === "claude" && <StatusDot status={v.chat?.status as never} />}
                </div>
                <div className="min-h-0 flex-1">
                  {tab === "claude" && <ChatPanelBody sid={sid} id={id} title={v.title} status={v.status} at={() => cutNow} />}
                  {tab === "notes" && <Notes id={id} notes={v.notes} now={cutNow} onSeek={seekCut} reload={reload} />}
                  {tab === "adjust" && <AdjustPanel id={id} status={v.progress} />}
                  {tab === "info" && <Inspector v={v} />}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      <div className="h-[146px] shrink-0 border-t bg-sidebar">
        <Timeline spans={spans} total={total} now={now} notes={onCut ? v.notes : []} plan={showing === "edit" ? v.plan : null} onSeek={(t) => { const p = player.current; if (p) p.currentTime = t; }} />
      </div>
    </div>
  );
}

/** The chat panel without its own header (the editor's tabs carry it). */
function ChatPanelBody({ sid, id, title, status, at }: { sid: string; id: string; title: string; status: string; at: () => number }) {
  const hint = status === "new" ? "Start the cut from New video, or ask Claude here: “cut this take”."
    : status === "transcribing" || status === "cutting" ? "Claude is cutting this take. Ask for any change: “keep the second hook”, “less tight at 0:40”."
      : "Ask for any change: “keep the second hook”, “less tight at 0:40”, “bring back the joke”.";
  return <div className="h-full [&>div>div:first-child]:hidden"><ChatPanel sid={sid} title={title} edit={id} at={at} hint={<span>{hint}</span>} /></div>;
}
