#!/usr/bin/env python3
"""Free stock footage and photos for b-roll: search, look at a contact sheet, take one into the edit with its credit.

    stock.py search "<query>" [--kind video|photo] [--orientation portrait|landscape|any] [--n 9] [--out edits/NAME/stock/<words>]
    stock.py get edits/NAME <source>:<id> [--start S] [--end S] [--max-s 6]
    stock.py credits edits/NAME
    stock.py demo

Sources, all free to use without attribution required by their licences (credits are kept anyway):
  pexels     Pexels (key: Settings > Stock footage). Videos and photos.
  pixabay    Pixabay (key: Settings > Stock footage). Videos and photos.
  wikimedia  Wikimedia Commons, no key. Real things (a building, a person, a product, an event), each with its own
             licence (CC BY, CC BY-SA, public domain): the credit line is required and kept in credits.json.
A source without a key is skipped and said once. `search` writes <out>/sheet.jpg (numbered thumbnails: read it)
and <out>/index.json, and prints one numbered line per result: source:id, size, length, licence, author.
`get` downloads the pick into edits/NAME/images/ (a video trimmed to --max-s, at most 1080 wide), adds its credit to
credits.json, and prints the images/ path to use as a video_card or shot `src`.
Exit codes: 0 ok, 1 nothing found or a download failed, 2 usage.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "lib"))
from mm import keys, net  # noqa: E402

UA = "motionmaxxing/0.1 (stock search for a local video editor)"


def _json(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with net.urlopen(req, 30) as r:
        return json.loads(r.read().decode("utf-8"))


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "stock"


# ------------------------------------------------------------------ sources: each returns [{...}] in one shape
def pexels(q, kind, orientation, n):
    key, _ = keys.get("pexels")
    if not key:
        return None
    o = "" if orientation == "any" else f"&orientation={orientation}"
    if kind == "video":
        d = _json(f"https://api.pexels.com/videos/search?query={urllib.parse.quote(q)}&per_page={n}{o}", {"Authorization": key})
        out = []
        for v in d.get("videos", []):
            files = sorted((f for f in v.get("video_files", []) if f.get("link") and (f.get("width") or 0) <= 2160),
                           key=lambda f: -(f.get("width") or 0) * (f.get("height") or 0))
            if not files:
                continue
            best = next((f for f in files if min(f.get("width") or 0, f.get("height") or 0) <= 1080), files[0])
            out.append({"source": "pexels", "id": str(v["id"]), "kind": "video", "w": v.get("width"), "h": v.get("height"),
                        "seconds": v.get("duration"), "thumb": v.get("image"), "url": best["link"], "page": v.get("url"),
                        "author": (v.get("user") or {}).get("name"), "licence": "Pexels licence (free, no attribution required)"})
        return out
    d = _json(f"https://api.pexels.com/v1/search?query={urllib.parse.quote(q)}&per_page={n}{o}", {"Authorization": key})
    return [{"source": "pexels", "id": str(p["id"]), "kind": "photo", "w": p.get("width"), "h": p.get("height"), "seconds": None,
             "thumb": p["src"]["medium"], "url": p["src"]["large2x"], "page": p.get("url"), "author": p.get("photographer"),
             "licence": "Pexels licence (free, no attribution required)"} for p in d.get("photos", [])]


def pixabay(q, kind, orientation, n):
    key, _ = keys.get("pixabay")
    if not key:
        return None
    o = {"portrait": "vertical", "landscape": "horizontal"}.get(orientation, "all")
    if kind == "video":
        d = _json(f"https://pixabay.com/api/videos/?key={key}&q={urllib.parse.quote(q)}&per_page={max(3, n)}&safesearch=true")
        out = []
        for v in d.get("hits", []):
            vs = v.get("videos") or {}
            f = vs.get("medium") or vs.get("large") or vs.get("small")
            if not f or not f.get("url"):
                continue
            w, h = f.get("width"), f.get("height")
            if orientation == "portrait" and w and h and w > h:
                continue
            out.append({"source": "pixabay", "id": str(v["id"]), "kind": "video", "w": w, "h": h, "seconds": v.get("duration"),
                        "thumb": f.get("thumbnail") or (vs.get("tiny") or {}).get("thumbnail"), "url": f["url"], "page": v.get("pageURL"),
                        "author": v.get("user"), "licence": "Pixabay content licence (free, no attribution required)"})
        return out[:n]
    d = _json(f"https://pixabay.com/api/?key={key}&q={urllib.parse.quote(q)}&per_page={max(3, n)}&image_type=photo&orientation={o}&safesearch=true")
    return [{"source": "pixabay", "id": str(p["id"]), "kind": "photo", "w": p.get("imageWidth"), "h": p.get("imageHeight"),
             "seconds": None, "thumb": p.get("webformatURL"), "url": p.get("largeImageURL"), "page": p.get("pageURL"),
             "author": p.get("user"), "licence": "Pixabay content licence (free, no attribution required)"} for p in d.get("hits", [])][:n]


def wikimedia(q, kind, orientation, n):
    ft = "video" if kind == "video" else "bitmap"
    params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": f"{q} filetype:{ft}", "gsrnamespace": "6",
              "gsrlimit": str(n * 2), "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "640"}
    d = _json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    out = []
    pages = sorted((d.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value") or "see the file page"
        if re.search(r"\bnc\b|non-?commercial|fair use", lic, re.I):
            continue   # never non-commercial or fair-use files in a reel
        w, h = ii.get("width"), ii.get("height")
        if orientation == "portrait" and w and h and w > h * 1.05 and kind == "video":
            continue
        artist = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value") or "").strip()[:80] or "unknown"
        out.append({"source": "wikimedia", "id": str(p.get("pageid")), "kind": kind, "w": w, "h": h,
                    "seconds": round(float(ii["duration"]), 1) if ii.get("duration") else None, "thumb": ii.get("thumburl"),
                    "url": ii.get("url"), "page": ii.get("descriptionurl"), "author": artist,
                    "licence": lic, "title": p.get("title", "").removeprefix("File:")})
        if len(out) >= n:
            break
    return out


SOURCES = {"pexels": pexels, "pixabay": pixabay, "wikimedia": wikimedia}


def search(q, kind="video", orientation="portrait", n=9, out=None, only=None):
    out = Path(out or Path(tempfile.gettempdir()) / "mm-stock" / slug(q))
    out.mkdir(parents=True, exist_ok=True)
    found, skipped = [], []
    names = [k for k in SOURCES if (not only or k in only)]
    live = [k for k in names if k == "wikimedia" or keys.get(k)[0]]
    per = max(3, -(-n // max(1, len(live))))   # the sources with a key share the n
    for name in names:
        fn = SOURCES[name]
        try:
            r = fn(q, kind, orientation, per)
        except Exception as e:   # one source down never stops the others
            print(f"{name}: {net.friendly(e) if hasattr(net, 'friendly') else e}", file=sys.stderr)
            continue
        if r is None:
            skipped.append(name)
            continue
        found += r
    if skipped:
        print(f"skipped {', '.join(skipped)}: no key (Settings > Stock footage)", file=sys.stderr)
    found = found[:n]
    for i, r in enumerate(found, 1):
        r["n"] = i
    (out / "index.json").write_text(json.dumps({"query": q, "kind": kind, "results": found}, indent=1))
    if found:
        sheet(found, out / "sheet.jpg")
    for r in found:
        size = f"{r['w']}x{r['h']}" if r.get("w") else "?"
        length = f" {r['seconds']:.0f}s" if r.get("seconds") else ""
        print(f"{r['n']:>2}  {r['source']}:{r['id']}  {size}{length}  {r['licence']}  by {r.get('author') or '?'}"
              + (f"  ({r['title'][:50]})" if r.get("title") else ""))
    print(f"sheet: {out / 'sheet.jpg'}" if found else "nothing found: try other words (English works best)")
    return found


def sheet(results, path):
    """A numbered 3-column contact sheet of the thumbnails."""
    from PIL import Image, ImageDraw, ImageFont
    cw, ch = 360, 360
    cols = 3
    rows = (len(results) + cols - 1) // cols
    img = Image.new("RGB", (cols * cw, rows * ch), (20, 20, 22))
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
    for k, r in enumerate(results):
        x, y = (k % cols) * cw, (k // cols) * ch
        try:
            req = urllib.request.Request(r["thumb"], headers={"User-Agent": UA})
            with net.urlopen(req, 20) as f:
                from io import BytesIO
                t = Image.open(BytesIO(f.read())).convert("RGB")
            t.thumbnail((cw - 8, ch - 8))
            img.paste(t, (x + (cw - t.width) // 2, y + (ch - t.height) // 2))
        except Exception:
            pass
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((x + 8, y + 8, x + 60, y + 50), radius=8, fill=(0, 0, 0))
        d.text((x + 34, y + 29), str(r["n"]), font=font, fill=(255, 255, 255), anchor="mm")
        if r.get("seconds"):
            d.text((x + cw - 12, y + ch - 14), f"{r['seconds']:.0f}s", font=font, fill=(255, 255, 255), anchor="rs")
    img.save(path, quality=85)


def get(edit, ref, start=None, end=None, max_s=6.0, index=None):
    """Download source:id into edit/images/ (found by a search's index.json, or looked up again)."""
    edit = Path(edit)
    src, _, rid = ref.partition(":")
    hit = None
    found_in = [Path(index)] if index else (sorted((edit / "stock").glob("*/index.json"), key=lambda f: -f.stat().st_mtime)
                                            + list(Path(tempfile.gettempdir(), "mm-stock").glob("*/index.json")))
    for idx in found_in:
        try:
            hit = next((r for r in json.loads(Path(idx).read_text())["results"] if r["source"] == src and r["id"] == rid), None)
        except (OSError, ValueError, KeyError):
            continue
        if hit:
            break
    if not hit:
        sys.exit(f"ERROR: {ref} is not in a recent search: run stock.py search first")
    images = edit / "images"
    images.mkdir(parents=True, exist_ok=True)
    ext = ".mp4" if hit["kind"] == "video" else ".jpg"
    dest = images / f"stock-{src}-{rid}{ext}"
    tmp = dest.with_suffix(".part" + ext)
    req = urllib.request.Request(hit["url"], headers={"User-Agent": UA})
    with net.urlopen(req, 120) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 16)
            if not b:
                break
            f.write(b)
    if hit["kind"] == "video":
        a = float(start or 0)
        b = float(end) if end else a + min(max_s, float(hit.get("seconds") or max_s))
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", str(tmp), "-an",
                            "-vf", "scale='min(1080,iw)':-2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dest)], capture_output=True, text=True)
        tmp.unlink(missing_ok=True)
        if r.returncode:
            sys.exit(f"ERROR: could not trim the clip: {r.stderr.strip()[-200:]}")
    else:
        tmp.replace(dest)
    cf = edit / "credits.json"
    try:
        credits = json.loads(cf.read_text())
    except (OSError, ValueError):
        credits = []
    if not any(c.get("file") == f"images/{dest.name}" for c in credits):
        credits.append({"file": f"images/{dest.name}", "source": src, "url": hit.get("page"), "author": hit.get("author"),
                        "licence": hit.get("licence"), "title": hit.get("title")})
        cf.write_text(json.dumps(credits, indent=1))
    print(f"images/{dest.name}")
    return dest


def credits(edit):
    cf = Path(edit) / "credits.json"
    try:
        cs = json.loads(cf.read_text())
    except (OSError, ValueError):
        cs = []
    lines = [f"{c.get('title') or c['file']}: {c.get('author') or '?'}, {c.get('licence')}, {c.get('url')}" for c in cs]
    (Path(edit) / "credits.txt").write_text("\n".join(lines) + ("\n" if lines else ""))
    print("\n".join(lines) or "no stock used")


def demo():
    """Offline: the sources' answers are faked; the shape, the filters and the credits are checked."""
    global _json
    real = _json
    fake = {
        "commons": {"query": {"pages": {
            "1": {"index": 1, "pageid": 11, "title": "File:Server room.jpg", "imageinfo": [{"url": "https://u/a.jpg", "thumburl": "https://u/t.jpg",
                  "descriptionurl": "https://c/a", "width": 1600, "height": 1200, "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"},
                                                                                                 "Artist": {"value": "<a>Jane Doe</a>"}}}]},
            "2": {"index": 2, "pageid": 12, "title": "File:Logo.png", "imageinfo": [{"url": "https://u/b.png", "width": 500, "height": 500,
                  "extmetadata": {"LicenseShortName": {"value": "CC BY-NC 2.0"}}}]}}}},
    }
    _json = lambda url, headers=None: fake["commons"] if "wikimedia" in url else {}
    try:
        r = wikimedia("server room", "photo", "portrait", 5)
        assert len(r) == 1 and r[0]["author"] == "Jane Doe" and r[0]["licence"] == "CC BY-SA 4.0", r   # NC dropped, html stripped
        import os
        os.environ.pop("PEXELS_API_KEY", None)
        assert slug("Server Room / 2026!") == "server-room-2026"
    finally:
        _json = real
    with tempfile.TemporaryDirectory() as t:
        (Path(t) / "credits.json").write_text(json.dumps([{"file": "images/stock-wikimedia-11.jpg", "source": "wikimedia", "url": "https://c/a",
                                                          "author": "Jane Doe", "licence": "CC BY-SA 4.0", "title": "Server room.jpg"}]))
        credits(t)
        assert "Jane Doe, CC BY-SA 4.0" in (Path(t) / "credits.txt").read_text()
    print("stock demo ok")


def main():
    if sys.argv[1:] == ["demo"]:
        return demo()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--kind", default="video", choices=["video", "photo"])
    s.add_argument("--orientation", default="portrait", choices=["portrait", "landscape", "any"])
    s.add_argument("--n", type=int, default=9)
    s.add_argument("--out")
    s.add_argument("--only", help="comma-separated sources")
    g = sub.add_parser("get")
    g.add_argument("edit")
    g.add_argument("ref")
    g.add_argument("--start", type=float)
    g.add_argument("--end", type=float)
    g.add_argument("--max-s", type=float, default=6.0)
    g.add_argument("--index")
    c = sub.add_parser("credits")
    c.add_argument("edit")
    a = ap.parse_args()
    if a.cmd == "search":
        sys.exit(0 if search(a.query, a.kind, a.orientation, a.n, a.out, a.only.split(",") if a.only else None) else 1)
    if a.cmd == "get":
        get(a.edit, a.ref, a.start, a.end, a.max_s, a.index)
    if a.cmd == "credits":
        credits(a.edit)


if __name__ == "__main__":
    main()
