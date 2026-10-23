import { ArrowDown, ArrowUp, ChevronRight, FileCheck2, FileText, Film, Languages, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/drop-zone";
import { LangPicker } from "@/components/profiles";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import type { Clip, VideoSummary } from "@/components/video-card";
import { api, useApi, useEvents } from "@/lib/api";
import { LANG_OPTIONS, type LangChoice } from "@/lib/langs";
import { useProfiles } from "@/lib/profiles";
import { navigate, useRoute } from "@/lib/router";
import { toast } from "@/lib/toast";
import { droppedVideos, isVideo, uploadClips, useUploads, type Upload } from "@/lib/uploads";
import { clock, cn } from "@/lib/utils";
import type { PageProps } from "@/app";

const KINDS = [{ value: "take", label: "Take" }, { value: "broll", label: "B-roll" }];

/** New video: the raw takes (one, or every part and the b-roll at once), the language, an optional script, a note for
 *  Claude, and one button. Each clip is checked as it lands: a take (you, talking to the camera) or b-roll. */
export function NewVideoPage({ setTitle }: PageProps) {
  const route = useRoute();
  const [id, setId] = useState<string | null>(route.query.get("video"));
  const { data: video, reload } = useApi<VideoSummary>(id ? `/api/videos/${encodeURIComponent(id)}` : null, [id]);
  useEvents((t, d) => { if (t === "video" && (d as { id?: string } | undefined)?.id === id) reload(); });
  const all = useUploads();
  const [busy, setBusy] = useState(false);
  const [script, setScript] = useState("");
  const [notes, setNotes] = useState("");
  // the profile's language (its settings), else the last one picked in this profile: a creator mostly records in one
  const { current } = useProfiles();
  const langKey = `mm.lang${current ? `.${current.id}` : ""}`;
  const [lang, setLang] = useState<LangChoice>("auto");
  useEffect(() => {
    const ok = (v: unknown): v is LangChoice => LANG_OPTIONS.some((o) => o.value === v);
    let last: string | null = null;
    try { last = localStorage.getItem(langKey); } catch { /* private window */ }
    setLang(ok(current?.lang) ? current.lang : ok(last) ? last : "auto");
  }, [langKey, current?.lang]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pickLang = (v: LangChoice) => { setLang(v); try { localStorage.setItem(langKey, v); } catch { /* private window */ } };
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const more = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => { setTitle("New video"); }, [setTitle]);

  const add = async (fs: File[]) => {
    setBusy(true); setError(undefined);
    try { const v = await uploadClips(fs); setId(v); navigate(`/new?video=${encodeURIComponent(v)}`, true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const addMore = async (fs: File[]) => { if (id) try { await uploadClips(fs, id); } catch (e) { toast((e as Error).message); } };
  const change = async (n: number, body: object) => {
    if (!id) return;
    try { await api(`/api/videos/${encodeURIComponent(id)}/files/${n}`, { json: body }); reload(); } catch (e) { toast((e as Error).message); }
  };

  const clips: Clip[] = video?.files ?? [];
  const takes = clips.filter((c) => c.kind === "take");
  const broll = clips.filter((c) => c.kind === "broll");
  const checking = clips.some((c) => c.kind === "pending");
  const inflight = all.filter((u) => u.video === id && u.state !== "done");
  const sending = inflight.some((u) => u.state !== "failed");
  const ready = !!id && !sending && (clips.length <= 1 || (!checking && takes.length > 0));
  const start = async () => {
    if (!id) return;
    setStarting(true); setError(undefined);
    try { await api(`/api/videos/${encodeURIComponent(id)}/start`, { json: { script, instructions: notes, lang } }); navigate(`/videos/${encodeURIComponent(id)}`); }
    catch (e) { setError((e as Error).message); setStarting(false); }
  };
  const firstPct = all.find((u) => u.state === "uploading")?.pct ?? 0;

  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[640px] px-6 py-8">
        <h1 className="title-1">New video</h1>
        <p className="mb-5 label-2">Claude cuts the take first: the last good take of every line, no fillers, no dead air. You approve the cut, then the edit goes on top.</p>
        {!id ? <DropZone onFiles={add} busy={busy} progress={firstPct} /> : (
          <section className={cn("space-y-1.5 rounded-[14px] transition-colors", over && "bg-primary/8")}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void droppedVideos(e.dataTransfer).then((fs) => { if (fs.length) void addMore(fs); }); }}>
            <div className="flex items-center justify-between gap-2">
              <label className="flex min-w-0 items-center gap-1.5 headline"><Film className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{video?.title ?? "Your video"}</span>
                <span className="shrink-0 caption font-normal">{clips.length > 1 ? [takes.length && `${takes.length} take${takes.length > 1 ? "s" : ""}`, broll.length && `${broll.length} b-roll`].filter(Boolean).join(" · ") : ""}</span>
              </label>
              <button onClick={() => more.current?.click()} className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-primary hover:bg-primary/10"><Plus className="size-3.5" />Add clips</button>
              <input ref={more} type="file" multiple accept="video/*,.mov,.mp4,.m4v" className="hidden"
                onChange={(e) => { const fs = [...(e.target.files ?? [])].filter(isVideo); if (fs.length) void addMore(fs); e.target.value = ""; }} />
            </div>
            <ul className="panel divide-y overflow-hidden">
              {clips.map((c, n) => (
                <ClipRow key={c.path} video={id} c={c} n={n} single={clips.length === 1} takeNo={takes.indexOf(c) + 1}
                  canUp={c.kind === "take" && takes.indexOf(c) > 0} canDown={c.kind === "take" && takes.indexOf(c) < takes.length - 1} onChange={change} />
              ))}
              {inflight.map((u) => <UploadRow key={u.key} u={u} />)}
            </ul>
            <p className="px-1 caption">{clips.length + inflight.length > 1
              ? "Takes are joined in this order, then cut: the last good take of every line wins. B-roll goes into your Library, for this video and later ones."
              : "In parts, or with b-roll? Add those clips too: each is checked for you talking to the camera."}</p>
          </section>
        )}
        <div className="mt-6 space-y-1.5">
          <label className="flex items-center gap-1.5 headline"><Languages className="size-3.5 text-muted-foreground" />Language</label>
          {/* a phone: five equal segments in the small size, so "Hinglish" is never cut off at the edge */}
          <div className="md:hidden"><LangPicker value={lang} onChange={(v) => pickLang(v as LangChoice)} /></div>
          <div className="hidden md:block"><GlassSegmented label="Language" value={lang} onChange={(v) => pickLang(v as LangChoice)} options={[...LANG_OPTIONS]} /></div>
          <p className="caption">{lang === "auto" ? "Claude hears it: German, English, Hindi or Hinglish."
            : lang === "hinglish" ? "Hindi and English mixed. Captions in Roman letters: “aaj hum AI tools ki baat karenge”."
            : lang === "hi" ? "Captions in Devanagari, English words as you say them."
            : "Captions in your words, exactly as you say them."}</p>
        </div>
        <div className="mt-4 space-y-1.5">
          <label className="flex items-center gap-1.5 headline"><FileText className="size-3.5 text-muted-foreground" />Script <span className="caption font-normal">optional</span></label>
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5} placeholder="Paste the script: it helps Claude match each take to its line and spell names right."
            className="w-full resize-y rounded-[10px] bg-input p-2.5 leading-[18px] outline-none placeholder:text-faint-foreground focus:ring-2 focus:ring-primary/40" />
          {script.trim().length >= 20 && (
            <button onClick={async () => { const r = await api<{ id: string }>("/api/scripts", { json: { text: script } }); window.open(`/scripts/${encodeURIComponent(r.id)}`, "_blank"); }}
              className="flex items-center gap-1 text-[12px] text-primary hover:underline"><FileCheck2 className="size-3.5" />Check the facts first</button>
          )}
        </div>
        <div className="mt-4 space-y-1.5">
          <label className="flex items-center gap-1.5 headline"><Sparkles className="size-3.5 text-muted-foreground" />Anything Claude should know <span className="caption font-normal">optional</span></label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="For example: keep the second hook, the ending at 4:10 is the real one."
            className="w-full resize-y rounded-[10px] bg-input p-2.5 leading-[18px] outline-none placeholder:text-faint-foreground focus:ring-2 focus:ring-primary/40" />
        </div>
        {error && <p className="mt-3 text-destructive">{error}</p>}
        <div className="mt-6 flex items-center justify-end gap-3">
          {id && !ready && <span className="caption">{sending ? "Adding your clips…" : checking ? "Checking the clips…" : "Mark the clips of you talking as takes"}</span>}
          <button disabled={!ready || starting} onClick={start} className="flex h-8 items-center gap-1 rounded-lg bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">
            {starting ? <Loader2 className="size-4 animate-spin" /> : <>{takes.length > 1 ? `Join ${takes.length} takes and cut` : "Make the cut"} <ChevronRight className="size-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One dropped clip: its picture, what it is and why, its place among the takes, and the switch. */
function ClipRow({ video, c, n, single, takeNo, canUp, canDown, onChange }: {
  video: string; c: Clip; n: number; single: boolean; takeNo: number; canUp: boolean; canDown: boolean; onChange: (n: number, body: object) => void;
}) {
  const why = c.why ? c.why[0]!.toUpperCase() + c.why.slice(1) : "";
  const what = c.kind === "pending" ? "Checking…" : c.chosen ? (c.kind === "take" ? "A take: you said so" : "B-roll: you said so")
    : c.kind === "take" ? (c.why === "talking to the camera" ? "You, talking to the camera" : why) : `B-roll: ${c.why ?? ""}`;
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:flex-nowrap">
      <img src={`/api/videos/${encodeURIComponent(video)}/files/${n}/poster?f=${encodeURIComponent(c.name)}`} alt="" loading="lazy"
        className="h-10 w-16 shrink-0 rounded-[6px] bg-card-2 object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate">{c.kind === "take" && !single ? <span className="text-muted-foreground tabular">{takeNo}. </span> : null}{c.name}</p>
        <p className="truncate caption">{c.duration ? `${clock(c.duration)} · ` : ""}{what}</p>
      </div>
      {c.kind === "pending" ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : !single && (
        <div className="order-last flex w-full items-center justify-end gap-1 pl-[76px] sm:order-none sm:w-auto sm:pl-0">
          {c.kind === "take" && (canUp || canDown) && (
            <div className="flex shrink-0">
              <button aria-label="Earlier" disabled={!canUp} onClick={() => onChange(n, { move: -1 })} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
              <button aria-label="Later" disabled={!canDown} onClick={() => onChange(n, { move: 1 })} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
            </div>
          )}
          <div className="shrink-0"><GlassSegmented size="sm" label={`${c.name}: take or b-roll`} value={c.kind} onChange={(k) => onChange(n, { kind: k })} options={KINDS} /></div>
        </div>
      )}
      <button aria-label={`Remove ${c.name}`} onClick={() => onChange(n, { remove: true })} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8"><X className="size-3.5" /></button>
    </li>
  );
}

function UploadRow({ u }: { u: Upload }) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-3 py-2">
      <div className="grid h-10 w-16 shrink-0 place-items-center rounded-[6px] bg-card-2"><Film className="size-4 text-muted-foreground" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate">{u.name}</p>
        {u.state === "failed" ? <p className="caption text-destructive">{u.error ?? "the upload stopped"}</p> : (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(u.pct * 100)}%` }} /></div>
        )}
      </div>
    </li>
  );
}
