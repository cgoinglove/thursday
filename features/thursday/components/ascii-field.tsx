"use client";

import { useEffect, useRef } from "react";
import { useResolvedTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import {
  ALPHA_TOP,
  CHAR_RATE,
  EMOJI_CHAR_RATE,
  EMOJI_MIN_LEVEL,
  EMOJI_POOL,
  EMOJI_RATIO,
  hash,
  RAMP,
  smoothstep,
} from "../ascii.const";

/**
 * Full-screen ascii field for the boot sequence. Shares glyphs and rules with
 * ascii-orb (ascii.const) but nothing else: no modes, no voice, one motion.
 * The coordinate system is warped before distances are measured, three waves
 * interfere, and per-cell randoms break the rings a pure radial function draws.
 */

/**
 * One boot run, in seconds. The first frame is already the full field; it
 * shrinks from HOLD to SETTLE, and the overlay lifts at LIFT, before the
 * shrink ends, so the fade happens while still moving.
 */
const HOLD = 0;
const SETTLE = 0.9;
const LIFT = 0.26;

/** Where the leading edge ends up: half the screen diagonal is 1.0 and the wobble stretches it up to 30%. */
const REACH = 1.56;

/** Approximate cell size in px; grows with the screen. */
const FONT = 13;
const DENSITY = 1.15;
/** Above this area (px^2) cells grow to keep the count bounded. */
const CELL_BUDGET = 1_400_000;

/** White in dark theme, black otherwise; same two values as the orb (components/face). */
const INK_DARK: [number, number, number] = [247, 247, 247];
const INK_LIGHT: [number, number, number] = [10, 10, 10];

type Cell = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  dist: number;
  angle: number;
  seed: number;
  /** Keeps cells at equal distance from falling into the same step */
  grain: number;
  /** Below this the cell is empty; random gaps */
  gap: number;
  /** Shifts when the leading edge reaches this cell */
  birth: number;
  /** Emoji roll; the threshold comes from props */
  roll: number;
};

export type AsciiFieldProps = {
  /** Start from the full field and shrink to the face slot; otherwise start settled. */
  boot?: boolean;
  /** Settled radius as a fraction of half the screen diagonal. */
  rim?: number;
  /** Vertical center (0..1). */
  centerY?: number;
  /** Thin out below this height (0..1), where text sits. */
  clearAt?: number | null;
  /** How much to thin that area (0..1). */
  clearBy?: number;
  /** Share of cells that are emoji. Half the orb's: the same ratio reads as a wall at full-screen size. */
  emojiRatio?: number;
  /** Overall brightness. */
  dim?: number;
  /** Called once the shrink is done; only with `boot`. */
  onSettled?: () => void;
  className?: string;
};

export function AsciiField({
  boot = false,
  rim = 0.28,
  centerY = 0.34,
  clearAt = null,
  clearBy = 0.5,
  emojiRatio = EMOJI_RATIO / 2,
  dim = 1,
  onSettled,
  className,
}: AsciiFieldProps) {
  const hostRef = useRef<HTMLCanvasElement>(null);
  const dark = useResolvedTheme() === "dark";

  /** The loop mounts once; per-frame knobs come through refs so the grid is not rebuilt. */
  const look = useRef({ rim, clearAt, clearBy, emojiRatio, dim, dark });
  look.current = { rim, clearAt, clearBy, emojiRatio, dim, dark };
  const done = useRef(onSettled);
  done.current = onSettled;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctx = host.getContext("2d");
    if (!ctx) return;

    // prefers-reduced-motion: start settled, no animation
    const still =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const play = boot && !still;

    let cells: Cell[] = [];
    let bins: {
      ascii: Int32Array[];
      emoji: Int32Array[];
      an: Int32Array;
      en: Int32Array;
      glyph: string[];
    } | null = null;
    let w = 0;
    let h = 0;
    let font = FONT;
    let maxR = 1;

    /** Grid, rebuilt on resize. Cells scale with screen area so a large display does not turn into noise. */
    const build = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      if (w < 2 || h < 2) return;

      const scale = Math.max(1, Math.sqrt((w * h) / CELL_BUDGET));
      font = Math.round(FONT * scale);
      const cw = (font * 0.95) / DENSITY;
      const ch = (font * 1.25) / DENSITY;
      const cols = Math.ceil(w / cw);
      const rows = Math.ceil(h / ch);
      const cx = w / 2;
      const cy = h * centerY;
      // distance to the farthest corner, so reach 1.0 means the whole screen
      maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));

      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw + cw / 2;
          const y = r * ch + ch / 2;
          const dx = x - cx;
          const dy = y - cy;
          cells.push({
            x,
            y,
            dx,
            dy,
            dist: Math.hypot(dx, dy),
            angle: Math.atan2(dy, dx),
            seed: hash(c, r),
            grain: hash(c * 5.7 + 19, r * 2.3 + 53),
            gap: 0.05 + hash(c * 7.3 + 11, r * 3.1 + 5) * 0.3,
            birth: hash(c * 3.1 + 7, r * 5.7 + 2),
            roll: hash(c * 2.7 + 31, r * 5.9 + 17),
          });
        }
      }

      // bucketing by level keeps fillStyle changes to one per level
      bins = {
        ascii: Array.from(
          { length: RAMP.length },
          () => new Int32Array(cells.length),
        ),
        emoji: Array.from(
          { length: RAMP.length },
          () => new Int32Array(cells.length),
        ),
        an: new Int32Array(RAMP.length),
        en: new Int32Array(RAMP.length),
        glyph: new Array<string>(cells.length),
      };

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      host.width = Math.round(w * dpr);
      host.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    build();
    const observer = new ResizeObserver(build);
    observer.observe(host);

    /** `reach` is how far the field extends (always full); `body` is the radius that shrinks, leaving dust behind. */
    const shape = (t: number, rest: number) => {
      if (!play) return { reach: REACH, body: rest, growing: false };
      // ease-out: fastest from the first frame
      const ease = (x: number) => 1 - (1 - x) ** 3;
      const body =
        t < HOLD
          ? REACH
          : t < SETTLE
            ? REACH - ease((t - HOLD) / (SETTLE - HOLD)) * (REACH - rest)
            : rest;
      return { reach: REACH, body, growing: false };
    };

    let raf = 0;
    let last = 0;
    let told = false;
    const t0 = performance.now();
    /** Knob changes ease in over frames instead of snapping. */
    let easedRim: number | null = null;
    let easedClear: number | null = null;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      /**
       * Slow frame rate at rest (glyphs swap 2.2 times per second); full rate
       * only while the shrink runs, or it steps.
       */
      const moving = play && (now - t0) / 1000 < SETTLE + 0.2;
      if (now - last < (moving ? 16 : 48)) return;
      last = now;
      if (!bins || !cells.length) return;

      const t = (now - t0) / 1000;
      if (play && !told && t >= LIFT) {
        told = true;
        done.current?.();
      }

      const {
        rim: wantRim,
        clearAt,
        clearBy,
        emojiRatio,
        dim,
        dark,
      } = look.current;
      easedRim =
        easedRim === null ? wantRim : easedRim + (wantRim - easedRim) * 0.06;
      const wantClear = clearAt === null ? -1 : clearAt;
      easedClear =
        easedClear === null
          ? wantClear
          : easedClear + (wantClear - easedClear) * 0.06;
      const clearFrom = clearAt === null ? null : h * easedClear;
      const { reach, body, growing } = shape(t, easedRim);
      const ink = dark ? INK_DARK : INK_LIGHT;
      const top = RAMP.length - 1;

      bins.an.fill(0);
      bins.en.fill(0);

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const nd = cell.dist / maxR;

        // silhouette: three angular terms, two rotating slowly
        const wob =
          1 +
          0.17 * Math.sin(cell.angle * 2 + 0.7 + t * 0.11) +
          0.12 * Math.sin(cell.angle * 3 - 1.9 + t * 0.22) +
          0.07 * Math.sin(cell.angle * 5 + 3.1 - t * 0.08);

        // warp the coordinate system; every distance below is in this space
        const ndW =
          nd *
          (1 +
            0.075 * Math.sin(cell.angle * 2 + t * 0.21) +
            0.055 * Math.sin(cell.angle * 3 - t * 0.13 + nd * 4.5) +
            0.038 * Math.sin(cell.angle * 5 + t * 0.09 - nd * 8) +
            0.03 * Math.sin(nd * 11 + t * 0.17 + cell.seed * 3));

        // leading edge, shifted per cell by over a third of the screen with a soft threshold, so no visible line passes
        const lead = reach - (ndW / wob + (cell.birth - 0.5) * 0.55);
        if (lead < -0.03) continue;
        const arrived = smoothstep(0, 0.62, lead);

        // three waves, two counter-rotating; one radial sine would form rings
        const wave =
          0.55 * Math.sin(cell.dist * 0.03 - t * 0.4 + cell.angle * 1.6) +
          0.3 * Math.sin(cell.dist * 0.018 + t * 0.27 - cell.angle * 2.7) +
          0.15 * Math.sin(cell.angle * 4 + t * 0.33);

        // body: solid to half the radius, releasing only in the outer half (same shape as the orb's idleValue)
        const edge = ndW / wob + (cell.grain - 0.5) * 0.11;
        let v =
          (0.62 + wave * 0.22 + Math.sin(t * 0.35) * 0.07) *
          (1 - smoothstep(body * 0.5, body * 1.06, edge));

        // dust: about one cell in ten floats at its own distance and blinks at its own rate (the orb's faceDust)
        if (cell.seed > 0.895) {
          const at =
            body * 1.02 +
            hash(cell.seed * 311, 9) * Math.max(0.3, 1.25 - body * 0.7);
          const near = Math.exp(-(((ndW - at) / 0.12) ** 2));
          const spin = 0.5 + hash(cell.seed * 47, 21) * 1.5;
          // scaled down so bright specks land on dots and strokes, not the top glyphs
          v +=
            near * (0.42 + 0.58 * Math.sin(t * spin + cell.seed * 300)) * 0.7;
        }

        // a very low floor; the gap threshold eats most of it, leaving dots
        v += 0.22 * Math.exp(-ndW * 0.8) * (0.6 + 0.4 * wave);

        v =
          v * arrived +
          Math.exp(-((lead * lead) / 0.0024)) * (growing ? 0.5 : 0.12);
        v *= dim;

        // the text area is thinned, not covered; a ramp rather than a bell because text runs to the bottom edge
        if (clearFrom !== null) {
          v *=
            1 - clearBy * smoothstep(clearFrom - 130, clearFrom + 70, cell.y);
        }

        // from here on, same as the orb
        v *= 0.66 + cell.grain * 0.72;
        v *=
          0.8 +
          hash(
            Math.floor(cell.dx * 0.05 + t * 0.5),
            Math.floor(cell.dy * 0.05 - t * 0.3),
          ) *
            0.4;
        if (v < cell.gap + Math.sin(t * 0.28 + cell.seed * 6.283) * 0.05) {
          continue;
        }

        const level = (Math.min(1, v) * top) | 0;
        if (level <= 0) continue;

        if (
          emojiRatio > 0 &&
          cell.roll < emojiRatio &&
          // one level above the orb's threshold; dim emoji do not fade, they float like stickers
          level >= EMOJI_MIN_LEVEL + 1
        ) {
          const slot = (t * EMOJI_CHAR_RATE + cell.seed * 7) | 0;
          bins.glyph[i] =
            EMOJI_POOL[
              (((cell.seed * EMOJI_POOL.length) | 0) + slot) % EMOJI_POOL.length
            ];
          bins.emoji[level][bins.en[level]++] = i;
        } else {
          const set = RAMP[level];
          const slot = (t * CHAR_RATE + cell.seed * 7) | 0;
          bins.glyph[i] =
            set[(((cell.seed * set.length) | 0) + slot) % set.length];
          bins.ascii[level][bins.an[level]++] = i;
        }
      }

      // brightness is alpha; darkening the color inverts on a light background (same as the orb)
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgb(${ink[0]},${ink[1]},${ink[2]})`;
      ctx.font = `700 ${font}px ui-monospace,SFMono-Regular,Menlo,monospace`;
      for (let level = 1; level <= top; level++) {
        const n = bins.an[level];
        if (n === 0) continue;
        ctx.globalAlpha = ALPHA_TOP * (level / top);
        const list = bins.ascii[level];
        for (let k = 0; k < n; k++) {
          const cell = cells[list[k]];
          ctx.fillText(bins.glyph[list[k]], cell.x, cell.y);
        }
      }
      // smaller than the cell, or emoji eat their neighbors and read as stickers
      ctx.font = `${Math.round(font * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      for (let level = 1; level <= top; level++) {
        const n = bins.en[level];
        if (n === 0) continue;
        // emoji keep their own color, so only alpha varies (same ladder as the orb)
        ctx.globalAlpha = (0.35 + (level / top) * 0.65) * dim;
        const list = bins.emoji[level];
        for (let k = 0; k < n; k++) {
          const cell = cells[list[k]];
          ctx.fillText(bins.glyph[list[k]], cell.x, cell.y);
        }
      }
      ctx.globalAlpha = 1;
    };

    // draw immediately so the boot does not start with an empty beat
    draw(performance.now());
    if (!play) done.current?.();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
    // the grid depends on these two only; other knobs come through refs
  }, [boot, centerY]);

  return (
    <canvas
      ref={hostRef}
      aria-hidden
      className={cn("block size-full", className)}
    />
  );
}
