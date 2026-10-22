// From the apple-glass design kit.
"use client";

import { useSyncExternalStore } from "react";
import { GLASS_STORAGE_KEY } from "./glass-boot";

/**
 * The Liquid Glass preference (Settings > Appearance > Surface style): a
 * per-browser setting, not an account one.
 *
 *   on      -- Clear: the glass with its edge refraction (the default)
 *   frosted -- Soft: frosted glass without the bend; cheaper on the GPU
 *   off     -- Solid: opaque surfaces everywhere glass would be
 *
 * Until a style is picked, the OS Reduce Transparency setting is honoured
 * the way Apple platforms do it -- frostier, more opaque glass, i.e. Soft --
 * rather than Solid: Windows reports its "Transparency effects" switch as
 * that signal, and turning the whole app opaque for everyone who flips it
 * read as a bug. A choice made here wins over it either way (Clear brings
 * the lens back, Solid goes fully opaque). Applied as `data-glass` on
 * <html> (see globals.css), before first paint by the boot script in the
 * root layout, so there is no flash of the wrong material.
 */
export type GlassMode = "on" | "frosted" | "off";

const KEY = GLASS_STORAGE_KEY;
const EVENT = "motionmaxxing:glass-change";
const REDUCE_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";

function isMode(value: unknown): value is GlassMode {
  return value === "on" || value === "frosted" || value === "off";
}

/** The style picked in Settings, if any. */
export function readGlassChoice(): GlassMode | null {
  try {
    const value = localStorage.getItem(KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

function reducedTransparency(): boolean {
  try {
    return window.matchMedia(REDUCE_TRANSPARENCY).matches;
  } catch {
    return false;
  }
}

/** The style in effect: the choice, else what the OS asks for. */
export function readGlassMode(): GlassMode {
  return readGlassChoice() ?? (reducedTransparency() ? "frosted" : "on");
}

function apply(choice: GlassMode | null) {
  if (choice) document.documentElement.dataset.glass = choice;
  else delete document.documentElement.dataset.glass;
}

export function setGlassMode(mode: GlassMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked: still applies for this page view.
  }
  apply(mode);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  // `storage` fires in other tabs; the custom event covers this one; the
  // media query covers the OS setting changing while nothing is chosen.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    apply(readGlassChoice());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onChange);
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia(REDUCE_TRANSPARENCY);
    media.addEventListener("change", onChange);
  } catch {
    media = null;
  }
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onChange);
    media?.removeEventListener("change", onChange);
  };
}

export function useGlassMode(): GlassMode {
  return useSyncExternalStore(subscribe, readGlassMode, () => "on");
}

/** The style picked in Settings, or null while the OS decides. */
export function useGlassChoice(): GlassMode | null {
  return useSyncExternalStore(subscribe, readGlassChoice, () => null);
}
