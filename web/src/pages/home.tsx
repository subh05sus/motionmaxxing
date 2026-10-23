import { ArrowRight, Loader2, Sparkles, Wand2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Prose } from "@/components/chat";
import { DropZone } from "@/components/drop-zone";
import { VideoCard, type VideoSummary } from "@/components/video-card";
import { useItemActions } from "@/lib/actions";
import { api, useApi, useEvents } from "@/lib/api";
import { SPRING_SNAPPY } from "@/lib/motion";
import { useProfiles } from "@/lib/profiles";
import { Link, navigate } from "@/lib/router";
import { toast } from "@/lib/toast";
import { uploadClips, useUploads } from "@/lib/uploads";
import type { PageProps } from "@/app";

const WEEK = 7 * 24 * 3600 * 1000;
const WAITING = new Set(["new", "ready", "editing"]);         // the next step is the user's: start, approve the cut, approve the edit
const RUNNING = new Set(["transcribing", "cutting", "making"]);

function Shelf({ title, count, more, children }: { title: string; count?: number; more?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="title-2">{title}{count ? <span className="ml-2 font-normal label-3 tabular">{count}</span> : null}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}

/** A new measure of the profile's own style, waiting to be used (the weekly re-measure). */
function StyleUpdate() {
  const q = useApi<{ handle: string; change: string } | null>("/api/style-update");
  const [busy, setBusy] = useState<"use" | "keep">();
  useEvents((t, d) => { if (t === "session" && d?.meta?.id === "remeasure") q.reload(); });
  if (!q.data) return null;
  const decide = async (use: boolean) => {
    setBusy(use ? "use" : "keep");
    try { await api("/api/style-update", { json: { use } }); toast(use ? "New videos use the new style. Videos in progress keep theirs." : "Kept the style you have"); q.reload(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(undefined); }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SNAPPY} className="panel mt-5 flex gap-3 p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary"><Wand2 className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="headline">The style was measured again from the newest reels</p>
        <div className="mt-1 text-muted-foreground">{q.data.change.trim() ? <Prose text={q.data.change} /> : <p>Use it for the next videos?</p>}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => void decide(true)} disabled={!!busy} className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-50">
            {busy === "use" && <Loader2 className="size-3.5 animate-spin" />}Use the new style</button>
          <button onClick={() => void decide(false)} disabled={!!busy} className="h-7 whitespace-nowrap rounded-md px-3 hover:bg-foreground/10 disabled:opacity-50">Keep this one</button>
        </div>
      </div>
    </motion.div>
  );
}

/** Home: the profile's desk. One obvious next step (drop a take), then what waits for them, what runs, what is ready,
 *  and how the week went. */
export function HomePage({ setTitle }: PageProps) {
  const { data, reload } = useApi<(VideoSummary & { approved?: { cut?: string; edit?: string } })[]>("/api/videos");
  const { current } = useProfiles();
  const [busy, setBusy] = useState(false);
  const pct = useUploads().find((u) => u.state === "uploading")?.pct ?? 0;
  const act = useItemActions("videos", reload);
  useEffect(() => { setTitle("Home"); }, [setTitle]);
  useEvents((t) => { if (t === "video") reload(); });
  // every clip dropped goes into one new video: the takes are joined, the b-roll is told apart on New video
  const add = async (fs: File[]) => {
    setBusy(true);
    try { const id = await uploadClips(fs); navigate(`/new?video=${encodeURIComponent(id)}`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const all = data ?? [];
  const working = (v: VideoSummary) => !!v.working || RUNNING.has(v.status);
  const waiting = all.filter((v) => !working(v) && WAITING.has(v.status));
  const running = all.filter(working);
  const ready = all.filter((v) => !working(v) && v.status === "approved").slice(0, 10);
  const now = Date.now(), recent = (iso?: string) => !!iso && now - Date.parse(iso) < WEEK;
  const week = { started: all.filter((v) => recent(v.createdAt)).length, cuts: all.filter((v) => recent(v.approved?.cut)).length, edits: all.filter((v) => recent(v.approved?.edit)).length };
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const grid = "grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-5";
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[920px] px-6 py-8">
        <h1 className="title-1">{current ? `${hello}, ${current.name}` : hello}</h1>
        <p className="mb-5 label-2">Drop your raw takes. You get a clean cut to approve, then the edit on top.</p>
        <DropZone onFiles={add} busy={busy} progress={pct} />
        <StyleUpdate />

        {waiting.length > 0 && (
          <Shelf title="Waiting for you" count={waiting.length}>
            <div className={grid}>{waiting.map((v, i) => <VideoCard key={v.id} v={v} index={i} actions={act} />)}</div>
          </Shelf>
        )}
        {running.length > 0 && (
          <Shelf title="In progress" count={running.length}>
            <div className={grid}>{running.map((v, i) => <VideoCard key={v.id} v={v} index={i} actions={act} />)}</div>
          </Shelf>
        )}
        {ready.length > 0 && (
          <Shelf title="Ready" more={<Link href="/videos" className="flex items-center gap-1 text-primary hover:underline">All videos <ArrowRight className="size-3.5" /></Link>}>
            <div className={grid}>{ready.map((v, i) => <VideoCard key={v.id} v={v} index={i} actions={act} />)}</div>
          </Shelf>
        )}
        {data && !all.length && (
          <div className="panel mt-8 flex items-center gap-3 p-4 text-muted-foreground"><Sparkles className="size-4 text-primary" />Your videos show up here once you add one.</div>
        )}
        {all.length > 0 && (
          <Shelf title="This week">
            <div className="grid grid-cols-3 gap-2">
              {[["Started", week.started], ["Cuts approved", week.cuts], ["Edits approved", week.edits]].map(([label, n]) => (
                <div key={label as string} className="panel px-4 py-3">
                  <p className="text-[22px] leading-[26px] font-semibold tabular">{n}</p>
                  <p className="caption">{label}</p>
                </div>
              ))}
            </div>
          </Shelf>
        )}
      </div>
      {act.dialogs}
    </div>
  );
}
