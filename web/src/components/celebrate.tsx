import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { CheckDraw } from "@/components/ui/check-draw";
import { Link } from "@/lib/router";
import { SPRING_REWARD } from "@/lib/motion";

export interface Moment { id: number; title: string; body: string; href?: string }

/** An earned moment: a render or an export is done. A glass toast with a check that draws itself, then it goes. */
export function Celebrate({ moment, onDone }: { moment: Moment | null; onDone: () => void }) {
  const [shown, setShown] = useState<Moment | null>(null);
  useEffect(() => {
    if (!moment) return;
    setShown(moment);
    const t = setTimeout(() => { setShown(null); onDone(); }, 4200);
    return () => clearTimeout(t);
  }, [moment, onDone]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
      <AnimatePresence>
        {shown && (
          <motion.div key={shown.id} initial={{ opacity: 0, y: -14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.16 } }} transition={SPRING_REWARD}
            className="liquid-glass liquid-glass-milky pointer-events-auto flex items-center gap-3 rounded-full py-2 pr-5 pl-2.5">
            <CheckDraw checked size={26} />
            <div>
              <p className="headline">{shown.title}</p>
              <p className="caption">{shown.body}</p>
            </div>
            {shown.href && <Link href={shown.href} onClick={() => setShown(null)} className="ml-2 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground">Watch</Link>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
