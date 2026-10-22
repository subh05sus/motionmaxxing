import { FileCheck2, Film, FolderOpen, HardDrive, Loader2, MonitorPlay, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Confirm } from "@/components/confirm";
import { api, useApi, useEvents } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Link } from "@/lib/router";
import { ago } from "@/lib/utils";
import type { PageProps } from "@/app";

interface Deleted { key: string; kind: "video" | "demo" | "script"; id: string; title: string; at: string }
const KIND = { video: Film, demo: MonitorPlay, script: FileCheck2 } as const;

/** Recently deleted: restore as it was, or hand to the Mac's Trash (Finder can still put it back). */
function RecentlyDeleted() {
  const { data, reload } = useApi<Deleted[]>("/api/trash");
  const [asking, setAsking] = useState(false);
  useEvents((t) => { if (t === "video" || t === "demo" || t === "script") reload(); });
  if (!data?.length) return null;
  const restore = async (d: Deleted) => {
    try { await api(`/api/trash/${encodeURIComponent(d.key)}/restore`, { method: "POST" }); toast(`Restored “${d.title}”`); reload(); }
    catch (e) { toast((e as Error).message); }
  };
  const purge = async (keys: string[]) => {
    for (const k of keys) { try { await api(`/api/trash/${encodeURIComponent(k)}/purge`, { method: "POST" }); } catch (e) { toast((e as Error).message); } }
    reload();
  };
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="title-2">Recently deleted</h2>
        <button onClick={() => setAsking(true)} className="text-destructive hover:underline">Move all to the Trash</button>
      </div>
      <ul className="panel divide-y overflow-hidden">
        {data.map((d) => {
          const Icon = KIND[d.kind];
          return (
            <li key={d.key} className="row min-h-10 gap-3 px-3">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="caption">{ago(d.at)}</span>
              <button onClick={() => void restore(d)} className="flex h-7 items-center gap-1 rounded-md px-2.5 text-primary hover:bg-primary/10"><RotateCcw className="size-3.5" />Restore</button>
              <button title="Move to the Trash" onClick={() => void purge([d.key])} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 px-1 caption">Moved to the Trash, a file can still be put back from the Finder until the Trash is emptied.</p>
      <Confirm open={asking} title="Move all to the Trash?" action="Move to Trash" onCancel={() => setAsking(false)}
        body={<>{data.length} item(s) leave the studio for the Mac's Trash.</>}
        onConfirm={() => { setAsking(false); void purge(data.map((d) => d.key)); }} />
    </section>
  );
}

const size = (b: number) => (b <= 0 ? "None" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** The library: where the videos live on this Mac, what they take up, and a safe way to free space. */
export function LibraryPage({ setTitle }: PageProps) {
  const { data, reload } = useApi<{ path: string; disk: { library: number; working: number; free: number }; edits: { id: string; title: string; bytes: number }[] }>("/api/library");
  const [ask, setAsk] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [done, setDone] = useState<string>();
  useEffect(() => { setTitle("Library", <button onClick={() => void api("/api/reveal", { json: {} })} className="flex h-7 items-center gap-1.5 rounded-md px-2.5 hover:bg-foreground/8"><FolderOpen className="size-3.5" />Show in Finder</button>); }, [setTitle]);
  const max = Math.max(1, ...(data?.edits ?? []).map((e) => e.bytes));
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[720px] space-y-6 px-6 py-8">
        <div>
          <h1 className="title-1">Library</h1>
          <p className="label-2">Everything stays on this Mac, in <span className="font-mono text-[12px]">{data?.path.replace(/^\/Users\/[^/]+/, "~") ?? "…"}</span>. Nothing is uploaded.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([["Library", data?.disk.library], ["Rebuildable", data?.disk.working], ["Free on this Mac", data?.disk.free]] as const).map(([k, v]) => (
            <div key={k} className="panel p-3"><p className="caption">{k}</p><p className="title-2 tabular">{v == null ? "–" : size(v)}</p></div>
          ))}
        </div>
        <div className="panel flex items-center gap-3 p-3">
          <HardDrive className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1"><p className="font-medium">Free up space</p><p className="caption">{done ?? "Deletes only files a step rebuilds by itself: render pieces and old review copies. Your takes, cuts and edits stay."}</p></div>
          <button disabled={!data?.disk.working || cleaning} onClick={() => setAsk(true)} className="h-7 rounded-md bg-foreground/10 px-3 font-medium hover:bg-foreground/15 active:scale-[0.97] disabled:opacity-40">
            {cleaning ? <Loader2 className="size-3.5 animate-spin" /> : data?.disk.working ? `Free ${size(data.disk.working)}` : "Nothing to free"}
          </button>
        </div>
        <RecentlyDeleted />
        <section>
          <h2 className="mb-2 title-2">Videos by size</h2>
          <ul className="panel divide-y overflow-hidden">
            {(data?.edits ?? []).map((e) => (
              <li key={e.id} className="row min-h-9 gap-3 px-3">
                <Link href={`/videos/${encodeURIComponent(e.id)}`} className="min-w-0 flex-1 truncate hover:underline">{e.title}</Link>
                <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-foreground/8 sm:block"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(e.bytes / max) * 100}%` }} /></div>
                <span className="w-16 text-right caption tabular">{size(e.bytes)}</span>
                <button title="Show in Finder" onClick={() => void api("/api/reveal", { json: { id: e.id } })} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8"><FolderOpen className="size-3.5" /></button>
              </li>
            ))}
            {data && !data.edits.length && <li className="flex items-center gap-2 p-4 text-muted-foreground"><Sparkles className="size-4 text-primary" />No videos yet.</li>}
          </ul>
        </section>
      </div>
      <Confirm open={ask} title="Free up space?" action="Delete" onCancel={() => setAsk(false)}
        body={<>This deletes {data ? size(data.disk.working) : ""} of render pieces and old review copies. They are rebuilt when needed; your videos are not touched.</>}
        onConfirm={async () => {
          setAsk(false); setCleaning(true);
          try { const r = await api<{ files: number; bytes: number }>("/api/library/clean", { method: "POST" }); setDone(`Freed ${size(r.bytes)} (${r.files} files).`); reload(); }
          catch (e) { setDone((e as Error).message); } finally { setCleaning(false); }
        }} />
    </div>
  );
}
