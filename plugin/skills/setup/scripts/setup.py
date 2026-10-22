#!/usr/bin/env python3
"""Check and install everything motionmaxxing needs on this Mac. Stdlib only.

  python3 setup.py doctor [--quiet] [--json]   one row per tool: ok, or FIX with the exact command. --quiet: silent
                                               when ready, else one line; --json: the rows for the studio's setup page
  python3 setup.py install-all                 every missing step in order, never asking (Homebrew installs run
                                               themselves; anything needing a password is printed as a FIX). Each
                                               step reports itself as a progress event (job "setup")
  python3 setup.py venv                        the engine's Python (3.10-3.13) with requirements.lock, hashes checked
  python3 setup.py model                       Whisper large-v3-turbo for whisper.cpp (1.6 GB) and the voice detector,
                                               sha256 checked
  python3 setup.py edit-models                 the face finder (YuNet, 230 KB) and the cutout model (Robust Video
                                               Matting, 15 MB), sha256 checked
  python3 setup.py remotion                    the renderer: its pinned npm packages in ~/.motionmaxxing/remotion and its
                                               headless Chrome (about 300 MB, once)
  python3 setup.py motion                      the motion clip tools: the pinned HyperFrames CLI and GSAP in
                                               ~/.motionmaxxing/motion and their headless Chrome
  python3 setup.py demo                        self-check (no installs)

Where things go: $MM_HOME (default ~/.motionmaxxing): venv/, models/, env.json (what was installed from which pins).
Python packages come from requirements/requirements.lock (pip --require-hashes); models from lib/mm/models.py.
The system python3 can be too new for the pinned packages (a 3.15 has no wheels yet): the venv is made with the
newest 3.10-3.13 found (Homebrew's python@3.12 first).
Exit codes: 0 ready or done, 1 something to fix, 2 usage.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "lib"))
from mm import models, progress  # noqa: E402

PLUGIN = Path(__file__).resolve().parents[3]
HOME = Path(os.environ.get("MM_HOME", Path.home() / ".motionmaxxing"))
VENV = HOME / "venv"
VPY = VENV / "bin" / "python"
LOCK = PLUGIN / "requirements" / "requirements.lock"
ENV = HOME / "env.json"
PY_OK = ((3, 10), (3, 13))          # wheels exist for every pinned package on these
NODE_MIN, FFMPEG_MIN = 20, (4, 4)
WHISPER_MODEL = os.environ.get("MM_WHISPER_MODEL", "large-v3-turbo")
REMOTION_SRC = PLUGIN / "remotion"
REMOTION_HOME = HOME / "remotion"
MOTION_HOME = HOME / "motion"
MOTION_PY = PLUGIN / "skills" / "motion" / "scripts" / "motion.py"
BREW = {"ffmpeg": "ffmpeg", "node": "node", "whisper-cli": "whisper-cpp", "git": "git", "python": "python@3.12"}


def run(cmd, **k):
    return subprocess.run(cmd, capture_output=True, text=True, **k)


def version_of(cmd, pattern):
    exe = shutil.which(cmd[0])
    if not exe:
        return None
    try:
        out = run(cmd, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(pattern, (out.stdout or "") + (out.stderr or ""))
    return tuple(int(x) for x in m.groups()) if m else ()


def python_candidates():
    """Pythons that can hold the venv, newest first: names on PATH and Homebrew's python@3.1x."""
    names = [f"python3.{m}" for m in range(13, 9, -1)]
    paths = [shutil.which(n) for n in names] + [f"/opt/homebrew/opt/python@3.{m}/bin/python3.{m}" for m in range(13, 9, -1)]
    seen, out = set(), []
    for p in paths:
        if p and Path(p).exists() and os.path.realpath(p) not in seen:
            seen.add(os.path.realpath(p))
            v = version_of([p, "--version"], r"Python (\d+)\.(\d+)")
            if v and PY_OK[0] <= v[:2] <= PY_OK[1]:
                out.append((v[:2], p))
    return [p for _, p in sorted(out, reverse=True)]


def brew_fix(tool):
    return f"brew install {BREW[tool]}" if shutil.which("brew") else \
        'install Homebrew first: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'


def venv_ok():
    if not VPY.exists():
        return False, "not made yet"
    r = run([str(VPY), "-c", "import numpy, PIL, cv2, onnxruntime, yt_dlp; print('ok')"])
    return (r.stdout.strip() == "ok", "packages missing" if r.stdout.strip() != "ok" else "")


def rows():
    """[(name, ok, detail, fix or None)] for every tool, in install order."""
    out = []
    ff = version_of(["ffmpeg", "-version"], r"ffmpeg version n?(\d+)\.(\d+)")
    out.append(("ffmpeg", bool(ff) and ff >= FFMPEG_MIN, ".".join(map(str, ff or ())) or "missing",
                None if ff and ff >= FFMPEG_MIN else brew_fix("ffmpeg")))
    node = version_of(["node", "--version"], r"v(\d+)\.")
    out.append(("node", bool(node) and node[0] >= NODE_MIN, f"v{node[0]}" if node else "missing",
                None if node and node[0] >= NODE_MIN else brew_fix("node")))
    cli = shutil.which(os.environ.get("MM_WHISPER_CLI") or "whisper-cli")
    out.append(("whisper.cpp", bool(cli), cli or "missing", None if cli else brew_fix("whisper-cli")))
    pys = python_candidates()
    out.append(("python 3.10-3.13", bool(pys), pys[0] if pys else "missing", None if pys else brew_fix("python")))
    ok, why = venv_ok()
    out.append(("engine venv", ok, str(VENV) if ok else why, None if ok else f"python3 {Path(__file__).name} venv"))
    m = models.whispercpp(WHISPER_MODEL)
    out.append(("transcription model", bool(m), WHISPER_MODEL if m else "not downloaded (1.6 GB)",
                None if m else f"python3 {Path(__file__).name} model"))
    em = [r for r in ("yunet.onnx", "rvm_mobilenetv3_fp32.onnx") if not (models.DIR / r).exists()]
    out.append(("face and cutout models", not em, "YuNet, Robust Video Matting" if not em else "not downloaded (15 MB)",
                None if not em else f"python3 {Path(__file__).name} edit-models"))
    rv = remotion_installed()
    out.append(("renderer", bool(rv) and chrome_for(REMOTION_HOME / "node_modules" / ".remotion"),
                f"remotion {rv}" if rv else "not installed (about 300 MB)",
                None if rv and chrome_for(REMOTION_HOME / "node_modules" / ".remotion") else f"python3 {Path(__file__).name} remotion"))
    ok_m, why_m = motion_row()
    out.append(("motion clip tools", ok_m, why_m, None if ok_m else f"python3 {Path(__file__).name} motion"))
    return out


def doctor(quiet=False, as_json=False):
    rs = rows()
    bad = [r for r in rs if not r[1]]
    if as_json:
        print(json.dumps([{"name": n, "ok": ok, "detail": d, "fix": f} for n, ok, d, f in rs]))
        return 1 if bad else 0
    if quiet:
        if bad:
            print("motionmaxxing setup: " + ", ".join(r[0] for r in bad) + " missing. Run setup.py install-all.")
        return 1 if bad else 0
    for name, ok, detail, fix in rs:
        print(f"{'ok ' if ok else 'FIX'}  {name:<20} {detail}" + (f"\n     run: {fix}" if fix else ""))
    print("Ready." if not bad else "Not ready.")
    return 1 if bad else 0


def step_venv():
    pys = python_candidates()
    if not pys:
        sys.exit(f"ERROR: no Python 3.10-3.13 on this Mac. Run: {brew_fix('python')}")
    if VPY.exists():
        v = version_of([str(VPY), "--version"], r"Python (\d+)\.(\d+)")
        if not (v and PY_OK[0] <= v[:2] <= PY_OK[1]):
            shutil.rmtree(VENV)
    if not VPY.exists():
        print(f"making the engine's Python from {pys[0]}", flush=True)
        r = run([pys[0], "-m", "venv", str(VENV)])
        if r.returncode:
            sys.exit(f"ERROR: could not make the venv: {r.stderr.strip()[-300:]}")
        run([str(VPY), "-m", "pip", "install", "-q", "--upgrade", "pip"])
    print("installing the pinned packages (hashes checked)", flush=True)
    r = run([str(VPY), "-m", "pip", "install", "-q", "--no-deps", "--require-hashes", "-r", str(LOCK)])
    if r.returncode:
        sys.exit(f"ERROR: pip failed: {(r.stderr or r.stdout).strip()[-400:]}")
    env = json.loads(ENV.read_text(encoding="utf-8")) if ENV.exists() else {}
    env["lock"] = str(LOCK)
    ENV.parent.mkdir(parents=True, exist_ok=True)
    ENV.write_text(json.dumps(env, indent=1), encoding="utf-8")
    print("ok   engine venv", flush=True)


def step_model():
    total = [0]

    def hook(blocks, size, whole):
        got = min(blocks * size, whole)
        if whole and got * 10 // whole != total[0]:
            total[0] = got * 10 // whole
            progress.step("Downloading the transcription model", detail=f"{got // 10**6} of {whole // 10**6} MB",
                          progress=got / whole, job="setup")
    for name in (WHISPER_MODEL, "silero"):
        rel = models.WHISPER_CPP.get(name, f"ggml-{name}.bin")
        if rel not in models.PINS:
            sys.exit(f"ERROR: no pinned download for {rel}")
        print(f"checking {models.name(rel)}", flush=True)
        models.fetch(rel, check=False, hook=hook)
    print("ok   transcription model", flush=True)


def remotion_installed():
    try:
        return json.loads((REMOTION_HOME / "node_modules" / "remotion" / "package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        return None


def chrome_for(cache):
    return any(Path(cache).glob("chrome-headless-shell/*"))


def quiet(cmd, cwd, what, timeout=1800):
    """A long install step: its output only when it fails."""
    print(what, flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        sys.exit(f"ERROR: {what} failed: {(r.stderr or r.stdout).strip()[-500:]}")
    return r


def step_edit_models():
    for rel in ("yunet.onnx", "rvm_mobilenetv3_fp32.onnx"):
        print(f"checking {models.name(rel)}", flush=True)
        models.fetch(rel, check=False)
    print("ok   face and cutout models", flush=True)


def step_remotion():
    """The renderer's packages, exactly as its lock pins them (npm ci), then Remotion's own headless Chrome."""
    npm = shutil.which("npm")
    if not npm:
        sys.exit(f"ERROR: npm missing. Run: {brew_fix('node')}")
    REMOTION_HOME.mkdir(parents=True, exist_ok=True)
    lock = "package-lock.json"
    same = (REMOTION_HOME / lock).exists() and (REMOTION_HOME / lock).read_bytes() == (REMOTION_SRC / lock).read_bytes()
    for f in ("package.json", lock, "tsconfig.json", "render.mjs"):
        shutil.copy2(REMOTION_SRC / f, REMOTION_HOME / f)
    shutil.copytree(REMOTION_SRC / "src", REMOTION_HOME / "src", dirs_exist_ok=True)
    if not same or not remotion_installed():
        progress.step("Installing the renderer", detail="npm packages", job="setup")
        quiet([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], REMOTION_HOME,
              "installing the renderer's packages (npm ci)")
    if not chrome_for(REMOTION_HOME / "node_modules" / ".remotion"):
        progress.step("Installing the renderer", detail="its browser", job="setup")
        quiet([shutil.which("npx"), "remotion", "browser", "ensure"], REMOTION_HOME, "downloading the render browser")
    print(f"ok   renderer (remotion {remotion_installed()})", flush=True)


def motion_pins():
    text = MOTION_PY.read_text(encoding="utf-8")
    return {"hyperframes": re.search(r'HF_VERSION = "([^"]+)"', text)[1], "gsap": re.search(r'GSAP_VERSION = "([^"]+)"', text)[1]}


def motion_have():
    have = {}
    for name in ("hyperframes", "gsap"):
        try:
            have[name] = json.loads((MOTION_HOME / "node_modules" / name / "package.json").read_text(encoding="utf-8"))["version"]
        except (OSError, ValueError, KeyError):
            pass
    return have


def motion_bin():
    return MOTION_HOME / "node_modules" / ".bin" / "hyperframes"


def motion_row():
    pins, have = motion_pins(), motion_have()
    off = [f"{k} {have.get(k, 'missing')}" for k, v in pins.items() if have.get(k) != v]
    if off:
        return False, "not installed" if len(off) == len(pins) and not have else "; ".join(off)
    try:
        b = run([str(motion_bin()), "browser", "path"], timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return False, "no headless Chrome for clips"
    if b.returncode:
        return False, "no headless Chrome for clips"
    return True, f"hyperframes {pins['hyperframes']}, gsap {pins['gsap']}"


def step_motion():
    """The pinned HyperFrames CLI and GSAP, then the CLI's own headless Chrome."""
    npm = shutil.which("npm")
    if not npm:
        sys.exit(f"ERROR: npm missing. Run: {brew_fix('node')}")
    MOTION_HOME.mkdir(parents=True, exist_ok=True)
    pkg = MOTION_HOME / "package.json"
    if not pkg.exists():
        pkg.write_text('{"private": true, "description": "motionmaxxing motion clip tools"}\n', encoding="utf-8")
    pins = motion_pins()
    if motion_have() != pins:
        progress.step("Installing the motion clip tools", detail="HyperFrames and GSAP", job="setup")
        quiet([npm, "install", "--save-exact", "--no-audit", "--no-fund", "--loglevel=error"] + [f"{k}@{v}" for k, v in pins.items()],
              MOTION_HOME, "installing the motion clip tools (npm install)")
    b = run([str(motion_bin()), "browser", "path"], timeout=60)
    if b.returncode:
        progress.step("Installing the motion clip tools", detail="their browser", job="setup")
        quiet([str(motion_bin()), "browser", "ensure"], MOTION_HOME, "downloading the clip browser")
    print(f"ok   motion clip tools (hyperframes {pins['hyperframes']})", flush=True)


def install_all():
    plan = []
    for name, ok, _, fix in rows():
        if ok:
            continue
        if fix and fix.startswith("brew install") and shutil.which("brew"):
            plan.append((f"Installing {name}", lambda f=fix: run(f.split())))
        elif name == "engine venv":
            plan.append(("Setting up the engine", step_venv))
        elif name == "transcription model":
            plan.append(("Downloading the transcription model", step_model))
        elif name == "face and cutout models":
            plan.append(("Downloading the face and cutout models", step_edit_models))
        elif name == "renderer":
            plan.append(("Installing the renderer", step_remotion))
        elif name == "motion clip tools":
            plan.append(("Installing the motion clip tools", step_motion))
        elif fix:
            print(f"FIX  {name}: {fix}")
    for i, (label, fn) in enumerate(plan):
        progress.step(label, progress=i / max(1, len(plan)), job="setup")
        print(label, flush=True)
        fn()
    ready = doctor() == 0
    progress.step("Ready" if ready else "Not ready", progress=1.0, job="setup", done=ready,
                  failed=None if ready else "Something still needs a fix: see the list")
    return 0 if ready else 1


def demo():
    import tempfile
    global HOME, VENV, VPY
    assert brew_fix("whisper-cli").endswith("whisper-cpp") or "Homebrew" in brew_fix("whisper-cli")
    assert version_of(["definitely-not-a-tool"], r"(\d+)") is None
    with tempfile.TemporaryDirectory() as t:
        old = HOME, VENV, VPY
        HOME, VENV = Path(t), Path(t) / "venv"
        VPY = VENV / "bin" / "python"
        assert venv_ok() == (False, "not made yet")
        names = [r[0] for r in rows()]
        assert names == ["ffmpeg", "node", "whisper.cpp", "python 3.10-3.13", "engine venv", "transcription model",
                         "face and cutout models", "renderer", "motion clip tools"], names
        HOME, VENV, VPY = old
    for p in python_candidates():
        v = version_of([p, "--version"], r"Python (\d+)\.(\d+)")
        assert PY_OK[0] <= v[:2] <= PY_OK[1], (p, v)
    print("setup demo ok")


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    if a[:1] == ["doctor"]:
        return doctor("--quiet" in a, "--json" in a)
    if a == ["install-all"]:
        return install_all()
    if a == ["venv"]:
        return step_venv()
    if a == ["model"]:
        return step_model()
    if a in (["edit-models"], ["matte"], ["face"]):
        return step_edit_models()
    if a == ["remotion"]:
        return step_remotion()
    if a == ["motion"]:
        return step_motion()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main() or 0)
