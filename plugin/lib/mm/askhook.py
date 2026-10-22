"""Pictures the user attaches in the studio (a note's screenshot, an image added to an edit). Stdlib only."""
import base64
import re
from pathlib import Path

MAX_IMAGE = 15 << 20      # one attached image
MAX_IMAGES = 6


def save_images(folder, imgs, prefix, keep=()):
    """Attached pictures: names already kept (keep) and pasted, dropped or picked data urls (saved into folder).
    Only png, jpeg, gif and webp, under MAX_IMAGE each, at most MAX_IMAGES. The saved names, in order."""
    folder = Path(folder)
    out = []
    for im in imgs:
        if len(out) == MAX_IMAGES or not isinstance(im, str):
            continue
        if im in keep:
            out.append(im)
            continue
        m = re.match(r"data:image/(png|jpeg|gif|webp);base64,(.+)", im, re.S)
        if not m:
            continue
        try:
            raw = base64.b64decode(m[2])
        except ValueError:
            continue
        if len(raw) > MAX_IMAGE:
            continue
        folder.mkdir(parents=True, exist_ok=True)
        k = 1
        while any((folder / f"{prefix}-img{k}.{x}").exists() for x in ("jpg", "png", "gif", "webp")):
            k += 1
        name = f"{prefix}-img{k}.{'jpg' if m[1] == 'jpeg' else m[1]}"
        (folder / name).write_bytes(raw)
        out.append(name)
    return out
