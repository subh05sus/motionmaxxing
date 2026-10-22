// From the apple-glass design kit.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Press: a 0.97 scale on the shared decelerating curve (Tailwind v4's `scale`
 * is its own CSS property, hence `scale` in the transition list).
 *
 * Touch target: on touch screens an invisible `::after` grows every size to
 * at least 44pt tall (icon sizes on all sides) without changing layout.
 * `relative` anchors it; a caller's `absolute`/`fixed` replaces it and still
 * anchors it.
 *
 * Keyboard focus: `focus-ring` (globals.css), the app-wide 2px ring with a
 * 2px gap, so it reads on every fill; a caller's own focus-visible: classes
 * replace it.
 */
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-ring aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-ring-destructive dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default:
          "h-9 px-4 py-2 has-[>svg]:px-3 pointer-coarse:after:-inset-y-1",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 pointer-coarse:after:-inset-y-1.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4 pointer-coarse:after:-inset-y-0.5",
        icon: "size-9 pointer-coarse:after:-inset-1",
        "icon-sm": "size-8 pointer-coarse:after:-inset-1.5",
        "icon-lg": "size-10 pointer-coarse:after:-inset-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * Waiting on the server: a spinner replaces the content (the button keeps
     * its exact width) and the button is disabled.
     */
    loading?: boolean;
    /** Just finished: a check pops in briefly. Pair with `useAsyncAction`. */
    success?: boolean;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  success = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const busy = !asChild && (loading || success);

  return (
    <Comp
      data-slot="button"
      aria-busy={loading || undefined}
      // Disabled while loading, but not dimmed: the spinner is the signal.
      data-loading={loading || undefined}
      disabled={asChild ? disabled : disabled || loading}
      className={cn(
        buttonVariants({ variant, size, className }),
        busy && "[&>*:not([data-busy-overlay])]:invisible",
        loading && "opacity-100!",
      )}
      {...props}
    >
      {busy ? (
        <>
          {/* Bare text is wrapped so it can be hidden too; icons stay direct
              children so `has-[>svg]` padding (and the width) don't change. */}
          {React.Children.map(children, (child) =>
            typeof child === "string" || typeof child === "number" ? (
              <span>{child}</span>
            ) : (
              child
            ),
          )}
          <span
            data-busy-overlay=""
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Check className="animate-in fade-in-0 zoom-in-50 duration-200" />
            )}
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
