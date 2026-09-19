"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Single-value radiogroup styled as a pill; one option is always selected, filled blue
 * like everything else that is picked. A switch between views of one thing sets nothing,
 * so `view` raises the one shown as a white pill instead. Pass `w-full *:flex-1` in
 * `className` to stretch the buttons.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  view = false,
  className,
  ...rest
}: {
  options: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** The options are views of one thing, not values to pick. */
  view?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex w-fit gap-0.5 rounded-full bg-muted p-0.75",
        className,
      )}
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
              "flex h-7 items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              !picked && "text-muted-foreground hover:text-foreground",
              picked &&
                (view
                  ? "bg-background font-medium text-foreground shadow-sm dark:bg-input/60"
                  : "bg-brand font-medium text-brand-foreground"),
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
