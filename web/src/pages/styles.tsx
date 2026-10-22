import { Brain, Layers, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { Prose } from "@/components/chat";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SPRING_SNAPPY, staggerDelay } from "@/lib/motion";
import { motion } from "motion/react";
import type { PageProps } from "@/app";

interface Style { handle: string; name: string; about?: string; format?: string; aspect?: string; sample: boolean; layout?: string; cover?: string; motion?: { kinds?: Record<string, boolean> }; captions?: { present?: boolean } }

const LAYOUT: Record<string, string> = { split: "Half the screen", board: "Full screen canvas", cards: "Cards over you", pip: "Small box", behind: "Behind you", full: "Full screen" };

/** A small drawing of where the visuals sit in the frame, for a style without a cover image. */
function LayoutGlyph({ mode, aspect, captions }: { mode?: string; aspect?: string; captions?: boolean }) {
  const wide = aspect === "16:9";
  const face = <div className="absolute bottom-0 left-1/2 h-[46%] w-[46%] -translate-x-1/2 rounded-t-full bg-foreground/25" />;
  const visual = "rounded-[3px] bg-primary/55";
  return (
    <div className={cn("relative overflow-hidden rounded-[6px] border border-foreground/15 bg-foreground/[0.06]", wide ? "h-[54px] w-[96px]" : "h-[96px] w-[54px]")}>
      {mode === "split" ? (<><div className={cn("absolute inset-x-0 top-0 h-1/2 rounded-none", visual)} />{face}</>)
        : mode === "board" ? (<><div className="absolute inset-0 bg-black/60" /><div className={cn("absolute top-[22%] left-[18%] h-[40%] w-[30%]", visual)} /><div className={cn("absolute top-[30%] right-[16%] h-[34%] w-[26%] opacity-70", visual)} /></>)
          : (<>{face}<div className={cn("absolute top-[16%] left-[14%] h-[26%] w-[72%]", visual)} /></>)}
      {captions && <div className="absolute bottom-[14%] left-1/2 h-[5%] w-[34%] -translate-x-1/2 rounded-full bg-white/85" />}
    </div>
  );
}

/** Styles: the looks an edit can copy (the samples and every creator studied), and the taste learned from the user. */
export function StylesPage({ setTitle }: PageProps) {
  const { data } = useApi<{ styles: Style[]; taste: { text: string; settings: Record<string, unknown> } }>("/api/styles");
  useEffect(() => { setTitle("Styles"); }, [setTitle]);
  // The learned rules, without the file's title and without the sections nothing was learned for yet.
  const taste = (data?.taste.text ?? "").replace(/^# .*\n+/, "").split(/\n(?=## )/)
    .filter((sec) => !sec.startsWith("## ") || /\n\s*[-*]\s/.test(sec)).join("\n").trim();
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[920px] space-y-8 px-6 py-8">
        <section>
          <h1 className="title-1">Styles</h1>
          <p className="mb-4 label-2">How an edit looks: where the motion goes, how the captions read, how often it zooms. Claude picks one per video, or ask for one in the chat.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.styles ?? []).map((s, i) => (
              <motion.article key={s.handle} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SNAPPY, delay: staggerDelay(i) }} className="panel overflow-hidden">
                <div className="grid aspect-[16/9] place-items-center bg-card-2">
                  {s.cover ? <img src={s.cover} alt="" className="size-full object-cover" /> : <LayoutGlyph mode={s.layout} aspect={s.aspect} captions={s.captions?.present} />}
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="headline">{s.name}</h2>
                    {s.sample && <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[10px] text-muted-foreground">Sample</span>}
                  </div>
                  {s.format && <p className="caption">{s.format}</p>}
                  {s.about && <p className="line-clamp-4 text-[12px] leading-[16px] text-muted-foreground">{s.about}</p>}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="flex items-center gap-1 rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary"><Layers className="size-3" />{LAYOUT[s.layout ?? "cards"] ?? s.layout}</span>
                    {s.aspect && <span className="rounded-md bg-foreground/8 px-1.5 py-0.5 text-[11px] text-muted-foreground">{s.aspect}</span>}
                    {Object.entries(s.motion?.kinds ?? {}).filter(([, on]) => on).slice(0, 4).map(([k]) => <span key={k} className="rounded-md bg-foreground/8 px-1.5 py-0.5 text-[11px] text-muted-foreground">{k.replace(/_/g, " ")}</span>)}
                  </div>
                </div>
              </motion.article>
            ))}
            {!data && <p className="text-muted-foreground">Loading…</p>}
          </div>
        </section>
        <section>
          <h2 className="mb-1 flex items-center gap-2 title-2"><Brain className="size-4 text-primary" />Your taste</h2>
          <p className="mb-3 label-2">What motionmaxxing learned from your own edits and your notes. Every cut and edit reads it first. Change it by telling Claude.</p>
          <div className="panel p-4">
            {taste ? <Prose text={taste} /> : <p className="flex items-center gap-2 text-muted-foreground"><Sparkles className="size-4" />Nothing learned yet. Give Claude a raw take and your finished edit of it, and it measures how you cut.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
