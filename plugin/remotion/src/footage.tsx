import React, { createContext, useContext } from "react";
import { OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// The speaker's footage, with the video's keyframed colour and volume (the studio's Adjust tab: adjust.json
// "keyframes" and "volume", mirrored into plan.json by edit.py). The rest of its look and colour is burned into the
// footage copy (adjust.py). These two functions are the studio's src/shared/colour.ts keyFilter and volumeAt: the
// renderer is copied on its own ($MM_HOME/remotion), so it keeps its copy; change both together.

export type Key = { t: number; exposure?: number; saturation?: number; contrast?: number };
export type Vol = { t: number; db: number };

export function keyFilter(keys: Key[] | undefined, t: number): string {
  if (!keys?.length) return "";
  const ks = [...keys].sort((a, b) => a.t - b.t);
  const val = (k: Key | undefined) => ({ exposure: k?.exposure ?? 0, saturation: k?.saturation ?? 0, contrast: k?.contrast ?? 0 });
  let k: { exposure: number; saturation: number; contrast: number };
  if (t <= ks[0]!.t) k = val(ks[0]);
  else if (t >= ks[ks.length - 1]!.t) k = val(ks[ks.length - 1]);
  else {
    const i = ks.findIndex((x) => x.t > t), a = val(ks[i - 1]), b = val(ks[i]);
    const u = (t - ks[i - 1]!.t) / Math.max(1e-6, ks[i]!.t - ks[i - 1]!.t), e = u * u * (3 - 2 * u);
    k = { exposure: a.exposure + (b.exposure - a.exposure) * e, saturation: a.saturation + (b.saturation - a.saturation) * e,
      contrast: a.contrast + (b.contrast - a.contrast) * e };
  }
  return `brightness(${(2 ** k.exposure).toFixed(4)}) saturate(${(1 + k.saturation).toFixed(4)}) contrast(${(1 + k.contrast).toFixed(4)})`;
}

export function volumeAt(keys: Vol[] | undefined, t: number): number {
  const ks = [...(keys ?? [])].sort((a, b) => a.t - b.t);
  if (!ks.length) return 1;
  let db: number;
  if (t <= ks[0]!.t) db = ks[0]!.db;
  else if (t >= ks[ks.length - 1]!.t) db = ks[ks.length - 1]!.db;
  else { const i = ks.findIndex((x) => x.t > t), a = ks[i - 1]!, b = ks[i]!; db = a.db + ((b.db - a.db) * (t - a.t)) / Math.max(1e-6, b.t - a.t); }
  return Math.min(1, Math.max(0, 10 ** (Math.min(0, db) / 20)));
}

export const FootageAdjust = createContext<{ keyframes?: Key[]; volume?: Vol[] }>({});

/** The footage element every layout draws: OffthreadVideo with the keyframed colour and volume at this frame. */
export const Footage: React.FC<{ src: string; style?: React.CSSProperties }> = ({ src, style }) => {
  const { keyframes, volume } = useContext(FootageAdjust);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = keyFilter(keyframes, frame / fps);
  const filter = [style?.filter, f].filter(Boolean).join(" ") || undefined;
  return <OffthreadVideo src={staticFile(src)} style={{ ...style, filter }}
    volume={volume?.length ? (fr: number) => volumeAt(volume, fr / fps) : undefined} />;
};

/** The same keyframed colour for anything drawn of the speaker beside the footage (the cutouts). */
export function useKeyFilter(): string {
  const { keyframes } = useContext(FootageAdjust);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return keyFilter(keyframes, frame / fps);
}
