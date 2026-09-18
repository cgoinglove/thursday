"use client";

import { useState } from "react";
import { useThursdayFace } from "@/features/thursday/face.store";
import { AsciiWave } from "./ascii-wave";

// Once per app start: one ascii wave leaves her face and rolls off the screen. Nothing
// is covered — the screen under it is live from the first frame, so a click or a key
// goes straight through and needs no skipping.

/**
 * Her face's place per screen underneath, where the wave starts. The intro reads
 * the same values for its own field.
 */
export const INTRO_FACE = { centerY: 0.3, rim: 0.16 };
export const CALL_FACE = { centerY: 0.42 };

export function Boot({
  /** The screen underneath; picks where the wave starts. */
  over = "call",
}: {
  over?: "intro" | "call";
}) {
  const face = over === "intro" ? INTRO_FACE : CALL_FACE;
  const look = useThursdayFace();
  const [gone, setGone] = useState(false);
  if (gone) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      <AsciiWave
        centerY={face.centerY}
        charset={look.kind === "ascii" ? look.charset : "ascii"}
        onDone={() => setGone(true)}
      />

      {/* Only the client takes this element away, so on a load that never hydrates it
          stays and says so. Revealed by CSS alone (globals.css `stalled`), well after
          any healthy start. */}
      <p className="absolute inset-x-0 bottom-16 animate-stalled text-center text-[13px] text-muted-foreground opacity-0">
        The page did not start. Reload it.
      </p>
    </div>
  );
}
