/**
 * How a mark is shaped: the silhouettes, the eyes and the seed that picks one, in the
 * 240-unit box. No React, so the server draws the same face the screen does — a page a
 * bot writes carries its maker's mark (markStill), and the tab's icon its own.
 */
import type { BotIcon } from "./bot.schema";
import {
  MARK_PAINTS,
  MARK_SYSTEM,
  type MarkShape,
  markInk,
} from "./mark.const";

export const TAU = Math.PI * 2;
export const BOX = 240;
export const CENTER = BOX / 2;
const R = 112;

/** Every silhouette is resampled to this many polar points, so blending two is a plain lerp. */
const MARK_RESOLUTION = 128;
export const RES = MARK_RESOLUTION;

type Pt = [number, number];

export const f = (n: number) => Math.round(n * 100) / 100;
export const clamp = (n: number, lo: number, hi: number) =>
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

/** The classic heart curve, a little taller than wide. */
function heartOutline(): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 400; i++) {
    const t = (i / 400) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    out.push([CENTER + x * 6.6, CENTER - (y + 2.2) * 7.26]);
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
export function radiiToPath(radii: number[]): string {
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

export function eyePath(o: EyeOpts): string {
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
  float: number;
  breathe: number;
  speed: number;
  blink: boolean;

  notify: boolean;
  notifyAngle: number;
  notifyDist: number;
  notifyR: number;
  notifyRing: number;
};

export const MARK_DEFAULTS: MarkOptions = {
  shape: "blob",
  sides: 3,
  corner: 0.74,
  rotation: 0,
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
  float: 7,
  breathe: 3.7,
  speed: 1.7,
  blink: true,

  notify: false,
  notifyAngle: 41,
  notifyDist: 109,
  notifyR: 25,
  notifyRing: 11,
};

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

/**
 * How far a poly or a squircle leans off its true outline, as a fraction of the
 * radius. Ruled edges read as an icon rather than a face; this is a hand's worth
 * of wobble, and the seed gives each face its own.
 */
const WARP = 0.035;

/** Bends a ruled outline by a few slow waves. Blob outlines already wobble and are left alone. */
function warpRadii(radii: number[], seed: number, depth = WARP): number[] {
  const rnd = mulberry32(seed ^ 0x2f6b);
  const waves = [2, 3, 5].map((k) => ({
    k,
    a: (rnd() * 2 - 1) / k,
    p: rnd() * TAU,
  }));
  const offsets = radii.map((_, i) => {
    const a = (i / RES) * TAU;
    let d = 0;
    for (const wave of waves) d += wave.a * Math.sin(wave.k * a + wave.p);
    return d;
  });
  const peak = Math.max(...offsets.map(Math.abs)) || 1;
  return radii.map((r, i) => r * (1 + (depth * offsets[i]) / peak));
}

/**
 * A true heart has the only sharp tip and deep notch of any mark. Averaging the
 * radii blunts both, then it bends and leans by the seed like poly and squircle
 * do, a little more.
 */
function softenHeart(radii: number[], seed: number): number[] {
  let soft = radii;
  for (let pass = 0; pass < 2; pass++) {
    const prev = soft;
    soft = prev.map((_, i) => {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += prev[(i + k + RES) % RES];
      return sum / 7;
    });
  }
  const mean = soft.reduce((sum, r) => sum + r, 0) / RES;
  const bent = warpRadii(
    soft.map((r) => r * 0.95 + mean * 0.05),
    seed,
    0.05,
  );
  // A few degrees of lean, one sample at a time.
  const lean = Math.round((mulberry32(seed ^ 0x51f1)() * 2 - 1) * 3);
  return lean ? bent.map((_, i) => bent[(i - lean + RES * 2) % RES]) : bent;
}

const radiiCache = new Map<string, number[]>();

/** Ray-scanning the outline is the expensive step; cache by shape key. */
export function radiiFor(
  cfg: MarkOptions,
  shape: MarkShape,
  seed: number,
): number[] {
  const key = `${
    shape === "poly"
      ? `poly|${cfg.sides}|${cfg.corner}|${cfg.rotation}|${seed}`
      : shape === "squircle"
        ? `squircle|${cfg.squircle}|${seed}`
        : shape === "heart"
          ? `heart|${seed}`
          : `blob|${cfg.wobble}|${seed}`
  }|${cfg.autofit}`;
  const hit = radiiCache.get(key);
  if (hit) return hit;
  const traced = toRadii(outlineFor(cfg, shape, seed));
  const raw =
    shape === "blob"
      ? traced
      : shape === "heart"
        ? softenHeart(traced, seed)
        : warpRadii(traced, seed);
  const radii = cfg.autofit ? fitRadii(raw) : raw;
  if (radiiCache.size > 400) radiiCache.clear();
  radiiCache.set(key, radii);
  return radii;
}

function outlineFor(cfg: MarkOptions, shape: MarkShape, seed: number): Pt[] {
  if (shape === "squircle") return squircleOutline(cfg.squircle);
  if (shape === "poly") return polyOutline(cfg.sides, cfg.corner, cfg.rotation);
  if (shape === "heart") return heartOutline();
  return blobOutline(seed, cfg.wobble);
}

/** Cheap string hash so a name or id can seed the mark. */
export function hashSeed(seed: number | string): number {
  if (typeof seed === "number") return seed;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 10000;
}

/**
 * A mark at rest as bare path data, for a surface React does not draw — the tab's
 * icon, a page a bot wrote. The silhouette and eyes `<BotMark seed shape>` draws with no
 * other props, in the 240-unit box (the renderer's VIEW_BOX adds headroom around it).
 */
export function markAtRest(
  seed: number | string,
  shape: MarkShape = MARK_DEFAULTS.shape,
): {
  head: string;
  eyes: [string, string];
} {
  const cfg = MARK_DEFAULTS;
  const eye = (cx: number, tilt: number) =>
    eyePath({
      len: cfg.eyeLen,
      width: cfg.eyeWidth,
      bend: cfg.eyeBend,
      taper: cfg.eyeTaper,
      tilt,
      cx,
      cy: cfg.eyeY,
    });
  return {
    head: radiiToPath(radiiFor(cfg, shape, hashSeed(seed))),
    eyes: [
      eye(CENTER - cfg.eyeGap / 2, cfg.eyeTilt),
      eye(CENTER + cfg.eyeGap / 2, cfg.eyeTilt + cfg.eyeSkew),
    ],
  };
}

/** A bot's mark held still: what a page draws for the bot that wrote it. */
export type MarkStill = {
  head: string;
  eyes: [string, string];
  /** The body's colour as it reads on a white page; `currentColor` follows the page's text. */
  ink: string;
  /** A paint's colours top to bottom, in place of `ink`; null for a plain colour. */
  paint: string[] | null;
  /** Drawn as a line rather than a filled body. */
  outline: boolean;
};

/**
 * The bot's mark as it is at this moment, seeded by its name and wearing its whole icon
 * (the screen's rule), for a page written now: the page keeps this face even after the
 * bot's icon changes. A paint is still, its night alone for an aurora.
 */
export function markStill(name: string, icon?: BotIcon | null): MarkStill {
  const { head, eyes } = markAtRest(name, icon?.shape ?? MARK_DEFAULTS.shape);
  const spec = icon?.paint ? MARK_PAINTS[icon.paint] : null;
  return {
    head,
    eyes,
    ink: markInk(icon?.color ?? MARK_SYSTEM, false),
    paint: spec
      ? spec.look === "aurora"
        ? spec.colors.slice(0, 2)
        : [...spec.colors]
      : null,
    outline: icon?.outline === true,
  };
}
