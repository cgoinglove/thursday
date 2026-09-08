"use client";

import { cn } from "@/lib/utils";

/** Color dot; `null` means "follow the theme" and renders as foreground. */
export function Swatch({
  color,
  picked,
  onPick,
}: {
  color: string | null;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={color ?? "Follow the theme"}
      style={color ? { backgroundColor: color } : undefined}
      className={cn(
        "size-5 rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50",
        !color && "bg-foreground",
        picked &&
          "ring-2 ring-foreground/40 ring-offset-2 ring-offset-background",
      )}
    />
  );
}
