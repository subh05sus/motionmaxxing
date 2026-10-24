/**
 * A video's colour by hand (adjust.json "colour"), and the look's light (adjust.json "look"), as numbers both the
 * studio's live preview (WebGL, web/src/components/look-preview.tsx) and the render use: the server compiles the
 * colour into a 3x3 matrix and a 1D LUT (.cube) that edit/scripts/adjust.py applies in the footage's FFmpeg pass, and
 * the preview applies the same matrix and LUT on the GPU. One source, so what you drag is what renders.
 *
 * Order: the look (white balance and tone curve, then the face light inside its mask and the room outside it), then
 * the colour: matrix (temperature, tint, saturation, hue), then the per-channel curve (exposure, contrast, shadows,
 * highlights, the lift/gamma/gain wheels, then the curves).
 */

export interface Wheel { x: number; y: number; l: number }   // a colour wheel's puck (-1..1 each way) and its luminance (-1..1)
export interface Colour {
  exposure: number; contrast: number; saturation: number; temperature: number; tint: number; highlights: number; shadows: number;
  hue: number;   // degrees
  wheels: { lift: Wheel; gamma: Wheel; gain: Wheel };
  curves: { master: [number, number][]; r: [number, number][]; g: [number, number][]; b: [number, number][] };
  preset?: string;
}

const W0: Wheel = { x: 0, y: 0, l: 0 };
const C0: [number, number][] = [[0, 0], [1, 1]];
export const NEUTRAL: Colour = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, hue: 0,
  wheels: { lift: W0, gamma: W0, gain: W0 }, curves: { master: C0, r: C0, g: C0, b: C0 },
};

/** A partial colour (as saved) filled in with neutral values. */
export function colourOf(c?: Partial<Colour> | null): Colour {
  const w = (c?.wheels ?? {}) as Partial<Colour["wheels"]>, k = (c?.curves ?? {}) as Partial<Colour["curves"]>;
  return { ...NEUTRAL, ...(c ?? {}), wheels: { lift: { ...W0, ...w.lift }, gamma: { ...W0, ...w.gamma }, gain: { ...W0, ...w.gain } },
    curves: { master: k.master ?? C0, r: k.r ?? C0, g: k.g ?? C0, b: k.b ?? C0 } } as Colour;
}

export const isNeutral = (c?: Partial<Colour> | null): boolean => {
  const x = colourOf(c);
  const flat = (p: [number, number][]) => p.length === 2 && p[0]![0] === 0 && p[0]![1] === 0 && p[1]![0] === 1 && p[1]![1] === 1;
  return !x.exposure && !x.contrast && !x.saturation && !x.temperature && !x.tint && !x.highlights && !x.shadows && !x.hue
    && (["lift", "gamma", "gain"] as const).every((k) => !x.wheels[k].x && !x.wheels[k].y && !x.wheels[k].l)
    && (["master", "r", "g", "b"] as const).every((k) => flat(x.curves[k]));
};

/** One-click looks (presets). A profile's saved looks join these. */
export const PRESETS: Record<string, Partial<Colour>> = {
  Warm: { temperature: 0.35, saturation: 0.08, shadows: 0.05 },
  Cool: { temperature: -0.35, tint: 0.05, saturation: -0.05 },
  Punchy: { contrast: 0.25, saturation: 0.2, shadows: -0.05, highlights: -0.05 },
  Soft: { contrast: -0.2, shadows: 0.15, highlights: -0.15, saturation: -0.05 },
  "Black and white": { saturation: -1, contrast: 0.15 },
  Film: { contrast: 0.1, saturation: -0.1, wheels: { lift: { x: -0.15, y: -0.25, l: 0.08 }, gamma: W0, gain: { x: 0.12, y: 0.18, l: 0 } } },
};

const LUMA = [0.2126, 0.7152, 0.0722];
type Mat3 = number[];   // row-major 3x3
const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!));
const diag = (r: number, g: number, b: number): Mat3 => [r, 0, 0, 0, g, 0, 0, 0, b];
/** Saturation around Rec. 709 luma (s = 1 keeps it). */
export const satMatrix = (s: number): Mat3 => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (1 - s) * LUMA[j]! + (i === j ? s : 0)));
/** A hue turn by `deg` degrees around the grey axis, keeping luma (the classic luma-preserving rotation). */
export function hueMatrix(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const [lr, lg, lb] = LUMA as [number, number, number];
  return [
    lr + c * (1 - lr) + s * -lr, lg + c * -lg + s * -lg, lb + c * -lb + s * (1 - lb),
    lr + c * -lr + s * 0.143, lg + c * (1 - lg) + s * 0.14, lb + c * -lb + s * -0.283,
    lr + c * -lr + s * -(1 - lr), lg + c * -lg + s * lg, lb + c * (1 - lb) + s * lb,
  ];
}
/** Temperature (+ warm, - cool) and tint (+ magenta, - green) as channel gains. */
export const balance = (temperature: number, tint: number): Mat3 => diag(1 + 0.12 * temperature, 1 - 0.09 * tint, 1 - 0.12 * temperature);

/** A natural cubic spline through the points (x ascending), clamped to 0..1: FFmpeg's curves filter draws the same. */
export function spline(points: [number, number][]): (x: number) => number {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return (x) => x;
  if (n === 2) { const [[x0, y0], [x1, y1]] = p as [[number, number], [number, number]]; return (x) => Math.min(1, Math.max(0, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1))); }
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const h = xs.slice(1).map((x, i) => x - xs[i]!);
  const al = new Array(n).fill(0), l = new Array(n).fill(1), mu = new Array(n).fill(0), z = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) al[i] = (3 / h[i]!) * (ys[i + 1]! - ys[i]!) - (3 / h[i - 1]!) * (ys[i]! - ys[i - 1]!);
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (xs[i + 1]! - xs[i - 1]!) - h[i - 1]! * mu[i - 1];
    mu[i] = h[i]! / l[i]; z[i] = (al[i] - h[i - 1]! * z[i - 1]) / l[i];
  }
  const c = new Array(n).fill(0), b = new Array(n - 1).fill(0), d = new Array(n - 1).fill(0);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (ys[j + 1]! - ys[j]!) / h[j]! - (h[j]! * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]!);
  }
  return (x) => {
    if (x <= xs[0]!) return Math.min(1, Math.max(0, ys[0]!));
    if (x >= xs[n - 1]!) return Math.min(1, Math.max(0, ys[n - 1]!));
    let j = 0;
    while (j < n - 2 && x > xs[j + 1]!) j++;
    const t = x - xs[j]!;
    return Math.min(1, Math.max(0, ys[j]! + b[j] * t + c[j] * t * t + d[j] * t * t * t));
  };
}

/** A colour wheel's offset as an RGB tint: the puck's angle is the hue, its distance the amount. */
function wheelRGB(w: Wheel, k: number): [number, number, number] {
  const a = Math.atan2(w.y, w.x), m = Math.min(1, Math.hypot(w.x, w.y)) * k;
  const rgb = [0, 2, 4].map((o) => Math.cos(a - (o * Math.PI) / 3)) as [number, number, number];   // red at 0 deg, green at 120
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return rgb.map((v) => (v - mean) * m) as [number, number, number];
}

export interface Compiled { matrix: Mat3; lut: [number[], number[], number[]] }

/** The colour as a matrix and a per-channel LUT of `size` entries. */
export function compile(c0: Partial<Colour> | null | undefined, size = 1024): Compiled {
  const c = colourOf(c0);
  const matrix = mul(mul(balance(c.temperature, c.tint), hueMatrix(c.hue)), satMatrix(1 + c.saturation));
  const tone = spline([[0, 0], [0.25, 0.25 + 0.12 * c.shadows], [0.5, 0.5], [0.75, 0.75 + 0.12 * c.highlights], [1, 1]]);
  const master = spline(c.curves.master), per = [spline(c.curves.r), spline(c.curves.g), spline(c.curves.b)];
  const lift = wheelRGB(c.wheels.lift, 0.15), gamma = wheelRGB(c.wheels.gamma, 0.35), gain = wheelRGB(c.wheels.gain, 0.25);
  const ev = 2 ** c.exposure, k = 1 + c.contrast;
  const lut: [number[], number[], number[]] = [[], [], []];
  for (let i = 0; i < size; i++) {
    const x0 = i / (size - 1);
    for (let ch = 0; ch < 3; ch++) {
      let v = Math.min(1, x0 * ev);
      v = Math.min(1, Math.max(0, 0.5 + (v - 0.5) * k));
      v = tone(v);
      // lift raises the blacks, gain the whites, gamma the mids: each with its wheel's tint and its luminance
      const L = 0.1 * c.wheels.lift.l + lift[ch]!, G = 1 + 0.25 * c.wheels.gain.l + gain[ch]!;
      v = Math.min(1, Math.max(0, v * (G - L) + L));
      const gm = Math.max(0.2, 1 + 0.6 * c.wheels.gamma.l + gamma[ch]!);
      v = v ** (1 / gm);
      v = per[ch]!(master(v));
      lut[ch]!.push(Math.min(1, Math.max(0, v)));
    }
  }
  return { matrix, lut };
}

/** A 1D LUT file FFmpeg's lut1d reads. */
export function cube1d(lut: [number[], number[], number[]], title = "motionmaxxing colour"): string {
  const lines = [`TITLE "${title}"`, `LUT_1D_SIZE ${lut[0].length}`, "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"];
  for (let i = 0; i < lut[0].length; i++) lines.push(`${lut[0][i]!.toFixed(6)} ${lut[1][i]!.toFixed(6)} ${lut[2][i]!.toFixed(6)}`);
  return lines.join("\n") + "\n";
}

// --- the look (adjust.py), for the preview: the same numbers its FFmpeg filters use -----------------------------

export interface Look { on?: boolean; strength?: number; wb?: number[]; shadows?: number; highlights?: number; saturation?: number;
  face_light?: number; background?: number; room_saturation?: number; skin?: number }

/** adjust.py look_params: the look at its strength. */
export function lookParams(look: Look) {
  const s = look.strength ?? 1;
  const wb = (look.wb ?? [1, 1, 1]).map((g) => 1 + (g - 1) * s);
  return { wb, shadows: (look.shadows ?? 0) * s, highlights: 1 - (1 - (look.highlights ?? 1)) * s, saturation: 1 + ((look.saturation ?? 1) - 1) * s,
    face_light: (look.face_light ?? 0) * s, background: (look.background ?? 0) * s, room_saturation: 1 + ((look.room_saturation ?? 1) - 1) * s };
}

/** adjust.py global_chain's tone curve and lit_chain's: the same points, the same spline as FFmpeg's curves. */
export function lookCurves(look: Look, size = 256): { global: number[]; lit: number[]; matrix: Mat3; litSat: number; roomK: number; roomSat: number } {
  const p = lookParams(look), lo = p.shadows, hi = p.highlights, f = p.face_light;
  const g = spline([[0, lo], [0.25, 0.25 + lo * 0.55], [0.5, 0.5 + lo * 0.15], [0.85, 0.85 - (1 - hi) * 0.35], [1, hi]]);
  const lit = spline([[0, 0], [0.12, 0.12 + 0.01 * f], [0.35, 0.35 + 0.13 * f], [0.6, 0.6 + 0.11 * f], [0.85, 0.85 + 0.05 * f], [1, 1]]);
  const xs = Array.from({ length: size }, (_, i) => i / (size - 1));
  const matrix = mul(diag(p.wb[0]!, p.wb[1]!, p.wb[2]!), satMatrix(p.saturation));
  return { global: xs.map(g), lit: xs.map(lit), matrix, litSat: 1 + f * 0.12, roomK: 1 - p.background, roomSat: p.room_saturation };
}

/** adjust.py mask_frame: the face light's strength at (u, v) for a face box [x, y, w, h] in %. */
export function faceMask(box: number[] | null, u: number, v: number): number {
  if (!box) return 0;
  const [x, y, w, h] = box as [number, number, number, number];
  const cx = (x + w / 2) / 100, cy = (y + h * (0.5 - 0.08)) / 100, rx = (w / 100) * 1.15, ry = (h / 100) * 1.0;
  const d = Math.hypot((u - cx) / rx, (v - cy) / ry);
  const m = Math.min(1, Math.max(0, (1.6 - d) / 1.1));
  return m * m * (3 - 2 * m);
}

/** adjust.py box_at: the face box at t from face.json's samples (blended, held across a long gap). */
export function boxAt(heads: { t: number; box: number[] | null }[], t: number): number[] | null {
  const hs = heads.filter((h) => h.box && h.box[2]! > 3 && h.box[2]! < 60 && h.box[3]! > 3 && h.box[3]! < 70) as { t: number; box: number[] }[];
  if (!hs.length) return null;
  if (t <= hs[0]!.t) return hs[0]!.box;
  for (let i = 0; i < hs.length - 1; i++) {
    const a = hs[i]!, b = hs[i + 1]!;
    if (a.t <= t && t <= b.t) {
      if (b.t - a.t > 1.5) return t - a.t < b.t - t ? a.box : b.box;
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return a.box.map((v, j) => v + (b.box[j]! - v) * k);
    }
  }
  return hs[hs.length - 1]!.box;
}

/** Keyframed exposure, saturation and contrast at t (adjust.json "keyframes"), eased between keys. */
export interface Key { t: number; exposure?: number; saturation?: number; contrast?: number }
export function keyAt(keys: Key[] | undefined, t: number): { exposure: number; saturation: number; contrast: number } {
  const ks = [...(keys ?? [])].sort((a, b) => a.t - b.t);
  const val = (k: Key | undefined) => ({ exposure: k?.exposure ?? 0, saturation: k?.saturation ?? 0, contrast: k?.contrast ?? 0 });
  if (!ks.length) return val(undefined);
  if (t <= ks[0]!.t) return val(ks[0]);
  if (t >= ks[ks.length - 1]!.t) return val(ks[ks.length - 1]);
  const i = ks.findIndex((k) => k.t > t), a = val(ks[i - 1]), b = val(ks[i]);
  const u = (t - ks[i - 1]!.t) / Math.max(1e-6, ks[i]!.t - ks[i - 1]!.t), e = u * u * (3 - 2 * u);
  return { exposure: a.exposure + (b.exposure - a.exposure) * e, saturation: a.saturation + (b.saturation - a.saturation) * e, contrast: a.contrast + (b.contrast - a.contrast) * e };
}
/** The keyframes at t as a CSS filter (the render applies it per frame; the preview too). */
export const keyFilter = (keys: Key[] | undefined, t: number): string => {
  if (!keys?.length) return "";
  const k = keyAt(keys, t);
  return `brightness(${(2 ** k.exposure).toFixed(4)}) saturate(${(1 + k.saturation).toFixed(4)}) contrast(${(1 + k.contrast).toFixed(4)})`;
};

/** Volume keyframes (adjust.json "volume": [{t, db}]) at t, as a gain 0..1 (a fade or a dip; the voice is levelled already). */
export function volumeAt(keys: { t: number; db: number }[] | undefined, t: number): number {
  const ks = [...(keys ?? [])].sort((a, b) => a.t - b.t);
  if (!ks.length) return 1;
  let db: number;
  if (t <= ks[0]!.t) db = ks[0]!.db;
  else if (t >= ks[ks.length - 1]!.t) db = ks[ks.length - 1]!.db;
  else { const i = ks.findIndex((k) => k.t > t), a = ks[i - 1]!, b = ks[i]!; db = a.db + ((b.db - a.db) * (t - a.t)) / Math.max(1e-6, b.t - a.t); }
  return Math.min(1, Math.max(0, 10 ** (Math.min(0, db) / 20)));
}
