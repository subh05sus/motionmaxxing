import { Clapperboard, Ellipsis, FileCheck2, Film, FolderOpen, HardDrive, Loader2, MonitorPlay, Pencil, Play, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Confirm } from "@/components/confirm";
import { Menu } from "@/components/menu";
import { useItemActions } from "@/lib/actions";
import { api, useApi, useEvents } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Link } from "@/lib/router";
import { droppedVideos, isVideo, sendFile } from "@/lib/uploads";
import { ago, clock } from "@/lib/utils";
import type { PageProps } from "@/app";

interface Deleted { key: string; kind: "video" | "demo" | "script" | "broll"; id: string; title: string; at: string }
const KIND = { video: Film, demo: MonitorPlay, script: FileCheck2, broll: Clapperboard } as const;

interface Broll { file: string; title: string; added: string; from?: { id: string; title: string }; duration?: number; bytes: number; url: string; poster: string }

/** The library's b-roll: the clips New video recognised as b-roll and the ones added here. Every edit can use them
 *  (Claude looks through them for lines they show); renamed, a clip is easier for Claude to pick too. */
function BrollSection() {
  const { data, reload } = useApi<Broll[]>("/api/broll");
  useEvents((t) => { if (t === "broll") reload(); });
  const act = useItemActions("broll", reload);
  const [playing, setPlaying] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; b: Broll } | null>(null);
  const [adding, setAdding] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const add = async (fs: File[]) => {
    setAdding(fs.length);
    for (const f of fs) {
      try { await sendFile("/api/broll", f, () => {}); } catch (e) { toast(`${f.name}: ${(e as Error).message}`); }
      setAdding((n) => n - 1);
    }
    reload();
  };
  const items = menu ? [
    { label: "Rename…", icon: <Pencil className="size-3.5" />, run: () => act.rename(menu.b.file, menu.b.title) },
    { label: "Show in Finder", icon: <FolderOpen className="size-3.5" />, run: () => void api("/api/reveal", { json: { broll: menu.b.file } }) },
    { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, run: () => act.del([menu.b.file], menu.b.title) },
  ] : [];
  return (
    <section onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void droppedVideos(e.dataTransfer).then((fs) => { if (fs.length) void add(fs); }); }}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="title-2">B-roll {data?.length ? <span className="caption font-normal">{data.length} clip{data.length > 1 ? "s" : ""}</span> : null}</h2>
        <button disabled={adding > 0} onClick={() => input.current?.click()} className="flex items-center gap-1 text-primary hover:underline disabled:opacity-50">
          {adding > 0 ? <><Loader2 className="size-3.5 animate-spin" />Adding {adding}…</> : <><Plus className="size-3.5" />Add b-roll</>}
        </button>
        <input ref={input} type="file" multiple accept="video/*,.mov,.mp4,.m4v" className="hidden"
          onChange={(e) => { const fs = [...(e.target.files ?? [])].filter(isVideo); if (fs.length) void add(fs); e.target.value = ""; }} />
      </div>
      {data?.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.map((b) => (
            <div key={b.file} className="overflow-hidden rounded-[10px] bg-card-2" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, b }); }}>
              {playing === b.file ? (
                <video src={b.url} autoPlay controls playsInline onEnded={() => setPlaying(null)} className="aspect-video w-full bg-black object-contain" />
              ) : (
                <button aria-label={`Play ${b.title}`} onClick={() => setPlaying(b.file)} className="group relative block w-full">
                  <img src={b.poster} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"><span className="grid size-9 place-items-center rounded-full bg-black/45 text-white"><Play className="size-4" /></span></span>
                </button>
              )}
              <div className="flex items-center gap-1 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{b.title}</p>
                  <p className="truncate caption">{[b.duration ? clock(b.duration) : "", b.from ? `with “${b.from.title}”` : "", ago(b.added)].filter(Boolean).join(" · ")}</p>
                </div>
                <button aria-label="More" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right - 208, y: r.bottom + 4, b }); }}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8"><Ellipsis className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel flex items-center gap-3 p-4 text-muted-foreground"><Clapperboard className="size-4 shrink-0 text-primary" />B-roll dropped with a new video lands here, or add some: every edit can use it.</div>
      )}
      <Menu at={menu} items={items} onClose={() => setMenu(null)} />
      {act.dialogs}
    </section>
  );
}

/** Recently deleted: restore as it was, or hand to the Mac's Trash (Finder can still put it back). */
function RecentlyDeleted() {
  const { data, reload } = useApi<Deleted[]>("/api/trash");
  const [asking, setAsking] = useState(false);
  useEvents((t) => { if (t === "video" || t === "demo" || t === "script" || t === "broll") reload(); });
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
        <BrollSection />
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
