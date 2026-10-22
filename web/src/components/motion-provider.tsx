// From the apple-glass design kit.
"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * One switch for reduced motion across the app: with the OS setting on, every
 * `motion` component drops transform and layout animation and keeps only
 * opacity, so nothing slides, scales or springs. Components that need a
 * different fallback still read `useReducedMotion` themselves.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
