#!/usr/bin/env python3
"""Where the speaker's head is, so plan.py keeps cards and logos off it.

    ~/.motionmaxxing/venv/bin/python face.py edits/NAME      writes edits/NAME/face.json
    ~/.motionmaxxing/venv/bin/python face.py demo            self-check

Samples cut.mp4 every 0.5 s and finds the largest face with OpenCV's YuNet detector
(MIT licence, a 230 KB model fetched once into ~/.motionmaxxing/models). Each box is
the HEAD, not the face: widened for hair and ears, because a card that stops at the
eyebrows still sits on the hair.

face.json: {"step_s": 0.5, "heads": [{"t": 0.0, "box": [x, y, w, h], "eyes": y, "mouth": y} ...]} in percent of
the frame, box null when no face was found. eyes and mouth are the lines through YuNet's eye and mouth-corner
landmarks: captions go under the mouth (plan.py), never over it, as creators put them.
Exit codes: 0 ok, 1 error, 2 usage
"""
import json
import os
import subprocess
import sys
from pathlib import Path

MODEL = Path(os.environ.get("MM_HOME", Path.home() / ".motionmaxxing")) / "models" / "yunet.onnx"
STEP_S = 0.5
SCAN_W = 360            # detection width; YuNet is built for small inputs
HAIR, SIDE, CHIN = 0.35, 0.2, 0.15  # head = face box grown by these fractions (top, each side, bottom)


def model():
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "lib"))
    from mm import models   # pinned URL + sha256
    return str(models.fetch(MODEL.name, check=False))


def detector(w, h):
    """YuNet for w x h frames, with OpenCV's own log at errors only: its "Targets are not supported by the
    new graph engine" WARN on every run means nothing to a user."""
    import cv2
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
    return cv2.FaceDetectorYN.create(model(), "", (w, h), 0.6)


def head_box(face, w, h):
    """YuNet face [x, y, fw, fh] in px -> head box in percent, clamped to the frame."""
    x, y, fw, fh = face
    x0, x1 = max(0.0, x - SIDE * fw), min(w, x + fw + SIDE * fw)
    y0, y1 = max(0.0, y - HAIR * fh), min(h, y + fh + CHIN * fh)
    return [round(100 * x0 / w, 1), round(100 * y0 / h, 1), round(100 * (x1 - x0) / w, 1),
            round(100 * (y1 - y0) / h, 1)]


def frames(video):
    """(t, BGR frame at SCAN_W) every STEP_S seconds, straight from ffmpeg."""
    import numpy as np
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "json", str(video)], capture_output=True, text=True, check=True).stdout)["streams"][0]
    sh = round(SCAN_W * probe["height"] / probe["width"] / 2) * 2
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={1 / STEP_S},scale={SCAN_W}:{sh}",
                          "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    n, i = SCAN_W * sh * 3, 0
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield i * STEP_S, np.frombuffer(buf, np.uint8).reshape(sh, SCAN_W, 3)
        i += 1
    p.wait()


def scan(video):
    det, heads, last = None, [], None
    for t, im in frames(video):
        h, w = im.shape[:2]
        if det is None:
            det = detector(w, h)
        _, faces = det.detect(im)
        box, lines = None, {}
        if faces is not None and len(faces):
            # the face nearest the last one found (a cup or a hand raised to the lens can read as a bigger face), else
            # the biggest
            near = lambda f: (f[0] + f[2] / 2 - last[0]) ** 2 + (f[1] + f[3] / 2 - last[1]) ** 2
            pick = min(faces, key=near) if last is not None else max(faces, key=lambda f: f[2] * f[3])
            last = (pick[0] + pick[2] / 2, pick[1] + pick[3] / 2)
            box = head_box(pick[:4].tolist(), w, h)
            lines = face_lines(pick.tolist(), h)
        heads.append({"t": round(t, 2), "box": box, **lines})
    return steady(heads)


JUMP = 20    # % of the frame: a head this far from both neighbours, which agree with each other, is a misread


def steady(heads):
    """Samples whose head jumps away from two neighbours that agree (a cup held up read as the face for one sample)
    become null: no face there is better than a face in the wrong place."""
    out = [dict(x) for x in heads]
    c = lambda b: (b[0] + b[2] / 2, b[1] + b[3] / 2)
    far = lambda a, b: max(abs(c(a)[0] - c(b)[0]), abs(c(a)[1] - c(b)[1]))
    for i in range(1, len(heads) - 1):
        a, b, n = heads[i - 1]["box"], heads[i]["box"], heads[i + 1]["box"]
        if a and b and n and far(a, n) < JUMP / 2.5 and far(b, a) > JUMP and far(b, n) > JUMP:
            out[i] = {"t": heads[i]["t"], "box": None}
    return out


def face_lines(f, h):
    """YuNet's face row (box, then right eye, left eye, nose, right and left mouth corners) -> the eye line and the
    mouth line, % down the frame."""
    return {"eyes": round(100 * (f[5] + f[7]) / 2 / h, 1), "mouth": round(100 * (f[11] + f[13]) / 2 / h, 1)}


def demo():
    b = head_box([100, 200, 100, 100], 400, 800)
    assert b == [20.0, 20.6, 35.0, 18.8], b
    assert face_lines([100, 200, 100, 100, 130, 236, 170, 236, 150, 260, 132, 280, 168, 284], 800) == {"eyes": 29.5, "mouth": 35.2}
    hs = [{"t": 0, "box": [27, 42, 51, 43]}, {"t": 0.5, "box": [49, 67, 51, 33], "mouth": 97.3}, {"t": 1, "box": [28, 42, 48, 42]}]
    assert steady(hs)[1] == {"t": 0.5, "box": None} and steady(hs)[0] == hs[0]   # the cup held up for one sample
    assert head_box([0, 0, 100, 100], 400, 800)[:2] == [0.0, 0.0]
    try:
        import cv2  # noqa: F401  (the venv has it; a bare python skips this part)
    except ImportError:
        cv2 = None
    if cv2 is not None and MODEL.exists():   # the detector prints no OpenCV log lines
        r = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, sys.argv[1]); import face; "
                            "face.detector(64, 64)", str(Path(__file__).parent)], capture_output=True, text=True)
        assert r.returncode == 0 and "WARN" not in r.stderr, r.stderr
    print("demo ok")


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == "demo":
        return demo()
    d = Path(sys.argv[1])
    video = d / "cut.mp4"
    if not video.exists():
        sys.exit(f"ERROR: no cut.mp4 in {d}")
    heads = scan(video)
    found = sum(1 for x in heads if x["box"])
    (d / "face.json").write_text(json.dumps({"step_s": STEP_S, "heads": heads}), encoding="utf-8")
    print(f"{d / 'face.json'}: a head in {found} of {len(heads)} samples")


if __name__ == "__main__":
    main()
