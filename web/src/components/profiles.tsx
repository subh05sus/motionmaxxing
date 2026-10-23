import { AnimatePresence, motion } from "motion/react";
import { ChevronsUpDown, ImagePlus, Loader2, Plus, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Menu, type MenuItem } from "@/components/menu";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import { api } from "@/lib/api";
import { LANG_OPTIONS } from "@/lib/langs";
import { SPRING_SNAPPY, staggerDelay } from "@/lib/motion";
import { PLATFORMS, cleanHandle, switchProfile, useProfiles, type ProfileCard } from "@/lib/profiles";
import { navigate } from "@/lib/router";
import { sendFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/** The language a profile records in: the segmented control, or a pop-up menu where five do not fit (a phone). */
export function LangPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Language" className="h-8 w-full rounded-md bg-input px-2 outline-none focus:ring-2 focus:ring-primary/45 sm:hidden">
        {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{"ariaLabel" in o && o.value !== "auto" ? `${o.label} (${o.ariaLabel})` : o.label}</option>)}
      </select>
      <div className="hidden sm:block"><GlassSegmented equal size="sm" label="Language" value={value} onChange={(v) => onChange(v as string)} options={[...LANG_OPTIONS]} /></div>
    </>
  );
}

/** A profile's picture, or its first letter on its colour. */
export function Avatar({ p, size = 28, className }: { p: Pick<ProfileCard, "name" | "color" | "picture"> | null; size?: number; className?: string }) {
  const box = { width: size, height: size };
  if (p?.picture) return <img src={p.picture} alt="" style={box} className={cn("shrink-0 rounded-full object-cover", className)} />;
  return (
    <span style={{ ...box, background: p?.color ?? "var(--primary)", fontSize: Math.round(size * 0.42) }}
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white select-none", className)}>
      {(p?.name ?? "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "Who's editing?": the profiles to pick from, the first time this browser opens a library with two or more. */
export function WhoIsEditing({ profiles }: { profiles: ProfileCard[] }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string>();
  const pick = (id: string) => { setBusy(id); void switchProfile(id, window.location.pathname + window.location.search); };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-background px-4 py-10">
      <div className="w-full max-w-[720px] text-center">
        <img src="/icon.png" alt="" className="mx-auto mb-5 size-10" />
        <h1 className="text-[26px] leading-[32px] font-bold tracking-[-0.01em]">Who’s editing?</h1>
        <p className="mt-1 label-2">Each profile has its own videos, styles, scripts and chats. Switch any time in the sidebar.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-7">
          {profiles.map((p, i) => (
            <motion.button key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SNAPPY, delay: staggerDelay(i) }}
              whileTap={{ scale: 0.95 }} onClick={() => pick(p.id)} disabled={!!busy}
              className="group flex w-[112px] flex-col items-center gap-2.5 rounded-2xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="relative">
                <Avatar p={p} size={96} className="ring-2 ring-transparent ring-offset-4 ring-offset-background transition-shadow group-hover:ring-foreground/70" />
                {busy === p.id && <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40"><Loader2 className="size-5 animate-spin text-white" /></span>}
              </span>
              <span className="max-w-full truncate text-[15px] text-muted-foreground transition-colors group-hover:text-foreground">{p.name}</span>
            </motion.button>
          ))}
          <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SNAPPY, delay: staggerDelay(profiles.length) }}
            whileTap={{ scale: 0.95 }} onClick={() => setAdding(true)}
            className="group flex w-[112px] flex-col items-center gap-2.5 rounded-2xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="grid size-24 place-items-center rounded-full border-2 border-dashed border-foreground/20 text-muted-foreground transition-colors group-hover:border-foreground/45 group-hover:text-foreground"><Plus className="size-7" /></span>
            <span className="text-[15px] text-muted-foreground transition-colors group-hover:text-foreground">Add profile</span>
          </motion.button>
        </div>
      </div>
      <AddProfile open={adding} onClose={() => setAdding(false)} profiles={profiles} />
    </div>
  );
}

/** The sidebar's top: who this is, and a menu to switch, add a profile or open its settings. compact: the avatar only. */
export function ProfileSwitcher({ rail = false, compact = false }: { rail?: boolean; compact?: boolean }) {
  const { list, current } = useProfiles();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const items: MenuItem[] = [
    ...list.filter((p) => p.id !== current?.id).map((p) => ({ label: p.name, icon: <Avatar p={p} size={16} />, run: () => void switchProfile(p.id) })),
    { label: "Add a profile…", icon: <Plus className="size-3.5" />, run: () => setAdding(true) },
    { label: "Profile settings", icon: <UserRound className="size-3.5" />, run: () => navigate("/profile"), hidden: !current },
  ];
  const open = (e: MouseEvent) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: compact ? r.right - 208 : r.left + 6, y: r.bottom + 4 }); };
  return (
    <>
      {compact ? (
        <button onClick={open} aria-label={current ? `${current.name}: switch profile` : "Profiles"} className="grid size-7 place-items-center rounded-full active:scale-[0.92]">
          {current ? <Avatar p={current} size={26} /> : <UserRound className="size-4 text-muted-foreground" />}
        </button>
      ) : (
        <button onClick={open} title={rail ? current?.name ?? "Profiles" : undefined} aria-label={current ? `${current.name}: switch profile` : "Profiles"}
          className={cn("flex h-[52px] w-full items-center gap-2 px-3.5 text-left transition-colors hover:bg-foreground/5 active:bg-foreground/8", rail && "justify-center px-0")}>
          {current ? <Avatar p={current} size={28} /> : <img src="/icon.png" alt="" className="-mx-0.5 size-7 shrink-0" />}
          {!rail && <span className="min-w-0 flex-1 truncate headline">{current?.name ?? "motionmaxxing"}</span>}
          {!rail && <ChevronsUpDown className="size-3.5 shrink-0 text-faint-foreground" />}
        </button>
      )}
      <Menu at={at} items={items} onClose={() => setAt(null)} />
      <AddProfile open={adding} onClose={() => setAdding(false)} profiles={list} />
    </>
  );
}

const field = "h-8 w-full rounded-md bg-input px-2 outline-none focus:ring-2 focus:ring-primary/45";

/** A new profile: a name and a picture, the creator's handles (their style is measured from them right away), the
 *  language they record in, a brand kit, or the settings of a profile there is. */
export function AddProfile({ open, onClose, profiles }: { open: boolean; onClose: () => void; profiles: ProfileCard[] }) {
  const [name, setName] = useState("");
  const [picture, setPicture] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [lang, setLang] = useState<string>("auto");
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [colors, setColors] = useState<string[]>([]);
  const [font, setFont] = useState("");
  const [cta, setCta] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setName(""); setPicture(null); setPreview(undefined); setLang("auto"); setHandles({}); setColors([]); setFont(""); setCta(""); setCopyFrom(""); setError(undefined);
    setTimeout(() => nameInput.current?.focus(), 40);
  }, [open]);
  useEffect(() => { if (!picture) return; const u = URL.createObjectURL(picture); setPreview(u); return () => URL.revokeObjectURL(u); }, [picture]);
  const first = profiles.length === 0;
  const save = async () => {
    setBusy(true); setError(undefined);
    try {
      const hs = Object.fromEntries(Object.entries(handles).map(([k, v]) => [k, cleanHandle(v)]).filter(([, v]) => v));
      const brand = colors.length || font.trim() ? { colors, ...(font.trim() ? { font: font.trim() } : {}) } : undefined;
      const made = await api<ProfileCard>("/api/profiles", { json: {
        name: name.trim(), lang: lang === "auto" ? undefined : lang, handles: Object.keys(hs).length ? hs : undefined,
        brand, cta: cta.trim() || undefined, copy_from: copyFrom || undefined } });
      if (picture) await sendFile(`/api/profiles/${encodeURIComponent(made.id)}/picture`, picture, () => undefined);
      await switchProfile(made.id, "/");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }} onMouseDown={() => !busy && onClose()}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
            transition={SPRING_SNAPPY} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Add a profile"
            className="surface-sheet w-full max-w-[460px] rounded-[16px] p-5">
            <h2 className="title-2">Add a profile</h2>
            <p className="mt-0.5 caption">{first ? "Everything already in the library becomes this profile’s." : "A creator of their own: their videos, styles, scripts and chats stay apart."}</p>

            <div className="mt-4 flex items-center gap-3">
              <label className="relative grid size-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-foreground/8 text-muted-foreground hover:bg-foreground/12" title="Add a picture">
                {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <ImagePlus className="size-5" />}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/heic" className="sr-only" onChange={(e) => setPicture(e.target.files?.[0] ?? null)} />
              </label>
              <div className="min-w-0 flex-1">
                <label className="caption" htmlFor="profile-name">Name</label>
                <input id="profile-name" ref={nameInput} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Their name"
                  onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) void save(); if (e.key === "Escape") onClose(); }} className={cn(field, "mt-0.5")} />
              </div>
            </div>

            <section className="mt-4">
              <p className="caption">Their accounts: their own style is measured from these in the background</p>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-3">
                {PLATFORMS.map((pl) => (
                  <input key={pl.key} value={handles[pl.key] ?? ""} onChange={(e) => setHandles({ ...handles, [pl.key]: e.target.value })}
                    placeholder={`${pl.label} @handle`} autoComplete="off" spellCheck={false} className={field} />
                ))}
              </div>
            </section>

            <section className="mt-4">
              <p className="mb-1 caption">The language they record in</p>
              <LangPicker value={lang} onChange={setLang} />
            </section>

            <section className="mt-4">
              <p className="caption">Brand kit (optional: without one, the style’s colours are used)</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {colors.map((c, i) => (
                  <label key={i} className="relative size-8 cursor-pointer overflow-hidden rounded-md ring-1 ring-foreground/15" style={{ background: c }} title="Change the colour (right-click to remove)"
                    onContextMenu={(e) => { e.preventDefault(); setColors(colors.filter((_, j) => j !== i)); }}>
                    <input type="color" value={c} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))} className="sr-only" />
                  </label>
                ))}
                {colors.length < 4 && (
                  <button type="button" onClick={() => setColors([...colors, colors.length ? "#ffffff" : "#e5482c"])} title="Add a brand colour"
                    className="grid size-8 place-items-center rounded-md border border-dashed border-foreground/25 text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>
                )}
                <input value={font} onChange={(e) => setFont(e.target.value)} placeholder="Font (a Google Font)" className={cn(field, "min-w-[140px] flex-1")} />
              </div>
              <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Their usual call to action, like “Follow for more AI tools”" className={cn(field, "mt-1.5")} />
            </section>

            {profiles.length > 0 && (
              <section className="mt-4">
                <label className="caption" htmlFor="copy-from">Start from another profile’s settings</label>
                <select id="copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={cn(field, "mt-0.5")}>
                  <option value="">No, start fresh</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}: language, brand kit, names and terms</option>)}
                </select>
              </section>
            )}

            {error && <p className="mt-3 caption text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} disabled={busy} className="h-8 rounded-md px-3 hover:bg-foreground/10">Cancel</button>
              <button onClick={() => void save()} disabled={!name.trim() || busy}
                className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">
                {busy && <Loader2 className="size-3.5 animate-spin" />}Add profile
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
