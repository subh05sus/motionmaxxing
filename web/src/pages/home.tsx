import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DropZone } from "@/components/drop-zone";
import { VideoCard, type VideoSummary } from "@/components/video-card";
import { useItemActions } from "@/lib/actions";
import { useApi, useEvents } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { toast } from "@/lib/toast";
import { uploadClips, useUploads } from "@/lib/uploads";
import type { PageProps } from "@/app";

/** Home: one obvious next step (drop a take) and what is in progress. */
export function HomePage({ setTitle }: PageProps) {
  const { data, reload } = useApi<VideoSummary[]>("/api/videos");
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
  const recent = (data ?? []).slice(0, 8);
  const hour = new Date().getHours();
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[920px] px-6 py-8">
        <h1 className="title-1">{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}</h1>
        <p className="mb-5 label-2">Drop your raw takes. You get a clean cut to approve, then the edit on top.</p>
        <DropZone onFiles={add} busy={busy} progress={pct} />
        <div className="mt-8 mb-2 flex items-baseline justify-between">
          <h2 className="title-2">Recent</h2>
          {recent.length > 0 && <Link href="/videos" className="flex items-center gap-1 text-primary hover:underline">All videos <ArrowRight className="size-3.5" /></Link>}
        </div>
        {recent.length ? (
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-5">{recent.map((v, i) => <VideoCard key={v.id} v={v} index={i} actions={act} />)}</div>
        ) : (
          <div className="panel flex items-center gap-3 p-4 text-muted-foreground"><Sparkles className="size-4 text-primary" />Your videos show up here once you add one.</div>
        )}
      </div>
      {act.dialogs}
    </div>
  );
}
