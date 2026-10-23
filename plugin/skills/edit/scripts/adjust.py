#!/usr/bin/env python3
"""A video's own look: the light on the face and the colour of the footage, matched to a reference creator's.

    python3 adjust.py match <edit_dir> --ref <edit_dir or creator-teardowns/<handle>> [--strength 1.0]
                                              measure both, write <edit_dir>/adjust.json "look"
    python3 adjust.py stills <edit_dir> [--t 6,15,27]   before | after frames: <edit_dir>/.adjust/compare-<t>.jpg
    python3 adjust.py measure <video> [--face face.json]
    python3 adjust.py demo                               self-check

adjust.json {"look": {"on": true, "strength": 1.0, "wb": [r, g, b] gains, "shadows": 0.06, "highlights": 0.95,
"saturation": 1.0, "skin": 0.03, "face_light": 0.6, "background": 0.04, "ref": "...", "measured": {...}}}.

The footage the edit renders from (edit.py prepare_public) is graded here, in one ffmpeg pass: a white balance that
takes the cast toward the reference's, lifted shadows and rolled-off highlights (a soft light, not a harsh one), and a
light that follows the face (face.json, every 0.5 s): inside it the face is brighter and a touch rosier, outside it the
room is a little darker, so the face is what the eye reads first. The skin keeps its own tone: only the light changes.
The speaker's cutouts (matte.py, for cards behind them) get the same pass, so the two always match.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

STEP_S = 0.5            # face.json's sampling
MASK_SCALE = 4          # the face light's mask is drawn at 1/4 size: a soft falloff scales up without a visible edge
LIGHT_RX, LIGHT_RY = 1.15, 1.0   # the light's radius around the face box (x, y), in face boxes: forehead to chin, ears
LIGHT_LIFT_Y = 0.08     # its centre a little above the box's: a key light from slightly above


def probe(video):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(video)],
                       capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    s = d["streams"][0]
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    return {"width": s["width"], "height": s["height"], "fps": num / den, "duration": float(d["format"]["duration"])}


def heads(face_json):
    """face.json's head boxes [x, y, w, h] in %, the implausible ones (a box wider than 60% of the frame: a close
    graphic, a hand) left out."""
    try:
        hs = json.loads(Path(face_json).read_text(encoding="utf-8"))["heads"]
    except (OSError, ValueError, KeyError):
        return []
    return [h for h in hs if h.get("box") and 3 < h["box"][2] < 60 and 3 < h["box"][3] < 70]


def box_at(hs, t):
    """The face box at t: the samples around it blended, held at the ends; None without a face."""
    if not hs:
        return None
    if t <= hs[0]["t"]:
        return hs[0]["box"]
    for a, b in zip(hs, hs[1:]):
        if a["t"] <= t <= b["t"]:
            if b["t"] - a["t"] > 3 * STEP_S:   # a long gap (no face then): hold the nearer one, never sweep across
                return a["box"] if t - a["t"] < b["t"] - t else b["box"]
            k = (t - a["t"]) / max(1e-6, b["t"] - a["t"])
            return [x + (y - x) * k for x, y in zip(a["box"], b["box"])]
    return hs[-1]["box"]


def smooth_boxes(hs, t_all, window=0.75):
    """The face box per frame time, steadied over about `window` seconds so the light never jitters."""
    import numpy as np
    raw = np.array([box_at(hs, t) or [0, 0, 0, 0] for t in t_all], dtype=np.float32)
    if len(t_all) < 3:
        return raw
    n = max(1, int(round(window / max(1e-6, t_all[1] - t_all[0]))))
    k = np.ones(n, np.float32) / n
    pad = np.pad(raw, ((n // 2, n - 1 - n // 2), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, i], k, mode="valid") for i in range(4)], 1)


def mask_frame(box, mw, mh):
    """The light at one moment: 1 on the face, falling off softly (smoothstep) to 0 a face away."""
    import numpy as np
    x, y, w, h = box
    if w <= 0 or h <= 0:
        return np.zeros((mh, mw), np.float32)
    cx, cy = (x + w / 2) / 100 * mw, (y + h * (0.5 - LIGHT_LIFT_Y)) / 100 * mh
    rx, ry = w / 100 * mw * LIGHT_RX, h / 100 * mh * LIGHT_RY
    yy, xx = np.mgrid[0:mh, 0:mw].astype(np.float32)
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    m = np.clip((1.6 - d) / 1.1, 0, 1)            # full inside ~0.5 radii, gone at 1.6
    return m * m * (3 - 2 * m)


def write_mask(face_json, out, width, height, fps, frames, start_frame=0):
    """The face light's mask as a video (gray, lossless) at 1/MASK_SCALE size, one frame per output frame."""
    import numpy as np
    mw, mh = max(2, width // MASK_SCALE // 2 * 2), max(2, height // MASK_SCALE // 2 * 2)
    hs = heads(face_json)
    t_all = [(start_frame + i) / fps for i in range(frames)]
    boxes = smooth_boxes(hs, t_all)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{mw}x{mh}",
                          "-r", str(fps), "-i", "-", "-c:v", "ffv1", "-pix_fmt", "gray", str(out)], stdin=subprocess.PIPE)
    for b in boxes:
        p.stdin.write((mask_frame(b, mw, mh) * 255).astype(np.uint8).tobytes())
    p.stdin.close()
    if p.wait():
        sys.exit("ERROR: the face light's mask could not be written")
    return out


def look_params(look):
    """The numbers the filter uses, at the look's strength (0 = none, 1 = as matched)."""
    s = float(look.get("strength", 1.0))
    wb = [1 + (g - 1) * s for g in look.get("wb", [1, 1, 1])]
    return {"wb": wb, "shadows": look.get("shadows", 0.0) * s, "highlights": 1 - (1 - look.get("highlights", 1.0)) * s,
            "saturation": 1 + (look.get("saturation", 1.0) - 1) * s, "skin": look.get("skin", 0.0) * s,
            "face_light": look.get("face_light", 0.0) * s, "background": look.get("background", 0.0) * s,
            "room_saturation": 1 + (look.get("room_saturation", 1.0) - 1) * s}


LUMA = (0.2126, 0.7152, 0.0722)   # Rec. 709: what saturation turns around


def mixer(wb=(1, 1, 1), s=1.0):
    """colorchannelmixer for gains and a saturation around Rec. 709 luma: out_i = gain_i * (s * in_i + (1-s) * luma)."""
    rows = [[gain * ((1 - s) * LUMA[j] + (s if i == j else 0)) for j in range(3)] for i, gain in enumerate(wb)]
    keys = [f"{a}{b}" for a in "rgb" for b in "rgb"]
    return "colorchannelmixer=" + ":".join(f"{k}={v:.4f}" for k, v in zip(keys, [x for r in rows for x in r]))


def global_chain(p):
    """White balance and saturation in one colour matrix, then a soft tone curve: the floor a little lifted, the
    highlights rolled off, the mids kept. RGB filters only, so a cutout's alpha passes through."""
    mix = mixer(p["wb"], p["saturation"])[len("colorchannelmixer="):]
    lo, hi = p["shadows"], p["highlights"]
    curve = f"0/{lo:.3f} 0.25/{0.25 + lo * 0.55:.3f} 0.5/{0.5 + lo * 0.15:.3f} 0.85/{0.85 - (1 - hi) * 0.35:.3f} 1/{hi:.3f}"
    return f"colorchannelmixer={mix},curves=all='{curve}'"


def lit_chain(p):
    """Inside the face light: the skin's mids and highlights lifted by a curve that keeps the darks (hair, eyebrows,
    glasses stay dark: a gamma would haze them), and a touch more colour so lit skin reads alive, not grey. No red
    push: in the mids it tints dark hair red. `skin` (0 by default) adds warmth to the highlights only, when asked."""
    f, k = p["face_light"], p["skin"]
    curve = f"0/0 0.12/{0.12 + 0.01 * f:.3f} 0.35/{0.35 + 0.13 * f:.3f} 0.6/{0.6 + 0.11 * f:.3f} 0.85/{0.85 + 0.05 * f:.3f} 1/1"
    warm = f"colorbalance=rh={k:.3f}:bh={-k:.3f}," if k > 0.001 else ""
    return f"curves=all='{curve}',{warm}{mixer(s=1 + f * 0.12)}"


def room_chain(p):
    """Outside it: the room a little darker and calmer, so the face is what the eye reads first."""
    k = 1 - p["background"]
    return f"lutrgb=r=val*{k:.3f}:g=val*{k:.3f}:b=val*{k:.3f},{mixer(s=p['room_saturation'])}"


def graph(look, tail="", has_alpha=False):
    """The filter graph for [0] the footage and [1] the face light's mask; `tail` runs on the result (edit.py's fit
    to the output size). With alpha (the speaker's cutouts) the planes are RGBA, so the cut-out edge stays."""
    p = look_params(look)
    fmt = "gbrap" if has_alpha else "gbrp"
    end = ",format=rgba" if has_alpha else ",format=yuv420p"
    return (f"[0:v]format={fmt},{global_chain(p)},split[base][lit];[base]{room_chain(p)}[room];[lit]{lit_chain(p)}[face];"
            f"[1:v]format=gray[m0];[m0][room]scale2ref=w=rw:h=rh:flags=bicubic[m][room2];[m]format={fmt}[mask];"
            f"[room2][face][mask]maskedmerge{end}{(',' + tail) if tail else ''}")


def load(edit_dir):
    try:
        return json.loads((Path(edit_dir) / "adjust.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def look_of(edit_dir):
    """The video's look when it is on, else None."""
    lk = load(edit_dir).get("look") or {}
    return lk if lk.get("on") else None


def save(edit_dir, d):
    p = Path(edit_dir) / "adjust.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


# --- measuring and matching ---------------------------------------------------------------------------------------

def grab(video, t, w=360):
    import cv2
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", "-vf",
                        f"scale={w}:-2", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    return cv2.imdecode(np.frombuffer(r.stdout, np.uint8), cv2.IMREAD_COLOR) if r.stdout else None


def frame_stats(img, box):
    """Lab numbers of one frame (L 0-100): the face's skin (cheeks and nose), the room, the whole frame."""
    import numpy as np
    import cv2
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[..., 0] * 100 / 255, lab[..., 1] - 128, lab[..., 2] - 128
    H, W = L.shape
    x, y, w, h = box
    x0, x1 = int((x + w * 0.3) / 100 * W), int((x + w * 0.7) / 100 * W)
    y0, y1 = int((y + h * 0.35) / 100 * H), int((y + h * 0.8) / 100 * H)
    room = np.ones_like(L, bool)
    room[max(0, int(y / 100 * H) - 10):, max(0, int(x / 100 * W) - 30):int((x + w) / 100 * W) + 30] = False
    sl = (slice(y0, y1), slice(x0, x1))
    return {"face_L": float(np.median(L[sl])), "face_A": float(np.median(A[sl])), "face_B": float(np.median(B[sl])),
            "room_L": float(L[room].mean()), "frame_L": float(L.mean()), "p5_L": float(np.percentile(L, 5)),
            "p95_L": float(np.percentile(L, 95)), "frame_A": float(A.mean()), "frame_B": float(B.mean()),
            "chroma": float(np.sqrt(A ** 2 + B ** 2).mean())}


def measure(video, face_json, n=10):
    """The averages over n moments where a face is found."""
    import numpy as np
    info = probe(video)
    hs = heads(face_json)
    ts = [info["duration"] * (i + 0.5) / n for i in range(n)]
    rows = []
    for t in ts:
        b = box_at(hs, t)
        img = grab(video, t) if b else None
        if img is not None:
            rows.append(frame_stats(img, b))
    if not rows:
        sys.exit(f"ERROR: no face found in {video}")
    return {k: round(float(np.mean([r[k] for r in rows])), 2) for k in rows[0]}


def match(src, ref):
    """The look that takes `src` (measure()) toward `ref`'s light: the cast neutralised toward the reference's,
    shadows lifted toward its softer floor, highlights rolled off toward its, the face lit so it stands out from the
    room as much as the reference's does (never darker than it is), a touch of red where the skin reads greyer."""
    import numpy as np
    # white balance from the frames' mean a*/b* (Lab: +b* yellow, +a* magenta). Blue up and red down take b* down;
    # 0.6 of the way, the rest is the room itself (a cream wall stays a little cream).
    db = (ref["frame_B"] - src["frame_B"]) * 0.6
    da = (ref["frame_A"] - src["frame_A"]) * 0.6
    wb = [1 + da * 0.004 + db * 0.002, 1 - da * 0.006 + db * 0.001, 1 - db * 0.0075]
    # a little of the reference's softer floor (a black shirt stays black: a washed-out floor reads flat, not lit)
    shadows = float(np.clip((ref["p5_L"] - src["p5_L"]) / 100 * 0.2, 0, 0.03))
    highlights = float(np.clip(1 - max(0.0, src["p95_L"] - ref["p95_L"]) / 100 * 0.8, 0.9, 1.0))
    # the face lit: brighter than the room by the reference's ratio, and never less than a clear +8 L
    want = ref["face_L"] / max(1.0, ref["room_L"]) * src["room_L"]
    face_light = float(np.clip((max(want, src["face_L"] + 8) - src["face_L"]) / 11, 0.5, 1.0))
    skin = 0.0   # the skin keeps its own tone: warmth tinted dark hair (2026-10-23); a highlight warmth is there when asked
    # a busier room than the reference's is calmed; the skin is never desaturated
    room_saturation = float(np.clip(1 + (ref["chroma"] - src["chroma"]) / max(1.0, src["chroma"]) * 0.5, 0.8, 1.0))
    return {"on": True, "strength": 1.0, "wb": [round(x, 4) for x in wb], "shadows": round(shadows, 3),
            "highlights": round(highlights, 3), "saturation": 1.0, "skin": round(skin, 3),
            "face_light": round(face_light, 3), "background": 0.08, "room_saturation": round(room_saturation, 3)}


def apply_still(video, face_json, look, t, out):
    """One frame with the look, through the same graph as the render."""
    import numpy as np
    info = probe(video)
    hs = heads(face_json)
    b = box_at(hs, t) or [0, 0, 0, 0]
    mw, mh = info["width"] // MASK_SCALE // 2 * 2, info["height"] // MASK_SCALE // 2 * 2
    m = Path(out).with_suffix(".mask.png")
    import cv2
    cv2.imwrite(str(m), (mask_frame(b, mw, mh) * 255).astype(np.uint8))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-i", str(m),
                    "-filter_complex", graph(look) + ",format=yuv420p", "-frames:v", "1", str(out)], check=True)
    m.unlink(missing_ok=True)


def stills(edit_dir, ts, look=None):
    edit = Path(edit_dir)
    look = look or look_of(edit) or (load(edit).get("look") or {})
    out = edit / ".adjust"
    out.mkdir(exist_ok=True)
    files = []
    for t in ts:
        a, b = out / f"before-{t:g}.jpg", out / f"after-{t:g}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(edit / "cut.mp4"), "-frames:v", "1", str(a)], check=True)
        apply_still(edit / "cut.mp4", edit / "face.json", look, t, b)
        c = out / f"compare-{t:g}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(a), "-i", str(b), "-filter_complex",
                        "[0]scale=540:-2[x];[1]scale=540:-2[y];[x][y]hstack", str(c)], check=True)
        files.append(c)
    return files


def ref_video(ref):
    """A reference: another edit folder (its cut.mp4 + face.json)."""
    r = Path(ref)
    if (r / "cut.mp4").exists() and (r / "face.json").exists():
        return r / "cut.mp4", r / "face.json"
    sys.exit(f"ERROR: {ref} has no cut.mp4 and face.json to measure")


def demo():
    import tempfile
    import numpy as np
    # the mask: full on the face, nothing a face away, symmetric
    m = mask_frame([40, 30, 20, 20], 100, 100)
    assert m[int(30 + 20 * 0.42), 50] > 0.95 and m[5, 5] == 0 and abs(m[40, 30] - m[40, 70]) < 1e-5, m[40]
    # a face sample in a long gap holds rather than sweeps
    hs = [{"t": 0.0, "box": [10, 10, 20, 20]}, {"t": 5.0, "box": [60, 10, 20, 20]}]
    assert box_at(hs, 1.0)[0] == 10 and box_at(hs, 4.5)[0] == 60
    # matching: a yellow, harsh, dull take against a soft neutral one
    src = {"face_L": 42, "face_A": 12.5, "face_B": 10.3, "room_L": 62, "frame_L": 53, "p5_L": 12.7, "p95_L": 86.5,
           "frame_A": 1.9, "frame_B": 7.6, "chroma": 11.3}
    ref = {"face_L": 40, "face_A": 17, "face_B": 13.7, "room_L": 64, "frame_L": 59, "p5_L": 25, "p95_L": 81,
           "frame_A": 1.3, "frame_B": 1.5, "chroma": 8.0}
    lk = match(src, ref)
    assert lk["wb"][2] > 1 > lk["wb"][0] and 0 < lk["shadows"] <= 0.03 and lk["highlights"] < 1 and lk["face_light"] >= 0.5, lk
    assert lk["skin"] == 0 and lk["saturation"] == 1.0 and lk["room_saturation"] < 1, lk
    p0 = look_params({**lk, "strength": 0})
    assert p0["wb"] == [1, 1, 1] and p0["face_light"] == 0 and p0["highlights"] == 1, p0
    # the whole graph runs on a real frame, with and without alpha
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        v = t / "v.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=216x384:d=1:r=10", "-pix_fmt", "yuv420p", str(v)], check=True)
        (t / "face.json").write_text(json.dumps({"step_s": 0.5, "heads": [{"t": 0, "box": [35, 20, 30, 20]}, {"t": 1, "box": [35, 22, 30, 20]}]}))
        write_mask(t / "face.json", t / "m.mkv", 216, 384, 10, 10)
        o = t / "o.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(v), "-i", str(t / "m.mkv"), "-filter_complex", graph(lk, "scale=108:192"),
                        str(o)], check=True)
        assert probe(o)["width"] == 108
        png = t / "c.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=216x384,format=rgba", "-frames:v", "1", str(png)], check=True)
        po = t / "co.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(png), "-i", str(t / "m.mkv"), "-filter_complex", graph(lk, has_alpha=True),
                        "-frames:v", "1", str(po)], check=True)
        import cv2
        assert cv2.imread(str(po), cv2.IMREAD_UNCHANGED).shape[2] == 4   # the cutout keeps its alpha
    print("adjust demo ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["match", "stills", "measure", "mask", "demo"])
    ap.add_argument("target", nargs="?")
    ap.add_argument("--ref")
    ap.add_argument("--face")
    ap.add_argument("--strength", type=float, default=1.0)
    ap.add_argument("--t", default="")
    ap.add_argument("--out")
    ap.add_argument("--size", help="mask: WxH of the footage")
    ap.add_argument("--fps", type=float)
    ap.add_argument("--frames", type=int)
    a = ap.parse_args()
    if a.cmd == "demo":
        return demo()
    if a.cmd == "measure":
        v = Path(a.target)
        print(json.dumps(measure(v, a.face or v.parent / "face.json"), indent=1))
        return
    edit = Path(a.target)
    if a.cmd == "mask":   # edit.py prepare_public: the face light for the render's footage copy and the cutouts
        w, h = (int(x) for x in a.size.split("x"))
        write_mask(edit / "face.json", a.out, w, h, a.fps, a.frames)
        print(a.out)
        return
    if a.cmd == "match":
        src = measure(edit / "cut.mp4", edit / "face.json")
        rv, rf = ref_video(a.ref)
        ref = measure(rv, rf)
        look = {**match(src, ref), "strength": a.strength, "ref": str(Path(a.ref).resolve()), "measured": {"video": src, "ref": ref}}
        d = load(edit)
        d["look"] = look
        save(edit, d)
        print(json.dumps({k: v for k, v in look.items() if k != "measured"}, indent=1))
    elif a.cmd == "stills":
        info = probe(edit / "cut.mp4")
        ts = [float(x) for x in a.t.split(",") if x] or [round(info["duration"] * f, 1) for f in (0.2, 0.5, 0.8)]
        for f in stills(edit, ts):
            print(f)


if __name__ == "__main__":
    main()
