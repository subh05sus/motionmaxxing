import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { VideoCard, type VideoSummary } from "@/components/video-card";
import { useApi, useEvents } from "@/lib/api";
import { Link } from "@/lib/router";
import type { PageProps } from "@/app";

export function VideosPage({ setTitle }: PageProps) {
  const { data, reload } = useApi<VideoSummary[]>("/api/videos");
  const [q, setQ] = useState("");
  useEffect(() => { setTitle("Videos", <Link href="/new" className="flex h-7 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]">New video</Link>); }, [setTitle]);
  useEvents((t) => { if (t === "video") reload(); });
  const list = (data ?? []).filter((v) => v.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <div className="mb-4 flex h-7 w-64 items-center gap-2 rounded-md bg-input px-2">
          <Search className="size-3.5 text-faint-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="flex-1 bg-transparent outline-none placeholder:text-faint-foreground" />
        </div>
        {list.length ? (
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">{list.map((v, i) => <VideoCard key={v.id} v={v} index={i} />)}</div>
        ) : <p className="p-8 text-center text-muted-foreground">{data ? (q ? "Nothing matches." : "No videos yet. Add one from Home or New video.") : "Loading…"}</p>}
      </div>
    </div>
  );
}
