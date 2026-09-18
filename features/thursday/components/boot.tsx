"use client";

import { useEffect, useState } from "react";

/** Her face's vertical place on the intro, which its field draws around. */
export const INTRO_FACE = { centerY: 0.3, rim: 0.16 };

/**
 * What a load that never starts says. Only the client takes this away, so on a page
 * whose scripts did not run it stays, and CSS alone reveals it (globals.css `stalled`)
 * well after any healthy start: her face is a canvas and every control is the client's,
 * so such a page looks fine and does nothing.
 */
export function Boot() {
  const [started, setStarted] = useState(false);
  useEffect(() => setStarted(true), []);
  if (started) return null;

  return (
    <p
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-16 z-50 animate-stalled text-center text-[13px] text-muted-foreground opacity-0"
    >
      The page did not start. Reload it.
    </p>
  );
}
