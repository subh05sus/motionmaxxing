import { Check, FolderOpen, ImagePlus, Loader2, Plus, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar, LangPicker } from "@/components/profiles";
import { api, useApi, useEvents } from "@/lib/api";
import { PLATFORMS, cleanHandle, useProfiles, type ProfileCard, type ProfileSettings } from "@/lib/profiles";
import { toast } from "@/lib/toast";
import { sendFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import type { PageProps } from "@/app";

type Detail = ProfileCard & { settings: ProfileSettings; folder: string; ownStyle: string | null; measuring: boolean };

function Group({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 caption uppercase tracking-wide">{title}</h2>
      <div className="panel divide-y overflow-hidden">{children}</div>
      {footer && <p className="mt-1.5 px-1 caption">{footer}</p>}
    </section>
  );
}
const field = "h-7 w-full rounded-md bg-input px-2 outline-none focus:ring-2 focus:ring-primary/40";

/** "Claude (claude.com)" per line, as the names and terms are written in the box. */
const namesText = (n: ProfileSettings["names"]) => (n ?? []).map((x) => (typeof x === "string" ? x : x.domain ? `${x.name} (${x.domain})` : x.name)).join("\n");
/** The brand kit as saved: colours, a font, a logo, or the style's own look when there is none of them. */
const brandOf = (colors: string[], font: string, logo?: string) => (colors.length || font.trim() || logo
  ? { colors, ...(font.trim() ? { font: font.trim() } : {}), ...(logo ? { logo } : {}) } : { use_creator: true as const });
const namesList = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => { const m = /^(.*?)\s*\(([^()]+)\)$/.exec(l); return m ? { name: m[1]!.trim(), domain: m[2]!.trim() } : { name: l }; });

/** A profile's own settings: who it is, the language it records in, its accounts (its style is measured from them),
 *  its brand kit, its names and terms, where approved videos go. */
export function ProfilePage({ setTitle }: PageProps) {
  const { current } = useProfiles();
  const q = useApi<Detail>(current ? `/api/profiles/${encodeURIComponent(current.id)}/settings` : null, [current?.id]);
  useEvents((t, d) => { if (t === "session" && (d?.meta?.id === "measure" || d?.meta?.id === "remeasure")) q.reload(); });
  const d = q.data;
  const [name, setName] = useState("");
  const [lang, setLang] = useState("auto");
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [colors, setColors] = useState<string[]>([]);
  const [font, setFont] = useState("");
  const [cta, setCta] = useState("");
  const [names, setNames] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [picBusy, setPicBusy] = useState(false);
  const load = (x: Detail) => {
    setName(x.name); setLang(x.settings.lang ?? "auto"); setHandles(x.settings.handles ?? {});
    setColors(x.settings.brand?.colors ?? []); setFont(x.settings.brand?.font ?? ""); setCta(x.settings.cta ?? "");
    setNames(namesText(x.settings.names)); setExportDir(x.settings.export_dir ?? "");
  };
  useEffect(() => { if (d) load(d); }, [d?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTitle(current ? `${current.name}’s profile` : "Profile"); }, [setTitle, current]);
  if (!current) return <div className="grid h-full place-items-center px-6 text-center text-muted-foreground">No profiles yet. Add one from the sidebar’s menu.</div>;
  if (!d) return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  const logo = d.settings.brand?.logo;
  // null clears a setting (the language back to Auto, no call to action)
  const next = {
    name: name.trim(), lang: lang === "auto" ? null : lang,
    handles: Object.fromEntries(Object.entries(handles).map(([k, v]) => [k, cleanHandle(v)]).filter(([, v]) => v)),
    brand: brandOf(colors, font, logo), cta: cta.trim() || null, names: namesList(names), export_dir: exportDir.trim() || null,
  };
  const before = { name: d.name, lang: d.settings.lang ?? null, handles: d.settings.handles ?? {},
    brand: brandOf(d.settings.brand?.colors ?? [], d.settings.brand?.font ?? "", logo), cta: d.settings.cta ?? null,
    names: namesList(namesText(d.settings.names)), export_dir: d.settings.export_dir ?? null };
  const dirty = JSON.stringify(next) !== JSON.stringify(before);
  const save = async () => {
    setBusy(true);
    try {
      const measure = JSON.stringify(next.handles) !== JSON.stringify(before.handles) && Object.keys(next.handles).length > 0;
      await api(`/api/profiles/${encodeURIComponent(d.id)}/settings`, { json: next });
      toast(measure ? "Saved. Measuring the style from the accounts now." : "Saved");
      q.reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (kind: "picture" | "logo", f: File | undefined) => {
    if (!f) return;
    setPicBusy(true);
    try { await sendFile(`/api/profiles/${encodeURIComponent(d.id)}/${kind}`, f, () => undefined); q.reload(); }
    catch (e) { toast((e as Error).message); } finally { setPicBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[560px] space-y-6 px-6 py-8">
        <div className="flex items-center gap-4">
          <label className="group relative cursor-pointer" title="Change the picture">
            <Avatar p={{ ...current, picture: d.picture }} size={64} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
              {picBusy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            </span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/heic" className="sr-only" onChange={(e) => void upload("picture", e.target.files?.[0])} />
          </label>
          <div className="min-w-0 flex-1">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Name"
              className="w-full rounded-md bg-transparent px-1 -mx-1 title-1 outline-none hover:bg-foreground/5 focus:bg-input focus:ring-2 focus:ring-primary/40" />
            <p className="truncate caption font-mono" title={d.folder}>{d.folder.replace(/^\/Users\/[^/]+/, "~")}</p>
          </div>
        </div>

        <Group title="Language" footer="New videos start in this language. Each video can still pick another.">
          <div className="px-3 py-2.5"><LangPicker value={lang} onChange={setLang} /></div>
        </Group>

        <Group title="Accounts and style" footer="The style is measured from the newest reels when an account is added, and again each week: a new measure waits on Home for you to use it.">
          {PLATFORMS.map((pl) => (
            <div key={pl.key} className="flex min-h-10 items-center gap-3 px-3 py-1.5">
              <span className="w-20 shrink-0">{pl.label}</span>
              <input value={handles[pl.key] ?? ""} onChange={(e) => setHandles({ ...handles, [pl.key]: e.target.value })} placeholder="@handle" spellCheck={false} autoComplete="off" className={field} />
            </div>
          ))}
          <div className="flex min-h-10 items-center gap-2 px-3 py-2">
            {d.measuring ? <><Loader2 className="size-3.5 animate-spin text-primary" /><span>Measuring the style from the newest reels…</span></>
              : d.ownStyle ? <><Check className="size-3.5 text-success" /><span>Own style: <span className="font-medium">{d.ownStyle}</span></span></>
                : <><Sparkles className="size-3.5 text-muted-foreground" /><span className="text-muted-foreground">Add an account to measure the style.</span></>}
          </div>
        </Group>

        <Group title="Brand kit" footer="Without colours or a font, every edit uses its style’s look.">
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
            {colors.map((c, i) => (
              <label key={i} className="relative size-7 cursor-pointer overflow-hidden rounded-md ring-1 ring-foreground/15" style={{ background: c }} title="Change (right-click to remove)"
                onContextMenu={(e) => { e.preventDefault(); setColors(colors.filter((_, j) => j !== i)); }}>
                <input type="color" value={c} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))} className="sr-only" />
              </label>
            ))}
            {colors.length < 4 && <button onClick={() => setColors([...colors, colors.length ? "#ffffff" : "#e5482c"])} title="Add a colour"
              className="grid size-7 place-items-center rounded-md border border-dashed border-foreground/25 text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>}
            <input value={font} onChange={(e) => setFont(e.target.value)} placeholder="Font (a Google Font)" className={cn(field, "min-w-[140px] flex-1")} />
          </div>
          <div className="flex min-h-10 items-center gap-3 px-3 py-2">
            <span className="flex-1">Logo{logo ? <span className="ml-2 caption font-mono">{logo.split("/").pop()}</span> : null}</span>
            {logo && <img src={`/api/profiles/${encodeURIComponent(d.id)}/logo?v=${encodeURIComponent(logo)}`} alt="" className="h-6 max-w-[80px] object-contain" />}
            <label className="h-6 cursor-pointer rounded-md px-2 leading-6 text-primary hover:bg-primary/10">{logo ? "Change" : "Add"}
              <input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void upload("logo", e.target.files?.[0])} />
            </label>
          </div>
          <div className="px-3 py-2.5">
            <p className="mb-1 caption">The usual call to action</p>
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Follow for more AI tools" className={field} />
          </div>
        </Group>

        <Group title="Names and terms" footer="Spelled this way in the captions, and their logos found from the website: one per line, like Claude (claude.com).">
          <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={4} placeholder={"Claude (claude.com)\nCursor (cursor.com)"}
            className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12px] leading-[18px] outline-none" />
        </Group>

        <Group title="Exports" footer="An approved edit lands here: the video, its captions (SRT), the Final Cut, Premiere and Resolve files and the editor handoff.">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <input value={exportDir} onChange={(e) => setExportDir(e.target.value)} placeholder={`${d.folder.replace(/^\/Users\/[^/]+/, "~")}/Exports`} spellCheck={false} className={cn(field, "font-mono text-[12px]")} />
            <button onClick={() => void api("/api/reveal", { json: { exports: true } }).catch((e: Error) => toast(e.message))} title="Show in Finder"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"><FolderOpen className="size-4" /></button>
          </div>
        </Group>

        <div className="sticky bottom-24 flex justify-end md:bottom-4">
          <button onClick={() => void save()} disabled={!dirty || busy || !name.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 font-medium text-primary-foreground shadow-lg active:scale-[0.97] disabled:opacity-0 transition-opacity">
            {busy && <Loader2 className="size-3.5 animate-spin" />}Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
