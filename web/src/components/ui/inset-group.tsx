// From the apple-glass design kit.
"use client";

import { ChevronRight } from "lucide-react";
import { Link } from "@/lib/router";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * iOS Settings-style grouped lists: a quiet caption above a rounded inset
 * panel of rows separated by inset hairlines, with an optional footnote
 * below. Used for Settings, Profile, Billing and Integrations -- content
 * lists elsewhere stay flat (`List` / `ListRow`).
 */
export function InsetGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {title && (
        <h2 className="px-4 text-13 font-medium text-muted-foreground">
          {title}
        </h2>
      )}
      <ul className="min-w-0 overflow-hidden rounded-xl bg-foreground/[0.035] dark:bg-foreground/[0.06] [&>li+li]:border-t [&>li+li]:border-border/60">
        {children}
      </ul>
      {footer && (
        <p className="px-4 text-xs leading-relaxed text-muted-foreground">
          {footer}
        </p>
      )}
    </section>
  );
}

/**
 * One row of an `InsetGroup`. 52px minimum (44pt+ target), icon tile on the
 * left, label and optional detail, and on the right either a value, a
 * control (`trailing`: a switch, a button) or -- for navigation rows -- a
 * chevron. `href`/`onClick` make the whole row tappable with press feedback.
 */
export function InsetRow({
  icon,
  iconClassName,
  label,
  detail,
  value,
  trailing,
  href,
  onClick,
  destructive = false,
  disabled = false,
  htmlFor,
  className,
}: {
  icon?: React.ReactNode;
  /** Tint for the icon tile, e.g. "bg-blue-500 text-white". */
  iconClassName?: string;
  label: React.ReactNode;
  detail?: React.ReactNode;
  /** A read-only value on the right (e.g. "English", "Pro"). */
  value?: React.ReactNode;
  /** A control on the right (switch, button). */
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Makes the label a <label> for a control in `trailing`. */
  htmlFor?: string;
  className?: string;
}) {
  const navigates = Boolean(href || onClick);
  const body = (
    <>
      {icon && (
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-foreground/[0.07] text-foreground/75 [&_svg]:size-[17px]",
            iconClassName,
          )}
        >
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className={cn(
              "truncate text-15 leading-snug",
              destructive && "text-destructive",
            )}
          >
            {label}
          </label>
        ) : (
          <span
            className={cn(
              "truncate text-15 leading-snug",
              destructive && "text-destructive",
            )}
          >
            {label}
          </span>
        )}
        {detail && (
          <span className="mt-0.5 text-13 leading-snug text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      {value !== undefined && value !== null && (
        <span className="min-w-0 max-w-[55%] truncate text-end text-15 text-muted-foreground">
          {value}
        </span>
      )}
      {trailing && <span className="relative z-10 shrink-0">{trailing}</span>}
      {navigates && !trailing && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 rtl:-scale-x-100" />
      )}
    </>
  );

  const rowClass = cn(
    "flex min-h-[52px] w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left",
    navigates &&
      "transition-colors hover:bg-foreground/[0.035] active:bg-foreground/[0.07] focus-visible:bg-foreground/[0.05] outline-none",
    disabled && "pointer-events-none opacity-50",
    className,
  );

  return (
    <li className="min-w-0">
      {href ? (
        <Link href={href} className={rowClass}>
          {body}
        </Link>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={rowClass}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}
