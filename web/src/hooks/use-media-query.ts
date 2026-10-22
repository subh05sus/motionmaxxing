// From the apple-glass design kit.
"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a media query. Reads the real value on the client's first
 * render (no false-then-true flash after hydration of client-only UI), and
 * `false` during server rendering.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-sized screens: where sheets come from the bottom. */
export function useIsPhone() {
  return useMediaQuery("(max-width: 767px)");
}

/** A touch screen without hover, where swipe gestures are the way in. */
export function useCoarsePointer() {
  return useMediaQuery("(pointer: coarse)");
}
