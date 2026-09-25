"use client";

import { useEffect, useState } from "react";
import { EMOJI_POOL, hash } from "../ascii.const";

/**
 * Thursday wherever she is small: the room, a thread, the call log, the
 * settings nav. Every screen draws her through this one component, so giving
 * her another icon is a change to this file. The browser tab is the exception:
 * it keeps the mark drawn from THURSDAY_SEED (tab-state).
 *
 * It is the call's orb in miniature and keeps its rules. Glyphs have one size,
 * so a bigger box holds more of them, not bigger ones; cells sit on a grid and
 * never touch; the rim is crumbly; past a few cells some are missing, more
 * toward the rim. Nothing fades: a cell moves by taking another glyph. SVG so
 * callers can size it with classes.
 */

/** The seed the browser tab's mark is drawn from (tab-state). */
export const THURSDAY_SEED = "thursday";

/** Glyph size in px. Constant, so the number of cells follows the box. */
const GLYPH = 4;
/** The air a bot mark leaves in its own box (BotMark draws 240 of 276); without it she reads a size larger beside one. */
const INSET = 240 / 276;
/** How long a cell keeps a glyph. */
const FLIP_MS = 620;
/** Steps through EMOJI_POOL per flip. The pool runs in colour bands, so a stride past one changes the colour. */
const HUE_STRIDE = 9;
/** From this many cells a side the rim is ragged; in fewer, a cell out of line reads as broken. */
const ROUGH_FROM = 5;
/** From this many a side some cells are missing; in fewer, a hole reads as an empty mark rather than a crumbly one. */
const HOLES_FROM = 8;
/**
 * Three a side is a plus sign with its corners dropped and a square with them kept. The
 * corners are kept and pulled in to the radius of their neighbours, overlapping them a
 * little, so the eight stand in a ring around the middle one.
 */
const CORNER_PULL = 0.72;

type Cell = {
  /** Stable per grid and slot: the key, and what the cell's randoms are drawn from. */
  seed: number;
  x: number;
  y: number;
  /** 0 at the center, 1 at the rim. */
  r: number;
};

const layouts = new Map<number, { cells: Cell[]; font: number }>();

function layoutOf(size: number) {
  const known = layouts.get(size);
  if (known) return known;

  const inner = size * INSET;
  const pad = (size - inner) / 2;
  const side = Math.max(2, Math.round(inner / GLYPH));
  const pitch = inner / side;
  const font = pitch * 0.98;
  const cells: Cell[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const corner = side === 3 && row !== 1 && col !== 1;
      const pull = corner ? CORNER_PULL : 1;
      const cx = inner / 2 + pitch * (col + 0.5 - side / 2) * pull;
      const cy = inner / 2 + pitch * (row + 0.5 - side / 2) * pull;
      const r = Math.hypot(cx - inner / 2, cy - inner / 2) / (inner / 2);
      const seed = side * 977 + row * side + col;
      const rough = side >= ROUGH_FROM;
      // a rim cell sits a little in or out of the circle
      const crumble = rough ? (hash(seed, 1) - 0.5) * 0.24 : 0;
      if (r + crumble > 0.98) continue;
      if (side >= HOLES_FROM && hash(seed, 2) < 0.02 + 0.24 * r ** 3) continue;
      // the baseline sits below the cell's center by about a third of the glyph
      cells.push({ seed, x: pad + cx, y: pad + cy + font * 0.36, r });
    }
  }
  const made = { cells, font };
  layouts.set(size, made);
  return made;
}

/** The glyph a cell holds at `t`. Each cell flips on its own beat, so the ball shimmers rather than blinks. */
function glyphAt(cell: Cell, t: number) {
  const turn = Math.floor((t + hash(cell.seed, 11) * FLIP_MS * 3) / FLIP_MS);
  const from = Math.floor(hash(cell.seed, 17) * EMOJI_POOL.length);
  return EMOJI_POOL[(from + turn * HUE_STRIDE) % EMOJI_POOL.length];
}

/** One clock for every mounted mark. */
const listeners = new Set<(t: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: (t: number) => void) {
  listeners.add(listener);
  if (!timer) {
    const start = Date.now();
    // a quarter of a flip: fine enough that cells do not visibly change together
    timer = setInterval(() => {
      const t = Date.now() - start;
      for (const fn of listeners) fn(t);
    }, FLIP_MS / 4);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function ThursdayMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const { cells, font } = layoutOf(size);
  // first frame is t=0 so server and client render the same picture
  const [t, setT] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return subscribe(setT);
  }, []);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      // a glyph with no colour of its own (no colour emoji font) follows the theme
      fill="currentColor"
      aria-hidden
    >
      {cells.map((cell) => (
        <text
          key={cell.seed}
          x={cell.x}
          y={cell.y}
          textAnchor="middle"
          fontFamily='"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
          fontSize={font}
        >
          {glyphAt(cell, t)}
        </text>
      ))}
    </svg>
  );
}
