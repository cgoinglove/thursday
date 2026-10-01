"use client";

import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Single-value radiogroup styled as a pill; one option is always selected, filled blue
 * like everything else that is picked. A switch between views of one thing sets nothing,
 * so `view` raises the one shown as a white pill instead. Pass `w-full *:flex-1` in
 * `className` to stretch the buttons.
 *
 * The keyboard is a radio group's (WAI-ARIA APG, Radio Group): Tab enters at the one picked
 * and leaves the group, and the arrows pick the one before or after, round the ends. Each
 * option a tab stop of its own, Tab landed on the first rather than the one picked and the
 * arrows did nothing (UX test, accessibility).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  view = false,
  size = "default",
  className,
  ...rest
}: {
  options: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** The options are views of one thing, not values to pick. */
  view?: boolean;
  /** `sm` stands as tall as a header's small buttons (size-7). */
  size?: "default" | "sm";
  className?: string;
  "aria-label"?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const at = options.findIndex((option) => option.value === value);
  const step = (by: number) => {
    const next = (Math.max(0, at) + by + options.length) % options.length;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      onKeyDown={(event) => {
        const by = {
          ArrowRight: 1,
          ArrowDown: 1,
          ArrowLeft: -1,
          ArrowUp: -1,
        }[event.key];
        if (!by || options.length < 2) return;
        // The group's own: an arrow here is not also the screen's around it
        event.preventDefault();
        event.stopPropagation();
        step(by);
      }}
      className={cn(
        "flex w-fit gap-0.5 rounded-full bg-muted",
        size === "sm" ? "p-0.5" : "p-0.75",
        className,
      )}
      {...rest}
    >
      {options.map((option, index) => {
        const picked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={picked}
            // One stop for the group: the one picked, or the first when none is
            tabIndex={picked || (at < 0 && index === 0) ? 0 : -1}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-full whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              size === "sm"
                ? "h-6 px-2.5 text-[12px]"
                : "h-7 px-3 text-[12.5px]",
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
