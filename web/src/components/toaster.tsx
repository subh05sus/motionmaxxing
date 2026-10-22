import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Toast } from "@/lib/toast";
import { SPRING_SNAPPY } from "@/lib/motion";

/** The toasts: one at a time, bottom centre, glass (it floats over everything), gone after 6 s or its action. */
export function Toaster() {
  const [t, setT] = useState<Toast | null>(null);
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent<Toast>).detail);
    window.addEventListener("mm:toast", on);
    return () => window.removeEventListener("mm:toast", on);
  }, []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT((x) => (x?.id === t.id ? null : x)), 6000);
    return () => clearTimeout(h);
  }, [t]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center md:bottom-6">
      <AnimatePresence>
        {t && (
          <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.16 } }}
            transition={SPRING_SNAPPY} className="liquid-glass liquid-glass-milky pointer-events-auto flex items-center gap-3 rounded-full py-2 pr-2 pl-4">
            <span>{t.text}</span>
            {t.action && (
              <button onClick={async () => { const a = t.action!; setT(null); await a.run(); }}
                className="h-7 rounded-full bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97]">{t.action.label}</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
