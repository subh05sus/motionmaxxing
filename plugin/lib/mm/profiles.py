#!/usr/bin/env python3
"""Profiles: one creator each, in their own folder of the library. Stdlib only.

    python3 profiles.py list                  {"profiles": [...], "active": id or null} as JSON
    python3 profiles.py active                the active profile's id (or why there is none)
    python3 profiles.py add <name> [--lang hinglish] [--from <id>] [--color "#4F7CFF"]   a new profile, its folder made
    python3 profiles.py move-video <video id> --from <id> --to <id>   a video, its raw takes and its chat, to another
    python3 profiles.py undo <log>            put back what a move did (<library>/.profiles/*.json)
    python3 profiles.py demo                  self-check

A profile keeps its own videos and raw takes (edits/, videos/, clips/, product/), styles (creator-teardowns/), scripts
(scripts/), Claude chats (.studio/sessions/), learned cut taste (taste.json, taste.md, rules.json), its own settings
(profile.json: language, brand kit, names and terms...), custom/ (rules, caption styles, templates) and Exports/.
Shared by every profile, at the library's top: broll/, recordings/, the sample styles (creator-teardowns/sample-*)
and custom/sounds/. The models, the renderer and the recording browser are the Mac's (MM_HOME).

<library>/profiles.json: {"profiles": [{"id": "anna", "name": "Anna", "folder": "Anna", "color": "#E5482C",
"picture": "picture.jpg" or null, "created": "2026-10-23T12:00:00Z"}]}. A picture lives in the profile's folder.

The first profile of a library made before profiles takes everything in it (adopt): its videos, raw takes, scripts,
chats, styles (not the samples), learned taste and Recently deleted move into the profile's folder, and the paths saved
inside them follow. Every move writes a log in <library>/.profiles/, and undo puts it back.

The active profile: MM_PROFILE (the studio sets it on everything it runs), else the only one there is. With two or
more and none set, a script stops and names them, so whoever runs it (Claude Code in a terminal) asks which: the
skills say to ask every time. No profiles yet: the library is used as it always was.
"""
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

FILE = "profiles.json"
# a profile's own settings in its profile.json; everything else in profile.json stays shared ($MM_HOME/profile.json)
OWN_KEYS = ("lang", "brand", "names", "handles", "export_dir", "creators", "liked_videos", "audience", "goal", "cta",
            "defaults", "looks")   # defaults: what a new video starts with (adjust.json); looks: its saved colour looks
SUBDIRS = ("edits", "videos", "scripts", "creator-teardowns", "attachments", "Exports")
COLORS = ("#E5482C", "#4F7CFF", "#2FB37F", "#B15CFF", "#F2A33A", "#16A9C9")
# the library's own folders (shared, or a library from before profiles): never a profile's folder name
RESERVED = {"broll", "recordings", "creator-teardowns", "custom", "edits", "videos", "scripts", "attachments", "clips",
            "product", ".trash", ".studio"}


# a library from before profiles: what its top and $MM_HOME held that is a profile's now (custom/sounds stays shared)
TOP_OWN = ("edits", "videos", "scripts", "attachments", "clips", "product", ".trash")
HOME_OWN = ("taste.json", "taste.md", "rules.json", "style-names.json")
# the files whose saved paths follow a move (plans, records, chats, exports...); media never
TEXT = {".json", ".jsonl", ".md", ".txt", ".html", ".htm", ".srt", ".vtt", ".xml", ".fcpxml", ".edl", ".csv", ".js",
        ".mjs", ".cjs", ".ts", ".tsx", ".css", ".py", ".sh", ".yaml", ".yml", ".log"}


class Ambiguous(SystemExit):
    """Two or more profiles and none picked: the message names them (a SystemExit, so a script stops with it)."""


def load(root):
    try:
        d = json.loads((Path(root) / FILE).read_text(encoding="utf-8"))
        return d if isinstance(d.get("profiles"), list) else {"profiles": []}
    except (OSError, ValueError):
        return {"profiles": []}


def save(root, d):
    p = Path(root) / FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def get(root, pid):
    return next((p for p in load(root)["profiles"] if p["id"] == pid), None)


def folder(root, pid):
    p = get(root, pid)
    return Path(root) / p["folder"] if p else None


def question(root):
    ps = load(root)["profiles"]
    return ("This library has profiles: " + ", ".join(f"{p['id']} ({p['name']})" for p in ps) + ". Which one is this "
            "for? Run the command again with MM_PROFILE=<id> in front (the studio sets it by itself). In Claude Code, "
            "ask the user which profile first.")


def active(root, strict=True):
    """(id, folder) of the active profile; (None, None) when the library has no profiles. strict: two or more and none
    picked raises Ambiguous (the script stops with the question); not strict: (None, None) then too."""
    ps = load(root)["profiles"]
    want = os.environ.get("MM_PROFILE", "").strip()
    if want:
        p = next((x for x in ps if x["id"] == want or x["name"].lower() == want.lower()), None)
        if not p:
            raise SystemExit(f"ERROR: no profile {want!r} in {root}. " + (question(root) if ps else "It has none yet."))
        return p["id"], Path(root) / p["folder"]
    if not ps:
        return None, None
    if len(ps) == 1:
        return ps[0]["id"], Path(root) / ps[0]["folder"]
    if strict:
        raise Ambiguous(question(root))
    return None, None


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-") or "profile"


def add(root, name, lang=None, copy_from=None, color=None, adopt_legacy=False):
    """A new profile (its folder and its own settings made). copy_from: another profile's id, whose own settings are
    copied (its handles, export folder and picture are its own: never). adopt_legacy: the first profile takes what the
    library held before profiles (the studio and the command line ask for it; a self-check never). -> the profile."""
    d = load(root)
    name = str(name).strip()[:40] or "Profile"
    pid, n = slug(name), 2
    while any(p["id"] == pid for p in d["profiles"]):
        pid, n = f"{slug(name)}-{n}", n + 1
    base = re.sub(r"[/\\:]+", "-", name).strip(". ") or pid
    taken = {p["folder"].lower() for p in d["profiles"]} | RESERVED
    fold, n = base, 2
    while fold.lower() in taken:
        fold, n = f"{base} {n}", n + 1
    f = Path(root) / fold
    for s in SUBDIRS:
        (f / s).mkdir(parents=True, exist_ok=True)
    own = {}
    if copy_from and folder(root, copy_from):
        try:
            own = {k: v for k, v in json.loads((folder(root, copy_from) / "profile.json").read_text(encoding="utf-8")).items()
                   if k in OWN_KEYS and k not in ("handles", "export_dir")}
        except (OSError, ValueError):
            own = {}
    if lang:
        own["lang"] = lang
    (f / "profile.json").write_text(json.dumps(own, indent=1, ensure_ascii=False), encoding="utf-8")
    p = {"id": pid, "name": name, "folder": fold, "color": color or COLORS[len(d["profiles"]) % len(COLORS)],
         "picture": None, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    d["profiles"].append(p)
    save(root, d)
    if adopt_legacy and len(d["profiles"]) == 1 and has_legacy(root):
        p["adopted"] = str(adopt(root, pid))
    return p


def _home():
    return Path(os.environ.get("MM_HOME", Path.home() / ".motionmaxxing"))


def claude_dir(cwd):
    """Claude Code's folder for the conversations held in a working folder (~/.claude/projects/<the path, every other
    sign a dash>). A chat resumes only from the folder it was started in, so a moved chat's transcript is copied."""
    base = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"
    return base / re.sub(r"[^A-Za-z0-9]", "-", str(cwd))


class Log:
    """What a move did, saved as it goes to <library>/.profiles/<when>-<what>.json, so undo can put it back."""

    def __init__(self, root, what):
        self.file = Path(root) / ".profiles" / f"{time.strftime('%Y%m%d-%H%M%S')}-{what}.json"
        self.d = {"what": what, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "moves": [], "pairs": [], "rewritten": [],
                  "copies": [], "keys": {}}

    def save(self):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.d, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.file)


def _swap(text, pairs):
    """Each old path for its new one, only as a whole path or a folder of one (edits/a never edits/ab)."""
    for a, b in sorted(pairs, key=lambda x: -len(x[0])):
        if a in text:
            text = re.sub(re.escape(a) + r"(?=$|[^A-Za-z0-9._-])", lambda _m, b=b: b, text)
    return text


def _tilde(pairs):
    home = str(Path.home())
    return pairs + [("~" + a[len(home):], "~" + b[len(home):]) for a, b in pairs if a.startswith(home + "/")]


def _rewrite(paths, pairs, log):
    """The paths saved in the text files under paths follow pairs; log names each file changed."""
    pairs = _tilde(pairs)
    for base in paths:
        base = Path(base)
        for f in [base] if base.is_file() else base.rglob("*") if base.is_dir() else []:
            if f.is_symlink() or not f.is_file() or f.suffix.lower() not in TEXT:
                continue
            try:
                if f.stat().st_size > 64 << 20:
                    continue
                t = f.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            n = _swap(t, pairs)
            if n != t:
                f.write_text(n, encoding="utf-8")
                log.d["rewritten"].append(str(f))
    log.d["pairs"] += [list(x) for x in pairs]


def _copy(src, dst, log):
    if src.exists() and not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, dst)
        log.d["copies"].append(str(dst))


def _chats(sessions, old_cwd, new_cwd, log):
    """Each moved studio chat's Claude transcript, copied to the new working folder's, so it resumes there."""
    a, b = claude_dir(old_cwd), claude_dir(new_cwd)
    for f in sessions:
        try:
            cs = json.loads(Path(f).read_text(encoding="utf-8")).get("claudeSession")
        except (OSError, ValueError):
            continue
        if cs:
            _copy(a / f"{cs}.jsonl", b / f"{cs}.jsonl", log)
            _copy(a / cs, b / cs, log)


def adopt(root, pid, log=None):
    """A library from before profiles becomes this profile's: everything its top held that is a profile's (videos, raw
    takes, scripts, attachments, Recently deleted, styles but the samples), $MM_HOME's learned taste and chats, and the
    profile's own answers in $MM_HOME/profile.json. The b-roll, recordings, samples and sounds stay shared. -> the log."""
    import library
    root = Path(root)
    f, home = folder(root, pid), _home()
    log = log or Log(root, f"adopt-{pid}")
    pairs, moved, chats = [], [], []

    def mv(src, dst):
        if not src.exists() or dst.exists():
            return False
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        log.d["moves"].append([str(src), str(dst)])
        moved.append(dst)
        log.save()
        return True

    for top in TOP_OWN:
        d = root / top
        if d.is_dir():
            for x in sorted(d.iterdir()):
                mv(x, f / top / x.name)
            pairs.append((str(d), str(f / top)))   # every path under it, the deleted ones' too
            try:
                d.rmdir()
            except OSError:
                pass
    for x in sorted((root / "custom").iterdir()) if (root / "custom").is_dir() else []:
        if x.name != "sounds" and mv(x, f / "custom" / x.name):
            pairs.append((str(root / "custom" / x.name), str(f / "custom" / x.name)))
    for x in sorted((root / "creator-teardowns").iterdir()) if (root / "creator-teardowns").is_dir() else []:
        if x.is_dir() and not library.is_sample_dir(x) and mv(x, f / "creator-teardowns" / x.name):
            pairs.append((str(root / "creator-teardowns" / x.name), str(f / "creator-teardowns" / x.name)))
    for n in HOME_OWN:
        if mv(home / n, f / n):
            pairs.append((str(home / n), str(f / n)))
    for x in sorted((home / "studio" / "sessions").glob("*.json")):
        if mv(x, f / ".studio" / "sessions" / x.name):
            chats.append(f / ".studio" / "sessions" / x.name)
    _rewrite(moved, pairs, log)
    _chats(chats, root, f, log)
    _copy(claude_dir(root) / "memory", claude_dir(f) / "memory", log)   # what Claude remembers of this library
    shared = home / "profile.json"
    try:
        sd = json.loads(shared.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sd = None
    if sd:
        own_f = f / "profile.json"
        own = json.loads(own_f.read_text(encoding="utf-8")) if own_f.exists() else {}
        for k in OWN_KEYS:
            if k in sd:
                log.d["keys"][k] = sd[k]
                own.setdefault(k, sd.pop(k))
        own_f.write_text(json.dumps(own, indent=1, ensure_ascii=False), encoding="utf-8")
        shared.write_text(json.dumps(sd, indent=1, ensure_ascii=False), encoding="utf-8")
        log.d["keys_to"] = str(own_f)
    log.save()
    return log.file


def has_legacy(root):
    """Whether the library's top holds a profile's things from before profiles (adopt moves them)."""
    import library
    root, home = Path(root), _home()
    tops = any(any((root / t).iterdir()) for t in TOP_OWN if (root / t).is_dir())
    styles = any(x.is_dir() and not library.is_sample_dir(x) for x in (root / "creator-teardowns").iterdir()) \
        if (root / "creator-teardowns").is_dir() else False
    return tops or styles or any((home / n).exists() for n in HOME_OWN) or any((home / "studio" / "sessions").glob("*.json"))


def move_video(root, vid, src, dst, log=None):
    """A video into another profile: its edit folder, the raw takes it was made from (in the profile's videos/), its
    chats and their attachments; the paths saved in them follow, and the chats resume there. -> the log."""
    root = Path(root)
    a, b = folder(root, src), folder(root, dst)
    if not a or not b:
        raise SystemExit(f"ERROR: no profile {src if not a else dst!r}. " + question(root))
    ed = a / "edits" / Path(vid).name
    if not ed.is_dir():
        raise SystemExit(f"ERROR: {src} has no video {vid!r}.")
    log = log or Log(root, f"move-{Path(vid).name}-{src}-{dst}")
    try:
        rec = json.loads((ed / "studio.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        rec = {}
    items = [Path("edits") / ed.name]
    for p in [rec.get("source")] + [c.get("path") for c in rec.get("files") or []]:
        if p and Path(p).parent == a / "videos" and Path(p).exists() and Path("videos") / Path(p).name not in items:
            items.append(Path("videos") / Path(p).name)
    sess = []
    for f in sorted((a / ".studio" / "sessions").glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if f.stem == f"v_{ed.name}" or d.get("edit") == str(ed) or f.stem == rec.get("session"):
            sess.append(f.stem)
            items.append(Path(".studio") / "sessions" / f.name)
            if (a / "attachments" / f.stem).is_dir():
                items.append(Path("attachments") / f.stem)
    moved, pairs = [], []
    for it in items:
        if (b / it).exists():
            raise SystemExit(f"ERROR: {dst} already has {it}; rename one first.")
    for it in items:
        (b / it).parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(a / it), str(b / it))
        log.d["moves"].append([str(a / it), str(b / it)])
        moved.append(b / it)
        pairs.append((str(a / it), str(b / it)))
        log.save()
    _rewrite(moved, pairs, log)
    _chats([b / ".studio" / "sessions" / f"{x}.json" for x in sess], a, b, log)
    log.save()
    return log.file


def undo(log_file):
    """Put back what a move did: the saved paths first, then the files, the copies made and the answers moved."""
    d = json.loads(Path(log_file).read_text(encoding="utf-8"))
    back = [(b, a) for a, b in d.get("pairs", [])]
    for f in d.get("rewritten", []):
        f = Path(f)
        if f.is_file():
            f.write_text(_swap(f.read_text(encoding="utf-8"), back), encoding="utf-8")
    for a, b in reversed(d.get("moves", [])):
        if Path(b).exists() and not Path(a).exists():
            Path(a).parent.mkdir(parents=True, exist_ok=True)
            shutil.move(b, a)
    for c in d.get("copies", []):
        c = Path(c)
        if c.is_dir():
            shutil.rmtree(c, ignore_errors=True)
        elif c.exists():
            c.unlink()
    if d.get("keys"):
        shared = _home() / "profile.json"
        try:
            sd = json.loads(shared.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            sd = {}
        sd.update(d["keys"])
        shared.write_text(json.dumps(sd, indent=1, ensure_ascii=False), encoding="utf-8")
    Path(log_file).rename(Path(log_file).with_suffix(".undone.json"))


def settings_file(root, pid=None):
    """The active (or given) profile's own profile.json, or None without profiles."""
    f = folder(root, pid) if pid else active(root, strict=False)[1]
    return f / "profile.json" if f else None


def demo():
    import tempfile
    old = os.environ.pop("MM_PROFILE", None)
    try:
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            assert active(root) == (None, None)                       # no profiles: the library as it always was
            m = add(root, "Anna", lang="de")
            assert m["id"] == "anna" and (root / "Anna" / "edits").is_dir() and active(root) == ("anna", root / "Anna")
            s = add(root, "Ben", lang="hinglish", copy_from="anna")
            assert json.loads((root / "Ben" / "profile.json").read_text())["lang"] == "hinglish"
            try:
                active(root)
                raise AssertionError("two profiles and none picked must ask")
            except Ambiguous as e:
                assert "anna (Anna)" in str(e) and "ben (Ben)" in str(e), e
            assert active(root, strict=False) == (None, None)
            os.environ["MM_PROFILE"] = "ben"
            assert active(root) == ("ben", root / "Ben") and settings_file(root) == root / "Ben" / "profile.json"
            os.environ["MM_PROFILE"] = "Anna"                      # the name works too
            assert active(root)[0] == "anna"
            os.environ["MM_PROFILE"] = "nobody"
            try:
                active(root)
                raise AssertionError("an unknown profile must stop")
            except SystemExit as e:
                assert "no profile 'nobody'" in str(e)
            assert add(root, "Ben")["folder"] == "Ben 2" and s["color"] != m["color"]
            assert add(root, "Videos")["folder"] == "Videos 2"        # never a shared folder's name
            os.environ.pop("MM_PROFILE", None)
        with tempfile.TemporaryDirectory() as t:
            _demo_adopt(Path(t))
    finally:
        os.environ.pop("MM_PROFILE", None)
        if old is not None:
            os.environ["MM_PROFILE"] = old
    print("profiles demo ok")


def _demo_adopt(t):
    """A library from before profiles: the first profile adopts it, a video moves to the second, both undo."""
    keep = {k: os.environ.get(k) for k in ("MM_HOME", "CLAUDE_CONFIG_DIR")}
    root, home, cc = t / "lib", t / "home", t / "claude"
    os.environ["MM_HOME"], os.environ["CLAUDE_CONFIG_DIR"] = str(home), str(cc)
    try:
        ed = root / "edits" / "talk"
        ed.mkdir(parents=True)
        (root / "videos").mkdir()
        (root / "videos" / "talk.mp4").write_bytes(b"x")
        (root / "videos" / "other.mp4").write_bytes(b"y")
        (ed / "studio.json").write_text(json.dumps({"source": str(root / "videos" / "talk.mp4"), "session": "v_talk",
                                                    "files": [{"path": str(root / "videos" / "talk.mp4")}]}))
        (ed / "plan.json").write_text(json.dumps({"cut": str(ed / "cut.mp4"), "broll": str(root / "broll" / "a.mov"),
                                                  "near": str(root / "edits" / "talk-2" / "x")}))
        (root / "edits" / "talk-2").mkdir()
        (root / "broll").mkdir()
        (root / "broll" / "a.mov").write_bytes(b"b")
        (root / "creator-teardowns" / "me").mkdir(parents=True)
        (root / "creator-teardowns" / "me" / "style.json").write_text('{"owner": true}')
        (home / "studio" / "sessions").mkdir(parents=True)
        (home / "taste.json").write_text("{}")
        (home / "studio" / "sessions" / "v_talk.json").write_text(json.dumps({"id": "v_talk", "edit": str(ed), "claudeSession": "c1"}))
        (home / "studio" / "sessions" / "studio.json").write_text(json.dumps({"id": "studio", "claudeSession": "c2"}))
        (home / "profile.json").write_text(json.dumps({"lang": "de", "platform": "reels"}))
        (claude_dir(root)).mkdir(parents=True)
        (claude_dir(root) / "c1.jsonl").write_text("{}")
        before = sorted(str(x.relative_to(t)) for x in t.rglob("*"))
        plan_before = (ed / "plan.json").read_text()
        assert has_legacy(root)
        a = add(root, "Anna", adopt_legacy=True)
        A = root / "Anna"
        assert (A / "edits" / "talk" / "plan.json").exists() and not (root / "edits").exists()
        assert (root / "broll" / "a.mov").exists() and (A / "creator-teardowns" / "me").is_dir()   # b-roll stays shared
        plan = json.loads((A / "edits" / "talk" / "plan.json").read_text())
        assert plan["cut"] == str(A / "edits" / "talk" / "cut.mp4") and plan["broll"] == str(root / "broll" / "a.mov"), plan
        assert plan["near"] == str(A / "edits" / "talk-2" / "x"), plan
        assert json.loads((A / ".studio" / "sessions" / "v_talk.json").read_text())["edit"] == str(A / "edits" / "talk")
        assert (claude_dir(A) / "c1.jsonl").exists() and (A / "taste.json").exists() and not (home / "taste.json").exists()
        assert json.loads((A / "profile.json").read_text())["lang"] == "de" and "lang" not in json.loads((home / "profile.json").read_text())
        assert add(root, "Ben", adopt_legacy=True)["folder"] == "Ben" and not any((root / "Ben" / "edits").iterdir())   # only the first adopts
        mv = move_video(root, "talk", "anna", "ben")
        B = root / "Ben"
        assert (B / "edits" / "talk").is_dir() and (B / "videos" / "talk.mp4").exists() and (A / "videos" / "other.mp4").exists()
        assert json.loads((B / "edits" / "talk" / "studio.json").read_text())["source"] == str(B / "videos" / "talk.mp4")
        assert (B / ".studio" / "sessions" / "v_talk.json").exists() and (A / ".studio" / "sessions" / "studio.json").exists()
        assert (claude_dir(B) / "c1.jsonl").exists()
        undo(mv)
        undo(a["adopted"])
        assert (ed / "plan.json").read_text() == plan_before
        after = sorted(str(x.relative_to(t)) for x in t.rglob("*"))
        gone = set(before) - set(after)
        assert not gone, gone
        assert json.loads((home / "profile.json").read_text())["lang"] == "de"
    finally:
        for k, v in keep.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v


def main():
    a = sys.argv[1:]
    if a == ["demo"]:
        return demo()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import library
    root = library.root()
    if a[:1] == ["list"]:
        print(json.dumps({**load(root), "active": active(root, strict=False)[0]}, indent=1, ensure_ascii=False))
    elif a[:1] == ["active"]:
        print(active(root)[0] or "no profiles: the library is used as one")
    elif a[:1] == ["add"] and len(a) >= 2:
        opt = lambda k: a[a.index(k) + 1] if k in a else None   # noqa: E731
        print(json.dumps(add(root, a[1], opt("--lang"), opt("--from"), opt("--color"), adopt_legacy=True), ensure_ascii=False))
    elif a[:1] == ["move-video"] and len(a) >= 2 and "--from" in a and "--to" in a:
        print(move_video(root, a[1], a[a.index("--from") + 1], a[a.index("--to") + 1]))
    elif a[:1] == ["undo"] and len(a) == 2:
        undo(a[1])
        print("put back")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
