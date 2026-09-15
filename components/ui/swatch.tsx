"use client";

import { cn } from "@/lib/utils";

/**
 * Color dot; `null` means "follow the theme" and renders as foreground.
 * `background` paints it with any CSS background instead, named by `label`.
 */
export function Swatch({
  color,
  background,
  label,
  picked,
  onPick,
}: {
  color: string | null;
  background?: string;
  label?: string;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={label ?? color ?? "Follow the theme"}
      style={
        background
          ? { background }
          : color
            ? { backgroundColor: color }
            : undefined
      }
      className={cn(
        "size-5 rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50",
        !color && !background && "bg-foreground",
        picked &&
          "ring-2 ring-foreground/40 ring-offset-2 ring-offset-background",
      )}
    />
  );
}
