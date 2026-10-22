// From the apple-glass design kit.
/**
 * Shared motion tokens.
 *
 * Calm, iOS-style springs: critically damped or close to it, so things land
 * without a visible bounce. Use these instead of inventing a spring per
 * component -- the same action should feel the same everywhere.
 *
 * Reduced motion is handled once, app-wide, by `<MotionProvider>`
 * (`MotionConfig reducedMotion="user"`): transforms are dropped and opacity
 * kept. Components only need `useReducedMotion` when they want a different
 * fallback than "no travel".
 */

/** Taps, toggles, small state changes (~200ms settle). */
export const SPRING_SNAPPY = {
  type: "spring",
  stiffness: 520,
  damping: 40,
  mass: 1,
} as const;

/** Panels, sheets, cards entering (~300ms settle). */
export const SPRING_DEFAULT = {
  type: "spring",
  stiffness: 380,
  damping: 38,
  mass: 1,
} as const;

/** Full-screen pushes and pops (~350ms settle, no overshoot). */
export const SPRING_PAGE = {
  type: "spring",
  stiffness: 300,
  damping: 34,
  mass: 1,
} as const;

/**
 * Earned moments only -- a goal reached, a quiz finished, a badge unlocked.
 * A touch of life (damping ratio ~0.6), never a cartoon bounce.
 */
export const SPRING_REWARD = {
  type: "spring",
  stiffness: 320,
  damping: 22,
  mass: 1,
} as const;

/** Exits run at about two thirds of the enter time. */
export const EASE_EXIT = {
  type: "tween",
  ease: [0.4, 0, 1, 1],
  duration: 0.16,
} as const;

/** Decelerating curve for CSS transitions that pair with the springs. */
export const EASE_OUT_CSS = "cubic-bezier(0.2, 0, 0, 1)";

/** Delay between siblings in a staggered entrance. */
export const STAGGER = 0.04;

/** Long lists stop staggering after this many rows, so they never drag. */
export const STAGGER_CAP = 8;

/** Entrance delay for the i-th item of a staggered list. */
export function staggerDelay(index: number) {
  return Math.min(index, STAGGER_CAP) * STAGGER;
}

/** Press feedback for anything tappable. */
export const PRESS_SCALE = 0.97;

/** Small round icon buttons press a little deeper, like iOS toolbar glyphs. */
export const PRESS_SCALE_ICON = 0.9;

/**
 * A light haptic tap. Android only -- iOS Safari has no web vibration API,
 * so this is a no-op there (and on desktop).
 *
 *  - `selection`: the faintest tick, for scrubbing and pickers
 *  - `tick`: a control changed (toggle, tab, swipe threshold)
 *  - `success`: something was completed (graded, saved, done)
 *  - `warning`: something was refused (limit reached, wrong answer)
 */
export function haptic(
  kind: "selection" | "tick" | "success" | "warning" = "tick",
) {
  if (typeof navigator === "undefined") return;
  const pattern =
    kind === "selection"
      ? 4
      : kind === "success"
        ? [8, 40, 12]
        : kind === "warning"
          ? [12, 60, 12]
          : 8;
  navigator.vibrate?.(pattern);
}
