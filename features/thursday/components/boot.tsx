"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AsciiField } from "./ascii-field";

// Full-screen ascii curtain shown once per app start; it collapses into the
// spot where the real face stands underneath and fades. Any pointer or key
// skips it.

/**
 * Where the curtain collapses to, per screen underneath. The intro reads the
 * same values so the face does not jump when the curtain lifts.
 */
export const INTRO_FACE = { centerY: 0.3, rim: 0.16 };
export const CALL_FACE = { centerY: 0.42, rim: 0.2 };
/** Fade duration in ms. Overlaps the collapse (AsciiField LIFT) on purpose. */
const LIFT_MS = 560;

export function Boot({
  /** The screen underneath; picks the collapse target. */
  over = "call",
}: {
  over?: "intro" | "call";
}) {
  const face = over === "intro" ? INTRO_FACE : CALL_FACE;
  const [lifting, setLifting] = useState(false);
  const [gone, setGone] = useState(false);

  const lift = useCallback(() => setLifting(true), []);

  // Unmount after the fade; a transparent canvas would keep rendering.
  useEffect(() => {
    if (!lifting) return;
    const end = setTimeout(() => setGone(true), LIFT_MS);
    return () => clearTimeout(end);
  }, [lifting]);

  useEffect(() => {
    if (gone) return;
    const skip = () => lift();
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [gone, lift]);

  if (gone) return null;

  return (
    <div
      aria-hidden
      onClick={lift}
      className={cn(
        "fixed inset-0 z-50 bg-background transition-opacity",
        lifting && "pointer-events-none opacity-0",
      )}
      style={{
        transitionDuration: `${LIFT_MS}ms`,
        transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <AsciiField boot rim={face.rim} centerY={face.centerY} onSettled={lift} />
    </div>
  );
}
