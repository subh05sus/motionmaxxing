"""The edit's steps as the studio shows them. Stdlib only.

The edit scripts report where they are (`step(edit, "plan")`); the studio's video page shows it as its progress line
(<edit>/progress.jsonl, the progress module). There is no separate review page: notes, approvals and every change
come from the studio.

    from mm import review
    review.step(edit_dir, "render", log=path)     # "Making the video", with the render's log for its bar
    python3 review.py demo
"""
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mm import progress  # noqa: E402

EDIT_STEPS = {"captions": "Writing the captions", "visuals": "Finding the visuals",
              "plan": "Planning zooms, cards and sound", "stills": "Checking a still of every moment",
              "render": "Making the video", "matte": "Cutting you out for the visuals behind you",
              "motion": "Building the motion graphics"}


def step(folder, key, log=None):
    """One of the edit's steps, on the studio's video page. Never raises: the page is a nicety."""
    try:
        text = EDIT_STEPS.get(key, key)
        detail = None
        if log:
            detail = Path(log).name
        return progress.step(text, detail=detail, job="edit", key=str(Path(folder).resolve()))
    except Exception:
        return False


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except (OSError, ValueError, TypeError):
        return True


def drop_spec(folder):
    """Stop a render started ahead of time and remove its files (the plan changed). Never stops this process."""
    folder = Path(folder)
    for meta in folder.glob("render*.spec.json"):
        try:
            pid = json.loads(meta.read_text(encoding="utf-8")).get("pid")
        except (OSError, ValueError):
            pid = None
        if pid and pid != os.getpid() and alive(pid):
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass
        for f in (meta, meta.with_name(meta.name.replace(".spec.json", ".spec.mp4")),
                  meta.with_name(meta.name.replace(".spec.json", ".spec.log"))):
            f.unlink(missing_ok=True)


def demo():
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        assert step(t, "plan")
        line = json.loads((Path(t) / "progress.jsonl").read_text().strip().splitlines()[-1])
        assert line["step"] == "Planning zooms, cards and sound" and line["job"] == "edit", line
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
        (Path(t) / "render.spec.json").write_text(json.dumps({"pid": p.pid}))
        (Path(t) / "render.spec.mp4").write_bytes(b"x")
        assert alive(p.pid)
        drop_spec(t)
        p.wait(timeout=5)
        assert not (Path(t) / "render.spec.json").exists() and not (Path(t) / "render.spec.mp4").exists()
        assert not alive(p.pid) and alive(os.getpid())
    print("review demo ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["demo"]:
        demo()
    else:
        print(__doc__)
        sys.exit(2)
