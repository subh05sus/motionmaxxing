// From the apple-glass design kit.
"use client";

import { motion, useReducedMotion } from "motion/react";
import { SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A check that draws itself: the disc scales in, then the tick strokes
 * across it. The confirmation glyph for anything completed -- a topic done,
 * a correct answer, a mistake resolved, a saved setting. Animates only when
 * `checked` changes, never on first render.
 */
export function CheckDraw({
  checked,
  size = 20,
  className,
  discClassName = "fill-primary",
  tickClassName = "stroke-primary-foreground",
  ringClassName = "stroke-muted-foreground/45",
  label,
}: {
  checked: boolean;
  size?: number;
  className?: string;
  discClassName?: string;
  tickClassName?: string;
  /** The empty ring shown while unchecked; pass "" to hide it. */
  ringClassName?: string;
  label?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {ringClassName && (
        <circle
          cx="10"
          cy="10"
          r="8.25"
          fill="none"
          strokeWidth="1.5"
          className={cn(
            "transition-opacity duration-200",
            ringClassName,
            checked && "opacity-0",
          )}
        />
      )}
      <motion.circle
        cx="10"
        cy="10"
        r="9"
        className={discClassName}
        style={{ originX: "50%", originY: "50%" }}
        initial={false}
        animate={{
          scale: checked ? 1 : reduce ? 1 : 0.4,
          opacity: checked ? 1 : 0,
        }}
        transition={SPRING_SNAPPY}
      />
      <motion.path
        d="M6.2 10.4 L8.8 12.9 L13.9 7.4"
        fill="none"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={tickClassName}
        initial={false}
        animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={
          reduce
            ? { duration: 0 }
            : {
                pathLength: { duration: 0.22, delay: checked ? 0.08 : 0 },
                opacity: { duration: 0.1 },
              }
        }
      />
    </svg>
  );
}
