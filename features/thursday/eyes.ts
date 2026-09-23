// Her eyes. One file, because the whole feature is here: the shape, what it does while it is up,
// and the test a renderer asks per cell. The call's orb and the intro's art both use it, and it can
// come out again by deleting this and the three lines that call it.
//
// The shape is the bot faces' own (features/bot/components/bot-mark: eyeLen 51, eyeWidth 38,
// eyeBend -1, eyeTaper 0.35, eyeTilt -90 so the length runs up the face, eyeGap 88, eyeY 100
// against a centre of 120, in a body of radius 112). One scale carries all of it to any size, which
// is the point: the eyes that open in the intro's star are the ones that open in the small face.
//
// Two things a mark does not need. The lid does the opening and the closing — the lens grows from
// a slit and goes back to one — because a hole that fills itself in cell by cell is something
// appearing, and one that fills itself back in is something dissolving; neither is what an eye
// does. The cell noise is still there, but only for the third of a second the lid is moving: the
// outline itself never wobbles, since at the call's size an eye is about eight cells across and
// an outline that moves by a cell and a half stops being an eye.
//
// How a face wears the pair is an EyeFit, and it is two numbers, not one. Making the lens big
// enough to read as a hole in a body of glyphs used to push the pair apart and up with it, which
// is what made the proportions wrong: the layout is the mark's, and only the lens grows.

import { fbm, ihash } from "./field";

const EYE = {
  len: 51,
  width: 38,
  bend: -1,
  taper: 0.35,
  gap: 88,
  /** Above the body's centre, as the mark has it (eyeY 100 of 120). */
  y: -20,
  radius: 112,
} as const;

/** How one face wears the pair. */
export type EyeFit = {
  /** Where they sit, as a multiple of the mark's own gap. 1 is exactly the mark's. */
  gap: number;
  /** How much larger the lens is than the mark's — a hole in glyphs needs more than a solid one. */
  size: number;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** One beat of a script: how long it runs, where it looks, how it leans, whether it blinks. */
type Beat = {
  ms: number;
  /** Radians. Both eyes lean the same way, so it reads as her head going over, not a squint. */
  tilt: number;
  /** Where she looks, as shares of the body's radius — never pixels, or one eye walks off a small face. */
  gaze: readonly [number, number];
  /** Seconds to arrive. A saccade is almost instant; coming level is not. */
  snap?: number;
  blink?: readonly [number, number];
  blink2?: readonly [number, number] | null;
};

export type EyeScript = { beats: Beat[]; total: number };

/** What the eyes are doing at a moment: where they look, how they lean, how open the lids are. */
export type EyeState = {
  gaze: readonly [number, number];
  tilt: number;
  /** Multiplies the eye's length. A blink takes it to nothing and back, and so do the lids. */
  lid: number;
  /**
   * How far the eye's middle has dropped as it shuts, as a share of its whole length: 0 closes
   * it on its middle; the share of what it loses that comes off the top, less the share off the
   * bottom, puts the lids' meeting below the middle, as a falling-asleep eye closes.
   */
  fall?: number;
};

/**
 * One of five scripts, drawn from `seed`, with every length jittered on top. Five rather than one
 * because a face that does the same thing every time is a loop, and a loop stops being seen once
 * it has been learned. Blinks stay quick; nothing else is — a face that keeps darting reads as
 * nervous rather than as alive.
 */
export function eyeScript(seed: number): EyeScript {
  const r = (k: number) => ihash(seed, k * 7 + 3, 1);
  const side = r(3) < 0.5 ? -1 : 1;
  // A lean she may take once she is looking at you. Never on the way up: an eye that arrives
  // on the slant and then straightens reads as the drawing correcting itself.
  const tilt = (0.26 + r(2) * 0.18) * side;
  const home = [0, 0] as const;
  const away = (reach: number) =>
    [side * reach * (0.15 + r(9) * 0.07), (r(10) - 0.5) * 0.07] as const;
  const blink = (at: number): Beat => ({
    ms: 0.62 + r(11) * 0.2,
    tilt: 0,
    gaze: home,
    blink: [at, at + 0.22],
  });

  let beats: Beat[];
  switch ((r(1) * 5) | 0) {
    case 0:
      // the long one: open, look at you, blink, one look away, back
      beats = [
        { ms: 1.3 + r(4) * 0.9, tilt: 0, gaze: home, snap: 0.01 },
        { ms: 1.4 + r(5) * 0.9, tilt: 0, gaze: home },
        blink(0.12),
        { ms: 1.2 + r(6) * 0.9, tilt: 0, gaze: away(1), snap: 0.1 },
        { ms: 1.3 + r(7) * 0.9, tilt: 0, gaze: home, snap: 0.12 },
        {
          ms: 0.95,
          tilt: 0,
          gaze: home,
          blink: [0.1, 0.3],
          blink2: r(8) < 0.5 ? [0.44, 0.64] : null,
        },
        { ms: 1.6 + r(12) * 1.2, tilt: 0, gaze: home },
      ];
      break;
    case 1:
      // a peek: barely open, one blink, gone
      beats = [
        { ms: 0.9 + r(4) * 0.5, tilt: 0, gaze: home, snap: 0.01 },
        { ms: 0.8 + r(5) * 0.5, tilt: 0, gaze: home },
        blink(0.1),
        { ms: 0.7 + r(6) * 0.6, tilt: 0, gaze: home },
      ];
      break;
    case 2:
      // opens level, leans her head over for a while, comes level again
      beats = [
        { ms: 1.2 + r(4) * 0.8, tilt: 0, gaze: home, snap: 0.01 },
        { ms: 1.6 + r(13) * 1.2, tilt, gaze: home, snap: 0.9 },
        { ms: 0.8, tilt, gaze: home, blink: [0.14, 0.36] },
        { ms: 1.8 + r(5) * 1.1, tilt: 0, gaze: home, snap: 0.75 },
        { ms: 1.5 + r(6) * 1.3, tilt: 0, gaze: home },
      ];
      break;
    case 3:
      // looks away almost at once, comes back, blinks twice
      beats = [
        { ms: 0.9 + r(4) * 0.5, tilt: 0, gaze: home, snap: 0.01 },
        { ms: 1.1 + r(5) * 0.7, tilt: 0, gaze: away(1.1), snap: 0.09 },
        { ms: 1.4 + r(6) * 0.8, tilt: 0, gaze: home, snap: 0.12 },
        {
          ms: 1,
          tilt: 0,
          gaze: home,
          blink: [0.08, 0.28],
          blink2: [0.42, 0.62],
        },
        { ms: 1.4 + r(7) * 1.2, tilt: 0, gaze: home },
      ];
      break;
    default:
      // two separate glances, one each way
      beats = [
        { ms: 1.2 + r(4) * 0.7, tilt: 0, gaze: home, snap: 0.01 },
        { ms: 1.2 + r(5) * 0.7, tilt: 0, gaze: home },
        { ms: 1 + r(6) * 0.6, tilt: 0, gaze: away(1), snap: 0.09 },
        { ms: 0.9 + r(7) * 0.5, tilt: 0, gaze: away(-0.85), snap: 0.09 },
        { ms: 1.2 + r(8) * 0.8, tilt: 0, gaze: home, snap: 0.12 },
        blink(0.12),
        { ms: 1.3 + r(12) * 1, tilt: 0, gaze: home },
      ];
  }

  let total = 0;
  for (const beat of beats) total += beat.ms;
  return { beats, total };
}

const AT_REST: EyeState = { gaze: [0, 0], tilt: 0, lid: 1 };

/** Where a script has got to, `age` seconds in. */
export function eyeState(script: EyeScript, age: number): EyeState {
  let at = 0;
  let wasGaze: readonly [number, number] = [0, 0];
  let wasTilt = 0;
  for (const beat of script.beats) {
    const local = age - at;
    if (local < beat.ms) {
      const arrived = smoothstep(0, beat.snap ?? 0.12, local);
      let lid = 1;
      for (const shut of [beat.blink, beat.blink2]) {
        if (!shut || local <= shut[0] || local >= shut[1]) continue;
        const p = (local - shut[0]) / (shut[1] - shut[0]);
        // down and back up
        lid *= Math.abs(Math.cos(Math.PI * p)) ** 0.7;
      }
      return {
        gaze: [
          mix(wasGaze[0], beat.gaze[0], arrived),
          mix(wasGaze[1], beat.gaze[1], arrived),
        ],
        tilt: mix(wasTilt, beat.tilt, arrived),
        lid,
      };
    }
    at += beat.ms;
    wasGaze = beat.gaze;
    wasTilt = beat.tilt;
  }
  return AT_REST;
}

/**
 * Whether a cell is inside one of the eyes. `dx`/`dy` are from the body's centre in the same units
 * as `bodyRadius`; `held` is how far the holes have opened, 0 to 1.
 */
export function inEye(
  dx: number,
  dy: number,
  bodyRadius: number,
  held: number,
  state: EyeState,
  fit: EyeFit,
) {
  if (held <= 0.03 || state.lid <= 0.02) return false;
  // where the pair sits is the mark's own layout; only the lens is scaled up from it
  const k = bodyRadius / EYE.radius;
  const ks = k * fit.size;
  for (const side of [-1, 1]) {
    const ex =
      dx - (side * (EYE.gap / 2) * k * fit.gap + state.gaze[0] * bodyRadius);
    const ey =
      dy -
      (EYE.y * k +
        state.gaze[1] * bodyRadius +
        ((state.fall ?? 0) * EYE.len * ks) / 2);
    // the pair leans together about their own centres
    const cos = Math.cos(state.tilt);
    const sin = Math.sin(state.tilt);
    const px = ex * cos - ey * sin;
    const py = ex * sin + ey * cos;
    const along = -py;
    const across = px;
    const len = EYE.len * ks * state.lid;
    const p = (along + len / 2) / len;
    if (p <= 0 || p >= 1) continue;
    const spine = 2 * (1 - p) * p * -EYE.bend * ks;
    const half = ((EYE.width * ks) / 2) * Math.sin(Math.PI * p) ** EYE.taper;
    if (Math.abs(across - spine) > half) continue;
    // While the lid is moving the edge is dirty: the last cells come and go on the eye's own
    // noise. Read BEFORE the lean, from each eye's own centre, so both eyes come apart on the
    // very same pattern — as the mark's two eyes are the same path twice. Read after it, the
    // lean turns that pattern a different way in each eye and one opens ahead of the other.
    if (
      held < 0.99 &&
      held < fbm(ex * 0.026 + 3, ey * 0.026, 7.7, 2) * 0.88 + 0.06
    )
      continue;
    return true;
  }
  return false;
}
