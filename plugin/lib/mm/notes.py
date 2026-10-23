#!/usr/bin/env python3
"""The studio's notes on a video, answered in their own threads. Stdlib only.

    python3 notes.py list <edit_dir>                       the notes as JSON (id, time, text, state, thread)
    python3 notes.py reply <edit_dir> <note id> "<text>" [--done]
                                                           Claude's answer under a note; --done marks it fixed (green)
    python3 notes.py demo                                  self-check

<edit_dir>/notes.json: [{"id", "t" (seconds), "text", "stage" ("cut"|"edit"), "at", "sent"?, "resolved"?, "reopened"?,
"thread": [{"from": "claude"|"you", "text", "at", "sent"?}]}]. The studio writes the notes and the user's replies;
Claude writes its replies here, one per note it worked on, after the fix is made: a short line in the user's language
saying what changed. --done when the note is handled; without it when Claude needs the user's answer first.

A note's state (the timeline's dot): "new" (orange: not sent to Claude yet, or reopened, or a reply of the user's not
sent yet), "working" (blue: Claude has it), "done" (green: Claude fixed it; the user can reopen it).
"""
import json
import os
import sys
import time
from pathlib import Path


def path(edit):
    return Path(edit) / "notes.json"


def load(edit):
    try:
        d = json.loads(path(edit).read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def save(edit, notes):
    p = path(edit)
    tmp = p.with_name(f".notes.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(notes, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def state(n):
    """"new", "working" or "done" (see the module's note)."""
    thread = n.get("thread") or []
    if not n.get("sent") or any(r.get("from") == "you" and not r.get("sent") for r in thread):
        return "new"
    if n.get("reopened") and n["reopened"] > n["sent"]:
        return "new"
    return "done" if n.get("resolved") else "working"


def reply(edit, nid, text, done=False):
    """Claude's answer under note `nid`; done: the note is fixed. -> the note."""
    notes = load(edit)
    n = next((x for x in notes if x.get("id") == nid), None)
    if not n:
        sys.exit(f"ERROR: no note {nid!r} in {path(edit)} (python3 notes.py list {edit})")
    text = " ".join(str(text).split())
    if not text:
        sys.exit("ERROR: an empty reply")
    n.setdefault("thread", []).append({"from": "claude", "text": text, "at": now()})
    if done:
        n["resolved"] = now()
    else:
        n.pop("resolved", None)
    save(edit, notes)
    return n


def demo():
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        save(t, [{"id": "n1", "t": 3.2, "text": "slide it in", "stage": "edit", "at": "2026-10-23T10:00:00.000Z"}])
        assert state(load(t)[0]) == "new"
        notes = load(t)
        notes[0]["sent"] = "2026-10-23T10:01:00.000Z"
        save(t, notes)
        assert state(load(t)[0]) == "working"
        n = reply(t, "n1", "  Done: it slides in from the right now, 0.4 s. ", done=True)
        assert state(n) == "done" and n["thread"][0] == {**n["thread"][0], "from": "claude", "text": "Done: it slides in from the right now, 0.4 s."}
        notes = load(t)   # the user answers in the thread: orange until it is sent
        notes[0]["thread"].append({"from": "you", "text": "a bit slower", "at": "2026-10-23T10:05:00.000Z"})
        save(t, notes)
        assert state(load(t)[0]) == "new"
        notes = load(t)
        notes[0]["thread"][-1]["sent"] = notes[0]["sent"] = "2026-10-23T10:06:00.000Z"
        notes[0].pop("resolved")
        save(t, notes)
        assert state(load(t)[0]) == "working"
        assert reply(t, "n1", "0.6 s now.")["thread"][-1]["from"] == "claude" and state(load(t)[0]) == "working"   # not done: a question
        notes = load(t)
        notes[0]["resolved"], notes[0]["reopened"] = "2026-10-23T10:07:00.000Z", "2026-10-23T10:08:00.000Z"
        assert state(notes[0]) == "new"   # reopened after it was sent: back to the user's side
        try:
            reply(t, "nope", "x")
            raise AssertionError("an unknown note must stop")
        except SystemExit as e:
            assert "no note" in str(e)
    print("notes demo ok")


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    if len(a) == 2 and a[0] == "list":
        print(json.dumps([{**n, "state": state(n)} for n in load(a[1])], indent=1, ensure_ascii=False))
    elif len(a) >= 4 and a[0] == "reply":
        n = reply(a[1], a[2], a[3], done="--done" in a[4:])
        print(f"{n['id']}: {state(n)}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
