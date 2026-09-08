"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Single-value radiogroup styled as a pill; one option is always selected.
 * Pass `w-full *:flex-1` in `className` to stretch the buttons.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ...rest
}: {
  options: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn("flex w-fit gap-1 rounded-lg bg-muted p-0.5", className)}
      {...rest}
    >
      {options.map((option) => {
        const picked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={picked}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              picked
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
