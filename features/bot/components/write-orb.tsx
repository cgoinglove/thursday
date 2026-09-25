"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * What the pill's write button becomes while the line it opens is up: smoke in a glass, carried
 * left to right. It keeps the button's box, so the pill is the same width either way.
 *
 * Drawn to frames the user brought, and measured off them rather than guessed:
 *   · one hue throughout — the blue channel never leaves 247..254 while red and green run
 *     110..252 — so every pixel is that blue with some amount of white in it;
 *   · the picture is mostly PALE: median red 219, only a tenth under 145. One soft dark mass and
 *     three quarters of it light; half and half reads as a wave;
 *   · the ramps between are long, and a long ramp is a wide window over a big slow field;
 *   · a row across the middle is nearly flat and a column is not, so the smoke lies in banks
 *     stretched sideways;
 *   · the edge lands in two pixels, so the circle is cut, not faded — which the button's own
 *     `rounded-full overflow-hidden` does, at the screen's resolution rather than the buffer's.
 *
 * Four things were tried and are wrong, kept here so they are not tried again: one field sliding
 * past reads as a camera moving over something standing still; crossfading two phases of one
 * field reads as growing and shrinking in place; a twist strongest in the middle draws a taegeuk;
 * and a scale under about 0.5 puts the whole disc inside one cell of noise, where it brightens
 * and darkens as one lump instead of having weather in it.
 */

/**
 * The one hue, deepest first: three smoke tones between the ink and the paper. The steps are
 * walked from the app's own blue (`--brand` #0169cc) at the distances read off the frames, so
 * the smoke is the app's colour and only the hue differs from what was measured.
 */
const STOPS: [number, [number, number, number]][] = [
  [0.0, [21, 117, 208]],
  [0.4, [90, 157, 222]],
  [0.75, [179, 210, 239]],
  [1.0, [252, 252, 254]],
];
const INK = STOPS[0][1];

/**
 * The sheets, coarsest first. Each is the same cloud at a different size, carried at its own
 * pace, every one stretched sideways (`wide` under `tall`) because that is how the frames lie.
 * `gust*` is how much a gust pulls that sheet about; only the big one feels it. The last belongs
 * to none of the others and pushes both ways — white where it is thick, indigo where it is thin —
 * which is where the irregularity comes from.
 */
const SHEETS = [
  {
    pace: 0.075,
    wide: 0.75,
    tall: 1.15,
    seed: 3.1,
    gustWide: 0.4,
    gustTall: 0.2,
    sky: 1,
  },
  {
    pace: 0.16,
    wide: 1.3,
    tall: 2.2,
    seed: 11.7,
    gustWide: 0,
    gustTall: 0,
    sky: 1,
  },
  {
    pace: 0.3,
    wide: 2.4,
    tall: 4.0,
    seed: 19.3,
    gustWide: 0,
    gustTall: 0,
    sky: 1,
  },
  {
    pace: 0.21,
    wide: 1.65,
    tall: 2.9,
    seed: 27.7,
    gustWide: 0,
    gustTall: 0,
    sky: 1.3,
  },
];

/**
 * Pixels across the buffer. The button is 28px, and smoke has no edge to lose, so the browser
 * scales this up rather than the paint running at device resolution: about half a millisecond a
 * frame, which at 30fps is a sixtieth of one core.
 */
const BUFFER = 48;

/*
 * It arrives and goes by fading, and by nothing else (the user's pick). Four other ways in were
 * built and turned down: smoke rising from the floor, a puff opening out of the middle, and a
 * sweep blowing in with the wind all draw the round shape at some single moment, which reads as
 * canned; and letting smoke escape past the rim, which at this size has three pixels to escape
 * into — too few to read as anything, enough to lose the shape.
 */

/** Thirty a second is enough for weather, and leaves the rest of the frame to the call. */
const FRAME_MS = 33;

/** How long it takes to fade in, and out again. */
const FADE_MS = 200;

const clamp = (value: number, low: number, high: number) =>
  value < low ? low : value > high ? high : value;
const ease = (t: number) => t * t * (3 - 2 * t);
const fade = (edge0: number, edge1: number, x: number) =>
  ease(clamp((x - edge0) / (edge1 - edge0), 0, 1));

const hash = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const noise = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = ease(x - xi);
  const v = ease(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};
/** Two octaves and no more: a third is grain, and grain is what makes it look like marble. */
const cloud = (x: number, y: number, seed: number) =>
  noise(x + seed, y + seed * 0.7) * 0.74 +
  noise(x * 2.2 + seed, y * 2.2 + seed * 1.3) * 0.26;

/** The colour at one amount of light, along the measured ramp. */
function tone(level: number, out: [number, number, number]) {
  const t = clamp(level, 0, 1);
  let at = 1;
  while (at < STOPS.length - 1 && t > STOPS[at][0]) at += 1;
  const [t0, from] = STOPS[at - 1];
  const [t1, to] = STOPS[at];
  const part = (t - t0) / (t1 - t0);
  out[0] = from[0] + (to[0] - from[0]) * part;
  out[1] = from[1] + (to[1] - from[1]) * part;
  out[2] = from[2] + (to[2] - from[2]) * part;
}

/**
 * `on` is the line being up. The orb outlives it by `FADE_MS` so it has time to draw back into
 * the button rather than vanishing: a swap with no going-away is what made `/` read as a cut.
 */
export function WriteOrb({
  on,
  className,
}: {
  on: boolean;
  className?: string;
}) {
  const held = useRef<HTMLCanvasElement>(null);
  const [alive, setAlive] = useState(on);

  // `alive` is whether it is in the tree, `shown` whether it has faded up. Two of them because a
  // transition needs a frame at nothing before it can run to something, and because it has to
  // stay in the tree long enough to fade out again.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (on) {
      setAlive(true);
      const up = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(up);
    }
    setShown(false);
    const leaving = setTimeout(() => setAlive(false), FADE_MS);
    return () => clearTimeout(leaving);
  }, [on]);

  useEffect(() => {
    const canvas = held.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = BUFFER;
    canvas.height = BUFFER;
    const image = context.createImageData(BUFFER, BUFFER);
    const pixels = image.data;
    const colour: [number, number, number] = [0, 0, 0];
    // Somewhere else in the weather and under a sky of its own every time, so it never opens on
    // the same frame twice.
    const born = Math.random() * 900;
    const sky = Math.random() * 400;

    const draw = (seconds: number) => {
      const time = seconds + born;
      // Carried one way only, left to right, at a pace that breathes. This is the integral of
      // that pace, so it speeds up and slows down but never slides back where it came from.
      const flow = time + 1.7 * Math.sin(time * 0.33);
      // The wind comes in gusts, on two beats that do not divide into each other.
      const blow =
        (0.5 + 0.5 * Math.sin(time * 0.27)) ** 2 * 0.72 +
        (0.5 + 0.5 * Math.sin(time * 0.41 + 2.1)) ** 3 * 0.28;
      const lift = Math.sin(time * 0.19) * 0.1;
      const carried = SHEETS.map((sheet) => ({
        seed: sheet.seed,
        shift: flow * sheet.pace,
        wide: sheet.wide * (1 - sheet.gustWide * blow),
        tall: sheet.tall * (1 + sheet.gustTall * blow),
        sky: sky * sheet.sky,
      }));

      let p = 0;
      for (let py = 0; py < BUFFER; py += 1) {
        const ny = ((py + 0.5) / BUFFER) * 2 - 1;
        for (let px = 0; px < BUFFER; px += 1, p += 4) {
          const nx = ((px + 0.5) / BUFFER) * 2 - 1;

          // A deep slow warp under the lot, so no sheet lies in flat strata.
          const wx = noise(nx * 0.55 + time * 0.03, ny * 0.55 + sky) - 0.5;
          const wy =
            noise(nx * 0.55 + 9.1 + sky, ny * 0.55 - time * 0.024) - 0.5;
          const qx = nx + wx * 1.15;
          const qy = ny + wy * 1.0 + lift;

          const [mass, bank, wisp, spare] = carried.map((sheet) =>
            cloud(
              (qx - sheet.shift) * sheet.wide + sheet.sky,
              qy * sheet.tall,
              sheet.seed,
            ),
          );

          // Mostly pale, with one soft dark mass in it — the frames' own proportions.
          let dark = clamp((0.52 - mass) / 0.34, 0, 1);
          dark *= 0.7 + 0.6 * clamp((0.56 - bank) / 0.4, 0, 1);
          dark = clamp(dark + (0.5 - wisp) * 0.42, 0, 1);
          let level =
            0.97 -
            0.92 * dark ** 1.2 -
            clamp((0.5 - wisp) / 0.6, 0, 1) * 0.1 +
            (spare - 0.5) * 0.38;

          // What is on the ball rather than in the smoke: a light standing off the upper left,
          // and the one bounce a glass ball catches along its lower rim.
          const radius = Math.sqrt(nx * nx + ny * ny);
          level +=
            clamp(1 - Math.hypot(nx + 0.42, ny + 0.48) / 1.5, 0, 1) * 0.16;
          level +=
            fade(0.84, 1.0, radius) *
            clamp(0.15 + 0.85 * (ny * 0.8 + nx * 0.45), 0, 1) *
            0.45;

          tone(level, colour);

          // Not a rim: the whole disc leaning into the ink as it goes out, which reads as a ball
          // where a band reads as a border drawn round it.
          const round = clamp(radius, 0, 1) ** 2.4 * 0.26;
          pixels[p] = colour[0] + (INK[0] - colour[0]) * round;
          pixels[p + 1] = colour[1] + (INK[1] - colour[1]) * round;
          pixels[p + 2] = colour[2] + (INK[2] - colour[2]) * round;
          // The circle is cut here rather than left to the button's `overflow-hidden`, which
          // does not reach a canvas of its own layer.
          pixels[p + 3] = 255 * (1 - fade(0.94, 1.0, radius));
        }
      }
      context.putImageData(image, 0, 0);
    };

    const started = performance.now();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(6);
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      draw((now - started) / 1000);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [alive]);

  if (!alive) return null;

  return (
    <canvas
      ref={held}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 size-full transition-opacity",
        shown ? "opacity-100" : "opacity-0",
        className,
      )}
      // The fade and the timer that takes the canvas away after it are one length
      style={{ transitionDuration: `${FADE_MS}ms` }}
    />
  );
}
