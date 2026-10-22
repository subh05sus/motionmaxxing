import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { SPRING_SNAPPY } from "@/lib/motion";

/** An alert, macOS style: only for actions that destroy something. A solid elevated surface, never glass. */
export function Confirm({ open, title, body, action, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; action: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onCancel]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onMouseDown={onCancel}>
          <motion.div role="alertdialog" aria-modal initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={SPRING_SNAPPY}
            onMouseDown={(e) => e.stopPropagation()} className="surface-sheet w-[300px] rounded-[14px] p-4 text-center">
            <h2 className="headline">{title}</h2>
            <div className="mt-1.5 text-[12px] leading-[16px] text-muted-foreground">{body}</div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button autoFocus onClick={onCancel} className="h-7 rounded-md bg-foreground/10 font-medium hover:bg-foreground/15 active:scale-[0.97]">Cancel</button>
              <button onClick={onConfirm} className="h-7 rounded-md bg-destructive font-medium text-white active:scale-[0.97]">{action}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
