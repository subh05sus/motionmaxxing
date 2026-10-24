import { describe, expect, it } from "vitest";
import { boxAt, compile, cube1d, isNeutral, keyAt, lookCurves, spline, volumeAt, NEUTRAL, PRESETS } from "../../shared/colour.js";

// The colour math the live preview and the render share (src/shared/colour.ts).
describe("colour", () => {
  it("leaves the picture alone when nothing is set", () => {
    const c = compile(NEUTRAL, 256);
    expect(c.matrix.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    for (const ch of c.lut) for (let i = 0; i < 256; i += 17) expect(ch[i]).toBeCloseTo(i / 255, 5);
    expect(isNeutral(NEUTRAL)).toBe(true);
    expect(isNeutral(PRESETS.Warm)).toBe(false);
  });
  it("draws a curve through its points, held inside 0..1", () => {
    const f = spline([[0, 0], [0.5, 0.7], [1, 1]]);
    expect(f(0.5)).toBeCloseTo(0.7, 6);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(spline([[0, 0.2], [1, 0.8]])(0.5)).toBeCloseTo(0.5, 6);
  });
  it("warms, brightens and turns black and white the way the names say", () => {
    const warm = compile({ temperature: 0.5 }, 16).matrix;
    expect(warm[0]).toBeGreaterThan(1);
    expect(warm[8]).toBeLessThan(1);
    expect(compile({ exposure: 1 }, 256).lut[0][64]).toBeCloseTo(Math.min(1, (64 / 255) * 2), 2);
    const bw = compile(PRESETS["Black and white"], 16).matrix;
    expect(bw[0]).toBeCloseTo(bw[3]!, 6);   // every channel the same mix: grey
  });
  it("writes a 1D LUT FFmpeg reads", () => {
    const text = cube1d(compile({ contrast: 0.2 }, 4).lut);
    expect(text).toMatch(/LUT_1D_SIZE 4/);
    expect(text.trim().split("\n")).toHaveLength(4 + 4);
  });
  it("follows the face and the keyframes in time", () => {
    const heads = [{ t: 0, box: [40, 20, 20, 20] }, { t: 1, box: [50, 20, 20, 20] }, { t: 5, box: [10, 20, 20, 20] }];
    expect(boxAt(heads, 0.5)![0]).toBeCloseTo(45, 6);
    expect(boxAt(heads, 1.2)![0]).toBe(50);   // a long gap holds the nearer face, never sweeps
    expect(keyAt([{ t: 0, exposure: 0 }, { t: 2, exposure: 1 }], 1).exposure).toBeCloseTo(0.5, 6);
    expect(volumeAt([{ t: 0, db: 0 }, { t: 1, db: -20 }], 1)).toBeCloseTo(0.1, 3);
    expect(volumeAt([], 3)).toBe(1);
  });
  it("matches the look's curves to adjust.py's points", () => {
    const lc = lookCurves({ on: true, strength: 1, shadows: 0.03, highlights: 0.95, face_light: 0.7, background: 0.08, room_saturation: 0.86 });
    expect(lc.global[0]).toBeCloseTo(0.03, 3);
    expect(lc.global[255]).toBeCloseTo(0.95, 3);
    expect(lc.lit[0]).toBe(0);
    expect(lc.roomK).toBeCloseTo(0.92, 6);
  });
});
