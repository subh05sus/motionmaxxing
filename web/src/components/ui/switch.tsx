// From the apple-glass design kit.
"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * An iOS-proportioned switch (44 x 26). The thumb glides on the shared
 * decelerating curve and widens slightly while pressed, like UISwitch. On
 * touch screens an invisible margin brings the target to 44pt tall.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-[26px] w-11 shrink-0 items-center rounded-full border border-transparent p-[2px] outline-none",
        "transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/15 dark:data-[state=unchecked]:bg-foreground/25",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-[9px] pointer-coarse:after:-inset-x-1 pointer-coarse:after:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.08)] ring-0",
          "transition-[transform,width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
          "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[18px]",
          "group-active/switch:w-[26px] group-active/switch:data-[state=checked]:translate-x-[14px]",
          "motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
