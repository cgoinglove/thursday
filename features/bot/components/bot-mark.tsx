"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { MARK_BANDS, type MarkShape } from "../mark.const";

// Procedural bot avatar: a generated silhouette with two eyes, animated per frame from refs.

const TAU = Math.PI * 2;
const BOX = 240;
const CENTER = BOX / 2;
const R = 112;
const PAD = 18; // headroom so squash/stretch and the notify ring can bleed out
const VIEW_BOX = `${-PAD} ${-PAD} ${BOX + PAD * 2} ${BOX + PAD * 2}`;
/** Every silhouette is resampled to this many polar points, so blending two is a plain lerp. */
const MARK_RESOLUTION = 128;
const RES = MARK_RESOLUTION;

type Pt = [number, number];

/** What the mark is doing. There is no mouth; while `speaking` the silhouette carries the audio. */
export type MarkState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  /** Handing work to a background bot. */
  | "delegating";

const f = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function squircleOutline(n: number): Pt[] {
  const out: Pt[] = [];
  const e = 2 / n;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([
      CENTER + Math.sign(c) * Math.abs(c) ** e * R,
      CENTER + Math.sign(s) * Math.abs(s) ** e * R,
    ]);
  }
  return out;
}

function blobOutline(seed: number, wobble: number): Pt[] {
  const rnd = mulberry32(seed);
  const harmonics = [1, 2, 3, 4, 5].map((k) => ({
    k,
    a: (rnd() * 2 - 1) / k,
    p: rnd() * TAU,
  }));
  const steps = 360;
  const raw: number[] = [];
  let peak = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    let d = 0;
    for (const h of harmonics) d += h.a * Math.sin(h.k * a + h.p);
    raw.push(d);
    peak = Math.max(peak, Math.abs(d));
  }
  // Normalize so `wobble` is the literal max deviation regardless of seed.
  const k = peak > 0 ? wobble / peak : 0;
  return raw.map((d, i) => {
    const a = (i / steps) * TAU;
    const r = R * (1 + d * k);
    return [CENTER + Math.cos(a) * r, CENTER + Math.sin(a) * r] as Pt;
  });
}

function polyOutline(sides: number, cornerRatio: number, rotDeg: number): Pt[] {
  const rot = (rotDeg * Math.PI) / 180 - Math.PI / 2;
  const verts: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * TAU;
    verts.push([CENTER + Math.cos(a) * R, CENTER + Math.sin(a) * R]);
  }
  const half = (Math.PI - TAU / sides) / 2;
  const edge = 2 * R * Math.sin(Math.PI / sides);
  const rho = (edge / 2) * Math.tan(half) * clamp(cornerRatio, 0.001, 1);
  const tangent = rho / Math.tan(half);

  const out: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const cur = verts[i];
    const prev = verts[(i - 1 + sides) % sides];
    const next = verts[(i + 1) % sides];
    const v1 = unit(sub(prev, cur));
    const v2 = unit(sub(next, cur));
    const t1: Pt = [cur[0] + v1[0] * tangent, cur[1] + v1[1] * tangent];
    const bis = unit([v1[0] + v2[0], v1[1] + v2[1]]);
    const cc: Pt = [
      cur[0] + (bis[0] * rho) / Math.sin(half),
      cur[1] + (bis[1] * rho) / Math.sin(half),
    ];
    const a1 = Math.atan2(t1[1] - cc[1], t1[0] - cc[0]);
    const t2: Pt = [cur[0] + v2[0] * tangent, cur[1] + v2[1] * tangent];
    let sweep = Math.atan2(t2[1] - cc[1], t2[0] - cc[0]) - a1;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    for (let s = 0; s <= 20; s++) {
      const a = a1 + sweep * (s / 20);
      out.push([cc[0] + Math.cos(a) * rho, cc[1] + Math.sin(a) * rho]);
    }
  }
  return out;
}

function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}
function unit(a: Pt): Pt {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
}

function toRadii(outline: Pt[]): number[] {
  const radii: number[] = new Array(RES);
  for (let i = 0; i < RES; i++) {
    const a = (i / RES) * TAU;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 0;
    for (let j = 0; j < outline.length; j++) {
      const p = outline[j];
      const q = outline[(j + 1) % outline.length];
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const px = p[0] - CENTER;
      const py = p[1] - CENTER;
      const t = (px * ey - py * ex) / den;
      const s = (px * dy - py * dx) / den;
      // The tolerance matters: a ray through a vertex sits exactly on s === 1, and a
      // 1-ULP disagreement between JS engines drops a sample, shifts the area
      // normalization and makes server and client draw different silhouettes.
      if (t > best && s >= -1e-9 && s <= 1 + 1e-9) best = t;
    }
    radii[i] = best || R;
  }
  return radii;
}

/** Closed Catmull-Rom through the polar samples, emitted as cubic beziers. */
function radiiToPath(radii: number[]): string {
  const pts: Pt[] = radii.map((r, i) => {
    const a = (i / RES) * TAU;
    return [CENTER + Math.cos(a) * r, CENTER + Math.sin(a) * r];
  });
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < RES; i++) {
    const p0 = pts[(i - 1 + RES) % RES];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % RES];
    const p3 = pts[(i + 2) % RES];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

// Eyes are closed paths around a bent spine, not stroked lines, so they can curve and taper.

type EyeOpts = {
  len: number;
  width: number;
  bend: number;
  taper: number;
  tilt: number;
  cx: number;
  cy: number;
};

function eyePath(o: EyeOpts): string {
  const N = 30;
  const rad = (o.tilt * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const place = (x: number, y: number): Pt => [
    o.cx + x * cos - y * sin,
    o.cy + x * sin + y * cos,
  ];

  const p0x = -o.len / 2;
  const p2x = o.len / 2;
  const left: Pt[] = [];
  const right: Pt[] = [];

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const bx = u * u * p0x + t * t * p2x;
    const by = 2 * u * t * -o.bend;
    const tx = 2 * u * -p0x + 2 * t * p2x;
    const ty = 2 * u * -o.bend + 2 * t * o.bend;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const w = (o.width / 2) * Math.sin(Math.PI * t) ** o.taper;
    left.push(place(bx + nx * w, by + ny * w));
    right.push(place(bx - nx * w, by - ny * w));
  }

  let d = `M${f(left[0][0])} ${f(left[0][1])}`;
  for (let i = 1; i <= N; i++) d += `L${f(left[i][0])} ${f(left[i][1])}`;
  for (let i = N - 1; i >= 0; i--) d += `L${f(right[i][0])} ${f(right[i][1])}`;
  return `${d}Z`;
}

export type MarkOptions = {
  shape: MarkShape;
  sides: number;
  corner: number;
  rotation: number;
  squircle: number;
  wobble: number;
  seed: number;
  autofit: boolean;

  color: string;
  fill: boolean;
  strokeWidth: number;

  eyeLen: number;
  eyeWidth: number;
  eyeBend: number;
  eyeTaper: number;
  eyeTilt: number;
  eyeSkew: number;
  eyeGap: number;
  eyeY: number;

  gazeRange: number;
  follow: boolean;

  /** Outline deviation at full volume, view-box units. Only harmonics 2..4 are driven, so it tilts rather than crinkles. */
  ripple: number;
  /** How far one syllable moves the mark, percent. */
  pulse: number;
  /** Spring impulse per syllable. Outline and squash both follow phrase-length averages, so this is the only fast channel. */
  punch: number;
  /** Per-frame band smoothing. 0.019 is roughly 0.9 s: the outline swells over a phrase, not per word. */
  bandEase: number;
  /** Speed of the syllable bob. 1 is about a 1.1 s period; higher reads as trembling. */
  bobRate: number;
  /** Vertical/horizontal travel at full volume, percent. Low sounds stretch the mark, bright sounds flatten it. */
  stretch: number;
  idle: boolean;
  liveliness: number;
  glance: number;
  float: number;
  breathe: number;
  speed: number;
  blink: boolean;

  /** Peak opacity of the soft shadow that swells under the mark while thinking, percent. 0 disables. */
  shadow: number;
  /** Soft aura around the silhouette; blur radius in view-box units. 0 disables. */
  glow: number;
  /** Aura color. null follows the mark color. */
  glowColor: string | null;
  /** Aura opacity, percent. */
  glowStrength: number;
  /** Border around the silhouette so it still reads on a same-colored background. 0 disables. */
  rim: number;
  /** Defaults to the theme text color, the one color guaranteed to differ from the background. */
  rimColor: string;

  notify: boolean;
  notifyAngle: number;
  notifyDist: number;
  notifyR: number;
  notifyRing: number;
  notifyColor: string;
};

const MARK_DEFAULTS: MarkOptions = {
  shape: "blob",
  sides: 3,
  corner: 0.74,
  rotation: -180,
  squircle: 4.6,
  wobble: 0.2,
  seed: 113,
  autofit: true,

  // Follows the theme so the mark flips with dark mode. Any CSS color works.
  color: "currentColor",
  fill: true,
  strokeWidth: 14,

  eyeLen: 51,
  eyeWidth: 38,
  eyeBend: -1,
  eyeTaper: 0.35,
  eyeTilt: -90,
  eyeSkew: 0,
  eyeGap: 88,
  eyeY: 100,

  gazeRange: 7,
  follow: true,

  ripple: 9,
  pulse: 7,
  punch: 0.05,
  bandEase: 0.019,
  bobRate: 1,
  stretch: 15,
  idle: true,
  liveliness: 55,
  glance: 22,
  float: 7,
  breathe: 3.7,
  speed: 1.7,
  blink: true,

  shadow: 16,
  glow: 0,
  glowColor: null,
  glowStrength: 55,
  rim: 0,
  rimColor: "currentColor",

  notify: false,
  notifyAngle: 41,
  notifyDist: 109,
  notifyR: 25,
  notifyRing: 11,
  notifyColor: "#FF3B30",
};

/* Per-instance variation: shape and color stay, only the values inside the shape roll
 * from a seed the caller picks (task id for one face per task, bot name for one per bot). */
const VARY = {
  /** Blob depth. The seed already changes the whole silhouette, so keep this slight. */
  wobble: [0.8, 1.35],
  /** Poly. Below 0.45 it rounds into a circle. */
  corner: [0.45, 0.77],
  rotation: [-180, 180],
  /** Squircle. 4 is nearly square, 12 nearly round. */
  squircle: [4, 12],
} as const satisfies Record<string, readonly [number, number]>;

/** Roll order defines what a seed means; reordering changes every bot's face. */
function varyOptions(cfg: MarkOptions, seed: number): MarkOptions {
  if (!seed) return cfg;
  const rnd = mulberry32(seed);
  const pick = ([lo, hi]: readonly [number, number]) => lo + rnd() * (hi - lo);
  return {
    ...cfg,
    wobble: cfg.wobble * pick(VARY.wobble),
    corner: pick(VARY.corner),
    rotation: pick(VARY.rotation),
    squircle: pick(VARY.squircle),
  };
}

/** Silhouettes are scaled to the area of the circle of radius R so they read the same size,
 *  capped so sharp corners stay inside the view box. */
const FIT_LIMIT = 130;

function fitRadii(radii: number[]): number[] {
  const dTheta = TAU / RES;
  let area = 0;
  let maxR = 0;
  for (const r of radii) {
    area += 0.5 * r * r * dTheta;
    if (r > maxR) maxR = r;
  }
  if (area <= 0) return radii;
  const k = Math.min(Math.sqrt((Math.PI * R * R) / area), FIT_LIMIT / maxR);
  return radii.map((r) => r * k);
}

const radiiCache = new Map<string, number[]>();

/** Ray-scanning the outline is the expensive step; cache by shape key. */
function radiiFor(cfg: MarkOptions, shape: MarkShape, seed: number): number[] {
  const key = `${
    shape === "poly"
      ? `poly|${cfg.sides}|${cfg.corner}|${cfg.rotation}`
      : shape === "squircle"
        ? `squircle|${cfg.squircle}`
        : `blob|${cfg.wobble}|${seed}`
  }|${cfg.autofit}`;
  const hit = radiiCache.get(key);
  if (hit) return hit;
  const raw = toRadii(outlineFor(cfg, shape, seed));
  const radii = cfg.autofit ? fitRadii(raw) : raw;
  if (radiiCache.size > 400) radiiCache.clear();
  radiiCache.set(key, radii);
  return radii;
}

function outlineFor(cfg: MarkOptions, shape: MarkShape, seed: number): Pt[] {
  if (shape === "squircle") return squircleOutline(cfg.squircle);
  if (shape === "poly") return polyOutline(cfg.sides, cfg.corner, cfg.rotation);
  return blobOutline(seed, cfg.wobble);
}

/* Idle beats: small unrelated motions picked at random, weighted by state. Each returns
 * per-frame channel offsets for progress p in 0..1 and a direction. `eyeLen`/`eyeWid`
 * scale along the eye's own axis, so they still mean shorter/wider when the eye is tilted. */

type Move = {
  eyeLen: number;
  eyeWid: number;
  eyeX: number;
  eyeY: number;
  bodyX: number;
  bodyY: number;
  rot: number;
  scale: number;
  /** Request an extra blink this many ms from now; 0 for none. */
  blinkIn: number;
};

const STILL: Move = {
  eyeLen: 1,
  eyeWid: 1,
  eyeX: 0,
  eyeY: 0,
  bodyX: 0,
  bodyY: 0,
  rot: 0,
  scale: 1,
  blinkIn: 0,
};

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Up and down in one arc. */
const hump = (p: number) => Math.sin(Math.PI * p);

/** Rise, hold, fall. Saccades rise much faster than they return, so the ratios are separate. */
function holdEnv(p: number, rise: number, fall: number) {
  if (p <= 0 || p >= 1) return 0;
  if (p < rise) return smooth(p / rise);
  if (p > 1 - fall) return smooth((1 - p) / fall);
  return 1;
}

type Beat = {
  weight: number;
  dur: [number, number];
  play: (p: number, dx: number, dy: number) => Partial<Move>;
};

const BEATS = {
  // The blink lands on the saccade itself, as with real eyes.
  glance: {
    weight: 26,
    dur: [900, 1400],
    play: (p, dx, dy) => {
      const e = holdEnv(p, 0.12, 0.34);
      return {
        eyeX: dx * 22 * e,
        eyeY: dy * 22 * e,
        rot: dx * 0.9 * e,
        blinkIn: p < 0.02 && Math.random() < 0.4 ? 40 : 0,
      };
    },
  },
  lookAway: {
    weight: 12,
    dur: [1800, 2600],
    play: (p, dx, dy) => {
      const e = holdEnv(p, 0.1, 0.46);
      return {
        eyeX: dx * 30 * e,
        eyeY: (dy * 0.5 + 0.35) * 22 * e,
        rot: dx * 1.6 * e,
      };
    },
  },
  widen: {
    weight: 8,
    dur: [700, 950],
    play: (p, dx) => {
      const e = holdEnv(p, 0.22, 0.5);
      return { eyeLen: 1 + 0.16 * e, eyeWid: 1 + 0.2 * e, rot: -dx * 0.5 * e };
    },
  },
  squint: {
    weight: 8,
    dur: [800, 1050],
    play: (p) => {
      const e = holdEnv(p, 0.25, 0.45);
      return { eyeLen: 1 - 0.3 * e, eyeWid: 1 - 0.12 * e };
    },
  },
  double: {
    weight: 7,
    dur: [420, 420],
    play: (p) => ({ blinkIn: p < 0.02 ? 1 : 0 }),
  },
  nod: {
    weight: 11,
    dur: [1150, 1400],
    play: (p) => ({
      bodyY: 10 * Math.sin(TAU * 2 * p) * hump(p),
      rot: 2.2 * Math.sin(TAU * 2 * p + 0.5) * hump(p),
      eyeY: 3.2 * Math.sin(TAU * 2 * p - 0.7) * hump(p),
    }),
  },
  sink: {
    weight: 7,
    dur: [1800, 2300],
    play: (p) => {
      const e = hump(p) ** 0.7;
      return {
        eyeLen: 1 - 0.26 * e,
        eyeY: 4 * e,
        bodyY: 8 * e,
        scale: 1 - 0.03 * e,
        rot: 1.8 * e,
      };
    },
  },
  wave: {
    weight: 7,
    dur: [1300, 1700],
    play: (p, dx) => {
      const e = holdEnv(p, 0.24, 0.34);
      return {
        bodyX: dx * Math.sin(TAU * 1.5 * p) * 9 * e,
        rot: dx * Math.sin(TAU * 1.5 * p + 0.5) * 4.5 * e,
        eyeX: dx * Math.sin(TAU * 1.5 * p) * 5 * e,
        eyeLen: 1 - 0.2 * e,
      };
    },
  },
  reach: {
    weight: 7,
    dur: [1800, 2300],
    play: (p) => {
      const e = holdEnv(p, 0.28, 0.34);
      return {
        scale: 1 + 0.045 * e,
        bodyY: -4 * e,
        eyeLen: 1 - 0.28 * e,
        eyeY: 3 * e,
        rot: 1.8 * e,
      };
    },
  },
  tilt: {
    weight: 11,
    dur: [1500, 1900],
    play: (p, dx) => {
      const e = holdEnv(p, 0.22, 0.4);
      return { rot: dx * 9 * e, bodyX: dx * -3 * e, eyeY: -1.5 * e };
    },
  },
  sweep: {
    weight: 9,
    dur: [1600, 2200],
    play: (p, dx, dy) => {
      const e = holdEnv(p, 0.12, 0.18);
      const side = Math.cos(Math.PI * clamp((p - 0.15) / 0.7, 0, 1));
      return {
        eyeX: dx * 24 * e * side,
        eyeY: dy * 24 * e * side,
        rot: dx * 1.2 * e * side,
      };
    },
  },
  roll: {
    weight: 5,
    dur: [900, 1200],
    play: (p, dx) => {
      const e = hump(p) ** 0.5;
      const a = TAU * p * (dx >= 0 ? 1 : -1);
      return {
        eyeX: Math.cos(a) * 20 * e,
        eyeY: Math.sin(a) * 14 * e,
        rot: Math.sin(a) * 1.5 * e,
        blinkIn: p > 0.9 && p < 0.93 ? 1 : 0,
      };
    },
  },
  shake: {
    weight: 8,
    dur: [650, 900],
    play: (p, dx) => {
      const e = hump(p);
      const s = Math.sin(TAU * 2 * p);
      return {
        rot: dx * s * 5 * e,
        bodyX: dx * s * 4 * e,
        eyeX: -dx * s * 4 * e,
      };
    },
  },
  bounce: {
    weight: 6,
    dur: [850, 1100],
    play: (p) => {
      const decay = 1 - 0.45 * p;
      const h = Math.abs(Math.sin(TAU * p)) * decay;
      const land = Math.max(0, -Math.cos(TAU * p)) * decay;
      return { bodyY: -14 * h, eyeY: 2.5 * h, scale: 1 - 0.04 * land };
    },
  },
  slowBlink: {
    weight: 6,
    dur: [900, 1200],
    play: (p) => ({ eyeWid: 1 - 0.88 * hump(p) ** 0.6, eyeY: 1.5 * hump(p) }),
  },
  perk: {
    weight: 5,
    dur: [700, 950],
    play: (p, dx) => {
      const e = holdEnv(p, 0.09, 0.62);
      return {
        bodyY: -7 * e,
        scale: 1 + 0.035 * e,
        eyeLen: 1 + 0.14 * e,
        eyeWid: 1 + 0.1 * e,
        rot: dx * 0.8 * e,
      };
    },
  },
} satisfies Record<string, Beat>;

type BeatKey = keyof typeof BEATS;

const BEAT_KEYS = Object.keys(BEATS) as BeatKey[];

/** Per-state beat weight multipliers. Unlisted beats are 1; 0 disables the beat in that state. */
const STATE_BEATS: Record<MarkState, Partial<Record<BeatKey, number>>> = {
  idle: {},
  connecting: { nod: 0, wave: 0, bounce: 0, sweep: 1.6, roll: 1.4 },
  listening: {
    glance: 0.3,
    lookAway: 0.15,
    sweep: 0.2,
    roll: 0,
    wave: 0,
    shake: 0,
    bounce: 0,
    sink: 0.3,
    widen: 2.2,
    perk: 1.8,
    nod: 1.6,
    slowBlink: 1.4,
  },
  thinking: {
    lookAway: 2.2,
    squint: 2,
    tilt: 1.8,
    roll: 2,
    sweep: 1.4,
    sink: 1.6,
    glance: 0.8,
    slowBlink: 1.2,
    nod: 0.3,
    wave: 0,
    bounce: 0.2,
    perk: 0.5,
  },
  delegating: {
    wave: 2.6,
    nod: 1.8,
    perk: 1.6,
    glance: 1.4,
    tilt: 1.2,
    lookAway: 0.4,
    squint: 0.4,
    sink: 0,
    roll: 0,
  },
  speaking: {
    nod: 2,
    glance: 1.2,
    widen: 1.2,
    sink: 0,
    roll: 0.3,
    wave: 0.4,
    slowBlink: 0.4,
    bounce: 0.6,
  },
};

function pickBeat(state: MarkState): BeatKey {
  const bias = STATE_BEATS[state];
  const weightOf = (key: BeatKey) => BEATS[key].weight * (bias[key] ?? 1);
  let total = 0;
  for (const key of BEAT_KEYS) total += weightOf(key);
  let r = Math.random() * total;
  for (const key of BEAT_KEYS) {
    r -= weightOf(key);
    if (r <= 0) return key;
  }
  return BEAT_KEYS[0];
}

type StateShape = {
  /** Eye size multiplier. */
  eyes: number;
  /** Whole-mark multiplier. */
  body: number;
  /** Slow self-driven deformation, independent of audio. */
  churn: number;
  churnSpeed: number;
  /** Multiplier on the gap between idle beats. */
  dwell: number;
  breathe: number;
  /** Multiplier on idle eye drift and on the blink interval. */
  float: number;
  blink: number;
  /** Constant tilt, degrees. */
  lean: number;
  /** Width/height ratio; above 1 flattens. */
  aspect: number;
  /** Constant gaze offset, box units, on top of pointer tracking and drift. */
  gazeX: number;
  gazeY: number;
  /** 1 lets the shadow through, 0 blocks it; eased like the other channels. */
  shadow: number;
};

/** Resting-pose targets per state. */
const STATE_SHAPE: Record<MarkState, StateShape> = {
  idle: {
    eyes: 1,
    body: 1,
    churn: 0,
    churnSpeed: 0,
    dwell: 1,
    breathe: 1,
    float: 1,
    blink: 1,
    shadow: 0,
    lean: 0,
    aspect: 1,
    gazeX: 0,
    gazeY: 0,
  },
  connecting: {
    eyes: 0.75,
    body: 0.91,
    churn: 2.5,
    churnSpeed: 3,
    dwell: 0.8,
    breathe: 2.2,
    float: 0.6,
    blink: 0.6,
    shadow: 0,
    lean: 0,
    aspect: 1.03,
    gazeX: 0,
    gazeY: 4,
  },
  listening: {
    eyes: 1.3,
    body: 1.04,
    churn: 0,
    churnSpeed: 0,
    dwell: 2.6,
    breathe: 0.45,
    float: 0.35,
    blink: 1.8,
    shadow: 0,
    lean: 0,
    aspect: 0.97,
    gazeX: 0,
    gazeY: -3,
  },
  thinking: {
    eyes: 0.66,
    body: 0.96,
    churn: 5,
    churnSpeed: 0.6,
    dwell: 0.5,
    breathe: 1.3,
    float: 1.4,
    blink: 0.8,
    shadow: 1,
    lean: 7,
    aspect: 1.04,
    gazeX: -9,
    gazeY: -8,
  },
  delegating: {
    eyes: 0.9,
    body: 0.98,
    churn: 0,
    churnSpeed: 0,
    dwell: 2.2,
    breathe: 0.6,
    float: 0.5,
    blink: 1.3,
    shadow: 0,
    lean: -6,
    aspect: 1,
    gazeX: 15,
    gazeY: 2,
  },
  // Small fast churn, as in `connecting`: driving the outline hard from the bands
  // stops reading as a head.
  speaking: {
    eyes: 0.95,
    body: 1,
    churn: 2.5,
    churnSpeed: 3,
    dwell: 4,
    breathe: 0.4,
    float: 0.5,
    blink: 1.2,
    shadow: 0,
    lean: 0,
    aspect: 1,
    gazeX: 0,
    gazeY: 0,
  },
};

const pointer = { x: 0, y: 0, live: false };

/** One passive listener for the whole app, bound when the first mark mounts. */
let pointerBound = false;
function bindPointer() {
  if (pointerBound || typeof window === "undefined") return;
  pointerBound = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.live = true;
    },
    { passive: true },
  );
}

export type BotMarkProps = {
  /** Pixel size of the square the mark is drawn in. */
  size?: number;
  /** Fixes the silhouette and the idle-animation phase. Strings are hashed, so an id works. */
  seed?: number | string;
  color?: string;
  shape?: MarkShape;
  /**
   * Nudges this instance's silhouette (VARY) while keeping shape and color. A value is
   * the seed (task id or bot name); `true` uses useId so server and client agree.
   */
  vary?: boolean | number | string;
  /** Stroke instead of fill; same as `options.fill: false`. */
  outline?: boolean;
  notify?: boolean;
  state?: MarkState;
  /** Read once per animation frame. Use this for live audio instead of React state. */
  getLevel?: () => number;
  /** MARK_BANDS values in 0..1, low frequencies first, read once per frame. Where the energy sits sets the shape, how much sets the size. */
  getSpectrum?: () => ArrayLike<number>;
  /** Per-instance overrides; omitted keys fall back to MARK_DEFAULTS. Pass a stable object, a new literal each render re-derives the silhouette. */
  options?: Partial<MarkOptions>;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
};

/** Cheap string hash so a name or id can seed the mark. */
export function hashSeed(seed: number | string): number {
  if (typeof seed === "number") return seed;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 10000;
}

export function BotMark({
  size = 32,
  seed,
  color,
  shape,
  vary,
  outline,
  notify,
  state = "idle",
  getLevel,
  getSpectrum,
  options,
  className,
  svgRef,
}: BotMarkProps) {
  const clipId = useId();
  // 0 means no variation. `true` falls back to useId, the only per-instance value
  // server and client agree on.
  const varySeed = useMemo(() => {
    if (vary === undefined || vary === false) return 0;
    return hashSeed(vary === true ? clipId : vary) || 1;
  }, [vary, clipId]);
  const cfg = useMemo(
    () =>
      varyOptions(
        {
          ...MARK_DEFAULTS,
          ...options,
          ...(outline === undefined ? {} : { fill: !outline }),
        } as MarkOptions,
        varySeed,
      ),
    [options, outline, varySeed],
  );
  const glowId = `${clipId}-glow`;
  const maskId = `${clipId}-mask`;
  const shadowId = `${clipId}-shadow`;
  const lifeRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGPathElement>(null);
  const clipRef = useRef<SVGPathElement>(null);
  const eyeLRef = useRef<SVGGElement>(null);
  const eyeRRef = useRef<SVGGElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const shadowRef = useRef<SVGPathElement>(null);
  const maskHeadRef = useRef<SVGPathElement>(null);
  const rimRef = useRef<SVGPathElement>(null);
  const localSvg = useRef<SVGSVGElement>(null);
  const svg = svgRef ?? localSvg;

  const theSeed = seed === undefined ? cfg.seed : hashSeed(seed);
  // Blob silhouettes come from the seed, so variation goes through the seed too; the
  // idle phase splits here so neighboring marks do not breathe in sync.
  const shapeSeed = varySeed
    ? ((theSeed ^ Math.imul(varySeed, 0x9e3779b1)) >>> 0) % 10000
    : theSeed;
  const theShape = shape ?? cfg.shape;
  const theFg = color ?? cfg.color;
  const notifying = notify ?? cfg.notify;

  // While deforming, the head is redrawn per frame; memo only seeds the initial `d`.
  const radii = useMemo(
    () => radiiFor(cfg, theShape, shapeSeed),
    [cfg, theShape, shapeSeed],
  );
  const headPath = useMemo(() => radiiToPath(radii), [radii]);

  const eyeL = useMemo(
    () =>
      eyePath({
        len: cfg.eyeLen,
        width: cfg.eyeWidth,
        bend: cfg.eyeBend,
        taper: cfg.eyeTaper,
        tilt: cfg.eyeTilt,
        cx: CENTER - cfg.eyeGap / 2,
        cy: cfg.eyeY,
      }),
    [cfg],
  );
  const eyeR = useMemo(
    () =>
      eyePath({
        len: cfg.eyeLen,
        width: cfg.eyeWidth,
        bend: cfg.eyeBend,
        taper: cfg.eyeTaper,
        tilt: cfg.eyeTilt + cfg.eyeSkew,
        cx: CENTER + cfg.eyeGap / 2,
        cy: cfg.eyeY,
      }),
    [cfg],
  );

  // Animated per frame through refs, not React state, so many marks do not re-render
  // the tree at 60 fps. `radii` and `shapeSeed` go through the ref rather than the
  // effect deps: the loop mounts once, and restarting it on a seed change (the create
  // form retypes the name) would snap the eyes and reset the blink and breath phase.
  const live = useRef({ cfg, state, getLevel, getSpectrum, radii, shapeSeed });
  live.current = { cfg, state, getLevel, getSpectrum, radii, shapeSeed };

  useEffect(() => {
    bindPointer();
    let raf = 0;
    // Seeded once at mount; a later seed change must not reset the breathing phase.
    const phase = (live.current.shapeSeed % 17) * 0.91;
    let gx = 0;
    let gy = 0;
    let nextBlink = performance.now() + 1200 + Math.random() * 4000;
    let blinkStart = 0;
    let queuedBlink = 0;

    // STATE_SHAPE values are targets, eased over about 0.6 s.
    const shape = { ...STATE_SHAPE.idle };
    const SHAPE_KEYS = Object.keys(shape) as (keyof StateShape)[];
    // Three time scales: ~50 ms to catch a syllable, ~300 ms to know one just happened,
    // ~1 s to know speech is ongoing.
    let fastLvl = 0;
    let midLvl = 0;
    let lvl = 0;
    let bright = 0.5;
    // Syllable-kicked spring; its own frequency caps how fast the mark can move.
    let bob = 0;
    let bobVel = 0;
    let lastOnset = 0;
    const band = new Array<number>(MARK_BANDS).fill(0);
    // Each harmonic rotates at its own speed, alternating direction, so the deformation
    // never settles into a standing wave.
    const bandPhase = Array.from({ length: MARK_BANDS }, (_, k) => k * 1.7);
    // Integrated, never `time * speed`: `churnSpeed` eases between states, and
    // phase = elapsed * speed would sweep the whole elapsed time on every speed change.
    let churnPhase = 0;
    let last = performance.now();
    let beat: {
      key: BeatKey;
      start: number;
      dur: number;
      dx: number;
      dy: number;
    } | null = null;
    let nextBeat = performance.now() + 1500 + Math.random() * 3000;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const { cfg: c, state: st } = live.current;
      const t = (now / 1000) * c.speed;

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const wanted = STATE_SHAPE[st];
      for (const key of SHAPE_KEYS) {
        shape[key] += (wanted[key] - shape[key]) * 0.06;
      }
      churnPhase += dt * shape.churnSpeed * c.speed;

      // Audio at 60 fps has little frame-to-frame correlation, so nothing below reads
      // level as position: onsets become spring impulses, only the phrase average is tracked.
      const spec = st === "speaking" ? live.current.getSpectrum?.() : undefined;
      let specSum = 0;
      for (let k = 0; k < MARK_BANDS; k++) {
        const target = spec ? clamp(spec[k] ?? 0, 0, 1) : 0;
        // Bands set the shape, so smooth hard; faster and small marks shimmer.
        band[k] += (target - band[k]) * c.bandEase;
        bandPhase[k] += dt * (0.05 + k * 0.018) * (k % 2 ? -1 : 1);
        // Summed before smoothing: the onset detector needs the rise over the moving
        // average, and smoothed bands erase it.
        specSum += target;
      }

      const raw =
        live.current.getLevel?.() ??
        (spec ? Math.min(1, specSum / (MARK_BANDS * 0.45)) : 0);
      const want = st === "speaking" ? clamp(raw, 0, 1) : 0;

      fastLvl += (want - fastLvl) * 0.3;
      midLvl += (want - midLvl) * 0.055;
      lvl += (want - lvl) * 0.016;

      // A syllable is a rise over the recent average. The gap must exceed the spring
      // period or kicks pile up into a tremble.
      if (
        fastLvl > midLvl * 1.25 + 0.03 &&
        fastLvl > 0.09 &&
        now - lastOnset > 340
      ) {
        lastOnset = now;
        // Slower springs integrate each impulse longer, so scale the kick with stiffness.
        bobVel -= c.punch * Math.min(1, fastLvl * 1.6) * c.bobRate;
      }
      // k = 0.010 gives a period near 1.1 s.
      const stiff = 0.01 * c.bobRate * c.bobRate;
      bobVel += -bob * stiff - bobVel * 0.085 * c.bobRate;
      bob += bobVel;

      // Where the energy sits: 0 = all low, 1 = all high. Eased slowly, since a shape
      // that changes per phoneme reads as flicker.
      if (specSum > 0.04) {
        let weighted = 0;
        for (let k = 0; k < MARK_BANDS; k++) weighted += band[k] * k;
        bright += (weighted / specSum / (MARK_BANDS - 1) - bright) * 0.04;
      } else {
        bright += (0.5 - bright) * 0.03;
      }

      // Pick the next beat and read this frame's values from it.
      const beatScale = shape.dwell;

      if (c.idle && !beat && now >= nextBeat) {
        const key = pickBeat(st);
        const spec = BEATS[key];
        const dir = Math.floor(Math.random() * 8) * (Math.PI / 4);
        beat = {
          key,
          start: now,
          dur: spec.dur[0] + Math.random() * (spec.dur[1] - spec.dur[0]),
          dx: Math.cos(dir),
          // Vertical range is smaller, like real eyes; thinking biases upward.
          dy: Math.sin(dir) * 0.7 - (st === "thinking" ? 0.5 : 0),
        };
      }

      let act = STILL;
      if (beat) {
        const p = (now - beat.start) / beat.dur;
        if (p >= 1) {
          beat = null;
          // liveliness 0: one beat every ~9 s; 100: every ~1.6 s.
          const gap = (9000 - c.liveliness * 74) * beatScale;
          nextBeat = now + gap * (0.6 + Math.random() * 0.8);
        } else {
          act = { ...STILL, ...BEATS[beat.key].play(p, beat.dx, beat.dy) };
          if (act.blinkIn > 0 && queuedBlink === 0) {
            queuedBlink = now + act.blinkIn;
          }
        }
      }

      if (shadowRef.current) {
        const swell = 0.5 - 0.5 * Math.cos(t * 0.55);
        shadowRef.current.setAttribute(
          "opacity",
          f((shape.shadow * swell * c.shadow) / 100).toString(),
        );
      }

      if (lifeRef.current) {
        const amp = (c.breathe * shape.breathe) / 100;
        const swell = (lvl * c.pulse) / 300 - bob * 0.05;
        const tall = ((0.45 - bright) / 0.45) * lvl * (c.stretch / 100);
        // aspect preserves volume: one axis multiplies, the other divides, so a state
        // change does not read as resizing.
        const sy =
          ((1 + amp * Math.sin(t * 1.6 + phase) - swell * 0.75 + tall) *
            shape.body *
            act.scale) /
          shape.aspect;
        const sx =
          (1 + swell - tall * 0.8) * shape.body * act.scale * shape.aspect;
        const rot =
          amp * 25 * Math.sin(t * 1.1 + phase * 1.7) + act.rot + shape.lean;
        const tx =
          CENTER + amp * 90 * Math.sin(t * 0.7 + phase * 0.6) + act.bodyX;
        const ty =
          CENTER +
          amp * 120 * Math.sin(t * 1.3 + phase * 2.3) +
          act.bodyY +
          bob * c.pulse * 2;
        lifeRef.current.setAttribute(
          "transform",
          `translate(${f(tx)} ${f(ty)}) rotate(${f(rot)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${-CENTER} ${-CENTER})`,
        );
      }

      // Eight bands folded into three, driving harmonics 2..4 only; higher harmonics on
      // an already bumpy silhouette read as noise.
      const lowE = (band[0] + band[1] + band[2]) / 3;
      const midE = (band[3] + band[4]) / 2;
      const highE = (band[5] + band[6] + band[7]) / 3;
      const energy = lowE + midE + highE;
      const rippling = energy > 0.03 && c.ripple > 0;
      const churning = shape.churn > 0;

      // Rebuild the outline only while something deforms it.
      if (headRef.current && (rippling || churning)) {
        const churnT = churnPhase;
        const next = live.current.radii.map((r, i) => {
          const th = (i / RES) * TAU;
          let out = r;
          if (rippling) {
            out +=
              c.ripple *
              (lowE * Math.sin(2 * th + bandPhase[0]) +
                midE * 0.7 * Math.sin(3 * th + bandPhase[1]) +
                highE * 0.5 * Math.sin(4 * th + bandPhase[2]));
          }
          if (churning) {
            out +=
              shape.churn *
              (0.65 * Math.sin(2 * th + churnT) +
                0.35 * Math.sin(3 * th - churnT * 1.4 + phase));
          }
          return out;
        });
        const d = radiiToPath(next);
        headRef.current.setAttribute("d", d);
        clipRef.current?.setAttribute("d", d);
        glowRef.current?.setAttribute("d", d);
        shadowRef.current?.setAttribute("d", d);
        rimRef.current?.setAttribute("d", d);
        maskHeadRef.current?.setAttribute("d", d);
      }

      if (eyesRef.current) {
        let tgx = 0;
        let tgy = 0;
        if (c.follow && pointer.live && svg.current) {
          const r = svg.current.getBoundingClientRect();
          if (r.width > 0) {
            tgx =
              clamp(
                (pointer.x - (r.left + r.width / 2)) / (r.width * 1.5),
                -1,
                1,
              ) * c.gazeRange;
            tgy =
              clamp(
                (pointer.y - (r.top + r.height / 2)) / (r.height * 1.5),
                -1,
                1,
              ) * c.gazeRange;
          }
        }
        gx += (tgx - gx) * 0.12;
        gy += (tgy - gy) * 0.12;
        // Two offset sines so the drift never lands on a beat.
        const drift =
          c.float *
          shape.float *
          (0.62 * Math.sin(t * 1.15 + phase) +
            0.38 * Math.sin(t * 0.47 + phase * 2.1));

        let sy = 1;
        if (blinkStart === 0) {
          if (queuedBlink > 0 && now >= queuedBlink) {
            blinkStart = now;
            queuedBlink = 0;
          } else if (c.blink && now >= nextBlink) {
            blinkStart = now;
          }
        }
        if (blinkStart > 0) {
          const p = (now - blinkStart) / 130;
          if (p >= 1) {
            blinkStart = 0;
            nextBlink = now + (1800 + Math.random() * 4500) * shape.blink;
          } else {
            sy = 1 - Math.sin(Math.PI * p) * 0.94;
          }
        }
        eyesRef.current.setAttribute(
          "transform",
          `translate(${f(gx + act.eyeX + shape.gazeX)} ${f(gy + drift + act.eyeY + shape.gazeY)}) translate(${CENTER} ${c.eyeY}) scale(1 ${sy.toFixed(3)}) translate(${-CENTER} ${-c.eyeY})`,
        );

        // Each eye scales about its own center; scaling both together widens the gap instead.
        const eyeWid = act.eyeWid * (1 - lvl * 0.13) * shape.eyes;
        const eyeLen = act.eyeLen * (1 + lvl * 0.04) * shape.eyes;

        const half = c.eyeGap / 2;
        for (const [i, ref] of [eyeLRef, eyeRRef].entries()) {
          if (!ref.current) continue;
          const cx = CENTER + (i === 0 ? -half : half);
          // Rotate into the eye's own frame before scaling so `eyeLen` still means
          // shorter when the eye is tilted.
          const tilt = i === 0 ? c.eyeTilt : c.eyeTilt + c.eyeSkew;
          const len = eyeLen.toFixed(3);
          const wid = eyeWid.toFixed(3);
          ref.current.setAttribute(
            "transform",
            `translate(${f(cx)} ${c.eyeY}) rotate(${f(tilt)}) scale(${len} ${wid}) rotate(${f(-tilt)}) translate(${f(-cx)} ${-c.eyeY})`,
          );
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [svg]);

  const nAngle = (cfg.notifyAngle * Math.PI) / 180;

  return (
    <svg
      ref={svg}
      data-slot="bot-mark"
      aria-hidden="true"
      className={className}
      viewBox={VIEW_BOX}
      width={size}
      height={size}
      style={{ overflow: "visible", "--fg": theFg } as React.CSSProperties}
    >
      <defs>
        <clipPath id={clipId}>
          <path ref={clipRef} d={headPath} />
        </clipPath>
        {/* Filled marks mask the eyes and readout out of the silhouette; painting them
            in a background colour breaks on tinted or translucent surfaces. */}
        {cfg.fill && (
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <path ref={maskHeadRef} d={headPath} fill="#fff" />
            <g clipPath={`url(#${clipId})`}>
              <g ref={eyesRef}>
                <g ref={eyeLRef}>
                  <path d={eyeL} fill="#000" />
                </g>
                <g ref={eyeRRef}>
                  <path d={eyeR} fill="#000" />
                </g>
              </g>
            </g>
            {notifying && (
              <circle
                cx={f(CENTER + Math.cos(nAngle) * cfg.notifyDist)}
                cy={f(CENTER + Math.sin(nAngle) * cfg.notifyDist)}
                r={cfg.notifyR + cfg.notifyRing}
                fill="#000"
              />
            )}
          </mask>
        )}
        {cfg.shadow > 0 && (
          <filter
            id={shadowId}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation={9} />
          </filter>
        )}
        {cfg.glow > 0 && (
          <filter
            id={glowId}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation={cfg.glow} />
          </filter>
        )}
      </defs>
      <g ref={lifeRef}>
        {cfg.shadow > 0 && (
          <path
            ref={shadowRef}
            d={headPath}
            fill="var(--fg)"
            filter={`url(#${shadowId})`}
            transform={`translate(0 ${12})`}
            opacity={0}
          />
        )}
        {cfg.glow > 0 && (
          <path
            ref={glowRef}
            d={headPath}
            fill={cfg.glowColor ?? "var(--fg)"}
            filter={`url(#${glowId})`}
            opacity={cfg.glowStrength / 100}
          />
        )}
        {/* Under the fill, stroked at double width so only the outer half shows. */}
        {cfg.rim > 0 && (
          <path
            ref={rimRef}
            d={headPath}
            fill="none"
            stroke={cfg.rimColor}
            strokeWidth={cfg.rim * 2}
            strokeLinejoin="round"
          />
        )}
        <path
          ref={headRef}
          d={headPath}
          fill={cfg.fill ? "var(--fg)" : "none"}
          stroke={cfg.fill ? "none" : "var(--fg)"}
          strokeWidth={cfg.fill ? 0 : cfg.strokeWidth}
          strokeLinejoin="round"
          mask={cfg.fill ? `url(#${maskId})` : undefined}
        />
        {/* Outlined marks have no silhouette to cut into, so the eyes are drawn. */}
        {!cfg.fill && (
          <g clipPath={`url(#${clipId})`}>
            <g ref={eyesRef}>
              <g ref={eyeLRef}>
                <path d={eyeL} fill="var(--fg)" />
              </g>
              <g ref={eyeRRef}>
                <path d={eyeR} fill="var(--fg)" />
              </g>
            </g>
          </g>
        )}
        {notifying && (
          <circle
            cx={f(CENTER + Math.cos(nAngle) * cfg.notifyDist)}
            cy={f(CENTER + Math.sin(nAngle) * cfg.notifyDist)}
            r={cfg.notifyR}
            fill={cfg.notifyColor}
          />
        )}
      </g>
    </svg>
  );
}

/** Mark for bots as a group (the settings section icon). No color or shape of its own:
 *  `currentColor` and the default silhouette, since it names the room, not a bot. */
export function BotsMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return <BotMark size={size} seed="bots" className={className} />;
}
