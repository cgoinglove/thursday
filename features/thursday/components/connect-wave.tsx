"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import type { AsciiCharset } from "../face.const";
import type { CallStatus } from "../thursday.schema";

/** Glyph cell, px. Emoji are dearer to draw than letters, so an all-emoji wave has fewer, larger ones. */
const CELL = { ascii: 11, emoji: 11, emojiOnly: 15 } as const;
/** How far the front travels per second, as a share of the way to the farthest corner. */
const SPEED = 0.95;
/** Width of the lit band behind the front, in the same units. */
const CREST = 0.3;
/** Share of cells that keep a crumb for a moment after the band has passed. */
const CRUMBS = 0.06;
/** Seconds the longest crumb outlives the band. */
const CRUMB_S = 0.5;
/** The front starts this far out, so the wave leaves her face rather than covering it. */
const HOLE = 0.1;
/** Past the farthest corner, the band and the longest crumb, the wave is over. */
const DONE_S = (1.2 + CREST) / SPEED + CRUMB_S;

type Cell = {
  x: number;
  y: number;
  dd: number;
  seed: number;
  grain: number;
  speck: number;
  roll: number;
};

const font = (cell: number) =>
  `700 ${cell}px ui-monospace, SFMono-Regular, Menlo, monospace`;

/** An emoji's square on the sheet: emoji reach past their font size. */
const slotOf = (cell: number) => Math.ceil(cell * 1.5);

/** The emoji drawn once side by side, so a frame copies squares rather than drawing emoji. */
function sheet(glyphs: readonly string[], cell: number) {
  const slot = slotOf(cell);
  const canvas = document.createElement("canvas");
  canvas.width = slot * glyphs.length;
  canvas.height = slot;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(cell);
  glyphs.forEach((glyph, at) => {
    ctx.fillText(glyph, at * slot + slot / 2, slot / 2);
  });
  return canvas;
}

/**
 * When a call connects, one wave of her glyphs leaves her face and rolls out to every corner
 * of the window: a round front made ragged, and crumbs left where it passed. It is drawn
 * over the whole screen, never takes a click, and does not play when the system asks
 * for less motion. Placed inside the box her face is laid out in; the wave starts at its centre.
 */
export function ConnectWave({
  status,
  charset,
}: {
  status: CallStatus;
  charset: AsciiCharset;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const was = useRef(status);
  const [playing, setPlaying] = useState(false);
  const cell = CELL[charset];
  // Emoji are drawn as the screen loads: the first emoji a page draws is slow, and the
  // moment a call picks up is the wrong moment for it
  const emoji = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    emoji.current = charset === "ascii" ? null : sheet(EMOJI_POOL, cell);
  }, [charset, cell]);

  useEffect(() => {
    const from = was.current;
    was.current = status;
    // from connecting to anything but connecting, hanging up or failing is a call that picked up
    if (
      from !== "connecting" ||
      status === "connecting" ||
      status === "idle" ||
      status === "ending"
    )
      return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPlaying(true);
  }, [status]);

  useEffect(() => {
    const element = canvas.current;
    const box = anchor.current?.getBoundingClientRect();
    if (!playing || !element || !box) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    const cells: Cell[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (hash(c + 53, r + 5) > 0.9) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        const angle = Math.atan2(y - cy, x - cx);
        const grain = hash(c + 31, r + 17);
        // a few slow lobes and some grain, so the front is round but never a clean circle
        const warp =
          1 +
          0.1 * Math.sin(3 * angle + 1.3) +
          0.05 * Math.sin(7 * angle - 0.7) +
          (grain - 0.5) * 0.1;
        const dd = (Math.hypot(x - cx, y - cy) / far) * warp;
        if (dd < HOLE) continue;
        cells.push({
          x,
          y,
          dd,
          seed: hash(c, r),
          grain,
          speck: hash(c + 7, r + 101),
          roll: hash(c + 211, r + 89),
        });
      }
    // nearest first, so a frame visits only the cells between the crumbs and the front
    cells.sort((a, b) => a.dd - b.dd);
    const from = (dd: number) => {
      let lo = 0;
      let hi = cells.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cells[mid].dd < dd) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    // One pixel per CSS pixel: the wave is gone in two seconds, and a retina-sized
    // canvas over the whole window is four times the pixels to put on screen every frame
    element.width = w;
    element.height = h;
    const ctx = element.getContext("2d");
    const emojis = emoji.current ?? sheet(EMOJI_POOL, cell);
    if (!ctx || !emojis) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(cell);
    // her ink is the page's foreground: black on light, white on dark
    ctx.fillStyle = getComputedStyle(element).color;
    const top = RAMP.length - 1;
    // the same glyphs as her face: all emoji, emoji over the bright ascii, or ascii alone
    const emojiAt = (c: Cell, level: number) =>
      charset === "emojiOnly" ||
      (charset === "emoji" && c.roll < EMOJI_RATIO && level >= EMOJI_MIN_LEVEL);
    const rate = charset === "emojiOnly" ? EMOJI_CHAR_RATE : CHAR_RATE;
    const slot = slotOf(cell);
    const half = slot / 2;

    const t0 = performance.now();
    let frame = 0;
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > DONE_S) return setPlaying(false);
      raf = requestAnimationFrame(tick);
      if (frame++ % 2) return;
      const R = t * SPEED;
      ctx.clearRect(0, 0, w, h);
      for (let i = from(R - CREST - CRUMB_S * SPEED); i < cells.length; i++) {
        const c = cells[i];
        const behind = R - c.dd;
        if (behind < -0.03) break;
        let v =
          smoothstep(-0.03, 0.02, behind) *
          (1 - smoothstep(0.02, CREST, behind)) *
          (0.72 + 0.28 * Math.sin(c.dd * 46 - t * 7 + c.seed * 6.283));
        if (c.speck < CRUMBS) {
          const life = 0.18 + c.grain * (CRUMB_S - 0.18);
          const since = (behind - CREST) / SPEED;
          v = Math.max(
            v,
            (0.3 + 0.4 * c.grain) * (1 - smoothstep(life * 0.4, life, since)),
          );
        }
        const level = Math.round(v * top);
        if (level < 1) continue;
        const turn = Math.floor(t * rate + c.seed * 10);
        if (emojiAt(c, level)) {
          // emoji keep their own colour, so only alpha varies, as on her face
          ctx.globalAlpha = 0.35 + (level / top) * 0.65;
          const at = Math.floor(hash(c.seed * 97, turn) * EMOJI_POOL.length);
          ctx.drawImage(
            emojis,
            at * slot,
            0,
            slot,
            slot,
            c.x - half,
            c.y - half,
            slot,
            slot,
          );
          continue;
        }
        ctx.globalAlpha = ALPHA_TOP * (level / top);
        const set = RAMP[level];
        ctx.fillText(
          set[Math.floor(hash(c.seed * 131, turn) * set.length)],
          c.x,
          c.y,
        );
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, charset, cell]);

  return (
    <>
      <span
        ref={anchor}
        aria-hidden
        className="pointer-events-none absolute inset-0"
      />
      {playing &&
        createPortal(
          <canvas
            ref={canvas}
            aria-hidden
            className="pointer-events-none fixed inset-0 z-30 size-full text-foreground"
          />,
          document.body,
        )}
    </>
  );
}
