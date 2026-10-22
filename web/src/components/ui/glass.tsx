// From the apple-glass design kit.
"use client";

import { motion } from "motion/react";
import * as React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useGlassChoice, useGlassMode } from "@/lib/glass-preference";
import { PRESS_SCALE_ICON, SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A Liquid Glass surface: the regular variant from Apple's HIG (blur plus a
 * luminosity shift -- lighter in light mode, darker in dark mode -- so labels
 * stay legible), with real edge refraction where the browser can do it.
 *
 * Layers, bottom to top:
 *   1. backdrop-filter -- the refracted, blurred, saturated content behind.
 *   2. a translucent fill (`.liquid-glass` background, `--glass-tint`).
 *   3. ::before -- a faint glow pooled under the top edge.
 *   4. ::after  -- a 1px specular hairline lit from above: brightest along
 *      the top, fading down the sides (never a uniform ring).
 *   5. children.
 *
 * Refraction is an SVG `feDisplacementMap` fed a displacement map generated
 * for this element's exact size and corner radius (red = x push, green = y
 * push, 128 = none). Only the bezel -- the outer `bezel` px -- bends; the
 * middle stays flat so labels over it do not wobble. Regular glass bends
 * gently and frosts a little after the bend (`--glass-lens-blur`); clear
 * glass, over media, keeps the stronger lens. Only Chromium applies an SVG
 * filter inside `backdrop-filter`; Safari (including every iOS browser) and
 * Firefox keep the frosted layers without the bend, which is why the frosted
 * look has to stand on its own.
 *
 * The Surface style setting (lib/glass-preference.ts) picks the material:
 * Clear (this, with the lens), Soft (frosted and more opaque, no lens) or
 * Solid (an opaque surface). Reduce Transparency gets Soft until a style is
 * picked, browsers without backdrop-filter get Solid, and Increase Contrast
 * swaps in a solid outlined surface (see `.liquid-glass` in globals.css).
 *
 * The design system, in short (Apple HIG, Materials):
 *   - Glass is for the functional layer only -- navigation and floating
 *     controls: the chat composer and header buttons, Jump to latest, the
 *     Ask bar, the tab bar, floating action bars, segmented controls. Never
 *     cards, panels, lists or backgrounds: the content layer is solid.
 *   - `regular` wherever there is text or the backdrop could fight legibility.
 *     `clear` only over rich media (the tutor's video), with a dim behind it.
 *   - Refraction is for a handful of hero controls.
 *   - Menus, popovers, dialogs and drawers are NOT glass: they hold text over
 *     busy content, so they use the solid `.surface-menu` / `.surface-sheet`
 *     (globals.css) with the same Apple shape.
 *   - Neutral by default. Colour is reserved for meaning (the red end-call).
 */

export type GlassVariant = "regular" | "clear";

interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: GlassVariant;
  /** Real edge refraction where supported. Off: frosted layers only. */
  refract?: boolean;
  /** Corner radius in px. Omit for a capsule/circle (half the short side). */
  radius?: number;
  /**
   * Width of the refracting rim, in px. Default: 34% of the short side
   * (40% for clear glass).
   */
  bezel?: number;
  /** Max displacement at the very edge, in px. Default: scales with size. */
  depth?: number;
  /** Frosting applied before the bend, in px. Kept low: glass is clear. */
  blur?: number;
  /**
   * Colour fringe at the rim (0 = none). Each channel bends a little more.
   * Default 0.05 (0.1 for clear glass).
   */
  chroma?: number;
}

/**
 * The lens's strength. Regular glass -- the controls and bars over text --
 * bends gently, so the rim reads as a thick polished edge rather than a
 * fisheye. Clear glass, over media, keeps the stronger lens it always had
 * (the glass slider's thumb is signed off as is).
 */
const LENS = {
  regular: {
    bezel: 0.34,
    chroma: 0.05,
    push: (short: number) => Math.min(12 + short * 0.32, 36),
  },
  clear: {
    bezel: 0.4,
    chroma: 0.1,
    push: (short: number) => Math.min(24 + short * 0.55, 72),
  },
} as const;

/**
 * What runs after the bend. Clear: saturation only -- no luminosity shift
 * on what it bends, or the picture reads as washed out. Regular: the same
 * frost, saturation and luminosity as the frosted path, read from the
 * material's custom properties so each theme and variant tunes its own.
 */
const LENS_TAIL = {
  regular:
    "blur(var(--glass-lens-blur, 3px)) saturate(var(--glass-saturate, 180%)) brightness(var(--glass-luma, 1))",
  clear: "saturate(150%)",
} as const;

let refractionSupport: boolean | null = null;

function supportsBackdropRefraction(): boolean {
  if (refractionSupport !== null) return refractionSupport;
  if (typeof navigator === "undefined" || typeof CSS === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  // Every iOS browser is WebKit underneath, whatever its name says.
  const iOS =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox/.test(ua);
  refractionSupport =
    chromium && !iOS && CSS.supports("backdrop-filter", "blur(1px)");
  return refractionSupport;
}

/**
 * The displacement map for a rounded rectangle. Each bezel pixel pushes its
 * sample inward along the edge normal, with a circular-arc profile: steep at
 * the rim, flat where the bezel meets the face -- the shape of a thick,
 * polished edge rather than a linear ramp.
 */
function buildDisplacementMap(
  w: number,
  h: number,
  r: number,
  bezel: number,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hw = w / 2;
  const hh = h / 2;

  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - hh;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      const d = -(outside + inside - r); // distance in from the edge

      let dx = 0;
      let dy = 0;
      if (d > 0 && d < bezel) {
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1;
          nx = qx / len;
          ny = qy / len;
        } else if (qx > qy) {
          nx = 1;
          ny = 0;
        } else {
          nx = 0;
          ny = 1;
        }
        nx *= px < 0 ? -1 : 1;
        ny *= py < 0 ? -1 : 1;
        const t = 1 - d / bezel; // 1 at the rim, 0 at the face
        const mag = 1 - Math.sqrt(1 - t * t);
        dx = -nx * mag;
        dy = -ny * mag;
      }

      const i = (y * w + x) * 4;
      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function GlassSurface({
  variant = "regular",
  refract: refractProp = true,
  radius,
  bezel,
  depth,
  blur = 2,
  chroma: chromaProp,
  className,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const lensKind = variant === "clear" ? "clear" : "regular";
  const chroma = chromaProp ?? LENS[lensKind].chroma;
  const ref = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/:/g, "");
  const [refract, setRefract] = useState(false);
  const [map, setMap] = useState<{
    w: number;
    h: number;
    href: string;
    push: number;
    version: number;
  } | null>(null);

  const glassMode = useGlassMode();
  const glassChoice = useGlassChoice();
  // The glass slider's thumb (`.liquid-bead`) is frozen at its signed-off
  // look, CSS and lens alike (globals.css): it keeps the lens unless a
  // surface style says otherwise, as before Reduce Transparency was honoured.
  const frozen = /(^|\s)liquid-bead(\s|$)/.test(className ?? "");
  const lensMode = frozen ? (glassChoice ?? "on") : glassMode;
  useEffect(() => {
    setRefract(
      refractProp && lensMode === "on" && supportsBackdropRefraction(),
    );
  }, [refractProp, lensMode]);

  // Regenerate only when the shape changes. The first map is built right
  // away; while the shape is still changing (the tab bar's collapse) the old
  // map keeps stretching to fit, and a new one is built once the size has
  // settled -- building it every frame (a per-pixel canvas plus a data-URL
  // encode) made that transition stutter on Android. Position changes never
  // touch the map.
  useLayoutEffect(() => {
    if (!refract || !ref.current) return;
    const el = ref.current;
    let frame = 0;
    let settle = 0;
    let built = false;
    const update = () => {
      if (built) {
        window.clearTimeout(settle);
        settle = window.setTimeout(build, 160);
        return;
      }
      build();
    };
    const build = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        built = true;
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (w < 4 || h < 4) return;
        setMap((prev) => {
          if (prev && prev.w === w && prev.h === h) return prev;
          const r = Math.min(radius ?? Math.min(w, h) / 2, w / 2, h / 2);
          const short = Math.min(w, h);
          // A thick pane: the bend reaches about a third of the way in from
          // the rim, and pushes harder on bigger panes so the curve reads at
          // any size.
          const rim = Math.min(
            bezel ?? short * LENS[lensKind].bezel,
            short / 2,
          );
          const href = buildDisplacementMap(w, h, r, rim);
          if (!href) return prev;
          const push = depth ?? LENS[lensKind].push(short);
          return { w, h, href, push, version: (prev?.version ?? 0) + 1 };
        });
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, [refract, radius, bezel, depth, lensKind]);

  // A fresh id per map: some engines cache a filter's output by id and keep
  // painting the old one after the map changes.
  const filterId = map ? `glass-${baseId}-${map.version}` : null;
  const lens = LENS_TAIL[lensKind];
  const refractStyle: React.CSSProperties | undefined =
    refract && filterId
      ? {
          backdropFilter: `url(#${filterId}) ${lens}`,
          WebkitBackdropFilter: `url(#${filterId}) ${lens}`,
        }
      : undefined;

  return (
    <div
      ref={ref}
      className={cn(
        "liquid-glass",
        variant === "clear" && "liquid-glass-clear",
        className,
      )}
      style={{ ...style, ...refractStyle }}
      {...rest}
    >
      {refract && map && filterId && (
        // biome-ignore lint/a11y/noSvgWithoutTitle: filter definitions only; nothing is drawn
        <svg
          aria-hidden
          width="0"
          height="0"
          className="pointer-events-none absolute"
        >
          <filter
            id={filterId}
            x="0"
            y="0"
            width={map.w}
            height={map.h}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={blur}
              edgeMode="duplicate"
              result="frost"
            />
            <feImage
              href={map.href}
              x="0"
              y="0"
              width={map.w}
              height={map.h}
              preserveAspectRatio="none"
              result="map"
            />
            {/* Chromatic aberration: the same lens applied three times at
                slightly different strengths, one colour channel kept from
                each, then screened back together. The flat middle of the
                map has no push, so the fringe only appears at the rim. */}
            <feDisplacementMap
              in="frost"
              in2="map"
              scale={map.push}
              xChannelSelector="R"
              yChannelSelector="G"
              result="bendR"
            />
            <feColorMatrix
              in="bendR"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="r"
            />
            <feDisplacementMap
              in="frost"
              in2="map"
              scale={map.push * (1 + chroma)}
              xChannelSelector="R"
              yChannelSelector="G"
              result="bendG"
            />
            <feColorMatrix
              in="bendG"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="g"
            />
            <feDisplacementMap
              in="frost"
              in2="map"
              scale={map.push * (1 + chroma * 2)}
              xChannelSelector="R"
              yChannelSelector="G"
              result="bendB"
            />
            <feColorMatrix
              in="bendB"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="b"
            />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GlassButton                                                        */
/* ------------------------------------------------------------------ */

const BUTTON_SIZES = {
  sm: "size-9", // 36px: dense desktop toolbars
  toolbar: "size-10 md:size-9", // chat header: six fit a 360px phone
  md: "size-11", // 44px: the HIG minimum tap target -- mobile headers
  lg: "size-[60px]", // call controls
} as const;

const ICON_SIZES = {
  sm: "[&_svg]:size-4",
  toolbar: "[&_svg]:size-[18px] md:[&_svg]:size-4",
  md: "[&_svg]:size-[20px]",
  lg: "[&_svg]:size-6",
} as const;

export interface GlassButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
  > {
  size?: keyof typeof BUTTON_SIZES;
  variant?: GlassVariant;
  /** `active`: a toggled-on control (denser lens). `destructive`: end call. */
  tone?: "default" | "active" | "destructive";
  refract?: boolean;
  /** Accessible name. Icon-only buttons must have one. */
  label: string;
}

/**
 * A round pane of glass holding one icon -- the building block for iOS-26
 * style toolbars and call controls. Presses scale down on a spring; the icon
 * stays neutral unless the tone says otherwise.
 */
export const GlassButton = React.forwardRef<
  HTMLButtonElement,
  GlassButtonProps
>(function GlassButton(
  {
    size = "md",
    variant = "regular",
    tone = "default",
    refract,
    label,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <GlassSurface
      variant={variant}
      refract={refract ?? size !== "sm"}
      className={cn(
        "shrink-0 rounded-full",
        BUTTON_SIZES[size],
        tone === "destructive" && "liquid-glass-destructive",
        disabled && "opacity-50",
        className,
      )}
    >
      {tone === "active" && (
        <span
          aria-hidden
          className="liquid-lens absolute inset-1 rounded-full"
        />
      )}
      <motion.button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: PRESS_SCALE_ICON }}
        transition={SPRING_SNAPPY}
        className={cn(
          "relative flex size-full items-center justify-center rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-foreground/40",
          "disabled:pointer-events-none",
          ICON_SIZES[size],
          tone === "destructive"
            ? "text-white"
            : variant === "clear"
              ? "text-white"
              : "text-foreground",
        )}
        {...(props as React.ComponentProps<typeof motion.button>)}
      >
        {children}
      </motion.button>
    </GlassSurface>
  );
});
