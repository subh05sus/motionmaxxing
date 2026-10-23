import { useSyncExternalStore } from "react";

/** Clips on their way into the library: the first dropped makes the video, the rest join it. Pages show them from
 *  this store, so an upload carries on (and stays visible) when Home hands over to New video. */
export interface Upload { key: string; video?: string; name: string; size: number; pct: number; state: "waiting" | "uploading" | "done" | "failed"; error?: string }

let uploads: Upload[] = [];
const subs = new Set<() => void>();
const emit = () => { uploads = [...uploads]; for (const f of subs) f(); };

export function useUploads(): Upload[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => uploads);
}

/** Video files only: a dropped folder's .DS_Store or a script stays out. */
export const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|mkv|webm)$/i.test(f.name);

/** The video files of a drop: loose files, and every file in a dropped folder (its subfolders too), by name. The
 *  entries are taken during the drop event itself: the browser empties the drop once the handler returns. */
export function droppedVideos(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const loose = [...dt.files];
  if (!entries.some((e) => e.isDirectory)) return Promise.resolve(loose.filter(isVideo));
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) { out.push(await new Promise<File>((ok, no) => (e as FileSystemFileEntry).file(ok, no))); return; }
    const reader = (e as FileSystemDirectoryEntry).createReader();
    for (;;) {   // a folder reads in batches of up to 100
      const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
      if (!batch.length) break;
      for (const x of batch) if (!x.name.startsWith(".")) await walk(x);
    }
  };
  return (async () => {
    for (const e of entries) await walk(e);
    return out.filter(isVideo).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  })();
}

/** One file into the studio (the body is the file, x-filename its name), with its progress 0..1. */
export function sendFile(url: string, file: File, onPct: (p: number) => void): Promise<{ id?: string; n?: number; file?: string }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("x-filename", encodeURIComponent(file.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onPct(e.loaded / e.total); };
    x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText || `HTTP ${x.status}`)));
    x.onerror = () => reject(new Error("the upload stopped"));
    x.send(file);
  });
}

/** Upload dropped clips into a video (a new one when none is given): the first makes it, the rest follow two at a
 *  time. Resolves with the video's id as soon as it exists; the others keep going in the background. */
export async function uploadClips(files: File[], video?: string): Promise<string> {
  const items: Upload[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, video, name: f.name, size: f.size, pct: 0, state: "waiting" }));
  uploads = [...uploads.filter((u) => u.state !== "done"), ...items];
  emit();
  let id = video;
  const one = async (i: number) => {
    const it = items[i]!;
    it.state = "uploading"; emit();
    try {
      const r = await sendFile(id ? `/api/videos/${encodeURIComponent(id)}/files` : "/api/videos", files[i]!, (p) => { it.pct = p; emit(); });
      if (!id && r.id) { id = r.id; for (const x of items) x.video = id; }
      it.state = "done"; it.pct = 1;
    } catch (e) { it.state = "failed"; it.error = (e as Error).message; }
    emit();
  };
  if (!id) {
    await one(0);
    if (!id) throw new Error(items[0]!.error ?? "the upload stopped");
  }
  const rest = items.map((_, i) => i).filter((i) => items[i]!.state === "waiting");
  void (async () => { for (let k = 0; k < rest.length; k += 2) await Promise.all(rest.slice(k, k + 2).map(one)); })();
  return id;
}
