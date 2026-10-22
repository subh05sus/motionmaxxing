"""The key store: the free stock libraries' keys, pasted once in the studio's Settings.

    from mm import keys
    key, where = keys.get("pexels")        # (None, None) when there is none
    keys.save("pexels", "563492ad...")     # keeps the other keys in the file
    ok, msg = keys.verify("pexels", key)   # one free search request

The file is ~/.config/motionmaxxing/.env (KEY=value lines, chmod 600). With MM_HOME set, the file is
$MM_HOME/.env instead and the shared one is never read or written, so an isolated test run never finds real keys.
An environment variable of the same name wins over the file. A .env in the working folder is never read: it belongs
to whatever project the session started in. Lines for other keys are kept as they are and never read here.
No paid service has a key here: Claude runs on the user's own login, transcription on this Mac.
"""
import contextlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    from mm import net
except ImportError:   # run as a script from this folder
    import net

KEY_FILE = Path.home() / ".config" / "motionmaxxing" / ".env"


def key_file():
    """$MM_HOME/.env when MM_HOME is set, else the shared KEY_FILE."""
    home = os.environ.get("MM_HOME", "").strip()
    return Path(home) / ".env" if home else KEY_FILE
VARS = {"pexels": "PEXELS_API_KEY", "pixabay": "PIXABAY_API_KEY"}
PREFIX = {}   # neither library's keys have a fixed start
NAMES = {"pexels": "Pexels", "pixabay": "Pixabay"}


def get(name):
    """(key, where it came from) or (None, None). `name` is pexels or pixabay.
    Never a .env in the working folder: that is another project's, and its key would be billed."""
    if name not in VARS:   # a service this editor does not use (no paid APIs): never a key
        return None, None
    var, p = VARS[name], key_file()
    if os.environ.get(var, "").strip():
        return os.environ[var].strip(), f"the {var} variable"
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None, None
    for line in lines:
        if line.startswith(f"{var}="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if key:
                return key, str(p)
    return None, None


def write_private(path, text):
    """Write a secrets file readable by this user only: a 0600 temp file beside it, then os.replace, so a
    reader never sees it half written and the file is never readable by others, not even for a moment."""
    path = Path(path)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return path


@contextlib.contextmanager
def _locked(path, wait=10):
    """One writer at a time (the home window's threads, setup.py): a lock file beside the key file, made
    with O_EXCL. One left by a writer that died is stale after 10 s."""
    lock = Path(path).with_name(Path(path).name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(int(wait / 0.025)):
        try:
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
            break
        except (FileExistsError, PermissionError):   # Windows: a lock being deleted refuses a new open
            try:
                if time.time() - lock.stat().st_mtime > 10:
                    lock.unlink(missing_ok=True)
            except OSError:
                pass
            time.sleep(0.025)
    else:
        raise TimeoutError(f"{lock} is held; delete it if nothing is saving a key")
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def _rewrite(name, key, path):
    """Drop VAR= from the file and add VAR=key (None: only drop), keeping every other line, under the lock."""
    var, path = VARS[name], Path(path or key_file())
    path.parent.mkdir(parents=True, exist_ok=True)
    with _locked(path):
        keep = [ln for ln in (path.read_text(encoding="utf-8").splitlines() if path.exists() else [])
                if ln.strip() and not ln.startswith(f"{var}=")]
        lines = keep + ([f"{var}={key}"] if key is not None else [])
        return write_private(path, "\n".join(lines) + "\n" if lines else "")


def save(name, key, path=None):
    """Write VAR=key, keeping every other line. Readable by this user only."""
    return _rewrite(name, key, path)


def remove(name, path=None):
    """Delete VAR= from the key file, keeping every other line."""
    return _rewrite(name, None, path)


def _get(url, headers):
    req = urllib.request.Request(url, headers={"User-Agent": "motionmaxxing", **headers})
    try:
        with net.urlopen(req, 20) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except (urllib.error.URLError, OSError) as e:
        return 0, net.friendly(e)


def verify(name, key):
    """(ok, message). Each check is a free listing call: nothing is billed. A key without its vendor's
    fixed prefix is refused here, so text that is not that key never leaves the computer."""
    if name in PREFIX and not key.startswith(PREFIX[name]):
        return False, f"this is not a {NAMES[name]} key, so nothing was sent. {NAMES[name]} keys start with {' or '.join(PREFIX[name])}"
    if name == "pexels":
        code, body = _get("https://api.pexels.com/videos/search?query=desk&per_page=1", {"Authorization": key})
    else:
        import urllib.parse
        code, body = _get("https://pixabay.com/api/videos/?" + urllib.parse.urlencode({"key": key, "q": "desk",
                                                                                     "per_page": 3}), {})
    if code == 200:
        return True, "key works"
    if code == 0:
        return False, body if body == net.FIX else f"no connection ({body[:80]})"
    if code in (401, 403) or (code == 400 and "key" in body.lower()):
        return False, "the service rejected this key. Copy it again, or make a new one."
    return False, f"HTTP {code}: {body[:120]}"


if __name__ == "__main__":   # self-check: saving one key keeps the others
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / ".env"
        save("pexels", "a" * 24, f)
        f.write_text(f.read_text(encoding="utf-8") + f"OTHER_TOOL_KEY={'t' * 24}\n", encoding="utf-8")  # someone else's line
        save("pixabay", "b" * 24, f)
        save("pixabay", "c" * 24, f)
        assert f.read_text(encoding="utf-8") == (f"PEXELS_API_KEY={'a' * 24}\nOTHER_TOOL_KEY={'t' * 24}\n"
                                                 f"PIXABAY_API_KEY={'c' * 24}\n")   # the other line is kept, never read
        assert os.name == "nt" or f.stat().st_mode & 0o777 == 0o600
        os.environ["MM_HOME"] = d   # MM_HOME isolates: its .env is read, the shared file never
        os.environ.pop("PIXABAY_API_KEY", None)
        assert key_file() == f and get("pixabay") == ("c" * 24, str(f))
        f.unlink()
        names = sorted(VARS) * 10   # many threads saving at once: every key survives, no temp or lock file left
        ts = [threading.Thread(target=save, args=(n, n[0] * 24 + str(i), f)) for i, n in enumerate(names)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        got = dict(ln.split("=", 1) for ln in f.read_text(encoding="utf-8").splitlines())
        assert set(got) == set(VARS.values()), got
        assert sorted(x.name for x in Path(d).iterdir()) == [".env"], list(Path(d).iterdir())
        remove("pexels", f)
        assert "PEXELS_API_KEY" not in f.read_text(encoding="utf-8") and "PIXABAY_API_KEY" in f.read_text(encoding="utf-8")
        real_get, sent = _get, []
        globals()["_get"] = lambda *a: sent.append(a) or (401, "unauthorized")
        try:
            ok, msg = verify("pexels", "x" * 30)
            assert not ok and "rejected" in msg and sent and "pexels.com" in sent[0][0], (msg, sent)
            globals()["_get"] = lambda *a: (200, "{}")
            assert verify("pixabay", "y" * 30) == (True, "key works")
        finally:
            globals()["_get"] = real_get
    print("keys demo ok")
