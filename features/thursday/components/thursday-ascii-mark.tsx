"use client";

import { useEffect, useState } from "react";
import { CHAR_RATE, hash, RAMP } from "../ascii.const";
import { useThursdayFace } from "../face.store";

/**
 * A tiny ascii orb for icon slots, about thirty cells. Shares the glyph
 * ladder, alpha shading and per-cell randoms with ascii-orb; its only motion
 * is a breath. SVG so callers can size it with classes.
 */

/** The orb's RAMP minus the top two steps: at 2-3px those glyphs read as ink blots. */
const ICON_RAMP = RAMP.slice(0, 10);

/**
 * 7 x 5 grid trimmed to an ellipse. Monospace glyphs are taller than wide, so
 * roundness is measured in normalized coordinates, not cells.
 */
const COLS = 7;
const ROWS = 5;
const X_PITCH = 12 / COLS;
const Y_PITCH = 12 / ROWS;

const CELLS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const col = i % COLS;
  const row = (i - col) / COLS;
  // normalized to -1..1; the grid is squashed but this space is round
  const nx = (col - (COLS - 1) / 2) / ((COLS - 1) / 2);
  const ny = (row - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
  return {
    i,
    x: X_PITCH * (col + 0.5),
    y: Y_PITCH * (row + 0.5) + Y_PITCH * 0.3,
    /** 0 at the center, 1 at the rim; drives brightness and breath order */
    r: Math.hypot(nx, ny),
  };
}).filter((cell) => cell.r <= 1.02);

/** One breath. */
const BREATH_MS = 1700;
/**
 * Center brightness and the floor the rim keeps, in ICON_RAMP steps. The rim
 * stays high: at 16px in muted ink the low steps read as a smudge, and the
 * ellipse mask, not brightness, makes the circle.
 */
const CORE = 9.8;
const RIM = 5.4;
const SWELL = 1.7;

type Glyph = { char: string; alpha: number };

function breathe(t: number): Glyph[] {
  return CELLS.map((cell) => {
    const wave = Math.sin((t / BREATH_MS) * Math.PI * 2 - cell.r * 2.2);
    // bright center falling off to the rim
    const level = RIM + (CORE - RIM) * (1 - cell.r ** 2) ** 0.6 + wave * SWELL;
    const step = Math.max(0, Math.min(ICON_RAMP.length - 1, Math.round(level)));
    const bag = ICON_RAMP[step];
    // glyphs swap per cell at about CHAR_RATE; clocks are offset per cell so they do not flip together
    const roll = hash(
      cell.i,
      Math.floor((t / 1000) * CHAR_RATE * 1.6 + cell.i * 0.41),
    );
    return {
      char: bag[Math.floor(roll * bag.length)] ?? " ",
      // shading is alpha, not glyph choice; the floor is high because low steps are invisible at 3px
      alpha:
        0.42 + 0.58 * Math.max(0, Math.min(1, level / (ICON_RAMP.length - 1))),
    };
  });
}

/** One clock for every mounted mark. */
const listeners = new Set<(t: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: (t: number) => void) {
  listeners.add(listener);
  if (!timer) {
    const start = Date.now();
    // 16fps; only the glyphs change
    timer = setInterval(() => {
      const t = Date.now() - start;
      for (const fn of listeners) fn(t);
    }, 60);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function ThursdayAsciiMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const face = useThursdayFace();
  // first frame is t=0 so server and client render the same picture
  const [glyphs, setGlyphs] = useState(() => breathe(0));

  useEffect(() => subscribe((t) => setGlyphs(breathe(t))), []);

  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={className}
      // a face with no color follows the theme ("system" preset in mark.const);
      // an unset fill paints black and vanishes in dark
      fill={face.color ?? "currentColor"}
      aria-hidden
    >
      {glyphs.map((glyph, i) => (
        <text
          // slots are fixed; the index is the slot
          key={CELLS[i].i}
          x={CELLS[i].x}
          y={CELLS[i].y}
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="2.85"
          fillOpacity={glyph.alpha}
        >
          {glyph.char}
        </text>
      ))}
    </svg>
  );
}
