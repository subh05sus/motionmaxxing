"""Long scripts report their own steps, so the studio moves without Claude remembering to. Stdlib only.

    from mm import progress
    progress.step("Writing down every word", detail="2 of 5 min", progress=0.4, key=edit_dir, job="video")
    python3 progress.py demo     self-check

Each step is one JSON line appended to <edit>/progress.jsonl when `key` is an edit folder (or a file in one),
else to $MM_HOME/progress/<job>.jsonl. The studio tails the file and shows the newest step, its detail and its bar.

    {"t": 1792700000.12, "job": "video", "step": "Writing down every word", "detail": "2 of 5 min", "progress": 0.4}

The same text as the newest step updates that row in the studio (a ticker), never a second one. Never raises and
never blocks: a full disk or a read-only folder only loses the event. MM_NO_PROGRESS=1 turns it off.
"""
import json
import os
import sys
import time
from pathlib import Path


def home():
    return Path(os.environ.get("MM_HOME", "").strip() or Path.home() / ".motionmaxxing")


def events_file(job, key=None):
    """Where a step for this job and key goes: the edit folder's progress.jsonl, else the job's file in home."""
    if key:
        k = Path(str(key))
        if k.is_dir():
            return k / "progress.jsonl"
        if k.parent.is_dir() and k.suffix:
            return k.parent / "progress.jsonl"
    return home() / "progress" / f"{job}.jsonl"


def step(text, detail=None, progress=None, job="video", key=None, done=False, failed=None):
    """Append one step. True when it was written. done: the job's last step; failed: a plain sentence why."""
    if os.environ.get("MM_NO_PROGRESS"):
        return False
    ev = {"t": round(time.time(), 2), "job": job, "step": text}
    if detail:
        ev["detail"] = detail
    if progress is not None:
        ev["progress"] = round(max(0.0, min(1.0, float(progress))), 3)
    if done:
        ev["done"] = True
    if failed:
        ev["failed"] = failed
    try:
        f = events_file(job, key)
        f.parent.mkdir(parents=True, exist_ok=True)
        with open(f, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(ev, ensure_ascii=False) + "\n")
        return True
    except Exception:   # noqa: BLE001  the studio is a nicety: nothing here may fail the script
        return False


def ticker(text, n, job="video", key=None):
    """A callback for one finished item of n: "3 of 7" under the step, the bar at 3/7."""
    return lambda i: step(text, detail=f"{i} of {n}", progress=i / n, job=job, key=key) if n > 1 else None


def last(job="video", key=None):
    """The newest step written for this job and key, or None."""
    try:
        lines = events_file(job, key).read_text(encoding="utf-8").splitlines()
        return json.loads(lines[-1]) if lines else None
    except (OSError, ValueError):
        return None


def demo():
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        os.environ["MM_HOME"] = str(Path(t) / "home")
        edit = Path(t) / "edits" / "take"
        edit.mkdir(parents=True)
        assert step("Writing down every word", key=edit)
        assert last(key=edit)["step"] == "Writing down every word"
        assert step("Cutting", key=edit / "words.raw.json", progress=1.7)   # a file in the edit: its folder
        ev = last(key=edit)
        assert ev["step"] == "Cutting" and ev["progress"] == 1.0
        assert ticker("Transcribed", 7, key=edit)(3) and last(key=edit)["detail"] == "3 of 7"
        assert step("Listed their videos", job="teardown", key="@someone")   # not a folder: home's file
        assert (Path(t) / "home" / "progress" / "teardown.jsonl").exists()
        os.environ["MM_NO_PROGRESS"] = "1"
        assert step("x", key=edit) is False
        del os.environ["MM_NO_PROGRESS"]
        bad = Path(t) / "ro"
        bad.mkdir()
        bad.chmod(0o500)
        try:
            assert step("x", key=bad) is False or True   # never raises, whatever the folder allows
        finally:
            bad.chmod(0o700)
    print("progress demo ok")


if __name__ == "__main__" and sys.argv[1:2] == ["demo"]:
    demo()
