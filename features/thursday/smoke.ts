// Her resting face, and the smoke that is her: the body, the haze round it, the plume she wears,
// what her open eyes do to all three, and the sigh she lets out as they open. One file, because
// it is one thing — she is smoke, so what leaves her is her too, as dense as she is where it
// leaves and thinning only as it goes. Every number here is the drawing, tuned by eye on the face
// itself, so it lives with it. No "use client": these are pure functions and one small piece of
// state per face.

import { smoothstep } from "./ascii.const";
import { fbm, type Wind, warp } from "./field";

/**
 * A place on the field, from her centre in reference units, read three ways: where her grain is
 * (dx, dy: on her head as it is turned), where her outline is (px, py, and dist from her centre:
 * in her head's own plane), and where her smoke is (sx, sy: trailing her head). Left out, the last
 * two are the place itself, as they are while she holds still (expressions.ts moves them).
 */
export type Spot = {
  dx: number;
  dy: number;
  dist: number;
  px?: number;
  py?: number;
  sx?: number;
  sy?: number;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** From `lo` at 0 through `at` at the middle to `hi` at 1: a strand number, by how thick she is. */
const mid3 = (lo: number, at: number, hi: number, v: number) =>
  v < 0.5 ? lo + (at - lo) * v * 2 : at + (hi - at) * (v - 0.5) * 2;

/**
 * Her body. Solid out to BODY_FULL of her radius, then a soft falloff to it. Her light is an
 * uneven grain that shifts slowly, with one slow breath: rings — a sine of her radius moving
 * out — read as circles going out from her like waves on water.
 */
const BODY_FULL = 0.55;
const BODY_FLOOR = 0.58;
const BODY_GRAIN = 0.6;
const BODY_BREATH = 0.07;
/** She leans a hair after the wind: her rim is read from this far upwind, at a full gust. */
const BODY_DRAG = 0.018;

/** Her light at a place. The sigh is drawn in it too, so where it leaves her there is no seam. */
function herLight(dx: number, dy: number, t: number) {
  return (
    BODY_FLOOR +
    Math.sin(t * 0.35) * BODY_BREATH +
    (fbm(dx * 0.011 + t * 0.04, dy * 0.011 - t * 0.03, t * 0.22, 2) - 0.5) *
      BODY_GRAIN
  );
}

/** The haze: faint, uneven dust from inside her rim out past it. */
const HAZE_FROM = 0.9;
const HAZE_TO = 1.32;

/**
 * The plume. One field read from her middle outward: filaments by direction, carried further
 * along their flight the older they are, leaning downwind the further out they are. How far
 * each direction carries is its own noise, and the bar rises along the way, so a filament is
 * wide where it leaves her and a thread at its end. Every direction runs at a phase of its own
 * (PLUME_JUMBLE, reference units), the field is broken into patches, now and then one way puffs
 * harder than the rest (PLUME_GUSH), and a gust reaches each way at its own moment: in step,
 * every front is an arc, and arcs going out one after another read as rings.
 */
const PLUME_DRIFT = 66;
const PLUME_FROM = 0.55;
const PLUME_TIP = 1.25;
const PLUME_BAR = 0.4;
const PLUME_GAIN = 3.2;
const PLUME_SPREAD = 0.006;
const PLUME_TOP = 0.55;
const PLUME_STRENGTH = 0.92;
const PLUME_LEAN = 0.087;
const PLUME_JUMBLE = 220;
const PLUME_GUSH = 0.9;
const REACH_BAR = 0.22;
const REACH_MIN = 1.05;
/**
 * What the plume asks of a direction — its phase, how far it carries, whether it is puffing, how
 * hard the gust reaches it — depends on the direction alone. So it is read once a frame for ANGLES
 * directions round her and looked up per cell, between the two nearest, rather than worked out
 * again for every cell.
 */
const ANGLES = 256;

/**
 * Her smoke at rest, and what it becomes while her eyes are open: ink, reach (radii), thickness
 * (0 threads to 1 masses) and haze. She starts into the open numbers FACE_AFTER seconds after her
 * lids start to part — after the sigh, since at the same moment the two are one thing — rises
 * over about FACE_RISE seconds (to nine tenths) and goes back as her eyes close (FACE_EASE).
 */
const REST = { ink: 1.52, reach: 2.2, thick: 0.52, haze: 0.27 };
const OPEN = { ink: 2.5, reach: 4, thick: 1, haze: 0.57 };
const FACE_AFTER = 0.65;
const FACE_RISE = 2.05;
const FACE_EASE = 0.5;

/**
 * Going to sleep: as her eyes shut her smoke is drawn in (SLEEP_SMOKE) and she dims (SLEEP_DIM),
 * and both come back over SLEEP_BACK seconds.
 */
const SLEEP_SMOKE = 0.65;
const SLEEP_DIM = 0.16;
const SLEEP_BACK = 2.2;

/**
 * The sigh she lets out as her eyes open — "pfooh" — made of her. It pours from a band of her
 * lower side (SIGH_SIDE off straight down, which reads as a beard), starting where she is still
 * solid (SIGH_ROOT) at her own light, and thinning slowly at first and then faster. Every
 * moment's smoke flies straight out from her middle, fast and then slowing: a moment let out `a`
 * seconds ago has gone reach * (1 - e^(-a / SIGH_SLOW)) past its root, then drifts (SIGH_DRIFT).
 * Each cell asks which moment's smoke is on it now and reads that, so nothing is carried on a
 * grid and nothing blurs.
 *   A sigh, not a held note: full for SIGH_HOLD, falling away within a third of a second
 *   (SIGH_FADE) to a trickle (SIGH_FLOOR) that keeps it joined to her, in gulps (SIGH_GULP); then
 *   all of it fades together by SIGH_FOR + SIGH_LINGER, so it never leaves her as a cloud of its
 *   own. SIGH_PACE runs its clock slower or faster than the wall's.
 *   How far it carries changes with direction (from SIGH_LOBE below 1 to above it), so its edge
 *   is lobes rather than the arc of a circle. It opens as it goes, from SIGH_OPEN either side of
 *   its way to SIGH_WIDE (both times SIGH_SPREAD), its sides come and go along its length
 *   (SIGH_RAGGED), past its root it is torn into patches (SIGH_TORN), the older it is the more it
 *   curls aside (SIGH_CURL), and further out its strands are broad (SIGH_FAN) on a thick body
 *   (SIGH_BODY), loosening as they age (SIGH_LOOSEN).
 *   It goes out through smoke that is already there, so the plume on that side thickens behind
 *   its front and reaches further once the front is past her rim (SIGH_STIR). All at once, the
 *   plume there would pop into place the instant her eyes opened.
 */
const SIGH_FOR = 1.9;
const SIGH_LINGER = 0.5;
const SIGH_HOLD = 0.5;
const SIGH_FADE = 0.3;
const SIGH_FLOOR = 0.18;
const SIGH_GULP = 0.8;
const SIGH_PACE = 0.65;
const SIGH_DENSE = 3.5;
const SIGH_ROOT = BODY_FULL;
const SIGH_SIDE = 0.7;
const SIGH_REACH = 1.53;
const SIGH_LOBE = 0.5;
const SIGH_SLOW = 0.6;
const SIGH_DRIFT = 0.18;
const SIGH_SPREAD = 1.8;
const SIGH_OPEN = 0.95;
const SIGH_WIDE = 2.4;
const SIGH_RAGGED = 0.9;
const SIGH_TORN = 0.65;
const SIGH_CURL = 1.1;
const SIGH_FAN = 2.2;
const SIGH_BODY = 0.45;
const SIGH_LOOSEN = 0.4;
const SIGH_THIN = 0.81;
const SIGH_STIR = 1.2;
const SIGH_STIR_REACH = 0.54;

/** How her smoke stands this frame. One per face; `stepSmoke` moves it. */
export type Smoke = {
  /** How much of a face she is — her eyes open — eased, 0..1. */
  face: number;
  /** How much of her haze and plume is held back this frame, 0..1 (expressions.ts). */
  hush: number;
  /** How far she has gone dim after shutting her eyes, 0..1. */
  dim: number;
  /** The plume's numbers this frame, between REST and OPEN by `face`. */
  ink: number;
  reach: number;
  few: number;
  narrow: number;
  hard: number;
  haze: number;
  sigh: {
    live: boolean;
    /** When it started (the orb's clock, seconds). */
    t0: number;
    /** Which way it goes (radians, screen coordinates) and where in its noise it is. */
    dir: number;
    seed: number;
    /** How hard it is blowing now, for the plume it blows through. */
    now: number;
    /** How far out its front has got, in radii. */
    front: number;
  };
  /**
   * This frame's per-direction numbers, ANGLES + 1 each (the last is the first): the plume's, by
   * angle round her, and how far the sigh carries, by angle from its own way (while it is out).
   */
  ways: {
    jumble: Float32Array;
    reach: Float32Array;
    gush: Float32Array;
    gust: Float32Array;
    lobe: Float32Array;
  };
};

export function createSmoke(): Smoke {
  const s: Smoke = {
    face: 0,
    hush: 0,
    dim: 0,
    ink: 0,
    reach: 0,
    few: 0,
    narrow: 0,
    hard: 0,
    haze: 0,
    sigh: { live: false, t0: 0, dir: Math.PI / 2, seed: 0, now: 0, front: 0 },
    ways: {
      jumble: new Float32Array(ANGLES + 1),
      reach: new Float32Array(ANGLES + 1),
      gush: new Float32Array(ANGLES + 1),
      gust: new Float32Array(ANGLES + 1),
      lobe: new Float32Array(ANGLES + 1),
    },
  };
  tune(s);
  return s;
}

/** The plume's numbers for how much of a face she is. */
function tune(s: Smoke) {
  const thick = mix(REST.thick, OPEN.thick, s.face);
  s.ink = mix(REST.ink, OPEN.ink, s.face);
  s.reach = mix(REST.reach, OPEN.reach, s.face);
  s.haze = mix(REST.haze, OPEN.haze, s.face);
  s.few = mid3(4.2, 1.9, 1, thick);
  s.narrow = mid3(0.3, 0.17, 0.04, thick);
  s.hard = mid3(2.6, 2, 1.25, thick);
}

/** How hard the sigh is let out `tau` seconds in (its own clock). */
function sighAt(tau: number, seed: number) {
  return (
    smoothstep(0, 0.05, tau) *
    Math.max(SIGH_FLOOR, Math.exp(-Math.max(0, tau - SIGH_HOLD) / SIGH_FADE)) *
    (1 - SIGH_GULP * 0.5 + SIGH_GULP * fbm(tau * 5 + seed, 1.7, 2.9, 2))
  );
}

/**
 * Once a frame. `open` is how open her eyes are and not closing (0..1), `dim` how far into
 * shutting them she is, `sinceLids` seconds since her lids started to part (below 0 while they
 * are not up), and `sighs` whether she wakes with the sigh this time.
 */
export function stepSmoke(
  s: Smoke,
  t: number,
  dt: number,
  open: number,
  dim: number,
  sinceLids: number,
  sighs = true,
) {
  const S = s.sigh;
  if (sighs && sinceLids >= 0 && sinceLids < 0.3 && !S.live) {
    S.live = true;
    S.t0 = t - sinceLids;
    S.dir =
      Math.PI / 2 +
      (Math.random() < 0.5 ? -1 : 1) *
        (SIGH_SIDE + (Math.random() - 0.5) * 0.3);
    S.seed = Math.random() * 50;
  }
  const T = (t - S.t0) * SIGH_PACE;
  if (S.live && T > SIGH_FOR + SIGH_LINGER) S.live = false;
  S.now = S.live
    ? sighAt(T, S.seed) *
      (1 - smoothstep(SIGH_FOR * 0.45, SIGH_FOR + SIGH_LINGER, T)) *
      Math.min(1.5, SIGH_DENSE) *
      smoothstep(0, 0.25, T)
    : 0;
  S.front =
    SIGH_ROOT +
    SIGH_REACH * (1 - Math.exp(-Math.max(0, T) / SIGH_SLOW)) +
    SIGH_DRIFT * Math.max(0, T);

  s.dim = Math.max(dim, s.dim * Math.exp(-dt / SLEEP_BACK));
  const want =
    sinceLids >= 0
      ? open * smoothstep(FACE_AFTER, FACE_AFTER + 0.2, sinceLids)
      : 0;
  // seconds to nine tenths is 2.3 time constants
  const ease = want > s.face ? FACE_RISE / 2.3 : FACE_EASE;
  s.face += (want - s.face) * (1 - Math.exp(-dt / ease));
  tune(s);

  const W = s.ways;
  for (let k = 0; k <= ANGLES; k++) {
    const a = -Math.PI + (k / ANGLES) * Math.PI * 2;
    const x = Math.cos(a);
    const y = Math.sin(a);
    W.jumble[k] =
      (fbm(x * 2.2 + 11, y * 2.2, t * 0.35, 2) - 0.5) * PLUME_JUMBLE;
    W.reach[k] = Math.max(
      0,
      fbm(x * 1.1 + 5, y * 1.1, t * 0.12, 2) - REACH_BAR,
    );
    W.gush[k] = smoothstep(0.5, 0.78, fbm(x * 1.6 + 3, y * 1.6, t * 0.5, 2));
    W.gust[k] = 0.4 + 1.2 * fbm(x * 1.2 + 7, y * 1.2, t * 0.4, 2);
    // how far the sigh carries this way: lobes, never the same all round
    if (S.live)
      W.lobe[k] =
        SIGH_REACH *
        (SIGH_LOBE +
          (1.5 - SIGH_LOBE) * fbm(x * 1.4 + S.seed, y * 1.4, T * 0.3, 2));
  }
}

/** A per-direction number at angle `a` (-π..π), between the two nearest directions read. */
function byWay(table: Float32Array, a: number) {
  const u = ((a + Math.PI) / (Math.PI * 2)) * ANGLES;
  const i = Math.min(ANGLES - 1, Math.max(0, Math.floor(u)));
  return table[i] + (table[i + 1] - table[i]) * (u - i);
}

/** How much of the sigh is on her plume this way, now. */
function sighOn(s: Smoke, angle: number) {
  const S = s.sigh;
  if (!S.live || S.now <= 0.01) return 0;
  let th = angle - S.dir;
  th -= Math.round(th / (Math.PI * 2)) * Math.PI * 2;
  const half = Math.min(Math.PI, SIGH_WIDE * 0.7 * SIGH_SPREAD);
  return S.now * (1 - smoothstep(half * 0.45, half, Math.abs(th)));
}

function plumeAt(
  x: number,
  y: number,
  t: number,
  R: number,
  dist: number,
  scale: number,
  s: Smoke,
  w: Wind,
  cap: number,
) {
  if (dist > R * (s.reach + 0.2 + SIGH_STIR_REACH)) return 0;
  // leaned: further downwind the further out, so a filament leaves her straight and bends on its
  // way; measured from her centre, which is what keeps it rooted in her
  const push = PLUME_LEAN * w.g * dist;
  const lx = x - w.x * push;
  const ly = y - w.y * push;
  const len = Math.hypot(lx, ly) || 1;
  const la = Math.atan2(ly, lx);
  const fan = s.few / (1 + dist * PLUME_SPREAD);
  const run = dist - t * PLUME_DRIFT - byWay(s.ways.jumble, la);
  const n = fbm((lx / len) * fan, (ly / len) * fan, run * 0.008, 3);
  // the sigh going through: thicker behind its front, further once that front is past her rim
  const blowing = sighOn(s, la);
  const front = s.sigh.front;
  const stir =
    blowing > 0
      ? blowing * (1 - smoothstep(front - 0.35, front + 0.05, dist / R))
      : 0;
  const stretch = blowing > 0 ? blowing * clamp01(front - 1) : 0;
  // how far THIS direction carries, and how far along its flight this cell is
  const far =
    R *
    (REACH_MIN +
      (s.reach - REACH_MIN) * Math.min(1, byWay(s.ways.reach, la) * 2.4) +
      SIGH_STIR_REACH * stretch);
  const out = smoothstep(R * PLUME_FROM, far, dist);
  const bar = PLUME_BAR + s.narrow * out;
  // the patches lift a strand by a fifth at most, so one that cannot clear its bar even then is
  // left without reading them
  if (n * 1.2 <= bar) return 0;
  const patched = n * (0.8 + 0.4 * warp(x * 0.02 + 3, y * 0.02, t * 0.3, 2));
  let strand = (Math.max(0, patched - bar) * PLUME_GAIN) ** s.hard;
  if (strand <= 0) return 0;
  strand *= 1 + PLUME_GUSH * byWay(s.ways.gush, la) + SIGH_STIR * stir;
  if (s.dim > 0.002) strand *= 1 - SLEEP_SMOKE * s.dim;
  const tip = (1 - out) ** PLUME_TIP;
  const gust = w.g * byWay(s.ways.gust, la);
  return Math.min(cap, strand * tip * (0.6 + 0.65 * gust) * s.ink) * scale;
}

/**
 * Her at rest: body, haze and plume, the brightest of the three. `R` is her radius now, `scale`
 * her share of it, `lift` light added to her body in place.
 */
export function restValue(
  p: Spot,
  t: number,
  lift: number,
  R: number,
  scale: number,
  s: Smoke,
  w: Wind,
) {
  const px = p.px ?? p.dx;
  const py = p.py ?? p.dy;
  const sx = p.sx ?? p.dx;
  const sy = p.sy ?? p.dy;
  const pull = BODY_DRAG * w.g * Math.min(1, p.dist / R) ** 2 * R;
  const dist = Math.hypot(px - w.x * pull, py - w.y * pull);
  const body = 1 - smoothstep(R * BODY_FULL, R, dist);
  let value = body > 0 ? (herLight(p.dx, p.dy, t) + lift) * body : 0;
  if (s.dim > 0.002) value *= 1 - SLEEP_DIM * s.dim;
  // her haze and her plume are where her smoke is, and a piece of hers can hold them back
  const held = 1 - s.hush;
  const sd = Math.hypot(sx - w.x * pull, sy - w.y * pull);
  if (s.haze > 0 && held > 0 && sd < R * HAZE_TO) {
    const most =
      s.haze *
      held *
      (1 - SLEEP_SMOKE * 0.6 * s.dim) *
      (1 - smoothstep(R * HAZE_FROM, R * HAZE_TO, sd)) *
      scale;
    // its patches are 1.55 of `most` at the brightest, so a haze that cannot pass her even then
    // is left without reading them
    if (most * 1.55 > value) {
      const haze =
        most * (0.45 + 1.1 * warp(sx * 0.012 + 11, sy * 0.012, t * 0.15, 2));
      if (haze > value) value = haze;
    }
  }
  // her floor inside, where the circle is protected; ink lifts only what is past her rim. The
  // plume never passes this, so where she is already brighter it is not read at all.
  const cap =
    PLUME_TOP +
    Math.max(0, PLUME_STRENGTH * s.ink - PLUME_TOP) *
      smoothstep(R * 0.92, R * 1.14, sd);
  if (held > 0 && cap * scale * held > value) {
    const plume = plumeAt(sx, sy, t, R, sd, scale, s, w, cap) * held;
    if (plume > value) value = plume;
  }
  // Arriving and leaving happen in patches on her own noise, never as one disc changing
  // brightness: a circle fading up out of an empty field is the one moment everything else
  // here is built to avoid.
  if (scale < 0.98 && value > 0) {
    const arrive = warp(p.dx * 0.015 - 7, p.dy * 0.015 + 3, 11.4, 2);
    value *= smoothstep(arrive - 0.34, arrive + 0.34, scale * 1.7 - 0.24);
  }
  return value;
}

/** The sigh on this cell now, 0 when it is not out. `R` is her radius now. */
export function sighValue(p: Spot, t: number, R: number, s: Smoke) {
  const S = s.sigh;
  if (!S.live) return 0;
  const T = (t - S.t0) * SIGH_PACE;
  const d = p.dist / R - SIGH_ROOT;
  if (d <= 0) return 0;
  let th = Math.atan2(p.py ?? p.dy, p.px ?? p.dx) - S.dir;
  th -= Math.round(th / (Math.PI * 2)) * Math.PI * 2;
  if (
    Math.abs(th) >
    Math.min(Math.PI, (SIGH_WIDE + 0.4) * SIGH_SPREAD * (1 + SIGH_RAGGED * 0.5))
  )
    return 0;
  const V = byWay(s.ways.lobe, th);
  // nothing has got further than what left first, so a cell past that is left at once
  if (d > V * (1 - Math.exp(-T / SIGH_SLOW)) + SIGH_DRIFT * T) return 0;
  // which moment's smoke has reached this far: invert its flight, a few Newton steps
  let a = -SIGH_SLOW * Math.log(1 - Math.min(d / V, 0.97));
  for (let k = 0; k < 3; k++) {
    const e = Math.exp(-a / SIGH_SLOW);
    a -=
      (V * (1 - e) + SIGH_DRIFT * a - d) / ((V * e) / SIGH_SLOW + SIGH_DRIFT);
  }
  const tau = T - a;
  if (a < 0 || tau < 0 || tau > SIGH_FOR) return 0;
  const strength = sighAt(tau, S.seed);
  const fade = 1 - smoothstep(SIGH_FOR * 0.45, SIGH_FOR + SIGH_LINGER, T);
  if (strength * fade < 0.01) return 0;
  th += (fbm(d * 1.8, tau * 2.2, t * 0.3, 2) - 0.5) * SIGH_CURL * (0.3 + a);
  const ragged =
    1 -
    SIGH_RAGGED * 0.5 +
    SIGH_RAGGED * fbm(d * 2.2 + S.seed, tau * 1.7, 3.3, 2);
  const half = Math.min(
    Math.PI,
    (SIGH_OPEN + (SIGH_WIDE - SIGH_OPEN) * (1 - Math.exp(-a / 0.45))) *
      SIGH_SPREAD *
      ragged,
  );
  const cone = 1 - smoothstep(half * 0.55, half, Math.abs(th));
  if (cone <= 0) return 0;
  const loose = 1 + SIGH_LOOSEN * a;
  const n = fbm(
    (th * SIGH_FAN) / loose + 4,
    tau * 3 + (d * 0.6) / loose,
    5.1,
    3,
  );
  const strand = (Math.max(0, n - 0.32) * 3) ** 1.4;
  // her own light where it leaves her, solid there, strands and thinning further out
  const grain =
    1 - smoothstep(0.15, 0.9, d) * (1 - Math.min(1, SIGH_BODY + strand));
  const thin = 1 / (1 + (d / SIGH_THIN) ** 2);
  const patch = smoothstep(
    0.25,
    0.65,
    warp(p.dx * 0.014 + S.seed, p.dy * 0.014, tau * 0.9 + t * 0.2, 2),
  );
  const torn = 1 - SIGH_TORN * smoothstep(0.1, 0.7, d) * (1 - patch);
  return Math.min(
    0.95,
    herLight(p.dx, p.dy, t) *
      strength *
      fade *
      cone *
      grain *
      thin *
      torn *
      SIGH_DENSE,
  );
}
