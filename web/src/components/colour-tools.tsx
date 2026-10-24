import { Palette, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Slider } from "@/components/adjust";
import { cn, clock } from "@/lib/utils";
import { NEUTRAL, PRESETS, colourOf, isNeutral, spline, type Colour, type Key, type Wheel } from "@shared/colour";

/** A colour wheel (Final Cut and Resolve's lift, gamma, gain): drag the puck toward a hue; its slider moves the light. */
function ColourWheel({ label, value, onChange }: { label: string; value: Wheel; onChange: (w: Wheel) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const set = (e: PointerEvent | React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    onChange({ ...value, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  };
  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={box} onDoubleClick={() => onChange({ ...value, x: 0, y: 0 })}
        onPointerDown={(e) => {
          set(e);
          const mv = (ev: PointerEvent) => set(ev), up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
          window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
        }}
        className="relative size-[76px] cursor-crosshair touch-none rounded-full ring-1 ring-foreground/15"
        style={{ background: "radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 70%), conic-gradient(from 90deg, #f33, #f3f, #33f, #3ff, #3f3, #ff3, #f33)" }}>
        <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/30 shadow"
          style={{ left: `${(value.x * 0.5 + 0.5) * 100}%`, top: `${(-value.y * 0.5 + 0.5) * 100}%` }} />
      </div>
      <span className="caption">{label}</span>
      <input type="range" min={-1} max={1} step={0.01} value={value.l} onChange={(e) => onChange({ ...value, l: Number(e.target.value) })}
        onDoubleClick={() => onChange({ ...value, l: 0 })} className="h-1 w-[76px] cursor-pointer accent-primary" aria-label={`${label} light`} />
    </div>
  );
}

const CH = [["master", "Luma", "#e5e5e5"], ["r", "Red", "#ff5c5c"], ["g", "Green", "#4cd964"], ["b", "Blue", "#5ac8fa"]] as const;

/** Curves: click to add a point, drag it, double-click it to take it away. */
function CurveEditor({ curves, onChange }: { curves: Colour["curves"]; onChange: (c: Colour["curves"]) => void }) {
  const [ch, setCh] = useState<"master" | "r" | "g" | "b">("master");
  const svg = useRef<SVGSVGElement>(null);
  const pts = curves[ch];
  const S = 160;
  const f = spline(pts);
  const path = Array.from({ length: 65 }, (_, i) => { const x = i / 64; return `${i ? "L" : "M"}${(x * S).toFixed(1)},${((1 - f(x)) * S).toFixed(1)}`; }).join(" ");
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const put = (next: [number, number][]) => onChange({ ...curves, [ch]: [...next].sort((a, b) => a[0] - b[0]) });
  const drag = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const ends = i === 0 || i === pts.length - 1;
    const mv = (ev: PointerEvent) => { const [x, y] = at(ev); const next = pts.map((p, j) => (j === i ? [ends ? p[0] : x, y] : p) as [number, number]); put(next); };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const color = CH.find((c) => c[0] === ch)![2];
  return (
    <div className="px-3 py-2.5">
      <div className="mb-2 flex gap-1">
        {CH.map(([k, label]) => <button key={k} onClick={() => setCh(k)} className={cn("h-6 rounded-md px-2 text-[11px]", ch === k ? "bg-foreground/12 text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
        <span className="flex-1" />
        <button title="Reset this curve" onClick={() => put([[0, 0], [1, 1]])} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8"><RotateCcw className="size-3" /></button>
      </div>
      <svg ref={svg} viewBox={`0 0 ${S} ${S}`} className="aspect-square w-full cursor-crosshair touch-none rounded-md bg-foreground/[0.05]"
        onPointerDown={(e) => { const [x, y] = at(e); if (pts.length < 12) put([...pts, [x, y]]); }}>
        {[0.25, 0.5, 0.75].map((g) => <g key={g} stroke="currentColor" className="text-foreground/10"><line x1={g * S} y1={0} x2={g * S} y2={S} /><line x1={0} y1={g * S} x2={S} y2={g * S} /></g>)}
        <line x1={0} y1={S} x2={S} y2={0} stroke="currentColor" className="text-foreground/15" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x * S} cy={(1 - y) * S} r={4.5} fill={color} stroke="#111" strokeWidth={1} className="cursor-grab"
            onPointerDown={drag(i)} onDoubleClick={(e) => { e.stopPropagation(); if (i > 0 && i < pts.length - 1) put(pts.filter((_, j) => j !== i)); }} />
        ))}
      </svg>
    </div>
  );
}

/** The colour by hand: one-click looks, the sliders, the wheels, the curves, and keyframes over time. */
export function ColourSection({ colour: c0, onChange, keys, onKeys, now, looks, onSaveLook }: {
  colour: Partial<Colour> | undefined; onChange: (c: Colour) => void; keys: Key[]; onKeys: (k: Key[]) => void; now: number;
  looks: { name: string; colour: Partial<Colour> }[]; onSaveLook: (name: string) => void;
}) {
  const c = colourOf(c0);
  const [open, setOpen] = useState<"wheels" | "curves" | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const set = (patch: Partial<Colour>) => onChange({ ...c, ...patch, preset: undefined });
  const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
  const all = [...Object.entries(PRESETS).map(([name, colour]) => ({ name, colour })), ...looks];
  const key = sel !== null ? keys[sel] : undefined;
  const setKey = (patch: Partial<Key>) => sel !== null && onKeys(keys.map((k, i) => (i === sel ? { ...k, ...patch } : k)));
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <Palette className="size-3.5 text-muted-foreground" /><h3 className="flex-1 headline">Colour</h3>
        {!isNeutral(c) && <button onClick={() => onChange(NEUTRAL)} className="caption hover:text-foreground">Reset</button>}
      </div>
      <div className="flex flex-wrap gap-1 px-1">
        <button onClick={() => onChange(NEUTRAL)} className={cn("h-6 rounded-full px-2.5 text-[11px]", isNeutral(c) ? "bg-primary text-primary-foreground" : "bg-foreground/8 hover:bg-foreground/12")}>None</button>
        {all.map((p) => (
          <button key={p.name} onClick={() => onChange({ ...colourOf(p.colour), preset: p.name })}
            className={cn("h-6 rounded-full px-2.5 text-[11px]", c.preset === p.name ? "bg-primary text-primary-foreground" : "bg-foreground/8 hover:bg-foreground/12")}>{p.name}</button>
        ))}
        {!isNeutral(c) && !c.preset && naming === null && (
          <button onClick={() => setNaming("")} className="flex h-6 items-center gap-1 rounded-full px-2 text-[11px] text-primary hover:bg-primary/10"><Plus className="size-3" />Save look</button>
        )}
        {naming !== null && (
          <span className="flex h-6 items-center gap-1 rounded-full bg-input pr-1 pl-2">
            <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name it" maxLength={30}
              onKeyDown={(e) => { if (e.key === "Enter" && naming.trim()) { onSaveLook(naming.trim()); setNaming(null); } if (e.key === "Escape") setNaming(null); }}
              className="w-24 bg-transparent text-[11px] outline-none" />
            <button disabled={!naming.trim()} onClick={() => { onSaveLook(naming.trim()); setNaming(null); }} className="text-[11px] text-primary disabled:opacity-40">Save</button>
          </span>
        )}
      </div>
      <div className="panel divide-y overflow-hidden">
        <Slider label="Exposure" value={c.exposure} min={-2} max={2} step={0.05} reset={0} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`} onChange={(v) => set({ exposure: v })} />
        <Slider label="Contrast" value={c.contrast} min={-1} max={1} reset={0} format={pct} onChange={(v) => set({ contrast: v })} />
        <Slider label="Saturation" value={c.saturation} min={-1} max={1} reset={0} format={pct} onChange={(v) => set({ saturation: v })} />
        <Slider label="Temperature" value={c.temperature} min={-1} max={1} reset={0} format={(v) => (v > 0 ? `warmer ${pct(v)}` : v < 0 ? `cooler ${pct(-v)}` : "0")} onChange={(v) => set({ temperature: v })} />
        <Slider label="Tint" value={c.tint} min={-1} max={1} reset={0} format={(v) => (v > 0 ? `magenta ${pct(v)}` : v < 0 ? `green ${pct(-v)}` : "0")} onChange={(v) => set({ tint: v })} />
        <Slider label="Highlights" value={c.highlights} min={-1} max={1} reset={0} format={pct} onChange={(v) => set({ highlights: v })} />
        <Slider label="Shadows" value={c.shadows} min={-1} max={1} reset={0} format={pct} onChange={(v) => set({ shadows: v })} />
        <Slider label="Hue" value={c.hue} min={-180} max={180} step={1} reset={0} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ hue: v })} />
        <button onClick={() => setOpen(open === "wheels" ? null : "wheels")} className="flex h-9 w-full items-center px-3 text-left hover:bg-foreground/5">
          <span className="flex-1">Colour wheels</span><span className="caption">{open === "wheels" ? "Hide" : "Lift · Gamma · Gain"}</span></button>
        {open === "wheels" && (
          <div className="flex justify-around px-2 py-3">
            {(["lift", "gamma", "gain"] as const).map((k) => (
              <ColourWheel key={k} label={k === "lift" ? "Shadows" : k === "gamma" ? "Midtones" : "Highlights"} value={c.wheels[k]}
                onChange={(w) => set({ wheels: { ...c.wheels, [k]: w } })} />
            ))}
          </div>
        )}
        <button onClick={() => setOpen(open === "curves" ? null : "curves")} className="flex h-9 w-full items-center px-3 text-left hover:bg-foreground/5">
          <span className="flex-1">Curves</span><span className="caption">{open === "curves" ? "Hide" : "Luma · Red · Green · Blue"}</span></button>
        {open === "curves" && <CurveEditor curves={c.curves} onChange={(cv) => set({ curves: cv })} />}
      </div>

      <div className="panel overflow-hidden">
        <div className="flex h-9 items-center gap-2 px-3">
          <span className="flex-1">Keyframes</span>
          <button onClick={() => { const next = [...keys, { t: Math.round(now * 10) / 10, exposure: 0, saturation: 0, contrast: 0 }].sort((a, b) => a.t - b.t); onKeys(next); setSel(next.findIndex((k) => Math.abs(k.t - now) < 0.05)); }}
            className="flex h-6 items-center gap-1 rounded-md px-2 text-[12px] text-primary hover:bg-primary/10"><Plus className="size-3" />At {clock(now)}</button>
        </div>
        {keys.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t px-3 py-2">
            {keys.map((k, i) => (
              <button key={i} onClick={() => setSel(sel === i ? null : i)} className={cn("flex h-6 items-center gap-1 rounded-full px-2 text-[11px] tabular", sel === i ? "bg-primary text-primary-foreground" : "bg-foreground/8")}>
                ◆ {clock(k.t)}</button>
            ))}
          </div>
        )}
        {key && (
          <div className="divide-y border-t">
            <Slider label={`Exposure at ${clock(key.t)}`} value={key.exposure ?? 0} min={-2} max={2} step={0.05} reset={0} format={(v) => `${v.toFixed(2)} EV`} onChange={(v) => setKey({ exposure: v })} />
            <Slider label="Saturation" value={key.saturation ?? 0} min={-1} max={1} reset={0} format={pct} onChange={(v) => setKey({ saturation: v })} />
            <Slider label="Contrast" value={key.contrast ?? 0} min={-1} max={1} reset={0} format={pct} onChange={(v) => setKey({ contrast: v })} />
            <button onClick={() => { onKeys(keys.filter((_, i) => i !== sel)); setSel(null); }} className="flex h-8 w-full items-center gap-1.5 px-3 text-destructive hover:bg-destructive/5"><Trash2 className="size-3.5" />Delete this keyframe</button>
          </div>
        )}
        {!keys.length && <p className="border-t px-3 py-2 caption">Change the light over time, e.g. brighten only a dark part: add a keyframe at the playhead and set it; the change eases between keyframes.</p>}
      </div>
    </section>
  );
}

/** Volume over time (adjust.json "volume"): a dip or a fade, eased between keyframes. */
export function VolumeKeys({ keys, onKeys, now }: { keys: { t: number; db: number }[]; onKeys: (k: { t: number; db: number }[]) => void; now: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const k = sel !== null ? keys[sel] : undefined;
  return (
    <div>
      <div className="flex h-9 items-center gap-2 px-3">
        <span className="flex-1">Volume keyframes</span>
        <button onClick={() => { const next = [...keys, { t: Math.round(now * 10) / 10, db: 0 }].sort((a, b) => a.t - b.t); onKeys(next); setSel(next.findIndex((x) => Math.abs(x.t - now) < 0.05)); }}
          className="flex h-6 items-center gap-1 rounded-md px-2 text-[12px] text-primary hover:bg-primary/10"><Plus className="size-3" />At {clock(now)}</button>
      </div>
      {keys.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {keys.map((x, i) => <button key={i} onClick={() => setSel(sel === i ? null : i)} className={cn("h-6 rounded-full px-2 text-[11px] tabular", sel === i ? "bg-primary text-primary-foreground" : "bg-foreground/8")}>◆ {clock(x.t)} · {x.db.toFixed(0)} dB</button>)}
        </div>
      )}
      {k && (
        <div className="border-t">
          <Slider label={`Volume at ${clock(k.t)}`} value={k.db} min={-40} max={0} step={1} reset={0} format={(v) => `${v.toFixed(0)} dB`} onChange={(v) => onKeys(keys.map((x, i) => (i === sel ? { ...x, db: v } : x)))} />
          <button onClick={() => { onKeys(keys.filter((_, i) => i !== sel)); setSel(null); }} className="flex h-8 w-full items-center gap-1.5 px-3 text-destructive hover:bg-destructive/5"><Trash2 className="size-3.5" />Delete this keyframe</button>
        </div>
      )}
    </div>
  );
}
