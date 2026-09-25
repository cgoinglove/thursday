"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  AsciiOrb,
  type AsciiOrbMode,
} from "@/features/thursday/components/ascii-orb";
import type { CallStatus, FaceWord } from "@/features/thursday/thursday.schema";
import { useIsDark } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * The call face: the ascii orb, told what the call is doing (CallStatus and `failed`) and
 * mapped here onto the orb's own modes.
 */

type FaceProps = {
  /** What the call is doing; every face answers only this. */
  status: CallStatus;
  /** A call just failed to open or dropped. The status is idle by then; this says why the face is not at rest. */
  failed?: boolean;
  /** A word `emote` put on the face. */
  word?: FaceWord | null;
  /** Box size in px, measured (see Face). */
  size: number;
  /** Audio bands, read once per animation frame, not through state. */
  getSpectrum?: () => ArrayLike<number>;
  /** She comes in waking (ascii-orb `waking`): the first run's opening brings her in this way. */
  waking?: boolean;
  className?: string;
};

/**
 * Listening is her resting face (the meter under it shows the voice); ending draws the body
 * in and leaves the field empty; delegating borrows the working comet.
 */
const ORB_MODE: Record<CallStatus, AsciiOrbMode> = {
  ending: "ending",
  idle: "idle",
  connecting: "connecting",
  listening: "idle",
  speaking: "speaking",
  working: "working",
  delegating: "working",
};

/** The orb takes no color: white in dark theme, black otherwise. */
const ORB_DARK: [number, number, number] = [247, 247, 247];
const ORB_LIGHT: [number, number, number] = [10, 10, 10];

function OrbFace({
  status,
  failed,
  word,
  size,
  getSpectrum,
  waking,
  className,
}: FaceProps) {
  const dark = useIsDark();
  return (
    <AsciiOrb
      mode={failed ? "error" : ORB_MODE[status]}
      word={word}
      size={size}
      color={dark ? ORB_DARK : ORB_LIGHT}
      getSpectrum={getSpectrum}
      waking={waking}
      className={className}
    />
  );
}

/**
 * The face at the size of its box, measured because the canvas face needs real
 * pixels. It is not drawn at all until the box has been measured: the orb builds
 * a grid per size, and building one for a guess and then again for the real width
 * throws away the first one's trails in front of the user. Fades in from the frame
 * after it mounts. memo: the call screen re-renders per transcript fragment; the
 * face's props are stable references.
 */
export const Face = memo(function Face({
  // a face without a call is between calls (previews)
  status = "idle",
  className,
  ...rest
}: Omit<FaceProps, "size" | "status"> & { status?: CallStatus }) {
  const box = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState<number | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      // a box with no width yet is not a size to build a grid for
      if (width > 0) setPx(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // one frame later: the fade runs only from a frame already drawn at opacity 0
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={box}
      className={cn(
        // square regardless of contents, so hiding the face does not collapse the box
        "aspect-square transition-opacity duration-700 ease-out",
        shown && px !== null ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {px !== null && <OrbFace {...rest} status={status} size={px} />}
    </div>
  );
});
