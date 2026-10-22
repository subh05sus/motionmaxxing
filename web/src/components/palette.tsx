import { AnimatePresence, motion } from "motion/react";
import { Film, House, Library, MonitorPlay, Moon, Palette as PaletteIcon, Plus, Search, Settings, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { navigate } from "@/lib/router";
import { SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface Item { id: string; label: string; hint?: string; icon: typeof Film; run: () => void }

export function toggleTheme(): void {
  const dark = document.documentElement.classList.toggle("dark");
  try { localStorage.setItem("motionmaxxing:theme", dark ? "dark" : "light"); } catch { /* private window */ }
}

/** ⌘K: jump to a page or a video, or do something. A solid menu surface (it holds text), never glass. */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [videos, setVideos] = useState<{ id: string; title: string; status: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQ(""); setI(0);
    api<typeof videos>("/api/videos").then(setVideos).catch(() => setVideos([]));
    setTimeout(() => input.current?.focus(), 20);
  }, [open]);
  const items = useMemo<Item[]>(() => {
    const go = (p: string) => () => { navigate(p); onClose(); };
    const all: Item[] = [
      { id: "new", label: "New video", hint: "Drop a raw take", icon: Plus, run: go("/new") },
      { id: "home", label: "Home", icon: House, run: go("/") },
      { id: "videos", label: "Videos", icon: Film, run: go("/videos") },
      { id: "demos", label: "Demos", hint: "Claude records a site", icon: MonitorPlay, run: go("/demos") },
      { id: "styles", label: "Styles", icon: PaletteIcon, run: go("/styles") },
      { id: "library", label: "Library", icon: Library, run: go("/library") },
      { id: "settings", label: "Settings", icon: Settings, run: go("/settings") },
      { id: "setup", label: "Check the setup", icon: Wrench, run: go("/setup") },
      { id: "theme", label: "Switch dark and light", icon: Moon, run: () => { toggleTheme(); onClose(); } },
      ...videos.map((v) => ({ id: `v:${v.id}`, label: v.title, hint: v.status, icon: Film, run: go(`/videos/${encodeURIComponent(v.id)}`) })),
    ];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    // A match in the name beats one in the hint; a name that starts with it beats one that contains it.
    const rank = (x: Item) => { const l = x.label.toLowerCase(); return l.startsWith(s) ? 0 : l.includes(s) ? 1 : x.hint?.toLowerCase().includes(s) ? 2 : 3; };
    return all.filter((x) => rank(x) < 3).sort((a, b) => rank(a) - rank(b));
  }, [q, videos, onClose]);
  useEffect(() => { setI(0); }, [q]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onMouseDown={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.98, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }} transition={SPRING_SNAPPY}
            onMouseDown={(e) => e.stopPropagation()} className="surface-menu w-[560px] max-w-[92vw] overflow-hidden rounded-[14px]">
            <div className="flex h-11 items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos, pages and actions"
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "ArrowDown") { e.preventDefault(); setI((n) => Math.min(items.length - 1, n + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
                  if (e.key === "Enter") items[i]?.run();
                }}
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint-foreground" />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-1.5">
              {items.length ? items.map((it, n) => (
                <li key={it.id}>
                  <button onMouseEnter={() => setI(n)} onClick={it.run}
                    className={cn("row w-full text-left", n === i && "bg-primary text-primary-foreground")}>
                    <it.icon className={cn("size-4 shrink-0", n === i ? "" : "text-muted-foreground")} />
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && <span className={cn("caption", n === i && "text-primary-foreground/80")}>{it.hint}</span>}
                  </button>
                </li>
              )) : <li className="p-4 text-center text-muted-foreground">Nothing matches</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
