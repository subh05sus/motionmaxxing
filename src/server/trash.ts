import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY } from "./paths.js";

/**
 * Recently deleted: a deleted video, demo, script or b-roll clip moves into <library>/.trash/<key>/ with what it was and where it
 * came from, so Undo and Restore put it back exactly. "Delete forever" hands it to the Mac's Trash (Finder can
 * still put it back from there). Nothing is ever removed with rm.
 */

export const TRASH = path.join(LIBRARY, ".trash");
export type Kind = "video" | "demo" | "script" | "broll";
export interface Deleted { key: string; kind: Kind; id: string; title: string; at: string; items: { from: string; name: string }[] }

const meta = (key: string): Deleted | null => {
  try { return JSON.parse(readFileSync(path.join(TRASH, key, "deleted.json"), "utf8")); } catch { return null; }
};

/** Move these paths into one trash entry. Each must be inside the library. -> the entry. */
export function trash(kind: Kind, id: string, title: string, paths: string[]): Deleted {
  mkdirSync(TRASH, { recursive: true });
  const key = `${new Date().toISOString().replace(/[:.]/g, "-")}__${kind}__${path.basename(id)}`;
  const dir = path.join(TRASH, key);
  mkdirSync(dir, { recursive: true });
  const items: Deleted["items"] = [];
  for (const [i, p] of paths.entries()) {
    if (!p || !existsSync(p) || !path.resolve(p).startsWith(LIBRARY + path.sep)) continue;
    const name = `${i}-${path.basename(p)}`;
    renameSync(p, path.join(dir, name));
    items.push({ from: path.resolve(p), name });
  }
  const d: Deleted = { key, kind, id, title, at: new Date().toISOString(), items };
  writeFileSync(path.join(dir, "deleted.json"), JSON.stringify(d, null, 1));
  return d;
}

/** Put an entry back where it was. A place taken since gets a free name beside it. -> the restored id. */
export function restore(key: string): { kind: Kind; id: string } {
  const d = meta(path.basename(key));
  if (!d) throw new Error("that is no longer in Recently deleted");
  const dir = path.join(TRASH, d.key);
  let id = d.id;
  for (const it of d.items) {
    let to = it.from;
    if (existsSync(to)) {
      const ext = path.extname(to), base = to.slice(0, to.length - ext.length);
      let n = 2;
      while (existsSync(`${base}-${n}${ext}`)) n++;
      to = `${base}-${n}${ext}`;
      if (it === d.items[0]) id = path.basename(to);
    }
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(path.join(dir, it.name), to);
  }
  rmSync(dir, { recursive: true, force: true });   // only deleted.json is left in it
  return { kind: d.kind, id };
}

export function list(): Deleted[] {
  if (!existsSync(TRASH)) return [];
  return readdirSync(TRASH).filter((n) => statSync(path.join(TRASH, n)).isDirectory()).map(meta)
    .filter((d): d is Deleted => !!d).sort((a, b) => b.at.localeCompare(a.at));
}

/** Hand an entry to the Mac's Trash (Finder can put it back from there). */
export function purge(key: string): Promise<void> {
  const dir = path.join(TRASH, path.basename(key));
  if (!existsSync(dir)) return Promise.reject(new Error("that is no longer in Recently deleted"));
  return new Promise((resolve, reject) => {
    const pr = spawn("osascript", ["-e", "on run argv", "-e", "set f to POSIX file (item 1 of argv) as alias", "-e",
      'tell application "Finder" to delete f', "-e", "end run", dir]);
    pr.on("close", (c) => (c ? reject(new Error("Finder could not move it to the Trash")) : resolve()));
  });
}
