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

/**
 * A radius that is not a circle: fine fray from one noise, and a few slow lobes from a much
 * broader one. The lobes matter — a crenellated circle is still read as a circle.
 */
export function shell(
  angle: number,
  radius: number,
  t: number,
  rough = 0.22,
  spin = 0.11,
  lobe = 0,
) {
  const n = fbm(
    Math.cos(angle) * 1.6 + 9,
    Math.sin(angle) * 1.6 + 4,
    t * spin,
    3,
  );
  const big = lobe
    ? (fbm(
        Math.cos(angle) * 0.52 + 2,
        Math.sin(angle) * 0.52,
        t * spin * 0.55,
        2,
      ) -
        0.5) *
      2 *
      lobe
    : 0;
  return radius * (1 - rough * 0.5 + rough * n) * (1 + big);
}
