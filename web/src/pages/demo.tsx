import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/chat";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import { useMediaQuery } from "@/hooks/use-media-query";
import { api, useApi, useEvents } from "@/lib/api";
import { clock } from "@/lib/utils";
import { DEMO_STATUS, type Demo } from "@/pages/demos";
import type { PageProps } from "@/app";

/** One demo: the video (wide or vertical), what Claude is doing, and the chat to change it. */
export function DemoPage({ id, setTitle, chatOpen }: PageProps & { id: string; chatOpen: boolean }) {
  const { data: d, reload } = useApi<Demo & { chat: { id: string; status: string } | null }>(`/api/demos/${encodeURIComponent(id)}`, [id]);
  useEvents((t, x) => { if ((t === "demo" && x?.id === id) || t === "session") reload(); });
  const [view, setView] = useState<"wide" | "tall">("wide");
  const wide = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    if (!d) return;
    setTitle(
      <span className="flex items-center gap-2"><span className="truncate">{d.title}</span><span className="hidden caption font-normal sm:inline">{DEMO_STATUS[d.status].label}{d.seconds ? ` · ${clock(d.seconds)}` : ""}</span></span>,
      <div className="flex items-center gap-2">
        {d.media.wide && d.media.tall && <GlassSegmented value={view} onChange={(v) => setView(v as "wide" | "tall")} options={[{ value: "wide", label: "Wide" }, { value: "tall", label: "Vertical" }]} />}
        <button onClick={() => void api(`/api/demos/${encodeURIComponent(id)}/reveal`, { method: "POST" })} className="flex h-7 items-center gap-1.5 rounded-md px-2.5 hover:bg-foreground/8"><FolderOpen className="size-3.5" />Show in Finder</button>
      </div>,
    );
  }, [d, view, id, setTitle]);
  useEffect(() => { if (d && !d.media.wide && d.media.tall) setView("tall"); }, [d?.media.wide, d?.media.tall]);
  if (!d) return <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  const src = view === "tall" ? d.media.tall ?? d.media.wide : d.media.wide ?? d.media.tall;
  const sid = d.chat?.id ?? d.session ?? `d_${id}`;
  return (
    <div className="flex h-full">
      <section className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6">
        {src ? (
          <video key={src} src={src} controls playsInline className="max-h-full max-w-full rounded-[10px] bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]" />
        ) : (
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            {d.status === "failed" || d.status === "recorded" ? null : <Loader2 className="size-6 animate-spin text-primary" />}
            <p className="title-2">{DEMO_STATUS[d.status].label}</p>
            {d.status === "recorded" && (
              <button onClick={() => void api(`/api/demos/${encodeURIComponent(id)}/finish`, { method: "POST" }).then(reload).catch((e: Error) => alert(e.message))}
                className="h-8 rounded-full bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97]">Finish the video</button>
            )}
            <p className="label-2">{d.show}</p>
            {d.log.length > 0 && <pre className="max-w-full overflow-x-auto rounded-lg bg-foreground/6 p-2 text-left font-mono text-[11px] leading-[15px] text-muted-foreground">{d.log.join("\n")}</pre>}
          </div>
        )}
      </section>
      {chatOpen && wide && (
        <aside className="w-[340px] shrink-0 border-l bg-sidebar">
          <ChatPanel sid={sid} title={d.title} hint={<span>Ask for any change: “type slower”, “zoom less”, “show the answer longer”.</span>} />
        </aside>
      )}
    </div>
  );
}
