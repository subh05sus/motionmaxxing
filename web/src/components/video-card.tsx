import { Check, Ellipsis, Film, FolderOpen, Loader2, Pencil, Play, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Menu } from "@/components/menu";
import { api } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { SPRING_SNAPPY, staggerDelay } from "@/lib/motion";
import { ago, clock, cn } from "@/lib/utils";

export interface VideoSummary {
  id: string; title: string; createdAt: string; updatedAt: string; stage: "cut" | "edit" | "done"; status: string; lang?: string;
  /** What runs on it now, whatever its stage (a render after approval too): the server sees the process. */
  working?: { step: string; detail?: string; progress?: number } | null;
  seconds: { source?: number; cut?: number }; media: { source?: string; cut?: string; render?: string; poster?: string };
  progress?: { step: string; detail?: string; progress?: number; t: number; done?: boolean; failed?: string }; session?: string;
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Waiting to start", tone: "text-muted-foreground" },
  transcribing: { label: "Listening", tone: "text-primary" },
  cutting: { label: "Cutting", tone: "text-primary" },
  ready: { label: "Cut ready", tone: "text-success" },
  making: { label: "Making the edit", tone: "text-primary" },
  editing: { label: "Edit ready", tone: "text-success" },
  approved: { label: "Approved", tone: "text-muted-foreground" },
};

export interface CardActions { rename: (id: string, title: string) => void; del: (ids: string[], title: string) => void }

export function VideoCard({ v, index = 0, actions, selecting, selected, onSelect }: { v: VideoSummary; index?: number; actions?: CardActions;
  selecting?: boolean; selected?: boolean; onSelect?: (on: boolean) => void }) {
  const st = STATUS[v.status] ?? STATUS.new!;
  const working = !!v.working || v.status === "transcribing" || v.status === "cutting" || v.status === "making";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const href = `/videos/${encodeURIComponent(v.id)}`;
  const items = actions ? [
    { label: "Open", icon: <Play className="size-3.5" />, run: () => navigate(href) },
    { label: "Rename…", icon: <Pencil className="size-3.5" />, run: () => actions.rename(v.id, v.title) },
    { label: "Show in Finder", icon: <FolderOpen className="size-3.5" />, run: () => void api("/api/reveal", { json: { id: v.id } }) },
    { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, run: () => actions.del([v.id], v.title) },
  ] : [];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SNAPPY, delay: staggerDelay(index) }}
      onContextMenu={(e) => { if (!actions) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }} className="group/card relative">
      <Menu at={menu} items={items} onClose={() => setMenu(null)} />
      {actions && !selecting && (
        <button aria-label="More" onClick={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
          className="absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
          <Ellipsis className="size-4" />
        </button>
      )}
      {selecting && (
        <button aria-label={selected ? "Deselect" : "Select"} onClick={() => onSelect?.(!selected)}
          className={cn("absolute top-3 left-3 z-10 grid size-6 place-items-center rounded-full border-2 border-white shadow", selected ? "bg-primary" : "bg-black/30")}>
          {selected && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </button>
      )}
      <Link href={href} onClick={(e) => { if (selecting) { e.preventDefault(); onSelect?.(!selected); } }}
        className={cn("group block rounded-[12px] p-1.5 hover:bg-foreground/5 active:scale-[0.985] transition-transform", selected && "bg-primary/12 ring-2 ring-primary")}>
        <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[9px] bg-card-2">
          {v.media.poster ? <img src={v.media.poster} alt="" loading="lazy" className="size-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : null}
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-faint-foreground"><Film className="size-6 opacity-0 group-[&:not(:has(img))]:opacity-100" /></div>
          {(v.seconds.cut ?? v.seconds.source) && (
            <span className="absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white tabular">{clock(v.seconds.cut ?? v.seconds.source)}</span>
          )}
        </div>
        <div className="px-0.5 pt-1.5">
          <p className="truncate font-medium">{v.title}</p>
          <p className={cn("flex items-center gap-1 caption", st.tone)}>
            {working && <Loader2 className="size-3 animate-spin" />}
            {working && v.progress?.step ? v.progress.step : st.label}
            <span className="label-3"> · {ago(v.updatedAt)}</span>
          </p>
        </div>
      </Link>
    </motion.div>
  );
}
