// From the apple-glass design kit.
"use client";

import { LayoutGroup, MotionConfig, motion } from "motion/react";
import type * as React from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * An iOS 26 segmented control.
 *
 * Per the HIG, glass does not belong in the content layer -- except on a
 * control while it is being used. So the track is a soft fill, and only the
 * thumb is glass: a lens (`.liquid-lens`) that springs to the chosen option
 * and swells slightly as it lands, the "liquid" in Liquid Glass. Reduced
 * motion drops the travel and the swell.
 *
 * `tone="onColor"` is for coloured surfaces (the dashboard hero): a darker
 * track and white labels.
 *
 * `equal` splits the track into equal segments that fill its width, for short
 * fixed option sets (7D / 30D / 90D). The thumb is then one element that
 * slides by whole segment widths -- a pure transform, never a layout
 * measurement -- so the selection can change without anything reflowing.
 */
export interface GlassSegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Accessible name when the label is terse ("7D" -> "Last 7 days"). */
  ariaLabel?: string;
  /**
   * A custom visual in place of the label text (e.g. "A" glyphs of growing
   * size). `label` then becomes the segment's accessible name and tooltip.
   */
  content?: React.ReactNode;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
  /** Trailing adornment, e.g. a "-20%" saving. */
  suffix?: React.ReactNode;
}

interface GlassSegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<GlassSegmentedOption<T>>;
  tone?: "default" | "onColor";
  size?: "sm" | "md";
  /** Name for the group, read by screen readers. */
  label?: string;
  /** Equal-width segments filling the track; see the component docs. */
  equal?: boolean;
  /**
   * Render as tabs (role="tablist") that control panels with ids
   * `${tabsId}-panel-${value}` -- see `SegmentedPanels`. Arrow keys move
   * between tabs. Without it, the control is a group of toggle buttons.
   */
  tabsId?: string;
  className?: string;
}

const THUMB_SPRING = { type: "spring", stiffness: 480, damping: 34 } as const;

export function GlassSegmented<T extends string>({
  value,
  onChange,
  options,
  tone = "default",
  size = "md",
  label,
  equal = false,
  tabsId,
  className,
}: GlassSegmentedProps<T>) {
  const groupId = useId();
  const onColor = tone === "onColor";
  const activeIndex = options.findIndex((o) => o.value === value);

  // The lens: the inner span swells as it lands, re-keyed per value so each
  // landing replays it. Its carrier (layoutId or transform) does the travel
  // -- two transforms, two elements, so the spring and the scale never fight.
  const lens = (
    <motion.span
      key={value}
      className={cn(
        "liquid-lens absolute inset-0 rounded-full",
        onColor && "bg-white/25!",
      )}
      initial={{ scaleX: 1.14, scaleY: 1.08 }}
      animate={{ scaleX: 1, scaleY: 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 20 }}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={groupId}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: role is "tablist" when the arrow-key handler is attached */}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is "group" or "tablist", both take aria-label */}
        <div
          role={tabsId ? "tablist" : "group"}
          onKeyDown={
            tabsId
              ? (event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                    return;
                  event.preventDefault();
                  const step = event.key === "ArrowRight" ? 1 : -1;
                  const next =
                    options[
                      (activeIndex + step + options.length) % options.length
                    ];
                  if (!next) return;
                  onChange(next.value);
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`${tabsId}-tab-${next.value}`)
                      ?.focus(),
                  );
                }
              : undefined
          }
          aria-label={label}
          className={cn(
            "relative max-w-full items-center rounded-full p-1",
            equal ? "grid w-full" : "inline-flex",
            onColor
              ? "bg-black/15 ring-1 ring-white/20 ring-inset"
              : "bg-foreground/6",
            className,
          )}
          style={
            equal
              ? {
                  gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
                }
              : undefined
          }
        >
          {equal && activeIndex >= 0 && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1"
              // 8px = the track's p-1 on both sides.
              style={{ width: `calc((100% - 8px) / ${options.length})` }}
              initial={false}
              animate={{ x: `${activeIndex * 100}%` }}
              transition={THUMB_SPRING}
            >
              {lens}
            </motion.span>
          )}
          {options.map((option) => {
            const active = option.value === value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                {...(tabsId
                  ? {
                      role: "tab",
                      id: `${tabsId}-tab-${option.value}`,
                      "aria-selected": active,
                      "aria-controls": `${tabsId}-panel-${option.value}`,
                      tabIndex: active ? 0 : -1,
                    }
                  : { "aria-pressed": active })}
                aria-label={
                  option.ariaLabel ??
                  (option.content ? option.label : undefined)
                }
                title={option.content ? option.label : undefined}
                onClick={() => onChange(option.value)}
                className={cn(
                  "relative flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium outline-none transition-colors duration-200",
                  // 44pt tall on touch screens without changing the look.
                  "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2 pointer-coarse:after:content-['']",
                  "focus-visible:ring-2 focus-visible:ring-offset-0",
                  size === "sm" ? "h-7 text-xs" : "h-8 text-sm",
                  // Equal segments centre their label in a fixed share of the
                  // track, so side padding would only take room from it (long
                  // translations, larger text sizes).
                  equal
                    ? "min-w-0 px-2"
                    : cn("shrink-0", size === "sm" ? "px-3" : "px-4"),
                  onColor
                    ? cn(
                        "focus-visible:ring-white/70",
                        active
                          ? "text-white"
                          : "text-white/70 hover:text-white",
                      )
                    : cn(
                        "focus-visible:ring-foreground/30",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      ),
                )}
              >
                {active && !equal && (
                  <motion.span
                    aria-hidden
                    layoutId="thumb"
                    transition={THUMB_SPRING}
                    className="absolute inset-0"
                  >
                    {lens}
                  </motion.span>
                )}
                <span className="relative flex min-w-0 items-center gap-1.5">
                  {Icon && <Icon className="size-4" />}
                  {option.content ? (
                    <span aria-hidden className="flex items-center">
                      {option.content}
                    </span>
                  ) : equal ? (
                    <span className="truncate">{option.label}</span>
                  ) : (
                    option.label
                  )}
                  {option.count !== undefined && (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        onColor ? "text-white/70" : "text-muted-foreground",
                      )}
                    >
                      {option.count}
                    </span>
                  )}
                  {option.suffix}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
