"use client";

import { useEffect, useRef } from "react";
import type { AsciiCharset } from "@/features/thursday/face.const";
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
 * One ascii wave over the whole screen: it leaves her face, rolls out to the corners
 * behind a ragged front, and is gone. Played once when the app opens (boot) and once
 * when the first-run intro ends. As dense as the ascii field and drawn by the same
 * glyph rules (ascii.const), in the glyphs her face is set to; it shares nothing else
 * with the field, and it never takes a click: the screen under it is already live.
 */

/** How fast the front travels, in reaches (face to the farthest corner) per second. */
const SPEED = 0.95;
/** How far behind the front the crest still draws, in reaches. */
const CREST = 0.3;
/** Crumbs: the share of cells that keep a little ink after the crest, and for how long (s). Few and brief, or the screen reads as dirty. */
const CRUMB_SHARE = 0.06;
const CRUMB_LIFE = { min: 0.18, max: 0.5 };

/** Same cell sizing as the field, so the two read as one material. */
const FONT = 13;
const DENSITY = 1.15;
const CELL_BUDGET = 1_400_000;

const INK_DARK: [number, number, number] = [247, 247, 247];
const INK_LIGHT: [number, number, number] = [10, 10, 10];

type Cell = {
  x: number;
  y: number;
  /** Distance from her face in reaches, warped so the front is ragged */
  reach: number;
  seed: number;
  grain: number;
  gap: number;
  speck: number;
  roll: number;
};

export function AsciiWave({
  centerY = 0.42,
  charset = "ascii",
  onDone,
  className,
}: {
  /** Her face's vertical center (0..1): where the wave starts. */
  centerY?: number;
  charset?: AsciiCharset;
  /** Called once the last crumb is gone, or at once under reduced motion. */
  onDone?: () => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLCanvasElement>(null);
  const dark = useResolvedTheme() === "dark";
  const look = useRef({ dark, charset });
  look.current = { dark, charset };
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const host = hostRef.current;
    const ctx = host?.getContext("2d");
    if (!host || !ctx) return;
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      done.current?.();
      return;
    }

    const w = host.clientWidth;
    const h = host.clientHeight;
    const scale = Math.max(1, Math.sqrt((w * h) / CELL_BUDGET));
    const font = Math.round(FONT * scale);
    const cw = (font * 0.95) / DENSITY;
    const ch = (font * 1.25) / DENSITY;
    const cx = w / 2;
    const cy = h * centerY;
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));

    const cells: Cell[] = [];
    for (let r = 0; r < Math.ceil(h / ch); r++) {
      for (let c = 0; c < Math.ceil(w / cw); c++) {
        const x = c * cw + cw / 2;
        const y = r * ch + ch / 2;
        const angle = Math.atan2(y - cy, x - cx);
        const grain = hash(c * 5.7 + 19, r * 2.3 + 53);
        // three angular terms and a per-cell shift: no clean circle ever passes
        const warp =
          1 +
          0.1 * Math.sin(3 * angle + 1.3) +
          0.05 * Math.sin(7 * angle - 0.7) +
          (grain - 0.5) * 0.1;
        cells.push({
          x,
          y,
          reach: (Math.hypot(x - cx, y - cy) / far) * warp,
          seed: hash(c, r),
          grain,
          gap: hash(c * 7.3 + 11, r * 3.1 + 5),
          speck: hash(c * 3.1 + 7, r * 5.7 + 2),
          roll: hash(c * 2.7 + 31, r * 5.9 + 17),
        });
      }
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    host.width = Math.round(w * dpr);
    host.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // the front has left the farthest warped corner, and the longest crumb after it
    const length = (1.25 + CREST) / SPEED + CRUMB_LIFE.max;
    const top = RAMP.length - 1;
    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      if (t >= length) {
        done.current?.();
        return;
      }
      raf = requestAnimationFrame(draw);

      const { dark: onDark, charset: glyphs } = look.current;
      const ink = onDark ? INK_DARK : INK_LIGHT;
      const front = t * SPEED;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgb(${ink[0]},${ink[1]},${ink[2]})`;
      const text = `700 ${font}px ui-monospace,SFMono-Regular,Menlo,monospace`;
      const emoji = `${Math.round(font * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      let drawing = "";

      for (const cell of cells) {
        const behind = front - cell.reach;
        if (behind < -0.03 || cell.gap > 0.9) continue;
        // the crest: brightest just behind the front, rippling as it thins
        let v =
          smoothstep(-0.03, 0.02, behind) *
          (1 - smoothstep(0.02, CREST, behind)) *
          (0.72 + 0.28 * Math.sin(cell.reach * 46 - t * 7 + cell.seed * 6.283));
        if (cell.speck < CRUMB_SHARE) {
          const life =
            CRUMB_LIFE.min + cell.grain * (CRUMB_LIFE.max - CRUMB_LIFE.min);
          const age = behind / SPEED - CREST / SPEED;
          v = Math.max(
            v,
            (0.3 + 0.4 * cell.grain) * (1 - smoothstep(life * 0.4, life, age)),
          );
        }
        const level = Math.round(v * top);
        if (level < 1) continue;

        const asEmoji =
          glyphs === "emojiOnly" ||
          (glyphs === "emoji" &&
            level >= EMOJI_MIN_LEVEL + 1 &&
            // half the orb's share: the same ratio reads as a wall at this size
            cell.roll < EMOJI_RATIO / 2);
        const want = asEmoji ? emoji : text;
        if (drawing !== want) {
          ctx.font = want;
          drawing = want;
        }
        if (asEmoji) {
          ctx.globalAlpha = 0.35 + (level / top) * 0.65;
          const slot = (t * EMOJI_CHAR_RATE + cell.seed * 7) | 0;
          ctx.fillText(
            EMOJI_POOL[
              (((cell.seed * EMOJI_POOL.length) | 0) + slot) % EMOJI_POOL.length
            ],
            cell.x,
            cell.y,
          );
        } else {
          ctx.globalAlpha = ALPHA_TOP * (level / top);
          const set = RAMP[level];
          const slot = (t * CHAR_RATE + cell.seed * 7) | 0;
          ctx.fillText(
            set[(((cell.seed * set.length) | 0) + slot) % set.length],
            cell.x,
            cell.y,
          );
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [centerY]);

  return (
    <canvas
      ref={hostRef}
      aria-hidden
      className={cn("pointer-events-none block size-full", className)}
    />
  );
}
