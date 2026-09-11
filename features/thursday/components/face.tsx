"use client";

import { type ComponentType, memo, useEffect, useRef, useState } from "react";
import {
  BotMark,
  type MarkOptions,
  type MarkState,
} from "@/features/bot/components/bot-mark";
import {
  AsciiOrb,
  type AsciiOrbMode,
} from "@/features/thursday/components/ascii-orb";
import type { FaceKind } from "@/features/thursday/face.const";
import type {
  CallStatus,
  ThursdayFace,
} from "@/features/thursday/thursday.schema";
import { useResolvedTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * The call face. Two renderers with nothing in common inside (an SVG
 * silhouette and a glyph canvas); the shared contract is CallStatus, and each
 * adapter maps it. A third face is one FaceKind, one state table, one FACES entry.
 */

export type FaceProps = {
  /** What the call is doing; every face answers only this. */
  status: CallStatus;
  /** Box size in px, measured (see Face). */
  size: number;
  /** Audio bands, read once per animation frame, not through state. */
  getSpectrum?: () => ArrayLike<number>;
  /** Appearance; each face reads only the fields that apply to it. */
  look: ThursdayFace;
  className?: string;
};

const MARK_STATE: Record<CallStatus, MarkState> = {
  idle: "idle",
  connecting: "connecting",
  listening: "listening",
  speaking: "speaking",
  working: "thinking",
  delegating: "delegating",
};

/**
 * The mark's defaults are tuned for 32px rows; at 448px the same amplitude
 * reads as nothing, so the channels are roughly doubled. Module-level because
 * BotMark re-derives the silhouette when this object's identity changes.
 */
const MARK_VOICE: Partial<MarkOptions> = {
  /**
   * The outline carries the voice. `pulse` and `stretch` move the whole mark,
   * which at face size reads as a wobbling object rather than speech; `punch`
   * with no pulse only squashes it a touch on each syllable.
   */
  ripple: 18,
  bandEase: 0.03,
  pulse: 0,
  punch: 0.05,
  stretch: 0,
};

function MarkFace({ status, size, getSpectrum, look, className }: FaceProps) {
  return (
    <BotMark
      size={size}
      seed="thursday"
      color={look.color}
      shape={look.shape}
      outline={look.outline}
      state={MARK_STATE[status]}
      getSpectrum={getSpectrum}
      options={MARK_VOICE}
      notify={false}
      className={className}
    />
  );
}

/**
 * listening borrows `connecting` (the orb held open, waiting), not `idle`,
 * which is the orb at rest between calls. delegating borrows the working comet.
 */
const ORB_MODE: Record<CallStatus, AsciiOrbMode> = {
  idle: "idle",
  connecting: "connecting",
  listening: "connecting",
  speaking: "speaking",
  working: "working",
  delegating: "working",
};

/** The orb takes no color: white in dark theme, black otherwise. */
const ORB_DARK: [number, number, number] = [247, 247, 247];
const ORB_LIGHT: [number, number, number] = [10, 10, 10];

function OrbFace({ status, size, getSpectrum, look, className }: FaceProps) {
  const dark = useResolvedTheme() === "dark";
  return (
    <AsciiOrb
      mode={ORB_MODE[status]}
      size={size}
      color={dark ? ORB_DARK : ORB_LIGHT}
      getSpectrum={getSpectrum}
      charset={look.charset}
      fontSize={look.fontSize}
      density={look.density}
      className={className}
    />
  );
}

export const FACES: Record<
  FaceKind,
  /**
   * `render` is a component; render it as an element, never call it, or its
   * hooks fold into the caller's hook list and switching faces crashes.
   */
  { label: string; hint: string; render: ComponentType<FaceProps> }
> = {
  mark: {
    label: "Mark",
    hint: "A silhouette with eyes. Blinks, glances, leans into a voice.",
    render: MarkFace,
  },
  ascii: {
    label: "Ascii",
    hint: "A field of characters. No eyes — the whole orb is the expression.",
    render: OrbFace,
  },
};

/**
 * The face at the size of its box, measured because the canvas face needs real
 * pixels. Fades in: the chosen face arrives after hydration, so the first
 * frame is always the default and must not be shown.
 */
/** memo: the call screen re-renders per transcript fragment; the face's props are stable references. */
export const Face = memo(function Face({
  look,
  // a face without a call is between calls (previews)
  status = "idle",
  size = 448,
  className,
  ...rest
}: Omit<FaceProps, "size" | "status"> & {
  size?: number;
  status?: CallStatus;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(size);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0) setPx(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // one frame later on purpose: the store corrects itself during hydration
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // An element, not a call: each face owns its hooks, and a kind change swaps
  // the element type so one unmounts cleanly
  const Render = FACES[look.kind].render;

  return (
    <div
      ref={box}
      className={cn(
        // square regardless of contents, so hiding the face does not collapse the box
        "aspect-square transition-opacity duration-700 ease-out",
        shown ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <Render {...rest} look={look} status={status} size={px} />
    </div>
  );
});
