import { ChevronRight, FileCheck2, FileText, Film, Languages, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DropZone } from "@/components/drop-zone";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import type { VideoSummary } from "@/components/video-card";
import { api, upload } from "@/lib/api";
import { LANG_OPTIONS, type LangChoice } from "@/lib/langs";
import { navigate, useRoute } from "@/lib/router";
import { clock } from "@/lib/utils";
import type { PageProps } from "@/app";

/** New video: the raw take, an optional script, a note for Claude, and one button. */
export function NewVideoPage({ setTitle }: PageProps) {
  const route = useRoute();
  const [id, setId] = useState<string | null>(route.query.get("video"));
  const [video, setVideo] = useState<VideoSummary>();
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [script, setScript] = useState("");
  const [notes, setNotes] = useState("");
  // the last language picked comes back: a creator mostly records in one
  const [lang, setLang] = useState<LangChoice>(() => {
    try { const v = localStorage.getItem("mm.lang"); return LANG_OPTIONS.some((o) => o.value === v) ? (v as LangChoice) : "auto"; } catch { return "auto"; }
  });
  const pickLang = (v: LangChoice) => { setLang(v); try { localStorage.setItem("mm.lang", v); } catch { /* private window */ } };
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { setTitle("New video"); }, [setTitle]);
  useEffect(() => { if (id) api<VideoSummary>(`/api/videos/${encodeURIComponent(id)}`).then(setVideo).catch(() => setVideo(undefined)); }, [id]);
  const add = async (f: File) => {
    setBusy(true); setError(undefined);
    try { const r = await upload(f, setPct); setId(r.id); navigate(`/new?video=${encodeURIComponent(r.id)}`, true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!id) return;
    setStarting(true); setError(undefined);
    try { await api(`/api/videos/${encodeURIComponent(id)}/start`, { json: { script, instructions: notes, lang } }); navigate(`/videos/${encodeURIComponent(id)}`); }
    catch (e) { setError((e as Error).message); setStarting(false); }
  };
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[640px] px-6 py-8">
        <h1 className="title-1">New video</h1>
        <p className="mb-5 label-2">Claude cuts the take first: the last good take of every line, no fillers, no dead air. You approve the cut, then the edit goes on top.</p>
        {!id ? <DropZone onFile={add} busy={busy} progress={pct} /> : (
          <div className="panel flex items-center gap-3 p-3">
            <div className="h-16 w-9 shrink-0 overflow-hidden rounded-[6px] bg-card-2">{video?.media.poster && <img src={video.media.poster} alt="" className="size-full object-cover" />}</div>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{video?.title ?? "Your video"}</p><p className="caption"><Film className="mr-1 inline size-3" />Ready to cut{video?.seconds.source ? ` · ${clock(video.seconds.source)}` : ""}</p></div>
            <button onClick={() => { setId(null); navigate("/new", true); }} className="h-7 rounded-md px-2.5 text-muted-foreground hover:bg-foreground/8">Change</button>
          </div>
        )}
        <div className="mt-6 space-y-1.5">
          <label className="flex items-center gap-1.5 headline"><Languages className="size-3.5 text-muted-foreground" />Language</label>
          {/* a phone: five equal segments in the small size, so "Hinglish" is never cut off at the edge */}
          <div className="md:hidden"><GlassSegmented equal size="sm" label="Language" value={lang} onChange={(v) => pickLang(v as LangChoice)} options={[...LANG_OPTIONS]} /></div>
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
        <div className="mt-6 flex justify-end">
          <button disabled={!id || starting} onClick={start} className="flex h-8 items-center gap-1 rounded-lg bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">
            {starting ? <Loader2 className="size-4 animate-spin" /> : <>Make the cut <ChevronRight className="size-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
