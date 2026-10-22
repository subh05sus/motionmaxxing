import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SPRING_SNAPPY } from "@/lib/motion";

/** Rename: a small sheet with the name selected, Enter saves, Esc cancels. */
export function Rename({ open, title, onSave, onClose }: { open: boolean; title: string; onSave: (t: string) => Promise<void> | void; onClose: () => void }) {
  const [v, setV] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setV(title); setTimeout(() => input.current?.select(), 30); } }, [open, title]);
  const save = async () => { const t = v.trim(); if (t && t !== title) await onSave(t); onClose(); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onMouseDown={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={SPRING_SNAPPY}
            onMouseDown={(e) => e.stopPropagation()} className="surface-sheet w-[340px] rounded-[14px] p-4">
            <h2 className="headline">Rename</h2>
            <input ref={input} value={v} onChange={(e) => setV(e.target.value)} maxLength={80}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") onClose(); }}
              className="mt-3 h-8 w-full rounded-md bg-input px-2 outline-none focus:ring-2 focus:ring-primary/50" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="h-7 rounded-md px-3 hover:bg-foreground/10">Cancel</button>
              <button onClick={() => void save()} disabled={!v.trim()} className="h-7 rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">Save</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
