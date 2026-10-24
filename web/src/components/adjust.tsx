import { Check, ChevronDown, Copy, Loader2, Sparkles, Volume2, Wand2 } from "lucide-react";
import { ColourSection, VolumeKeys } from "@/components/colour-tools";
import type { Colour, Key } from "@shared/colour";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, type MenuItem } from "@/components/menu";
import { Switch } from "@/components/ui/switch";
import { api, useApi, useEvents } from "@/lib/api";
import { useProfiles } from "@/lib/profiles";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** adjust.json, as the server's adjust API gives it (edit/scripts/audio.py and adjust.py read it). */
export interface AudioSettings { on?: boolean; echo?: boolean; breaths?: boolean; duck?: boolean; match?: boolean; ref?: { profile?: string; edit?: string } }
export interface LookSettings {
  on?: boolean; strength?: number; ref?: { profile?: string; edit?: string }; face_light?: number; background?: number;
  face_light_set?: boolean; background_set?: boolean; wb?: number[]; measured?: { ref_edit?: string };
}
export interface Adjust { audio?: AudioSettings; look?: LookSettings; colour?: Partial<Colour>; keyframes?: Key[]; volume?: { t: number; db: number }[] }
export interface AdjustInfo {
  adjust: Adjust; original: string | null; hasEdit: boolean; face: boolean; refs: { profile: string; name: string }[];
  sound: { clean?: boolean; lufs?: number; tp?: number; orig_lufs?: number; noise_removal?: string } | null;
}

/** A video's adjust settings, saved a moment after the last change (a slider sends one save, not a hundred). */
export function useAdjust(id: string) {
  const q = useApi<AdjustInfo>(`/api/videos/${encodeURIComponent(id)}/adjust`, [id]);
  useEvents((t, d) => { if (t === "video" && d?.id === id) q.reload(); });
  const [local, setLocal] = useState<Adjust | null>(null);
  const timer = useRef<number>(undefined);
  const pending = useRef<Adjust>({});
  useEffect(() => { if (q.data && !timer.current) setLocal(q.data.adjust); }, [q.data]);
  const save = useCallback((patch: Adjust, now = false) => {
    setLocal((cur) => {
      const next = { ...(cur ?? {}) } as Adjust & Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) next[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...((next[k] as object) ?? {}), ...v } : v;
      return next;
    });
    for (const [k, v] of Object.entries(patch)) {
      const p = pending.current as Record<string, unknown>;
      p[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...((p[k] as object) ?? {}), ...v } : v;
    }
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current; pending.current = {}; timer.current = undefined;
      try { await api(`/api/videos/${encodeURIComponent(id)}/adjust`, { json: body }); } catch (e) { toast((e as Error).message); }
      q.reload();
    }, now ? 0 : 450);
  }, [id, q]);
  return { info: q.data, adjust: local ?? q.data?.adjust ?? {}, save, reload: q.reload };
}

function Section({ title, icon, children, footer, right }: { title: string; icon: ReactNode; children: ReactNode; footer?: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="flex-1 headline">{title}</h3>
        {right}
      </div>
      <div className="panel divide-y overflow-hidden">{children}</div>
      {footer && <p className="px-1 caption">{footer}</p>}
    </section>
  );
}

function Toggle({ label, sub, on, onChange, disabled }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn("flex min-h-10 items-center gap-3 px-3 py-1.5", disabled && "opacity-50")}>
      <div className="min-w-0 flex-1"><p>{label}</p>{sub && <p className="caption">{sub}</p>}</div>
      <Switch checked={on} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** A labelled slider with its value; double-click puts it back to `reset`. */
export function Slider({ label, value, min, max, step = 0.01, onChange, format, reset, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; reset?: number; disabled?: boolean;
}) {
  return (
    <label className={cn("block px-3 py-2", disabled && "pointer-events-none opacity-50")} onDoubleClick={() => reset !== undefined && onChange(reset)}>
      <span className="flex items-baseline justify-between"><span>{label}</span><span className="caption tabular">{format ? format(value) : value.toFixed(2)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1 w-full cursor-pointer accent-primary" />
    </label>
  );
}

/** The Adjust tab: the video's sound, look and colour. Changes save by themselves; the edit is made again a few
 *  seconds after the last one, and the player shows the look and colour live on the cut (look-preview.tsx). */
export function AdjustPanel({ id, status, state, now, compare, onCompare, children }: {
  id: string; status?: { step?: string; done?: boolean; failed?: string } | null; state: ReturnType<typeof useAdjust>; now: number;
  compare: boolean; onCompare: (on: boolean) => void; children?: ReactNode;
}) {
  const { info, adjust, save } = state;
  const { current, list } = useProfiles();
  const mine = useApi<{ settings: { looks?: { name: string; colour: Partial<Colour> }[] } }>(current ? `/api/profiles/${encodeURIComponent(current.id)}/settings` : null, [current?.id]);
  const saveLook = async (name: string) => {
    if (!current) return toast("Add a profile to save looks");
    const looks = [...(mine.data?.settings.looks ?? []).filter((x) => x.name !== name), { name, colour: { ...(adjust.colour ?? {}), preset: undefined } }];
    await api(`/api/profiles/${encodeURIComponent(current.id)}/settings`, { json: { looks } });
    mine.reload(); save({ colour: { ...(adjust.colour ?? {}), preset: name } }, true);
    toast(`“${name}” is in ${current.name}'s looks`);
  };
  const a = adjust.audio ?? {}, lk = adjust.look ?? {};
  const [copyAt, setCopyAt] = useState<{ x: number; y: number } | null>(null);
  const videos = useApi<{ id: string; title: string }[]>("/api/videos");
  if (!info) return <div className="grid h-full place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  const refName = (r?: { profile?: string }) => (r?.profile ? `${list.find((p) => p.id === r.profile)?.name ?? r.profile}'s reels` : "none");
  const copy = async (to: string[] | "default") => {
    try {
      await api(`/api/videos/${encodeURIComponent(id)}/adjust/copy`, { json: { to } });
      toast(to === "default" ? `New ${current ? `${current.name} ` : ""}videos start with these settings` : `Copied to ${to.length} video${to.length === 1 ? "" : "s"}`);
    } catch (e) { toast((e as Error).message); }
  };
  const copyItems: MenuItem[] = [
    { label: current ? `Make default for ${current.name}` : "Make the default", icon: <Check className="size-3.5" />, run: () => void copy("default") },
    { label: "Copy to every other video", icon: <Copy className="size-3.5" />, run: () => void copy((videos.data ?? []).map((x) => x.id).filter((x) => x !== id)) },
    ...(videos.data ?? []).filter((x) => x.id !== id).slice(0, 12).map((x) => ({ label: `To “${x.title.length > 22 ? `${x.title.slice(0, 21)}…` : x.title}”`, icon: <Copy className="size-3.5" />, run: () => void copy([x.id]) })),
  ];
  const working = status && !status.done && !status.failed && /sound|making the video|render/i.test(status.step ?? "");
  return (
    <div className="h-full space-y-5 overflow-y-auto p-3">
      {working && <p className="flex items-center gap-1.5 caption text-primary"><Loader2 className="size-3 animate-spin" />{status?.step}</p>}

      <Section title="Sound" icon={<Volume2 className="size-3.5" />}
        footer={info.sound?.clean ? `Studio sound: ${info.sound.lufs?.toFixed(1)} LUFS${info.sound.orig_lufs != null ? ` (was ${info.sound.orig_lufs.toFixed(1)})` : ""}, peak ${info.sound.tp?.toFixed(1)} dBTP${info.sound.noise_removal === "afftdn" ? " · FFmpeg noise removal (install DeepFilterNet in Setup for the AI one)" : ""}. The player's A/B switch plays the original.`
          : "Noise removed on your Mac (DeepFilterNet), a voice EQ, de-essing, gentle compression, and loudness to -14 LUFS like the platforms play it."}>
        <Toggle label="Studio sound" sub="Clean, clear, the right level" on={!!a.on} onChange={(v) => save({ audio: { on: v } }, true)} />
        <Toggle label="Room echo reduction" sub="A drier, closer voice" on={!!a.echo} disabled={!a.on} onChange={(v) => save({ audio: { echo: v } }, true)} />
        <Toggle label="Breaths and mouth clicks" sub="Softened between words" on={!!a.breaths} disabled={!a.on} onChange={(v) => save({ audio: { breaths: v } }, true)} />
        <Toggle label="Music dips under your voice" on={a.duck !== false} onChange={(v) => save({ audio: { duck: v } }, true)} />
        <VolumeKeys keys={adjust.volume ?? []} onKeys={(k) => save({ volume: k })} now={now} />
        <div className={cn("flex min-h-10 items-center gap-3 px-3 py-1.5", !a.on && "opacity-50")}>
          <div className="min-w-0 flex-1"><p>Match a creator's sound</p>
            {a.match && <select value={a.ref?.profile ?? ""} onChange={(e) => save({ audio: { ref: { profile: e.target.value } } }, true)} className="mt-1 h-6 rounded-md bg-input px-1 text-[12px]">
              <option value="">Pick a profile</option>{info.refs.map((r) => <option key={r.profile} value={r.profile}>{r.name}'s reels</option>)}</select>}
          </div>
          <Switch checked={!!a.match} disabled={!a.on} onCheckedChange={(v) => save({ audio: { match: v, ...(v && !a.ref ? { ref: { profile: info.refs.find((r) => r.profile !== current?.id)?.profile ?? info.refs[0]?.profile } } : {}) } }, true)} />
        </div>
      </Section>

      <Section title="Look" icon={<Wand2 className="size-3.5" />}
        footer={lk.on ? (!lk.ref?.profile ? "A soft light that follows your face and the room a touch darker. Pick a reference to match its light too."
          : info.face ? `Your light matched to ${refName(lk.ref)}, a soft light that follows your face, the room a touch darker.` : "Matched when the edit is made (it needs the face tracking the edit makes).")
          : "Your face lit and the light matched to a reference, e.g. another profile's reels."}>
        <Toggle label="Lit-face look" sub={lk.on && lk.ref?.profile ? `Reference: ${refName(lk.ref)}` : undefined} on={!!lk.on}
          onChange={(v) => save({ look: { on: v, ...(v && !lk.ref ? { ref: { profile: info.refs.find((r) => r.profile !== current?.id)?.profile ?? current?.id } } : {}) } }, true)} />
        {lk.on && (<>
          <div className="flex min-h-10 items-center gap-3 px-3 py-1.5">
            <span className="flex-1">Reference</span>
            <select value={lk.ref?.profile ?? ""} onChange={(e) => save({ look: { ref: { profile: e.target.value } } }, true)} className="h-7 rounded-md bg-input px-1.5">
              {info.refs.map((r) => <option key={r.profile} value={r.profile}>{r.name}'s reels</option>)}
            </select>
          </div>
          <Slider label="Strength" value={lk.strength ?? 1} min={0} max={1.5} reset={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => save({ look: { strength: v } })} />
          <Slider label="Face light" value={lk.face_light ?? 0.6} min={0} max={1.2} reset={0.6} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => save({ look: { face_light: v, face_light_set: true } })} />
          <Slider label="Darker background" value={lk.background ?? 0.08} min={0} max={0.25} step={0.005} reset={0.08} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => save({ look: { background: v, background_set: true } })} />
        </>)}
      </Section>

      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 caption">{info.hasEdit ? "Showing the cut while you adjust, live; the edit is made again with it." : "Live on the cut."}</span>
        <button onClick={() => onCompare(!compare)} className={cn("h-6 rounded-full px-2.5 text-[11px]", compare ? "bg-primary text-primary-foreground" : "bg-foreground/8 hover:bg-foreground/12")}>Before | after</button>
      </div>
      <ColourSection colour={adjust.colour} onChange={(c) => save({ colour: c })} keys={adjust.keyframes ?? []} onKeys={(k) => save({ keyframes: k })}
        now={now} looks={mine.data?.settings.looks ?? []} onSaveLook={(n) => void saveLook(n)} />
      {children}

      <div className="flex items-center gap-2 px-1">
        <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCopyAt({ x: r.left, y: r.bottom + 4 }); }}
          className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-primary hover:bg-primary/10"><Copy className="size-3.5" />Copy settings<ChevronDown className="size-3" /></button>
        <span className="flex-1" />
        {info.hasEdit ? <span className="flex items-center gap-1 text-right caption"><Sparkles className="size-3 shrink-0" />Re-made after a change</span> : <span className="caption">Shown live on the cut</span>}
      </div>
      <Menu at={copyAt} items={copyItems} onClose={() => setCopyAt(null)} />
    </div>
  );
}
