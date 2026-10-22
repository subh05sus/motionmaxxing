import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatPanel, Prose } from "@/components/chat";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useApi, useEvents } from "@/lib/api";
import { factLine, type ScriptSummary } from "@/pages/scripts";
import type { PageProps } from "@/app";

/** One script: the fact-check (facts.md) or the script as pasted, and Claude beside it. */
export function ScriptPage({ id, setTitle, chatOpen }: PageProps & { id: string; chatOpen: boolean }) {
  const { data: d, reload } = useApi<ScriptSummary & { script: string; facts: string | null; chat: { id: string; status: string } | null }>(`/api/scripts/${encodeURIComponent(id)}`, [id]);
  useEvents((t, x) => { if ((t === "script" && x?.id === id) || t === "session") reload(); });
  const [tab, setTab] = useState<"facts" | "script">("facts");
  const wide = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    if (!d) return;
    setTitle(<span className="flex items-center gap-2"><span className="truncate">{d.title}</span><span className="hidden caption font-normal sm:inline">{d.status === "done" ? factLine(d.counts) : "Checking"}</span></span>,
      <GlassSegmented value={tab} onChange={(v) => setTab(v as "facts" | "script")} options={[{ value: "facts", label: "Fact-check" }, { value: "script", label: "Script" }]} />);
  }, [d, tab, setTitle]);
  if (!d) return <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  return (
    <div className="flex h-full">
      <section className="min-w-0 flex-1 overflow-y-auto pb-24 md:pb-0">
        <div className="mx-auto max-w-[820px] px-6 py-8">
          {tab === "script" ? <pre className="whitespace-pre-wrap font-sans text-[14px] leading-[22px]">{d.script}</pre>
            : d.facts ? <Prose text={d.facts} />
              : <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground"><Loader2 className="size-6 animate-spin text-primary" /><p className="title-2 text-foreground">Checking every claim</p><p>Claude splits the script into claims and checks them against sources found now. This page fills in by itself.</p></div>}
        </div>
      </section>
      {chatOpen && wide && (
        <aside className="w-[340px] shrink-0 border-l bg-sidebar">
          <ChatPanel sid={d.chat?.id ?? d.session ?? `s_${id}`} title={d.title} hint={<span>Ask about any claim: “is C4 really free?”, “find a newer source”.</span>} />
        </aside>
      )}
    </div>
  );
}
