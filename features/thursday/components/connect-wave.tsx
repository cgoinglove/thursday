"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ALPHA_TOP,
  CHAR_RATE,
  EMOJI_CHAR_RATE,
  EMOJI_POOL,
  emojiAlpha,
  hash,
  LEVELS,
  RAMP,
  smoothstep,
} from "../ascii.const";
import { faceGlyphs } from "../face-glyphs";
import type { CallStatus } from "../thursday.schema";

/** Grid step, px: her face's own. */
const CELL = 11;
/** Glyph size, px: under the step, so the wave reads as specks with air between them. */
const GLYPH = 9;
/** Share of cells that carry a glyph at all: fewer, not larger, keeps the wave light to draw. */
const KEEP = 0.4;
/** How far the front travels per second, as a share of the way to the farthest corner. */
const SPEED = 0.95;
/** Width of the lit band behind the front, in the same units. */
const CREST = 0.2;
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
};

const FONT = `700 ${GLYPH}px ui-monospace, SFMono-Regular, Menlo, monospace`;

/** An emoji's square on the sheet: emoji reach past their font size. */
const SLOT = Math.ceil(GLYPH * 1.5);

/** The emoji drawn once side by side, so a frame copies squares rather than drawing emoji. */
function sheet(glyphs: readonly string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = SLOT * glyphs.length;
  canvas.height = SLOT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = FONT;
  glyphs.forEach((glyph, at) => {
    ctx.fillText(glyph, at * SLOT + SLOT / 2, SLOT / 2);
  });
  return canvas;
}

const still = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * When a call connects, one wave of her glyphs leaves her face and rolls out to every corner of
 * the window: a round front made ragged, and crumbs left where it passed. It is drawn over the
 * whole screen, never takes a click, and does not play when the system asks for less motion.
 * Placed inside the box her face is laid out in; the wave starts at its centre.
 *
 * It used to play once as the screen loaded too. The app opens plainly: a round
 * front crossing the whole window a second after a reload is the most regular thing on the
 * screen, and it landed on top of the hello she is already showing (the user's pick).
 */
export function ConnectWave({ status }: { status: CallStatus }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const was = useRef(status);
  const [playing, setPlaying] = useState(false);
  // Where she is drawn in emoji, they are drawn as the screen loads: the first emoji a page
  // draws is slow, and the moment a call picks up is the wrong moment for it
  const emoji = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (faceGlyphs() === "emoji") emoji.current = sheet(EMOJI_POOL);
  }, []);

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
    if (still()) return;
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
    const cells: Cell[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (hash(c + 53, r + 5) > KEEP) continue;
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
        const dd = (Math.hypot(x - cx, y - cy) / far) * warp;
        if (dd < HOLE) continue;
        cells.push({
          x,
          y,
          dd,
          seed: hash(c, r),
          grain,
          speck: hash(c + 7, r + 101),
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
    const letters = faceGlyphs() === "letters";
    const emojis = letters ? null : (emoji.current ?? sheet(EMOJI_POOL));
    if (!ctx || (!letters && !emojis)) return;
    if (letters) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = FONT;
      // her ink is the page's foreground: black on light, white on dark
      ctx.fillStyle = getComputedStyle(element).color;
    }
    const top = LEVELS - 1;
    const rate = letters ? CHAR_RATE : EMOJI_CHAR_RATE;
    const half = SLOT / 2;

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
        if (emojis) {
          // emoji keep their own colour, so only alpha varies, as on her face
          ctx.globalAlpha = emojiAlpha(level, top);
          const at = Math.floor(hash(c.seed * 97, turn) * EMOJI_POOL.length);
          ctx.drawImage(
            emojis,
            at * SLOT,
            0,
            SLOT,
            SLOT,
            c.x - half,
            c.y - half,
            SLOT,
            SLOT,
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
  }, [playing]);

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
