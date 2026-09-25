"use client";

import { type RefObject, useEffect, useRef } from "react";
import {
  ALPHA_TOP,
  EMOJI_MIN_LEVEL,
  EMOJI_POOL,
  EMOJI_RATIO,
  emojiAlpha,
  emojiWeight,
  hash,
  RAMP,
  smoothstep,
} from "@/features/thursday/ascii.const";
import {
  CHURN_ASCII,
  CHURN_EMOJI,
  DESIGN,
  GLYPH_FONT,
  REST_R,
  TRAIL_FAST,
} from "@/features/thursday/components/ascii-orb";
import type { AsciiCharset } from "@/features/thursday/face.const";
import { windAt } from "@/features/thursday/field";
import { createSmoke, restValue, stepSmoke } from "@/features/thursday/smoke";
import { WASH_SETS } from "@/features/thursday/wash";
import { useIsDark } from "@/hooks/use-theme";

/**
 * The sizes she comes down through before her own, largest first: how many of her radii across,
 * and the glyphs each is drawn in. A larger her is drawn in larger glyphs, so each size stands at
 * a depth of its own rather than being the same picture scaled.
 */
const SIZES = [
  { radii: 5, px: 64, density: 1.05 },
  { radii: 3.2, px: 40, density: 1.1 },
  { radii: 2.1, px: 26, density: 1.2 },
  { radii: 1.45, px: 16, density: 1.3 },
] as const;

/**
 * When each size comes in, seconds from the start; the last is her own, on her real face. An
 * uneven beat, long and then shorter and shorter, and each run jittered by up to BEAT_JITTER, so
 * it is never a count.
 */
const BEAT = [0.2, 1.6, 2.5, 3.1, 3.55];
const BEAT_JITTER = 0.12;
/** How long a size takes to come in: the first comes out of nothing, the rest in a step. */
const FIRST_IN = 1.2;
const NEXT_IN = 0.35;
/** When the first run's hello goes up under her, seconds from the start. */
const HELLO_AT = 4.7;
/** Past the last beat by this much, the opening is over once nothing of it is left on screen. */
const LAST_CRUMB = 1.6;

/**
 * The phosphor: her face's short clock, and a long tail that is heavier than hers, since what a
 * size leaves behind is the point here. Seconds, and what the tail is worth beside the body.
 */
const TRAIL_SLOW = 1.4;
const TRAIL_WEIGHT = 0.55;

/**
 * A size she has left keeps only its rim, between RIM_IN and RIM_OUT of her radii, and the rim
 * comes apart: the circle cut into sectors (CRUMBS for the largest, CRUMBS_MORE more for each
 * smaller size), each drifting out at its own speed and going out at its own moment.
 */
const RIM_IN = [0.6, 0.88] as const;
const RIM_OUT = [1.2, 1.55] as const;
const CRUMBS = 70;
const CRUMBS_MORE = 26;
/** Share of crumbs that carry one of her washes away with them, and how long a cell keeps it. */
const CARRIERS = 0.13;
const CARRY_LINGER = 0.35;
/** Her washes a crumb can carry: moons, water, and her whites (wash.ts WASH_SETS). */
const CARRIED = [2, 3, 1] as const;

/** Past this many of her radii from its centre, no size of her ever lights a cell. */
const REACH = 2.6;

/**
 * What a size she has left is drawn in when she is drawn in emoji: her whites, out of her pool
 * and her washes, dim to bright. On a light ground the order turns over — white vanishes into it,
 * and black is what reads.
 */
const GONE_DARK = [
  [],
  ["🤍"],
  ["🤍", "☁️"],
  ["☁️", "🤍"],
  ["☁️", "🕊️"],
  ["🕊️", "☁️"],
  ["🕊️", "🦢"],
  ["🦢", "🕊️", "☁️"],
  ["🦢", "🤍"],
  ["🤍", "⚪", "🦢"],
  ["🤍", "⚪"],
  ["⚪", "🤍"],
];
const GONE_LIGHT = [
  [],
  ["🤍", "⚪"],
  ["🤍", "⚪", "🦢"],
  ["🦢", "🤍", "🕊️"],
  ["🦢", "🕊️", "☁️"],
  ["🕊️", "🦢", "☁️"],
  ["🕊️", "☁️"],
  ["☁️", "🕊️"],
  ["☁️", "🖤"],
  ["⚫", "🖤", "☁️"],
  ["🖤", "⚫"],
  ["🖤", "⚫"],
];

/** The largest glyph drawn, px: the emoji sheet is drawn at it and scaled down for the rest. */
const SHEET_PX = SIZES[0].px;
/** An emoji's square on the sheet, as a share of its font size: emoji reach past it. */
const SLOT_OVER = 1.3;
/** Squares a row on the sheet, so no side of it passes what a GPU takes as one texture. */
const SHEET_COLS = 12;

type Cell = {
  x: number;
  y: number;
  /** Where the cell is on this size of her: her radii from its centre, and the same in reference units. */
  r: number;
  dx: number;
  dy: number;
  /** Its crumb of the rim: how far that drifts, when it goes out, whether it carries a wash. */
  drift: number;
  go: number;
  carry: number;
  /** Where its drifting noise is read, scaled so that the noise is the same size in glyphs on every size. */
  nx: number;
  ny: number;
  seed: number;
  grain: number;
  gap: number;
  roll: number;
};

type Size = {
  px: number;
  cells: Cell[];
  fast: Float32Array;
  slow: Float32Array;
  wasLevel: Int8Array;
  turn: Int32Array;
  pick: Int32Array;
  /** The wash a cell holds, 1-based, and how much longer it keeps it. */
  pool: Int8Array;
  poolFor: Float32Array;
  /** Cells by level this frame, and their glyphs. */
  ascii: Int32Array[];
  emoji: Int32Array[];
  asciiN: Int32Array;
  emojiN: Int32Array;
  glyph: string[];
  /** All of it has gone out. */
  over: boolean;
};

/** The emoji drawn once on a sheet, so a frame copies squares rather than drawing emoji. */
function sheet(glyphs: string[], dpr: number) {
  const font = Math.round(SHEET_PX * dpr);
  const slot = Math.ceil(font * SLOT_OVER);
  const canvas = document.createElement("canvas");
  canvas.width = slot * SHEET_COLS;
  canvas.height = slot * Math.ceil(glyphs.length / SHEET_COLS);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = GLYPH_FONT(font);
  const at = new Map<string, number>();
  glyphs.forEach((glyph, i) => {
    at.set(glyph, i);
    ctx.fillText(
      glyph,
      (i % SHEET_COLS) * slot + slot / 2,
      Math.floor(i / SHEET_COLS) * slot + slot / 2,
    );
  });
  // a square's side in CSS px for each px of glyph
  return { canvas, at, slot, scale: slot / dpr / SHEET_PX };
}

const still = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The first run's opening. She comes in larger than the screen and steps down to her own size on
 * an uneven beat; each size she was keeps only its rim, and the rim comes apart crumb by crumb,
 * each crumb going out at its own speed, some carrying one of her washes away with them. Every
 * size is her resting face (smoke.ts restValue) — nothing here is drawn for the occasion — laid on
 * the box her face stands in (`anchor`), whose `--face-bleed` says how far her canvas reaches past
 * it. On the last beat `onArrive` puts her real face in its place, and she wakes there; `onHello`
 * is the first screen going up, and `onDone` the last crumb gone. It does not play when the system
 * asks for less motion: then all three come at once.
 */
export function Echoes({
  anchor,
  charset,
  onArrive,
  onHello,
  onDone,
}: {
  anchor: RefObject<HTMLElement | null>;
  charset: AsciiCharset;
  onArrive: () => void;
  onHello: () => void;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dark = useIsDark();
  // the loop starts once; what may change under it comes through refs
  const live = useRef({ charset, dark, onArrive, onHello, onDone });
  live.current = { charset, dark, onArrive, onHello, onDone };

  useEffect(() => {
    const element = canvas.current;
    const box = anchor.current;
    const said = { arrive: false, hello: false, done: false };
    const say = (what: keyof typeof said) => {
      if (said[what]) return;
      said[what] = true;
      if (what === "arrive") live.current.onArrive();
      else if (what === "hello") live.current.onHello();
      else live.current.onDone();
    };
    if (!element || !box || still()) {
      say("arrive");
      say("hello");
      say("done");
      return;
    }
    const ctx = element.getContext("2d");
    if (!ctx) {
      say("arrive");
      say("hello");
      say("done");
      return;
    }

    const beat = BEAT.map(
      (at, i) => at + (i > 0 ? (Math.random() - 0.5) * BEAT_JITTER : 0),
    );
    const seed = Math.random() * 50;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const emojis = sheet(
      [
        ...new Set([
          ...EMOJI_POOL,
          ...GONE_DARK.flat(),
          ...GONE_LIGHT.flat(),
          ...CARRIED.flatMap((set) => WASH_SETS[set - 1].emoji),
        ]),
      ],
      dpr,
    );
    const top = RAMP.length - 1;

    let sizes: Size[] = [];
    // Her ink is the page's foreground, read again only when the theme turns or the canvas is
    // laid out anew (which resets it): read every frame, it makes the page work out its styles
    // while the first screen is animating in.
    let inkFor: boolean | null = null;
    // her canvas's centre and size, measured off the box she stands in, and every size's grid on it
    const lay = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      element.width = Math.round(w * dpr);
      element.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      inkFor = null;
      const rect = box.getBoundingClientRect();
      const bleed =
        Number.parseFloat(
          getComputedStyle(box).getPropertyValue("--face-bleed"),
        ) / 100 || 0;
      const size = rect.width * (1 + 2 * bleed);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const perPx = DESIGN / size;
      sizes = SIZES.map((one, index) => {
        const cw = (one.px * 0.95) / one.density;
        const ch = (one.px * 1.25) / one.density;
        // each size a little turned against the last, so its crumbs are not the last one's
        const turn = 0.12 * index;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const n = CRUMBS + CRUMBS_MORE * index;
        const cells: Cell[] = [];
        for (let row = 0; row * ch < h; row++)
          for (let col = 0; col * cw < w; col++) {
            const x = col * cw + cw / 2;
            const y = row * ch + ch / 2;
            const ox = (x - cx) * perPx;
            const oy = (y - cy) * perPx;
            const qx = (ox * cos - oy * sin) / REST_R / one.radii;
            const qy = (ox * sin + oy * cos) / REST_R / one.radii;
            const r = Math.hypot(qx, qy);
            if (r > REACH) continue;
            const sector = Math.floor(
              ((Math.atan2(qy, qx) + Math.PI) / (Math.PI * 2)) * n,
            );
            const h1 = hash(sector + index * 13, 3.1 + seed);
            const carry = hash(sector * 1.3, 11.1 + seed);
            cells.push({
              x,
              y,
              r,
              dx: qx * REST_R,
              dy: qy * REST_R,
              drift: 0.02 + 0.14 * h1 * h1,
              go: 0.15 + 0.9 * hash(sector, 7.7 + index),
              carry:
                carry < CARRIERS
                  ? CARRIED[Math.floor(carry * 23) % CARRIED.length]
                  : 0,
              nx: ox * (8 / one.px) * 0.05,
              ny: oy * (8 / one.px) * 0.05,
              seed: hash(col + index * 101, row),
              grain: hash(col * 5.7 + 19 + index, row * 2.3 + 53),
              gap: 0.05 + hash(col * 7.3 + 11, row * 3.1 + 5 + index) * 0.3,
              roll: hash(col * 2.7 + 31, row * 5.9 + 17 + index),
            });
          }
        const count = cells.length;
        return {
          px: one.px,
          cells,
          fast: new Float32Array(count),
          slow: new Float32Array(count),
          wasLevel: new Int8Array(count).fill(-9),
          turn: new Int32Array(count).fill(-9),
          pick: new Int32Array(count),
          pool: new Int8Array(count),
          poolFor: new Float32Array(count),
          ascii: Array.from({ length: top + 1 }, () => new Int32Array(count)),
          emoji: Array.from({ length: top + 1 }, () => new Int32Array(count)),
          asciiN: new Int32Array(top + 1),
          emojiN: new Int32Array(top + 1),
          glyph: new Array<string>(count),
          over: false,
        };
      });
    };
    lay();
    window.addEventListener("resize", lay);

    const smoke = createSmoke();
    const windSeed = Math.random() * 90;
    const spot = { dx: 0, dy: 0, dist: 0 };
    const t0 = performance.now();
    let last = t0;
    let clock = 0;
    let raf = 0;

    const tick = (now: number) => {
      const T = (now - t0) / 1000;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      clock += dt;
      const { charset: cs, dark: onDark } = live.current;
      const alone = cs === "emojiOnly";
      const rate = alone ? CHURN_EMOJI : CHURN_ASCII;
      const gone = onDark ? GONE_DARK : GONE_LIGHT;
      if (inkFor !== onDark) {
        inkFor = onDark;
        ctx.fillStyle = getComputedStyle(element).color;
      }
      // her smoke at rest and this frame's wind: every size leans as she does
      stepSmoke(smoke, clock, dt, 0, 0, -1);
      const wind = windAt(clock, windSeed);
      const fastKeep = Math.exp(-dt / TRAIL_FAST);
      const slowKeep = Math.exp(-dt / TRAIL_SLOW);

      ctx.clearRect(0, 0, element.width / dpr, element.height / dpr);
      let lit = 0;
      sizes.forEach((one, index) => {
        const from = beat[index];
        const next = beat[index + 1];
        if (one.over || T < from) return;
        const age = T - next;
        const coming =
          age <= 0
            ? smoothstep(0, 1, (T - from) / (index === 0 ? FIRST_IN : NEXT_IN))
            : 1;
        const ghost = age > 0 ? smoothstep(0, 0.3, age) : 0;
        const left = age > 0.05;
        // her own noise, at a time of its own for each size, so no two sizes breathe together
        const at = clock + index * 31;
        one.asciiN.fill(0);
        one.emojiN.fill(0);
        let here = 0;
        const cells = one.cells;
        for (let ci = 0; ci < cells.length; ci++) {
          const cell = cells[ci];
          let v = 0;
          let carried = 0;
          if (age <= 0) {
            if (coming > 0 && cell.r < REACH) {
              spot.dx = cell.dx;
              spot.dy = cell.dy;
              spot.dist = cell.r * REST_R;
              v = restValue(spot, at, 0, REST_R, coming, smoke, wind);
            }
          } else {
            // the size she was: its rim, each crumb drifting out and going out on its own time
            const rs = cell.r - cell.drift * age ** 0.8;
            const rim =
              smoothstep(RIM_IN[0], RIM_IN[1], Math.abs(rs)) *
              (1 - smoothstep(RIM_OUT[0], RIM_OUT[1], Math.abs(rs)));
            const keep =
              (1 + (rim * 1.5 - 1) * ghost) *
              (1 - smoothstep(cell.go, cell.go + 0.4, age));
            if (keep > 0) {
              const k = cell.r > 0 ? rs / cell.r : 0;
              spot.dx = cell.dx * k;
              spot.dy = cell.dy * k;
              spot.dist = Math.abs(rs) * REST_R;
              v = restValue(spot, at, 0, REST_R, 1, smoke, wind) * keep;
              if (v > 0.04 && ghost > 0.5) carried = cell.carry;
            }
          }

          // her per-cell response, as her face has it
          v *= 0.66 + cell.grain * 0.72;
          v *=
            0.8 +
            hash(
              Math.floor(cell.nx + clock * 0.5),
              Math.floor(cell.ny - clock * 0.3),
            ) *
              0.4;
          if (
            v > 0.3 &&
            hash(Math.floor(clock * 1.6) * 31.7, cell.seed * 613) > 0.992
          )
            v = Math.max(v, 0.9);

          if (carried) {
            one.pool[ci] = carried;
            one.poolFor[ci] = CARRY_LINGER * (0.5 + cell.grain);
          } else if (one.poolFor[ci] > 0) {
            one.poolFor[ci] -= dt;
            if (one.poolFor[ci] <= 0) one.pool[ci] = 0;
          } else {
            one.pool[ci] = 0;
          }

          const lit1 = (one.fast[ci] =
            v > one.fast[ci] * fastKeep ? v : one.fast[ci] * fastKeep);
          const tail = (one.slow[ci] =
            v > one.slow[ci] * slowKeep ? v : one.slow[ci] * slowKeep);
          v = lit1 > tail * TRAIL_WEIGHT ? lit1 : tail * TRAIL_WEIGHT;
          const gate =
            cell.gap + Math.sin(clock * 0.28 + cell.seed * 6.283) * 0.05;
          if (v < gate) continue;
          const level = ((v > 1 ? 1 : v) * top) | 0;
          if (level === 0) continue;
          here++;

          const slot = (clock * rate + cell.seed * 7) | 0;
          if (
            slot !== one.turn[ci] ||
            level - one.wasLevel[ci] >= 2 ||
            one.wasLevel[ci] - level >= 2
          ) {
            one.turn[ci] = slot;
            one.wasLevel[ci] = level;
            one.pick[ci] = ((cell.seed * 997) | 0) + slot + level;
          }
          const pick = one.pick[ci];
          const set = one.pool[ci] ? WASH_SETS[one.pool[ci] - 1] : null;
          const showEmoji =
            alone ||
            (cs === "emoji" &&
              (set !== null ||
                (cell.roll < EMOJI_RATIO && level >= EMOJI_MIN_LEVEL)));
          if (showEmoji && emojis) {
            // a size she has left goes to her whites; what carries a wash wears it
            const bag = set ? set.emoji : left ? gone[level] : EMOJI_POOL;
            one.glyph[ci] = bag[pick % bag.length];
            one.emoji[level][one.emojiN[level]++] = ci;
          } else {
            const bag = set ? set.ascii : RAMP[level];
            one.glyph[ci] = bag[pick % bag.length];
            one.ascii[level][one.asciiN[level]++] = ci;
          }
        }
        lit += here;
        if (age > 1.45 && here === 0) one.over = true;

        // drawn by level, as her face is: ink for the glyphs, alpha for how bright
        ctx.font = GLYPH_FONT(one.px);
        for (let lv = 1; lv <= top; lv++) {
          const n = one.asciiN[lv];
          if (n === 0) continue;
          ctx.globalAlpha = ALPHA_TOP * (lv / top);
          const idx = one.ascii[lv];
          for (let i = 0; i < n; i++) {
            const cell = cells[idx[i]];
            ctx.fillText(one.glyph[idx[i]], cell.x, cell.y);
          }
        }
        if (!emojis) return;
        for (let lv = 1; lv <= top; lv++) {
          const n = one.emojiN[lv];
          if (n === 0) continue;
          ctx.globalAlpha = emojiAlpha(lv, top, alone);
          // drawn alone, the dim end is drawn smaller too (ascii.const emojiWeight)
          const side =
            one.px *
            emojis.scale *
            (alone ? 0.5 + emojiWeight(lv, top) * 0.5 : 1);
          const idx = one.emoji[lv];
          for (let i = 0; i < n; i++) {
            const cell = cells[idx[i]];
            const at = emojis.at.get(one.glyph[idx[i]]) ?? 0;
            ctx.drawImage(
              emojis.canvas,
              (at % SHEET_COLS) * emojis.slot,
              Math.floor(at / SHEET_COLS) * emojis.slot,
              emojis.slot,
              emojis.slot,
              cell.x - side / 2,
              cell.y - side / 2,
              side,
              side,
            );
          }
        }
      });
      ctx.globalAlpha = 1;

      if (T >= beat[4]) say("arrive");
      if (T >= HELLO_AT) say("hello");
      if (T > beat[4] + LAST_CRUMB && lit === 0) {
        ctx.clearRect(0, 0, element.width / dpr, element.height / dpr);
        say("done");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", lay);
    };
  }, [anchor]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full text-foreground"
    />
  );
}
