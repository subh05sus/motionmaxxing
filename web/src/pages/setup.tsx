import { CheckCircle2, CircleDashed, Loader2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { CheckDraw } from "@/components/ui/check-draw";
import { api, useApi, useEvents } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PageProps } from "@/app";

interface Row { name: string; ok: boolean; detail: string; fix: string | null }
const WHAT: Record<string, string> = {
  Claude: "Your Claude subscription: the studio's Claude runs on it, never an API key.",
  ffmpeg: "Cuts, joins and measures your video.",
  node: "Runs this studio and the renderer.",
  "whisper.cpp": "Writes down every word, on your Mac's graphics chip.",
  "python 3.10-3.13": "Runs the editing tools.",
  "engine venv": "The editing tools' own packages, exact versions.",
  "transcription model": "Whisper large-v3-turbo, 1.6 GB, downloaded once.",
};

/** First run: what the Mac has, what it still needs, and one button that installs the rest in the background. */
export function SetupPage({ setTitle, onDone }: PageProps & { onDone: () => void }) {
  const { data, reload } = useApi<{ rows: Row[]; installing: boolean }>("/api/setup");
  const [progress, setProgress] = useState<{ step: string; detail?: string; progress?: number } | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => { setTitle("Set up"); }, [setTitle]);
  useEffect(() => { if (data?.installing) setInstalling(true); }, [data?.installing]);
  useEvents((type, d) => {
    if (type !== "setup") return;
    if (d?.installing === false) { setInstalling(false); reload(); }
    api<typeof progress>("/api/setup/progress").then(setProgress).catch(() => undefined);
  });
  const rows = data?.rows ?? [];
  const ready = rows.length > 0 && rows.every((r) => r.ok);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[560px] px-6 py-12">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-[11px] bg-primary/15 text-primary"><Wrench className="size-5" /></div>
          <div>
            <h1 className="title-1">{ready ? "Your Mac is ready" : "Getting your Mac ready"}</h1>
            <p className="label-2">{ready ? "Everything the studio needs is installed." : "A few tools, once. You never need a terminal."}</p>
          </div>
        </div>
        <ul className="panel divide-y overflow-hidden">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 px-3 py-2.5">
              {r.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : installing ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <CircleDashed className="size-4 shrink-0 text-faint-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{r.name}</span><span className="caption truncate">{r.ok ? r.detail : "needed"}</span></div>
                <p className="caption">{WHAT[r.name] ?? ""}</p>
                {!r.ok && r.name === "Claude" && <p className="mt-1 text-[12px] text-warning">Sign in once: in Terminal, in the motionmaxxing folder, run <span className="font-mono">bin/mm login</span>, then come back here.</p>}
                {!r.ok && r.fix && r.name !== "Claude" && !r.fix.startsWith("brew install") && !r.fix.startsWith("python3") && <p className="mt-1 font-mono text-[11px] text-warning">{r.fix}</p>}
              </div>
            </li>
          ))}
          {!rows.length && <li className="flex items-center gap-2 p-4 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking your Mac…</li>}
        </ul>
        {installing && progress && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between caption"><span>{progress.step}</span><span>{progress.detail}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.round((progress.progress ?? 0.05) * 100)}%` }} /></div>
          </div>
        )}
        <div className="mt-6 flex items-center justify-end gap-2">
          {ready ? (
            <><CheckDraw checked size={22} /><button onClick={onDone} className="h-8 rounded-lg bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97]">Open the studio</button></>
          ) : (
            <>
              <button onClick={onDone} className="h-8 rounded-lg px-3 text-muted-foreground hover:bg-foreground/8">Later</button>
              <button disabled={installing} onClick={() => { setInstalling(true); void api("/api/setup/install", { method: "POST" }); }}
                className={cn("h-8 rounded-lg bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-60")}>
                {installing ? "Setting up…" : "Set up everything"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
