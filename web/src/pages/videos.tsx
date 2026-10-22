import { Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { VideoCard, type VideoSummary } from "@/components/video-card";
import { useItemActions } from "@/lib/actions";
import { useApi, useEvents } from "@/lib/api";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { PageProps } from "@/app";

export function VideosPage({ setTitle }: PageProps) {
  const { data, reload } = useApi<VideoSummary[]>("/api/videos");
  const [q, setQ] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const act = useItemActions("videos", () => { reload(); setPicked(new Set()); setSelecting(false); });
  useEvents((t) => { if (t === "video") reload(); });
  const list = (data ?? []).filter((v) => v.title.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => {
    setTitle("Videos", (
      <div className="flex items-center gap-2">
        {selecting ? (
          <>
            <span className="caption">{picked.size} selected</span>
            <button onClick={() => setPicked(new Set(list.map((v) => v.id)))} className="h-7 rounded-md px-2.5 hover:bg-foreground/8">Select all</button>
            <button disabled={!picked.size} onClick={() => act.del([...picked], (data ?? []).find((v) => picked.has(v.id))?.title ?? "")}
              className="flex h-7 items-center gap-1.5 rounded-md bg-destructive px-3 font-medium text-white active:scale-[0.97] disabled:opacity-40"><Trash2 className="size-3.5" />Delete</button>
            <button onClick={() => { setSelecting(false); setPicked(new Set()); }} className="h-7 rounded-md px-2.5 hover:bg-foreground/8">Done</button>
          </>
        ) : (
          <>
            {(data?.length ?? 0) > 0 && <button onClick={() => setSelecting(true)} className="h-7 rounded-md px-2.5 hover:bg-foreground/8">Select</button>}
            <Link href="/new" className="flex h-7 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]">New video</Link>
          </>
        )}
      </div>
    ));
  }, [setTitle, selecting, picked, list.length, data, act.del]);
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <div className="mb-4 flex h-7 w-64 items-center gap-2 rounded-md bg-input px-2">
          <Search className="size-3.5 text-faint-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="flex-1 bg-transparent outline-none placeholder:text-faint-foreground" />
        </div>
        {list.length ? (
          <div className={cn("grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6")}>
            {list.map((v, i) => (
              <VideoCard key={v.id} v={v} index={i} actions={act} selecting={selecting} selected={picked.has(v.id)}
                onSelect={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(v.id); else n.delete(v.id); return n; })} />
            ))}
          </div>
        ) : <p className="p-8 text-center text-muted-foreground">{data ? (q ? "Nothing matches." : "No videos yet. Add one from Home or New video.") : "Loading…"}</p>}
      </div>
      {act.dialogs}
    </div>
  );
}
