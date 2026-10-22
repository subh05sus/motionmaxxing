import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(path, { ...rest, ...(json !== undefined ? { method: rest.method ?? "POST", body: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${r.status}`);
  return data as T;
}

/** GET a path, again whenever `reload()` is called or one of the studio's live events names it. */
export function useApi<T>(path: string | null, deps: unknown[] = []): { data: T | undefined; error?: string; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    api<T>(path).then((d) => { if (n === seq.current) { setData(d); setError(undefined); setLoading(false); } })
      .catch((e: Error) => { if (n === seq.current) { setError(e.message); setLoading(false); } });
  }, [path]);
  useEffect(() => { setLoading(true); reload(); }, [reload, ...deps]);
  return { data, error, reload, loading };
}

type Handler = (type: string, data: any) => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;
function connect(): void {
  if (source) return;
  source = new EventSource("/api/events");
  for (const t of ["video", "demo", "session", "setup", "hello"]) source.addEventListener(t, (e) => {
    const data = JSON.parse((e as MessageEvent).data || "{}");
    for (const h of handlers) h(t, data);
  });
  source.onerror = () => { source?.close(); source = null; setTimeout(connect, 1500); };
}

/** The studio's live events: a video changed, a conversation moved, setup progressed. */
export function useEvents(handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    connect();
    const h: Handler = (t, d) => ref.current(t, d);
    handlers.add(h);
    return () => { handlers.delete(h); };
  }, []);
}

/** Upload a file into the library: a new video. Calls back with 0..1 as it goes. */
export function upload(file: File, onProgress: (p: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/videos");
    x.setRequestHeader("x-filename", encodeURIComponent(file.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText || `HTTP ${x.status}`)));
    x.onerror = () => reject(new Error("the upload stopped"));
    x.send(file);
  });
}
