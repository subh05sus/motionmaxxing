import { Ellipsis, FileCheck2, Loader2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Menu } from "@/components/menu";
import { useItemActions } from "@/lib/actions";
import { api, useApi, useEvents } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { ago, cn } from "@/lib/utils";
import type { PageProps } from "@/app";

export interface ScriptSummary { id: string; title: string; createdAt: string; updatedAt: string; status: "starting" | "checking" | "done"; counts: Record<string, number> | null; session?: string }

export function factLine(c: Record<string, number> | null): string {
  if (!c) return "";
  const bad = (c.falsch ?? 0) + (c.veraltet ?? 0) + (c.ungenau ?? 0);
  return `${c.total} claims · ${bad ? `${bad} to change` : "nothing to change"}${c["ungeprüft"] ? ` · ${c["ungeprüft"]} unchecked` : ""}`;
}

/** Scripts: paste one before recording; Claude checks every claim against sources found now. */
export function ScriptsPage({ setTitle }: PageProps) {
  const { data, reload } = useApi<ScriptSummary[]>("/api/scripts");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; s: ScriptSummary } | null>(null);
  const act = useItemActions("scripts", reload);
  useEffect(() => { setTitle("Scripts"); }, [setTitle]);
  useEvents((t) => { if (t === "script") reload(); });
  const check = async () => {
    setBusy(true); setError(undefined);
    try { const r = await api<{ id: string }>("/api/scripts", { json: { text } }); navigate(`/scripts/${encodeURIComponent(r.id)}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[760px] space-y-8 px-6 py-8">
        <section>
          <h1 className="title-1">Scripts</h1>
          <p className="mb-4 label-2">Paste a script before you record. Claude checks every number, name and step against sources found today, and suggests a fix in your words for anything wrong or outdated.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste the script…"
            className="w-full resize-y rounded-[10px] bg-input p-3 leading-[19px] outline-none placeholder:text-faint-foreground focus:ring-2 focus:ring-primary/40" />
          <div className="mt-2 flex items-center justify-end gap-3">
            {error && <span className="text-destructive">{error}</span>}
            <button disabled={text.trim().length < 20 || busy} onClick={check} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <><FileCheck2 className="size-4" />Check the facts</>}
            </button>
          </div>
        </section>
        <section>
          <h2 className="mb-2 title-2">Checked</h2>
          <ul className="panel divide-y overflow-hidden">
            {(data ?? []).map((s) => (
              <li key={s.id}>
                <Link href={`/scripts/${encodeURIComponent(s.id)}`} className="row min-h-11 gap-3 px-3 hover:bg-foreground/5">
                  <FileCheck2 className={cn("size-4 shrink-0", s.status === "done" ? "text-success" : "text-primary")} />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="caption">{s.status === "done" ? factLine(s.counts) : <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" />Checking</span>}</span>
                  <span className="w-20 text-right caption">{ago(s.updatedAt)}</span>
                  <button aria-label="More" onClick={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right - 208, y: r.bottom + 4, s }); }}
                    className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8"><Ellipsis className="size-4" /></button>
                </Link>
              </li>
            ))}
            {data && !data.length && <li className="p-4 text-center text-muted-foreground">No scripts checked yet.</li>}
          </ul>
        </section>
      </div>
      <Menu at={menu} onClose={() => setMenu(null)} items={menu ? [
        { label: "Rename…", icon: <Pencil className="size-3.5" />, run: () => act.rename(menu.s.id, menu.s.title) },
        { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, run: () => act.del([menu.s.id], menu.s.title) },
      ] : []} />
      {act.dialogs}
    </div>
  );
}
