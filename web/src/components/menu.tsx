import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface MenuItem { label: string; icon?: ReactNode; run: () => void; danger?: boolean; hidden?: boolean }

/** A Mac context menu: a solid menu surface at a point (right-click or the … button), Esc or a click outside closes it. */
export function Menu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", off);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => { window.removeEventListener("mousedown", off); window.removeEventListener("keydown", key); window.removeEventListener("blur", onClose); };
  }, [at, onClose]);
  const shown = items.filter((i) => !i.hidden);
  const W = 208, H = shown.length * 28 + 10;
  const x = at ? Math.min(at.x, window.innerWidth - W - 8) : 0;
  const y = at ? Math.min(at.y, window.innerHeight - H - 8) : 0;
  return (
    <AnimatePresence>
      {at && (
        <motion.div ref={ref} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={SPRING_SNAPPY} style={{ left: x, top: y, width: W, transformOrigin: "0 0" }} role="menu"
          className="surface-menu fixed z-50 rounded-[10px] p-[5px]" onContextMenu={(e) => e.preventDefault()}>
          {shown.map((i) => (
            <button key={i.label} role="menuitem" onClick={() => { onClose(); i.run(); }}
              className={cn("flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left hover:bg-primary hover:text-primary-foreground",
                i.danger && "text-destructive hover:bg-destructive hover:text-white")}>
              <span className="grid size-4 place-items-center">{i.icon}</span>{i.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
