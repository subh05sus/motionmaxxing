import { Film, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "@/lib/router";
import { SPRING_SNAPPY, staggerDelay } from "@/lib/motion";
import { ago, clock, cn } from "@/lib/utils";

export interface VideoSummary {
  id: string; title: string; createdAt: string; updatedAt: string; stage: "cut" | "edit" | "done"; status: string; lang?: string;
  seconds: { source?: number; cut?: number }; media: { source?: string; cut?: string; render?: string; poster?: string };
  progress?: { step: string; detail?: string; progress?: number; t: number; done?: boolean; failed?: string }; session?: string;
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Waiting to start", tone: "text-muted-foreground" },
  transcribing: { label: "Listening", tone: "text-primary" },
  cutting: { label: "Cutting", tone: "text-primary" },
  ready: { label: "Cut ready", tone: "text-success" },
  editing: { label: "Edit ready", tone: "text-success" },
  approved: { label: "Approved", tone: "text-muted-foreground" },
};

export function VideoCard({ v, index = 0 }: { v: VideoSummary; index?: number }) {
  const st = STATUS[v.status] ?? STATUS.new!;
  const working = v.status === "transcribing" || v.status === "cutting";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SNAPPY, delay: staggerDelay(index) }}>
      <Link href={`/videos/${encodeURIComponent(v.id)}`} className="group block rounded-[12px] p-1.5 hover:bg-foreground/5 active:scale-[0.985] transition-transform">
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
