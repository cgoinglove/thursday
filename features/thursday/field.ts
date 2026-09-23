// The mathematics her face is made of, kept out of the renderer so the call's orb and the intro's
// art draw the same shapes. No "use client": these are pure functions.
//
// Everything here exists to answer one thing — a face built from sines is read as a loop within a
// few seconds, because a sine repeats at a fixed interval and every cell of it moves in step. Value
// noise read at a place another noise has moved has no such interval.

/** Deterministic integer hash in [0, 1). Cheap enough to call a few times per cell per frame. */
export function ihash(x: number, y: number, z: number) {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 1274126177;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth 3D value noise. The third axis is time, so a field drifts rather than scrolls. */
export function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const a = lerp(ihash(xi, yi, zi), ihash(xi + 1, yi, zi), u);
  const b = lerp(ihash(xi, yi + 1, zi), ihash(xi + 1, yi + 1, zi), u);
  const c = lerp(ihash(xi, yi, zi + 1), ihash(xi + 1, yi, zi + 1), u);
  const d = lerp(ihash(xi, yi + 1, zi + 1), ihash(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}

/** Octaves of it, each half the weight and twice the frequency. */
export function fbm(x: number, y: number, z: number, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x, y, z);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    z *= 1.97;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * fBm read at a place fBm itself moved (Inigo Quilez's domain warping). This is the one that
 * stops a field reading as a pattern: the texture is pulled about by a second texture, so no
 * feature is the same size or the same distance from the next as any other.
 */
export function warp(x: number, y: number, z: number, pull = 4) {
  const qx = fbm(x, y, z, 2);
  const qy = fbm(x + 5.2, y + 1.3, z + 2.8, 2);
  return fbm(x + pull * qx, y + pull * qy, z, 3);
}

/** Which way the wind blows (a unit vector) and how hard, 0..1. */
export type Wind = { x: number; y: number; g: number };

/**
 * How fast the wind turns, how hard it blows when it is calm, and how its gusts come: a gust is
 * the part of a slow noise over GUST_BAR, raised to GUST_SHAPE, so it is calm most of the time
 * and hard for a moment. An even wind reads as too much smoke, always.
 */
const WIND_TURN = 0.1;
const WIND_CALM = 0.38;
const GUST_BAR = 0.38;
const GUST_GAIN = 3.2;
const GUST_SHAPE = 1.5;

/**
 * The wind at `t` seconds, for anything that has to lean the same way at once. Read as a
 * displacement rather than as a rotation: a field turned with distance spirals, a field pushed
 * with distance drifts, and drifting is what smoke does.
 */
export function windAt(t: number, seed = 0): Wind {
  // The whole circle, not a wobble around a fixed heading: a base angle plus a small swing means
  // every run blows the same way, and a plume that always leans east is a decoration. The noise
  // spans more than a turn, and `seed` is where in it this face started.
  const a = fbm(t * WIND_TURN + seed * 3.7, 3.1 + seed, 1.4, 2) * 9.2;
  const raw = fbm(t * 0.11 + seed * 5.3, 7.7, 2.2, 3);
  const gust = Math.max(0, Math.min(1, (raw - GUST_BAR) * GUST_GAIN));
  return {
    x: Math.cos(a),
    y: Math.sin(a),
    g: WIND_CALM + (1 - WIND_CALM) * gust ** GUST_SHAPE,
  };
}
