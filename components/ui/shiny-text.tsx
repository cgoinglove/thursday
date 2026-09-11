import type { CSSProperties } from "react";
import { cn, WAITING_INK } from "@/lib/utils";

/**
 * The resting ink and the band that crosses it. On a light page the band moves
 * toward the ink: a lighter band on light ground reads as the words fading out.
 */
const TONES = {
  muted: { rest: "text-muted-foreground", band: "via-foreground" },
  waiting: { rest: WAITING_INK, band: "via-amber-950 dark:via-amber-100" },
} as const;

export type ShinyTone = keyof typeof TONES;

/**
 * Words for something still moving. They are drawn once as plain text, so they
 * cut short, wrap and select like any other; the sweep is a copy laid over them
 * that carries only the band. A gradient clipped to the glyphs cannot draw the
 * "…" a box truncates to, so the ellipsis belongs to the plain layer.
 *
 * Truncate on this component, not on a parent: it is an inline-block, and a
 * parent cannot put an ellipsis inside one.
 */
export function ShinyText({
  text,
  tone = "muted",
  speed = 2.4,
  className,
}: {
  text: string;
  tone?: ShinyTone;
  /** Seconds for the band to cross once. */
  speed?: number;
  className?: string;
}) {
  const { rest, band } = TONES[tone];
  return (
    <span
      data-slot="shiny-text"
      className={cn("relative inline-block max-w-full", rest, className)}
    >
      {text}
      <span
        aria-hidden
        style={{ animationDuration: `${speed}s` } as CSSProperties}
        className={cn(
          "pointer-events-none absolute inset-0 animate-shine overflow-hidden bg-linear-120 from-transparent from-35% via-50% to-transparent to-65% bg-size-[200%_auto] bg-clip-text text-transparent p-[inherit] select-none [text-overflow:inherit] motion-reduce:hidden",
          band,
        )}
      >
        {text}
      </span>
    </span>
  );
}
