import { useEffect, useRef, useState } from "react";
import { boxAt, compile, isNeutral, keyAt, lookCurves, type Colour, type Key, type Look } from "@shared/colour";

/**
 * The look and the colour live on the player, as the render will make them: the video's frame through a WebGL2
 * shader that runs the same chain as the render's FFmpeg pass (edit/scripts/adjust.py, src/shared/colour.ts): the
 * look's white balance and tone curve, then the face light inside a mask that follows face.json and the room outside
 * it, then the colour's matrix and LUT, then the keyframes. A split line shows the original on its left.
 */

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_frame, u_look, u_lit, u_colour;
uniform bool u_lookOn, u_colourOn, u_hasFace;
uniform mat3 u_mLook, u_mColour;
uniform float u_litSat, u_roomK, u_roomSat, u_split;
uniform vec4 u_box;
uniform vec3 u_key;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 sat(vec3 c, float s) { return mix(vec3(dot(c, LUMA)), c, s); }
float at(sampler2D t, float x, int ch) { vec4 v = texture(t, vec2((clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5)); return ch == 0 ? v.r : ch == 1 ? v.g : v.b; }
vec3 curve(sampler2D t, vec3 c) { return vec3(at(t, c.r, 0), at(t, c.g, 0), at(t, c.b, 0)); }
vec3 lut(sampler2D t, vec3 c) { return vec3(at(t, c.r, 0), at(t, c.g, 1), at(t, c.b, 2)); }
void main() {
  vec2 q = vec2(uv.x, 1.0 - uv.y);   // the frame's own orientation: y down, as face.json measures it
  vec3 c = texture(u_frame, q).rgb;
  if (q.x < u_split) { o = vec4(c, 1.0); return; }
  if (u_lookOn) {
    vec3 g = curve(u_look, clamp(u_mLook * c, 0.0, 1.0));
    vec3 room = sat(g * u_roomK, u_roomSat);
    vec3 lit = sat(curve(u_lit, g), u_litSat);
    float m = 0.0;
    if (u_hasFace) { float d = length((q - u_box.xy) / u_box.zw); m = clamp((1.6 - d) / 1.1, 0.0, 1.0); m = m * m * (3.0 - 2.0 * m); }
    c = mix(room, lit, m);
  }
  if (u_colourOn) c = lut(u_colour, clamp(u_mColour * c, 0.0, 1.0));
  c = sat(c * u_key.x, u_key.y);
  c = (c - 0.5) * u_key.z + 0.5;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

type Heads = { t: number; box: number[] | null }[];

function lutTexture(gl: WebGL2RenderingContext, chans: number[][]): WebGLTexture {
  const n = chans[0]!.length, data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[i * 4 + c] = (chans[c] ?? chans[0]!)[i]!;
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, n, 1, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  return t;
}

/** Resample a LUT to 256 entries for the GPU. */
const to256 = (a: number[]) => Array.from({ length: 256 }, (_, i) => a[Math.round((i / 255) * (a.length - 1))]!);

export function LookPreview({ video, faceUrl, look, colour, keys, split, onSplit }: {
  video: HTMLVideoElement | null; faceUrl: string; look: Look | null; colour: Partial<Colour> | null; keys?: Key[];
  split: number | null; onSplit: (v: number | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [heads, setHeads] = useState<Heads>([]);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const state = useRef({ look, colour, keys, split, heads });
  state.current = { look, colour, keys, split, heads };

  useEffect(() => {   // the face track the face light follows
    let live = true;
    fetch(faceUrl).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setHeads(d?.heads ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, [faceUrl]);

  useEffect(() => {   // the canvas sits exactly on the picture
    if (!video) return;
    const place = () => {
      const p = video.parentElement?.getBoundingClientRect(), r = video.getBoundingClientRect();
      if (p) setRect({ left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(video);
    video.addEventListener("loadedmetadata", place);
    return () => { ro.disconnect(); video.removeEventListener("loadedmetadata", place); };
  }, [video]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !video) return;
    const gl = cv.getContext("webgl2", { premultipliedAlpha: false });
    if (!gl) { setFailed(true); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch (e) { console.warn("look preview:", e); setFailed(true); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const frame = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, frame);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    let last = "", tex: { look?: WebGLTexture; lit?: WebGLTexture; colour?: WebGLTexture } = {};
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (video.readyState < 2) return;
      const { look: lk, colour: col, keys: ks, split: sp, heads: hs } = state.current;
      if (cv.width !== video.videoWidth / 2) { cv.width = Math.max(2, video.videoWidth / 2); cv.height = Math.max(2, video.videoHeight / 2); gl.viewport(0, 0, cv.width, cv.height); }
      const sig = JSON.stringify([lk, col]);
      const lc = lk?.on ? lookCurves(lk) : null, cc = col && !isNeutral(col) ? compile(col, 256) : null;
      if (sig !== last) {   // the curves and LUTs are made again only when the settings change
        last = sig;
        for (const t of Object.values(tex)) if (t) gl.deleteTexture(t);
        tex = { look: lc ? lutTexture(gl, [lc.global]) : undefined, lit: lc ? lutTexture(gl, [lc.lit]) : undefined,
          colour: cc ? lutTexture(gl, cc.lut.map(to256)) : undefined };
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frame);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform1i(u("u_frame"), 0);
      ([["u_look", tex.look], ["u_lit", tex.lit], ["u_colour", tex.colour]] as const).forEach(([n, t], i) => {
        gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, t ?? null); gl.uniform1i(u(n), 1 + i);
      });
      gl.uniform1i(u("u_lookOn"), lc ? 1 : 0);
      gl.uniform1i(u("u_colourOn"), cc ? 1 : 0);
      if (lc) {
        gl.uniformMatrix3fv(u("u_mLook"), true, lc.matrix);
        gl.uniform1f(u("u_litSat"), lc.litSat); gl.uniform1f(u("u_roomK"), lc.roomK); gl.uniform1f(u("u_roomSat"), lc.roomSat);
        const b = boxAt(hs, video.currentTime);
        gl.uniform1i(u("u_hasFace"), b ? 1 : 0);
        if (b) gl.uniform4f(u("u_box"), (b[0]! + b[2]! / 2) / 100, (b[1]! + b[3]! * 0.42) / 100, (b[2]! / 100) * 1.15, b[3]! / 100);
      }
      if (cc) gl.uniformMatrix3fv(u("u_mColour"), true, cc.matrix);
      const k = keyAt(ks, video.currentTime);
      gl.uniform3f(u("u_key"), 2 ** k.exposure, 1 + k.saturation, 1 + k.contrast);
      gl.uniform1f(u("u_split"), sp ?? -1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); for (const t of Object.values(tex)) if (t) gl.deleteTexture(t); gl.deleteTexture(frame); gl.deleteProgram(prog); };
  }, [video]);

  if (failed) return null;
  // the canvas is there from the start (the GL set-up needs it); it shows once it knows where the picture is
  return (
    <div className="pointer-events-none absolute" style={rect ?? { visibility: "hidden", left: 0, top: 0, width: 1, height: 1 }}>
      <canvas ref={canvas} className="size-full rounded-[10px]" />
      {split !== null && (
        <div className="pointer-events-auto absolute top-0 bottom-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none" style={{ left: `${split * 100}%` }}
          onPointerDown={(e) => {
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const move = (ev: PointerEvent) => onSplit(Math.min(0.98, Math.max(0.02, (ev.clientX - box.left) / box.width)));
            const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
            window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
          }}>
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.5)]" />
          <span className="absolute top-2 right-4 rounded-full bg-black/55 px-1.5 text-[10px] text-white">before</span>
          <span className="absolute top-2 left-4 rounded-full bg-black/55 px-1.5 text-[10px] text-white">after</span>
          <span className="absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[10px] text-black shadow">⇆</span>
        </div>
      )}
    </div>
  );
}
