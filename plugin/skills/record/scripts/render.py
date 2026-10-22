#!/usr/bin/env python3
"""Finish a recording: the waiting sped up, a camera that follows the action, a smooth cursor with clicks, a Mac window.

    python3 render.py <recording dir> [--aspect 16:9|9:16|1:1|4:5] [--fps 30] [--out demo.mp4] [--width N]
                      [--zoom Z] [--look window|bare] [--no-cursor] [--badge] [--bg #141518]
    python3 render.py demo

Reads what recorder.mjs run wrote (frames.json, frames/, events.json). Writes the video, a poster (<out>.jpg) and
<out>.json: the video's length, the recording-to-video time map, every click's time in the video (for the edit to
place captions and cuts).

- Waits (a reply streaming, a page loading) play fast: a wait of d seconds lasts about 0.6 + 0.12 d (0.8 to 2.2 s),
  with smooth ramps in and out. Long typing plays up to 3x.
- The camera zooms to each click, field and focus, pans between actions close in time, and pulls back to the whole
  window for waits, scrolls and idle stretches. It moves on critically damped springs, in video time.
- The cursor is drawn, not recorded: a macOS arrow on the recorded path, pressed on each click with a ring, and it
  fades when the hand rests.
- Vertical (9:16) and square videos follow the action inside the window; the whole window shows when pulled back.
Exit codes: 0 ok, 1 failed, 2 usage
"""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/System/Library/Fonts/SFNS.ttf"
ASPECTS = {"16:9": (16, 9), "9:16": (9, 16), "1:1": (1, 1), "4:5": (4, 5)}
WIDTH = {"16:9": 1920, "9:16": 1080, "1:1": 1080, "4:5": 1080}
ZMAX = {"16:9": 2.0, "9:16": 2.8, "1:1": 2.4, "4:5": 2.5}
S = 2          # canvas pixels per CSS pixel (the recorder's device scale)
TB = 44        # the window's toolbar, CSS px
RADIUS = 12    # window corners, CSS px


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------ time: the waiting plays fast
def time_map(ev, t0, t1, fast=True):
    """(grid, speed, video time at each grid point). Speed is 1 except in waits and long typing."""
    step = 0.01
    tg = np.arange(t0, t1 + step, step)
    sp = np.ones_like(tg)

    def plateau(a, b, v, ramp):
        if v <= 1.05 or b - a < 0.3:
            return
        w = np.zeros_like(tg)
        up = (tg >= a) & (tg < a + ramp)
        w[up] = smooth((tg[up] - a) / ramp)
        w[(tg >= a + ramp) & (tg <= b - ramp)] = 1
        dn = (tg > b - ramp) & (tg <= b)
        w[dn] = smooth((b - tg[dn]) / ramp)
        np.maximum(sp, 1 + (v - 1) * w, out=sp)

    if fast:
        for a, b, kind in ev.get("waits", []):
            d = b - a
            if kind == "fast" and d >= 0.8:
                out = min(2.2, max(0.8, 0.6 + 0.12 * d))
                plateau(a, b, d / out, min(0.35, d / 4))
        for act in ev.get("actions", []):
            if act.get("kind") == "type" and act.get("end"):
                d = act["end"] - act["t"]
                if d > 2.5:
                    plateau(act["t"], act["end"], min(3.0, d / 2.5), 0.3)
    tau = np.concatenate([[0.0], np.cumsum(step / sp[:-1])])
    return tg, sp, tau


# ------------------------------------------------------------------ geometry
class Geo:
    """Window coordinates in CSS px: the window's top left is (0, 0), the page starts at y = TB."""

    def __init__(self, vw, vh, aspect, look):
        self.vw, self.vh = vw, vh
        self.tb = TB if look == "window" else 0
        self.m = round(0.07 * vw) if look == "window" else 0
        self.ww, self.wh = vw, vh + self.tb
        aw, ah = ASPECTS[aspect]
        self.a = aw / ah
        need_w, need_h = self.ww + 2 * self.m, self.wh + 2 * self.m
        if need_w / need_h > self.a:
            self.bw, self.bh = need_w, need_w / self.a
        else:
            self.bw, self.bh = need_h * self.a, need_h
        self.cx0, self.cy0 = self.ww / 2, self.wh / 2

    def clamp(self, cx, cy, z):
        """The camera's center for zoom z, kept inside the window on each axis where the view is smaller than it."""
        w, h = self.bw / z, self.bh / z
        cx = min(max(cx, w / 2), self.ww - w / 2) if w <= self.ww else self.cx0
        cy = min(max(cy, h / 2), self.wh - h / 2) if h <= self.wh else self.cy0
        return cx, cy

    def rect(self, cx, cy, z):
        w, h = self.bw / z, self.bh / z
        return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


# ------------------------------------------------------------------ the camera
def shots(ev, geo, zmax):
    """What the camera wants over recording time: [(start, end, cx, cy, z, kind)], plus the pull-back stretches."""
    segs = []
    min_ctx = 560 if geo.a >= 1.2 else 480
    for a in sorted(ev.get("actions", []), key=lambda x: x["t"]):
        if not a.get("box"):
            continue
        l, t, w, h = a["box"]
        kind = a["kind"]
        lead = {"click": 0.9, "hover": 0.9, "type": 0.5, "focus": 0.4, "scrolled-to": 0.2}.get(kind, 0.5)
        hold = {"click": 1.3, "hover": 1.1, "type": 0.9, "focus": 0.2, "scrolled-to": 1.2}.get(kind, 1.0)
        end = (a.get("end") or a["t"]) + hold
        ctx = min(geo.bw, max(min_ctx, w * 1.6, h * 1.6 * geo.a))
        z = max(1.0, min(zmax, geo.bw / ctx))
        segs.append([a["t"] - lead, end, l + w / 2, t + geo.tb + h / 2, z, kind])
    # Actions close together: the camera pans from one to the next instead of pulling back between them.
    for s, n in zip(segs, segs[1:]):
        if n[0] - s[1] < 1.6:
            s[1] = max(s[1], n[0])
    pull = [(a, b) for a, b, k in ev.get("waits", []) if k == "fast" and b - a >= 0.8] + \
           [(a, b) for a, b in ev.get("scrolls", [])]
    return segs, pull


def want(t, segs, pull, geo):
    for s in segs:
        if s[5] == "focus" and s[0] <= t <= s[1]:
            return s[2], s[3], s[4]
    for a, b in pull:
        if a + 0.25 <= t <= b:
            return geo.cx0, geo.cy0, 1.0
    hit = None
    for s in segs:
        if s[0] <= t <= s[1]:
            hit = s          # the latest one that has started
    if hit:
        return hit[2], hit[3], hit[4]
    return geo.cx0, geo.cy0, 1.0


def camera_path(src_t, fps, segs, pull, geo):
    """Critically damped springs in video time: no overshoot, no snapping, the same feel at any speed-up."""
    dt = 1.0 / fps
    w_pan, w_zoom = 2 * math.pi * 0.85, 2 * math.pi * 0.75
    cx, cy, z = geo.cx0, geo.cy0, 1.0
    tx, ty, tz = want(src_t[0], segs, pull, geo)
    cx, cy = geo.clamp(tx, ty, tz)
    lz = math.log(tz)
    vx = vy = vz = 0.0
    out = []
    for t in src_t:
        tx, ty, tz = want(t, segs, pull, geo)
        tx, ty = geo.clamp(tx, ty, tz)
        ltz = math.log(tz)
        for _ in range(2):   # two half steps: stable and smooth
            h = dt / 2
            vz += (w_zoom * w_zoom * (ltz - lz) - 2 * w_zoom * vz) * h
            lz += vz * h
            vx += (w_pan * w_pan * (tx - cx) - 2 * w_pan * vx) * h
            vy += (w_pan * w_pan * (ty - cy) - 2 * w_pan * vy) * h
            cx += vx * h
            cy += vy * h
        z = math.exp(lz)
        out.append((*geo.clamp(cx, cy, z), z))
    return out


# ------------------------------------------------------------------ drawing
def window_canvas(geo, url, bg):
    """The static stage, S x CSS size: background, the window's shadow, its toolbar (lights, address), the page hole."""
    m = geo.m
    W, H = round((geo.ww + 2 * m) * S), round((geo.wh + 2 * m) * S)
    can = Image.new("RGB", (W, H), bg)
    if geo.tb == 0:
        return can, (m * S, m * S), None
    x0, y0, x1, y1 = m * S, m * S, (m + geo.ww) * S, (m + geo.wh) * S
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 16 * S, x1, y1 + 10 * S), radius=RADIUS * S, fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26 * S))
    can.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), shadow)
    d = ImageDraw.Draw(can)
    d.rounded_rectangle((x0, y0, x1, y1), radius=RADIUS * S, fill=(44, 44, 46))
    d.rectangle((x0, y0 + geo.tb * S - S // 2, x1, y0 + geo.tb * S), fill=(22, 22, 24))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx, cy, r = x0 + (20 + 20 * i) * S, y0 + geo.tb / 2 * S, 6 * S
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c)
    pw, ph = min(560, geo.ww * 0.42) * S, 28 * S
    px0, py0 = (x0 + x1) / 2 - pw / 2, y0 + (geo.tb * S - ph) / 2
    d.rounded_rectangle((px0, py0, px0 + pw, py0 + ph), radius=8 * S, fill=(30, 30, 32))
    label = (url or "").split("://")[-1].split("/")[0].removeprefix("www.")
    try:
        font = ImageFont.truetype(FONT, 13 * S)
    except OSError:
        font = ImageFont.load_default()
    tw = d.textlength(label, font=font)
    lock = 9 * S if label and not label.startswith(("localhost", "127.")) else 0
    tx = (x0 + x1) / 2 - (tw + lock) / 2 + lock
    if lock:   # a small padlock before a public address
        lx, ly = tx - lock, py0 + ph / 2
        d.rounded_rectangle((lx, ly - 1 * S, lx + 7 * S, ly + 5 * S), radius=1.5 * S, fill=(160, 160, 166))
        d.arc((lx + 1.2 * S, ly - 5 * S, lx + 5.8 * S, ly + 1 * S), 180, 360, fill=(160, 160, 166), width=round(1.4 * S))
    d.text((tx, py0 + ph / 2), label, font=font, fill=(200, 200, 205), anchor="lm")
    # The page sits under the toolbar; its bottom corners follow the window's.
    hole = Image.new("L", (geo.vw * S, geo.vh * S), 255)
    hd = ImageDraw.Draw(hole)
    r = RADIUS * S
    for cx in (0, geo.vw * S - r):
        hd.rectangle((cx, geo.vh * S - r, cx + r, geo.vh * S), fill=0)
    hd.pieslice((0, geo.vh * S - 2 * r, 2 * r, geo.vh * S), 90, 180, fill=255)
    hd.pieslice((geo.vw * S - 2 * r, geo.vh * S - 2 * r, geo.vw * S, geo.vh * S), 0, 90, fill=255)
    # a hairline of light around the window, as dark-mode windows have
    d.rounded_rectangle((x0, y0, x1, y1), radius=RADIUS * S, outline=(74, 74, 78), width=max(1, S // 2))
    return can, (x0, y0 + geo.tb * S), hole


def cursor_sprite(px):
    """A macOS arrow, px tall: white, a dark edge, a soft shadow. Returns (RGB, alpha, offset of the tip)."""
    k = 4   # drawn 4x, then scaled down: smooth edges
    pts = [(0, 0), (0, 17.2), (4.3, 13.2), (7.2, 19.8), (10.0, 18.6), (7.2, 12.2), (12.6, 12.2)]
    scale = px * k / 20.0
    pad = int(3 * scale)
    size = (int(14 * scale) + 2 * pad, int(21 * scale) + 2 * pad)
    P = [(pad + x * scale, pad + y * scale) for x, y in pts]
    shape = Image.new("L", size, 0)
    ImageDraw.Draw(shape).polygon(P, fill=255)
    stroke = int(2 * max(1.0, px / 22) * k) | 1
    edge = shape.filter(ImageFilter.MaxFilter(stroke))
    shadow = edge.filter(ImageFilter.GaussianBlur(1.4 * scale)).point(lambda v: int(v * 0.4))
    shadow = Image.fromarray(np.roll(np.array(shadow), int(1.0 * scale), axis=0))
    rgb = Image.composite(Image.new("RGB", size, (255, 255, 255)), Image.new("RGB", size, (16, 16, 18)), shape)
    alpha = Image.fromarray(np.maximum(np.array(edge), np.array(shadow)))
    w, h = size[0] // k, size[1] // k
    return rgb.resize((w, h), Image.LANCZOS), alpha.resize((w, h), Image.LANCZOS), pad // k


def frame_at(ts, t):
    return max(0, int(np.searchsorted(ts, t, side="right")) - 1)


# ------------------------------------------------------------------ main render
def render(d, aspect="16:9", fps=30, out=None, width=None, zmax=None, look="window", cursor=True, badge=False,
           bg="#141518", fast=True, quiet=False):
    d = Path(d)
    frames = json.loads((d / "frames.json").read_text())
    ev = json.loads((d / "events.json").read_text())
    if not frames:
        raise SystemExit("no frames: the recording is empty")
    vw, vh = ev.get("viewport", [1440, 900])
    geo = Geo(vw, vh, aspect, look)
    zmax = zmax or ZMAX[aspect]
    ow = width or WIDTH[aspect]
    aw, ah = ASPECTS[aspect]
    oh = round(ow * ah / aw / 2) * 2
    ow = round(ow / 2) * 2
    bgc = tuple(int(bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    t0 = ev.get("t0", frames[0][0])
    t1 = max(ev.get("t1", frames[-1][0]), frames[-1][0])
    ts = np.array([f[0] for f in frames])
    tg, sp, tau = time_map(ev, t0, t1, fast)
    n = int(tau[-1] * fps) + 1
    taus = np.arange(n) / fps
    src_t = np.interp(taus, tau, tg)
    speed = np.interp(src_t, tg, sp)
    segs, pull = shots(ev, geo, zmax)
    cam = camera_path(src_t, fps, segs, pull, geo)

    canvas, origin, hole = window_canvas(geo, ev.get("url"), bgc)
    can_w, can_h = canvas.size
    m = geo.m
    background = Image.new("RGB", (ow, oh), bgc)

    mouse = np.array(ev.get("mouse") or [[t0, vw / 2, vh * 0.62]], dtype=float)
    clicks = ev.get("clicks", [])
    click_t = np.array([c[0] for c in clicks]) if clicks else np.array([])
    sprites = {}

    out = Path(out) if out else d / ("demo.mp4" if aspect == "16:9" else f"demo-{aspect.replace(':', 'x')}.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}",
                            "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], stdin=subprocess.PIPE)
    cur_idx, prev_key, view = -1, None, None
    poster_at = int(n * 0.35)
    try:
        font = ImageFont.truetype(FONT, round(oh * 0.022))
    except OSError:
        font = ImageFont.load_default()
    for k in range(n):
        t = src_t[k]
        idx = frame_at(ts, t)
        if idx != cur_idx:
            im = Image.open(d / "frames" / frames[idx][1]).convert("RGB")
            if im.size != (vw * S, vh * S):
                im = im.resize((vw * S, vh * S), Image.LANCZOS)
            canvas.paste(im, origin, hole)
            cur_idx = idx
        cx, cy, z = cam[k]
        x0, y0, x1, y1 = geo.rect(cx, cy, z)
        # camera rect in canvas pixels (the canvas spans the window plus its margin)
        bx0, by0, bx1, by1 = (x0 + m) * S, (y0 + m) * S, (x1 + m) * S, (y1 + m) * S
        key = (idx, round(bx0, 2), round(by0, 2), round(bx1, 2))
        if key != prev_key:   # the same frame under the same camera: nothing to redraw but the cursor
            if bx0 >= 0 and by0 >= 0 and bx1 <= can_w and by1 <= can_h:
                view = canvas.resize((ow, oh), Image.LANCZOS, box=(bx0, by0, bx1, by1), reducing_gap=2.0)
            else:
                view = background.copy()
                ix0, iy0, ix1, iy1 = max(0, bx0), max(0, by0), min(can_w, bx1), min(can_h, by1)
                if ix1 > ix0 and iy1 > iy0:
                    sx, sy = ow / (bx1 - bx0), oh / (by1 - by0)
                    dx0, dy0 = round((ix0 - bx0) * sx), round((iy0 - by0) * sy)
                    dx1, dy1 = round((ix1 - bx0) * sx), round((iy1 - by0) * sy)
                    if dx1 > dx0 and dy1 > dy0:
                        view.paste(canvas.resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS, box=(ix0, iy0, ix1, iy1), reducing_gap=2.0), (dx0, dy0))
            prev_key = key
        img = view.copy()
        ppc = ow / (x1 - x0)   # output pixels per CSS pixel
        to_out = lambda x, y: ((x - x0) * ppc, (y + geo.tb - y0) * ppc)   # page coords -> output pixels
        if cursor:
            mx = float(np.interp(t, mouse[:, 0], mouse[:, 1]))
            my = float(np.interp(t, mouse[:, 0], mouse[:, 2]))
            j = int(np.searchsorted(mouse[:, 0], t, side="right")) - 1
            moved = mouse[max(0, j), 0] if j >= 0 else t0
            recent_click = click_t[click_t <= t].max() if click_t.size and (click_t <= t).any() else -1e9
            idle = t - max(moved, recent_click)
            alpha = 1.0 if idle < 2.0 else max(0.0, 1 - (idle - 2.0) / 0.4)
            press = 1.0
            # the click: a ring that opens and fades, the arrow pressed for a moment
            for c in clicks:
                dtc = t - c[0]
                if 0 <= dtc <= 0.5:
                    e = 1 - (1 - dtc / 0.5) ** 3
                    rx, ry = to_out(c[1], c[2])
                    r = (7 + 26 * e) * ppc
                    ring = Image.new("L", (int(2 * r + 8), int(2 * r + 8)), 0)
                    rd = ImageDraw.Draw(ring)
                    a = int(150 * (1 - e))
                    rd.ellipse((4, 4, 4 + 2 * r, 4 + 2 * r), fill=int(a * 0.35), outline=a, width=max(2, round(2.2 * ppc)))
                    img.paste(Image.new("RGB", ring.size, (255, 255, 255)), (int(rx - r - 4), int(ry - r - 4)), ring)
                if 0 <= dtc <= 0.28:
                    press = 0.82 + 0.18 * min(1, dtc / 0.28) ** 2 if dtc > 0.08 else 0.82
            if alpha > 0.01:
                size = round(22 * ppc * press * (z ** -0.4) * 0.5) * 2   # grows with the zoom, but less than the page
                size = max(16, size)
                if size not in sprites:
                    sprites[size] = cursor_sprite(size)
                rgb, am, pad = sprites[size]
                px, py = to_out(mx, my)
                if alpha < 0.999:
                    am = am.point(lambda v, f=alpha: int(v * f))
                img.paste(rgb, (int(px - pad), int(py - pad)), am)
        if badge and speed[k] > 1.6:
            dr = ImageDraw.Draw(img)
            label = f"▶▶ {speed[k]:.0f}×"
            tw = dr.textlength(label, font=font)
            pad = oh * 0.012
            bx, by = ow - tw - pad * 4, pad * 3
            dr.rounded_rectangle((bx - pad, by - pad * 0.6, bx + tw + pad, by + font.size + pad * 0.8), radius=font.size, fill=(0, 0, 0))
            dr.text((bx, by), label, font=font, fill=(255, 255, 255))
        if k == poster_at:
            img.save(out.with_suffix(".jpg"), quality=90)
        enc.stdin.write(img.tobytes())
        if not quiet and k % (fps * 2) == 0:
            print(f"rendering {k / fps:.0f}/{n / fps:.0f} s", flush=True)
    enc.stdin.close()
    if enc.wait():
        raise SystemExit("ffmpeg could not write the video")
    dur = n / fps
    marks = np.arange(t0, t1, 0.25)
    info = {"video": out.name, "duration": round(dur, 3), "fps": fps, "aspect": aspect, "size": [ow, oh],
            "recorded": round(t1 - t0, 3),
            "map": [[round(float(a - t0), 2), round(float(b), 3)] for a, b in zip(marks, np.interp(marks, tg, tau))],
            "clicks": [round(float(np.interp(c[0], tg, tau)), 3) for c in clicks],
            "fast": [[round(float(np.interp(a, tg, tau)), 3), round(float(np.interp(b, tg, tau)), 3)]
                     for a, b, k in ev.get("waits", []) if k == "fast" and b - a >= 0.8]}
    out.with_suffix(".json").write_text(json.dumps(info, indent=1))
    if not quiet:
        print(f"{out} ({dur:.1f} s from {t1 - t0:.1f} s recorded, {ow}x{oh})")
    return info


def demo():
    """A synthetic recording: a page that changes, a click, a long wait, typing. The video must exist, the wait must
    shrink, and the camera must zoom in for the click and pull back for the wait."""
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="render_demo_"))
    (tmp / "frames").mkdir()
    t0 = 1000.0
    frames = []
    for i in range(40):
        im = Image.new("RGB", (1440 * S // 4, 900 * S // 4), (240, 240, 245))
        ImageDraw.Draw(im).rectangle((10 + i * 4, 40, 60 + i * 4, 90), fill=(0, 120, 255))
        name = f"{i:06d}.jpg"
        im.save(tmp / "frames" / name, quality=80)
        frames.append([t0 + i * 0.5, name])
    ev = {"url": "https://example.com/", "viewport": [1440, 900], "t0": t0, "t1": t0 + 20,
          "mouse": [[t0, 700, 500], [t0 + 1.5, 300, 200]], "clicks": [[t0 + 2.0, 300, 200]],
          "actions": [{"t": t0 + 2.0, "kind": "click", "box": [250, 180, 100, 40]},
                      {"t": t0 + 14, "end": t0 + 19, "kind": "type", "box": [400, 600, 700, 60]}],
          "waits": [[t0 + 4, t0 + 13, "fast"]], "scrolls": []}
    (tmp / "frames.json").write_text(json.dumps(frames))
    (tmp / "events.json").write_text(json.dumps(ev))
    info = render(tmp, fps=15, width=640, quiet=True)
    assert (tmp / "demo.mp4").stat().st_size > 1000 and (tmp / "demo.jpg").exists()
    assert 9.0 < info["duration"] < 16.0, info["duration"]          # 20 s recorded, the 9 s wait shrank to ~1.7 s
    geo = Geo(1440, 900, "16:9", "window")
    segs, pull = shots(ev, geo, 2.0)
    src = np.array([t0 + 0.2, t0 + 2.1, t0 + 8.0])
    cam = camera_path(np.repeat(src, 40), 30, segs, pull, geo)
    z_start, z_click, z_wait = cam[39][2], cam[79][2], cam[119][2]
    assert z_start < 1.05 and z_click > 1.6 and z_wait < 1.1, (z_start, z_click, z_wait)
    v = render(tmp, aspect="9:16", fps=10, width=360, quiet=True)
    assert v["size"] == [360, 640], v["size"]
    print("render demo ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["demo"]:
        demo()
        sys.exit(0)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dir")
    ap.add_argument("--aspect", default="16:9", choices=list(ASPECTS))
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--out")
    ap.add_argument("--width", type=int)
    ap.add_argument("--zoom", type=float, help="the most the camera zooms in (default 2 for 16:9, 2.8 for 9:16)")
    ap.add_argument("--look", default="window", choices=["window", "bare"])
    ap.add_argument("--no-cursor", action="store_true")
    ap.add_argument("--no-fast", action="store_true", help="play waits at their real speed")
    ap.add_argument("--badge", action="store_true", help="show the speed-up while it is fast")
    ap.add_argument("--bg", default="#141518")
    a = ap.parse_args()
    render(a.dir, a.aspect, a.fps, a.out, a.width, a.zoom, a.look, not a.no_cursor, a.badge, a.bg, not a.no_fast)
