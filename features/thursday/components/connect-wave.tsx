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

/** Glyph cell, px. */
const CELL = 11;
/** How far the front travels per second, as a share of the way to the farthest corner. */
const SPEED = 0.95;
/** Width of the lit band behind the front, in the same units. */
const CREST = 0.3;
/** Share of cells that keep a crumb for a moment after the band has passed. */
const CRUMBS = 0.06;
/** The front starts this far out, so the wave leaves her face rather than covering it. */
const HOLE = 0.1;
/** Past the farthest corner, the band and the longest crumb, the wave is over. */
const DONE_S = (1.2 + CREST) / SPEED + 0.5;

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
    const cols = Math.ceil(w / CELL);
    const rows = Math.ceil(h / CELL);
    const cells: {
      x: number;
      y: number;
      dd: number;
      seed: number;
      grain: number;
      speck: number;
      gap: number;
      roll: number;
    }[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = c * CELL + CELL / 2;
        const y = r * CELL + CELL / 2;
        const angle = Math.atan2(y - cy, x - cx);
        const grain = hash(c + 31, r + 17);
        // a few slow lobes and some grain, so the front is round but never a clean circle
        const warp =
          1 +
          0.1 * Math.sin(3 * angle + 1.3) +
          0.05 * Math.sin(7 * angle - 0.7) +
          (grain - 0.5) * 0.1;
        cells.push({
          x,
          y,
          dd: (Math.hypot(x - cx, y - cy) / far) * warp,
          seed: hash(c, r),
          grain,
          speck: hash(c + 7, r + 101),
          gap: hash(c + 53, r + 5),
          roll: hash(c + 211, r + 89),
        });
      }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    element.width = w * dpr;
    element.height = h * dpr;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${CELL}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    // her ink is the page's foreground: black on light, white on dark
    ctx.fillStyle = getComputedStyle(element).color;
    const top = RAMP.length - 1;
    // the same glyphs as her face: all emoji, emoji over the bright ascii, or ascii alone
    const emojiAt = (c: (typeof cells)[number], level: number) =>
      charset === "emojiOnly" ||
      (charset === "emoji" && c.roll < EMOJI_RATIO && level >= EMOJI_MIN_LEVEL);
    const rate = charset === "emojiOnly" ? EMOJI_CHAR_RATE : CHAR_RATE;

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
      for (const c of cells) {
        const behind = R - c.dd;
        if (behind < -0.03 || c.dd < HOLE || c.gap > 0.9) continue;
        let v =
          smoothstep(-0.03, 0.02, behind) *
          (1 - smoothstep(0.02, CREST, behind)) *
          (0.72 + 0.28 * Math.sin(c.dd * 46 - t * 7 + c.seed * 6.283));
        if (c.speck < CRUMBS) {
          const life = 0.18 + c.grain * 0.32;
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
          ctx.fillText(
            EMOJI_POOL[Math.floor(hash(c.seed * 97, turn) * EMOJI_POOL.length)],
            c.x,
            c.y,
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
  }, [playing, charset]);

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
