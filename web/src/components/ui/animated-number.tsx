// From the apple-glass design kit.
"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { haptic, SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A number whose value rolls like an odometer when it changes: up when it
 * grows, down when it shrinks. Use it for counts and balances that change
 * while you watch; use `CountUp` for a result revealed once.
 *
 * `showDelta` floats a "+N" that rises and fades whenever the value goes up
 * (a top-up, a promo code, XP) -- the earned-moment flourish, with a success
 * haptic. It never shows on the first render.
 */
export function AnimatedNumber({
  value,
  format,
  showDelta = false,
  formatDelta,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  showDelta?: boolean;
  formatDelta?: (delta: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const previous = useRef(value);
  const direction = value >= previous.current ? 1 : -1;
  const [delta, setDelta] = useState<{ id: number; amount: number } | null>(
    null,
  );

  useEffect(() => {
    const diff = value - previous.current;
    previous.current = value;
    if (showDelta && diff > 0) {
      setDelta({ id: Date.now(), amount: diff });
      haptic("success");
    }
  }, [value, showDelta]);

  const text = format ? format(value) : String(value);

  return (
    <span
      className={cn(
        "relative inline-flex align-baseline tabular-nums",
        className,
      )}
    >
      {reduce ? (
        <span>{text}</span>
      ) : (
        <span className="relative inline-flex overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout" custom={direction}>
            <motion.span
              key={text}
              custom={direction}
              variants={{
                enter: (d: number) => ({
                  y: d > 0 ? "100%" : "-100%",
                  opacity: 0,
                }),
                center: { y: "0%", opacity: 1 },
                exit: (d: number) => ({
                  y: d > 0 ? "-100%" : "100%",
                  opacity: 0,
                }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SPRING_SNAPPY}
              className="inline-block"
            >
              {text}
            </motion.span>
          </AnimatePresence>
        </span>
      )}
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.id}
            aria-hidden
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: [0, 1, 1, 0], y: reduce ? 0 : -18 }}
            transition={{
              duration: 1.4,
              times: [0, 0.15, 0.7, 1],
              ease: "easeOut",
            }}
            onAnimationComplete={() => setDelta(null)}
            className="pointer-events-none absolute -top-1 start-full ms-1 whitespace-nowrap font-semibold text-[0.7em] text-success"
          >
            {formatDelta ? formatDelta(delta.amount) : `+${delta.amount}`}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Counts from `from` to `to` once, decelerating -- a score or total being
 * revealed. Under reduced motion it shows the final value straight away.
 */
export function CountUp({
  to,
  from = 0,
  duration = 0.9,
  delay = 0,
  format,
  className,
}: {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? to : from);

  useEffect(() => {
    if (reduce) {
      setDisplay(to);
      return;
    }
    const controls = animate(from, to, {
      duration,
      delay,
      ease: [0.2, 0, 0, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [from, to, duration, delay, reduce]);

  return (
    <span className={cn("tabular-nums", className)}>
      {format ? format(display) : display}
    </span>
  );
}
