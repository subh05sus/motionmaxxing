import { Ellipsis, FolderOpen, Globe, Loader2, MonitorPlay, Pencil, Sparkles, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Menu } from "@/components/menu";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import { useItemActions } from "@/lib/actions";
import { api, useApi, useEvents } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { SPRING_SNAPPY, staggerDelay } from "@/lib/motion";
import { ago, clock, cn } from "@/lib/utils";
import type { PageProps } from "@/app";

export interface Demo {
  id: string; title: string; url: string; show: string; formats: string; createdAt: string; updatedAt: string;
  status: "planning" | "recording" | "recorded" | "finishing" | "ready" | "failed"; session?: string; seconds?: number; log: string[];
  media: { wide?: string; tall?: string; poster?: string };
}

export const DEMO_STATUS: Record<Demo["status"], { label: string; tone: string }> = {
  planning: { label: "Claude is planning it", tone: "text-primary" },
  recording: { label: "Recording", tone: "text-primary" },
  recorded: { label: "Recorded, not finished", tone: "text-warning" },
  finishing: { label: "Finishing the video", tone: "text-primary" },
  ready: { label: "Ready", tone: "text-success" },
  failed: { label: "A step failed", tone: "text-warning" },
};

const IDEAS = [
  { url: "claude.ai", show: "Ask Claude for a one-week meal plan in German, and show the answer arriving." },
  { url: "claude.ai", show: "Ask Claude to build a small to-do app as an artifact, and show it working." },
];

/** Demos: Claude drives a website in its own browser and finishes the recording (sped-up waits, a following camera). */
export function DemosPage({ setTitle }: PageProps) {
  const { data, reload } = useApi<Demo[]>("/api/demos");
  const [url, setUrl] = useState("");
  const [show, setShow] = useState("");
  const [formats, setFormats] = useState<"both" | "wide" | "tall">("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; d: Demo } | null>(null);
  const act = useItemActions("demos", reload);
  useEffect(() => { setTitle("Demos"); }, [setTitle]);
  useEvents((t) => { if (t === "demo") reload(); });
  const start = async () => {
    setBusy(true); setError(undefined);
    try { const r = await api<{ id: string }>("/api/demos", { json: { url, show, formats } }); navigate(`/demos/${encodeURIComponent(r.id)}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[920px] space-y-8 px-6 py-8">
        <section>
          <h1 className="title-1">Demos</h1>
          <p className="mb-4 label-2">Claude opens a site in its own browser, clicks and types like a person, and records it sharp. The waiting plays fast, the camera follows each click.</p>
          <div className="panel space-y-3 p-4">
            <div className="flex items-center gap-2 rounded-[10px] bg-input px-2.5">
              <Globe className="size-4 text-faint-foreground" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="claude.ai, or any website" className="h-9 flex-1 bg-transparent outline-none placeholder:text-faint-foreground" />
            </div>
            <textarea value={show} onChange={(e) => setShow(e.target.value)} rows={3} placeholder="What should it show? For example: ask Claude for a meal plan and show the answer arriving."
              className="w-full resize-y rounded-[10px] bg-input p-2.5 leading-[18px] outline-none placeholder:text-faint-foreground focus:ring-2 focus:ring-primary/40" />
            <div className="flex flex-wrap items-center gap-3">
              <GlassSegmented value={formats} onChange={(v) => setFormats(v as typeof formats)} options={[{ value: "both", label: "Wide and vertical" }, { value: "wide", label: "Wide" }, { value: "tall", label: "Vertical" }]} />
              <div className="flex-1" />
              {error && <span className="text-destructive">{error}</span>}
              <button disabled={!url.trim() || !show.trim() || busy} onClick={start} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <><MonitorPlay className="size-4" />Record it</>}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((i) => (
                <button key={i.show} onClick={() => { setUrl(i.url); setShow(i.show); }} className="rounded-full bg-foreground/6 px-2.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
                  <Sparkles className="mr-1 inline size-3 text-primary" />{i.show}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 caption">The first time on a site, Claude asks you once. Sites that need an account: sign in once from Settings, in the recording browser. Your own Chrome is never used.</p>
        </section>
        <section>
          <h2 className="mb-2 title-2">Recorded</h2>
          {data?.length ? (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {data.map((d, i) => (
                <motion.div key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SNAPPY, delay: staggerDelay(i) }}
                  className="group/card relative" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, d }); }}>
                  <button aria-label="More" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, d }); }}
                    className="absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover/card:opacity-100 pointer-coarse:opacity-100"><Ellipsis className="size-4" /></button>
                  <Link href={`/demos/${encodeURIComponent(d.id)}`} className="block rounded-[12px] p-1.5 transition-transform hover:bg-foreground/5 active:scale-[0.985]">
                    <div className="relative aspect-video overflow-hidden rounded-[9px] bg-card-2">
                      {d.media.poster ? <img src={d.media.poster} alt="" loading="lazy" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-faint-foreground"><MonitorPlay className="size-6" /></div>}
                      {d.seconds ? <span className="absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white tabular">{clock(d.seconds)}</span> : null}
                    </div>
                    <div className="px-0.5 pt-1.5">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className={cn("flex items-center gap-1 caption", DEMO_STATUS[d.status].tone)}>
                        {d.status !== "ready" && d.status !== "failed" && <Loader2 className="size-3 animate-spin" />}
                        {DEMO_STATUS[d.status].label}<span className="label-3"> · {ago(d.updatedAt)}</span>
                      </p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : <p className="text-muted-foreground">{data ? "No demos yet." : "Loading…"}</p>}
        </section>
        <Menu at={menu} onClose={() => setMenu(null)} items={menu ? [
          { label: "Rename…", icon: <Pencil className="size-3.5" />, run: () => act.rename(menu.d.id, menu.d.title) },
          { label: "Show in Finder", icon: <FolderOpen className="size-3.5" />, run: () => void api(`/api/demos/${encodeURIComponent(menu.d.id)}/reveal`, { method: "POST" }) },
          { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, run: () => act.del([menu.d.id], menu.d.title) },
        ] : []} />
        {act.dialogs}
      </div>
    </div>
  );
}
