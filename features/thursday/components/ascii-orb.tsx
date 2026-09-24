"use client";

import { useEffect, useRef } from "react";
import { ASCII_FACE } from "@/config";
import { createVoiceFollower, SPECTRUM_BANDS } from "@/lib/live/live.tap";
import {
  ALPHA_TOP,
  EMOJI_MIN_LEVEL,
  EMOJI_POOL,
  EMOJI_RATIO,
  emojiAlpha,
  emojiWeight,
  hash,
  LETTERS,
  RAMP,
  smoothstep,
} from "../ascii.const";
import {
  busy,
  createExpression,
  facing,
  type Grid,
  PIECE_SETS,
  type Plan,
  pieceAt,
  planOpening,
  sighs,
  stepExpression,
} from "../expressions";
import {
  type EyeFit,
  type EyeScript,
  type EyeState,
  eyeScript,
  eyeState,
  inEye,
} from "../eyes";
import type { AsciiCharset } from "../face.const";
import { type Wind, windAt } from "../field";
import {
  createSmoke,
  restValue,
  type Smoke,
  type Spot,
  sighValue,
  stepSmoke,
} from "../smoke";
import type { FaceWord } from "../thursday.schema";
import { WASH_SETS, wakingSlot, washAt, washOnce } from "../wash";

export type AsciiOrbMode =
  | "idle"
  | "connecting"
  /** Hanging up: the body draws in and goes out, leaving the field empty */
  | "ending"
  | "speaking"
  /** Running a tool; alive without speaking */
  | "working"
  | "error";

type AsciiOrbProps = {
  className?: string;
  mode?: AsciiOrbMode;
  /** "emoji" sprinkles emoji in; "emojiOnly" is all emoji */
  charset?: AsciiCharset;
  /** Glyph size (px) */
  fontSize?: number;
  /** Cell density; above 1 packs tighter */
  density?: number;
  /**
   * Voice bands, low to high, 0..1, read once per frame. Drives the swell while
   * speaking; without it a synthetic waveform keeps the orb alive (previews).
   */
  getSpectrum?: () => ArrayLike<number>;
  /**
   * A word to show (emote): the body steps aside, the letters light in one by
   * one, hold, and go out, and the mode takes the face back. A new `at` shows it again.
   */
  word?: FaceWord | null;
  /** Side length (px). Everything scales with it; cell count scales with area. */
  size?: number;
  /**
   * Orb color (RGB). Dark cells fade toward transparent, not black, so the
   * shading reads the same on light and dark backgrounds. Changes ease in.
   */
  color?: [number, number, number];
  /**
   * She comes in waking, as the first run brings her: her eyes open as she arrives, on a script
   * that looks at you, and a wash goes through her a moment later. Read once, as she mounts.
   */
  waking?: boolean;
};

/** Her glyphs, at the size the user set. */
export const GLYPH_FONT = (px: number) =>
  `700 ${px}px ui-monospace,SFMono-Regular,Menlo,monospace`;

/** The same, for an emoji standing at one rung of the ramp rather than at the top of it. */
const emojiFont = (px: number, level: number, top: number) =>
  GLYPH_FONT(px * (0.5 + emojiWeight(level, top) * 0.5));

/**
 * Every emoji she can show — her own, the washes' and her pieces' — drawn once at every size she draws them,
 * and wiped, before her first frame. The browser shapes a colour emoji the first time it meets it
 * at a size, and that is most of a frame: met in her first frame, it stalls her arrival, and met
 * when a wash first brings its set in, it stalls her then. A sheet copied from would spare the
 * first frame too, but costs three times as much on every frame after it.
 */
function warmEmoji(ctx: CanvasRenderingContext2D, px: number, cells: Cell[]) {
  if (cells.length === 0) return;
  const glyphs = new Set<string>(EMOJI_POOL);
  for (const set of SETS)
    for (const glyph of set.emoji ?? []) glyphs.add(glyph);
  const top = RAMP.length - 1;
  const fonts = [GLYPH_FONT(px)];
  for (let lv = 1; lv <= top; lv++) fonts.push(emojiFont(px, lv, top));
  for (const font of fonts) {
    ctx.font = font;
    let i = 0;
    for (const glyph of glyphs) {
      // at real cells, spread over the box, as her frames will place them
      const cell = cells[(i++ * 97) % cells.length];
      ctx.fillText(glyph, cell.x, cell.y);
    }
  }
  ctx.font = GLYPH_FONT(px);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Peak brightness of the default grey orb */
const DEFAULT_COLOR: [number, number, number] = [235, 235, 235];

/** Color easing per frame (0.05 is about 0.5s) */
const COLOR_EASE = 0.05;

/** A word as five rows of letter indices, one empty column between letters; -1 is no ink. */
function spell(text: string) {
  const rows: number[][] = [[], [], [], [], []];
  let letter = 0;
  for (const char of Array.from(text.toUpperCase())) {
    const glyph = LETTERS[char];
    if (!glyph) continue;
    if (rows[0].length) for (const row of rows) row.push(-1);
    glyph.forEach((line, r) => {
      for (const px of line) rows[r].push(px === "#" ? letter : -1);
    });
    if (char !== " ") letter++;
  }
  return rows;
}

const ERROR_ROWS = spell("ERROR");

/** Reference size the tuning constants assume; coordinates are normalized to it. */
export const DESIGN = 680;
/** Radius (reference units) within which cells exist. Must stay under DESIGN/2 or the canvas clips it. */
const FIELD_R = 328;

/** Where the rim sits while the voice is at the bottom of its range: the resting body's radius (IDLE_R), so speaking starts her own size */
const SPEAK_BASE = 170;
/** Swell across a phrase at the top of the voice's range */
const SPEAK_SWELL = 40;
/** Kick per syllable. Held down on purpose: a syllable should push the rim, not throw it */
const SPEAK_KICK = 85;
/** Rotating lobes, harmonics 2 and up (the first harmonic shifts the whole circle) */
const SPEAK_LOBES = 4;
/** Max depth of one lobe */
const SPEAK_LOBE_R = 28;
/**
 * How fast the whole lobe pattern turns (rad/s), and how much a loud phrase adds.
 * The lobes also drift against each other; this is the turn you actually see,
 * since counter-drifting alone reads as shimmer rather than rotation.
 */
const SPEAK_SPIN = 1.1;
const SPEAK_SPIN_VOICE = 0.9;
/**
 * Rim range. Past SPEAK_KNEE the rim slows into SPEAK_MAX rather than stopping
 * at it, so a loud syllable still reads as a push instead of a flat edge. Max
 * stays inside FIELD_R or thrown crumbs die at the edge; min keeps a deep
 * breath from collapsing to a dot.
 */
const SPEAK_MIN = 110;
const SPEAK_KNEE = 205;
const SPEAK_MAX = 235;
/** How far a rim cell sits in or out of the rim: the edge is crumbly, not drawn with a compass */
const SPEAK_ROUGH = 20;
/** Share of cells a syllable throws outward; the rest stay, so what leaves is crumbs, not a ring */
const SPECK_SHARE = 0.22;
/** Crumb speed (px/s) and lifetime (s) */
const RING_SPEED = 90;
const RING_LIFE = 0.7;
/** Syllables in flight at once, so fast speech does not flood the field */
const MAX_RINGS = 5;

/** Per-frame values derived from the voice; every cell reads the same ones. */
type Voice = {
  /** The voice inside its own range over about half a second (live.tap createVoiceFollower) */
  phrase: number;
  /** Spring kicked by each syllable */
  bob: number;
  bobVel: number;
  /** Lobe strength and angle */
  amp: number[];
  phase: number[];
  /** The whole pattern's turn (rad), one way */
  spin: number;
  /** One throw of crumbs per syllable */
  rings: { born: number; power: number }[];
};

/**
 * Seconds each channel of the field takes to arrive, and to leave. Leaving is
 * slower everywhere: a behaviour that stops winds down — crumbs already on their
 * way keep coming and fade out — rather than vanishing on the frame the mode
 * changes.
 */
const RISE = {
  scale: 0.45,
  lift: 0.22,
  gather: 0.3,
  comet: 0.45,
  speech: 0.5,
  err: 0.5,
  word: 0.35,
};
const FALL = {
  scale: 0.7,
  lift: 0.4,
  gather: 0.95,
  comet: 0.9,
  speech: 0.75,
  err: 0.6,
  word: 0.5,
};
/** Hanging up pulls the body in faster than anything else grows back. */
const END_FALL = 0.4;

/** Moves one channel toward its target; arriving and leaving have their own times. */
function toward(
  from: number,
  to: number,
  rise: number,
  fall: number,
  dt: number,
) {
  return from + (to - from) * Math.min(1, dt / (to > from ? rise : fall));
}

/**
 * The body every mode rests at. The max drawable radius is DESIGN/2, so this
 * sets the budget for SPEAK_MAX and the crumbs thrown past it: leave room, or a
 * loud voice fills the box and its swell has nowhere left to read. The visible
 * body is about half, since the idle wave fades from 0.55 x IDLE_R.
 */
const IDLE_R = 170;
/**
 * At rest she is this much larger than IDLE_R. Her body is solid only to half its radius and soft
 * past that (smoke.ts), so at IDLE_R itself her resting face reads as smaller than her speaking
 * one, which starts from IDLE_R.
 */
const REST_GROW = 1.08;
/** Her radius at rest, reference units: what the first run's echoes of her are drawn as multiples of. */
export const REST_R = IDLE_R * REST_GROW;

/**
 * Connecting: crumbs travel in from the edge of the field to the resting body.
 * Each ray carries its own crumb at its own phase, so nothing lines up into a
 * ring.
 */
const GATHER_R = 320;
/** Equal sectors around the circle; each is a few cells wide, so its crumb reads as a crumb and not an arc */
const GATHER_RAYS = 56;
/** One crumb's trip inward, in trips per second */
const GATHER_RATE = 0.7;
/**
 * Connecting draws the body in to `DIP` of its size and fills back out over
 * `GROW` as the crumbs land in it, so the gathering has somewhere to go instead
 * of piling onto a body that is already full.
 */
const GATHER_DIP = 0.45;
const GATHER_GROW = 1.3;

/** Working: a comet on the orbit just outside where the body rests; the body itself is gone */
const WORK_R = 210;
/** Orbit speed (rad/s); 3.0 is about one lap per 2s */
const WORK_SPIN = 3;
/** Orbit band width; larger blurs more */
const WORK_BAND = 1100;
/** Comet head sharpness / tail length (rad^2) */
const WORK_HEAD = 0.16;
const WORK_TAIL = 2.8;

/** Error cycle: letters light up one by one, then go out one by one (s) */
const ERR_STEP_IN = 0.65; // gap between letters
const ERR_FADE_IN = 0.8; // fade-in per letter
const ERR_HOLD_UNTIL = 5.6; // letters start going out
const ERR_STEP_OUT = 0.5;
const ERR_FADE_OUT = 0.7;
const ERR_CYCLE = 9.2;

/** A word (emote), once: letters light in one by one, hold, and go out the same way (s) */
const WORD_STEP_IN = 0.11;
const WORD_FADE_IN = 0.3;
const WORD_HOLD = 3.4;
const WORD_STEP_OUT = 0.08;
const WORD_FADE_OUT = 0.35;
/**
 * A word arrives and leaves rough rather than as clean strokes: each cell of a letter keeps
 * its own time within SCATTER (s), a cell still coming in or going out crackles on and off
 * STATIC_RATE times a second, and what goes out drops to RESIDUE and lingers as an
 * afterimage for LINGER (s) before it is gone.
 */
const WORD_SCATTER = 0.45;
const WORD_STATIC_RATE = 14;
const WORD_RESIDUE = 0.2;
const WORD_LINGER = 0.9;
/** A word given this soon after she mounts came with her (ms). */
const BORN_WITH_MS = 600;
/**
 * The widest and tallest a word is drawn, as shares of the box. Wider than her body, as ERROR
 * is: fitted to the body alone, a seven-letter word came out at the smallest size and was
 * hard to read.
 */
const WORD_WIDTH = 0.92;
const WORD_HEIGHT = 0.62;

type Cell = {
  /** Draw position on the canvas */
  x: number;
  y: number;
  /** Position in reference units */
  dx: number;
  dy: number;
  dist: number;
  angle: number;
  /** cos/sin of `angle`, kept because the resting field asks for them every frame */
  cos: number;
  sin: number;
  /** Per-cell random (0..1) */
  seed: number;
  /** Per-cell brightness response (0..1); without it cells at equal distance fall into the same step and form rings */
  grain: number;
  /** Below this brightness the cell is empty; random gaps */
  gap: number;
  /** Emoji slot in emoji mode */
  emoji: boolean;
  /** Below SPECK_SHARE, a crumb a syllable throws outward */
  speck: number;
  /** Index of the ERROR letter this cell belongs to, or -1 */
  letter: number;
  /** Index of the shown word's letter this cell belongs to, or -1; laid again for each word */
  word: number;
};

/** Index of the letter at (dx,dy) of a word centred on the box, each of its cells `s` grid cells wide; -1 when none */
function letterAt(
  rows: number[][],
  dx: number,
  dy: number,
  cw: number,
  ch: number,
  s: number,
) {
  const bx = Math.floor(dx / (cw * s) + rows[0].length / 2);
  const by = Math.floor(dy / (ch * s) + rows.length / 2);
  if (by < 0 || by >= rows.length) return -1;
  return rows[by][bx] ?? -1;
}

/**
 * The phosphor. A cell takes a brighter value at once and decays from it, on two clocks: a short
 * one that carries the body and a long, weaker one that is the tail. Two rather than one, because
 * a single constant either smears everything or nothing. The tail is short and light: her smoke
 * already leaves its own trail, and a long one on top of it reads as ink. Seconds.
 */
export const TRAIL_FAST = 0.085;
const TRAIL_SLOW = 0.8;
/** What the long clock is worth beside the short one. */
const TRAIL_WEIGHT = 0.52;

/**
 * How often a cell picks a new glyph at an unchanged brightness, a second. Slow on purpose: the
 * eye follows a glyph's identity, so a field whose glyphs shuffle while its shape holds still is
 * read as television snow rather than as something moving. The motion comes from the field — a
 * cell also re-picks the moment its brightness moves two steps, which is most of what happens
 * while she speaks. The wave that leaves her face keeps the faster rate (ascii.const CHAR_RATE):
 * it is over in two seconds and has no shape to hold.
 */
export const CHURN_ASCII = 0.4;
export const CHURN_EMOJI = 0.264;

/**
 * Between one opening of her eyes and the next she rests about this long, times a factor between
 * 0.55 and 1.45 drawn fresh each time, and each time how she wakes and what she does is the next
 * version in her deck (expressions.ts) with a script drawn for her eyes (eyes.ts). Nothing about
 * it is meant to be learnable: a face that does the same thing on a beat stops being seen once the
 * beat has been counted. An opening lasts about EYES_AWAKE, times 0.75 to 1.25. Seconds.
 */
const EYES_APART = 17;
const EYES_AWAKE = 11;
/** How long the body takes to close around them, and to let go again. */
const EYES_IN = 1.25;
const EYES_OUT = 1.5;
/** The lid: how long it takes to come up, how long to come down, and how long the noise dirties it. */
const EYES_OPEN = 0.38;
const EYES_SHUT = 1.35;
const EYES_FILL = 0.3;
/**
 * How long her eyes take to shut when something else takes the face in the middle of an opening —
 * a call connecting, her voice, a word. They shut as she falls asleep, only this quickly: gone at
 * once, an open eye is a hole that switches off.
 */
const EYES_CUT = 0.4;
/**
 * How she shuts them: falling asleep, not switched off. The lid falls quickly and then creeps the
 * last of the way (what is left of it goes as a power above 1 of what is left of the time), her
 * gaze lowers by EYES_SLEEP_DOWN of her radius, and EYES_LID_FALL of what the eye loses comes off
 * its top, so the lids meet below its middle. Lowered much further, the whole eye is seen sliding
 * off.
 */
const EYES_SLEEP_EASE = 2.2;
const EYES_SLEEP_DOWN = 0.04;
const EYES_LID_FALL = 0.7;

/**
 * About how often part of her is briefly made of something else, and about how long one sits
 * (wash.ts). Rare on purpose: it is an event, and an event that happens every few seconds is a
 * texture. A cell keeps its set for a moment after the wash has left it, so the front is ragged
 * coming and going rather than switching cleanly. Seconds.
 */
const WASH_APART = 42;
const WASH_HOLD = 3.2;
const WASH_LINGER = 0.3;
const WASH_LINGER_MORE = 0.9;

/**
 * How long after she mounts her eyes start to open — at once, so that the moment she is her own
 * size is the moment she looks — and, waking (`waking`), when the one wash that goes through her
 * starts and how long it sits. Seconds.
 */
const WAKE_LOOK = 0.15;
const WAKE_WASH = 1;
const WAKE_WASH_FOR = 2.9;

/**
 * The glyph sets a cell can be drawn from: the washes' (wash.ts), then what her pieces give off
 * (expressions.ts), whose pool is PIECE_POOL past theirs. A set with no emoji is drawn in hers.
 */
const SETS: readonly {
  ascii: readonly string[];
  emoji: readonly string[] | null;
}[] = [...WASH_SETS, ...PIECE_SETS];
const PIECE_POOL = WASH_SETS.length;

/**
 * How she wears her eyes (eyes.ts): the bot faces' own layout, with a lens a tenth larger,
 * because a hole in a body of glyphs needs a little more than a hole in a solid shape.
 */
const EYE_FIT: EyeFit = { gap: 1, size: 1.1 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The rim's radius for a raw push: as pushed up to SPEAK_KNEE, then easing into SPEAK_MAX. */
function rimAt(raw: number) {
  if (raw <= SPEAK_KNEE) return Math.max(SPEAK_MIN, raw);
  const room = SPEAK_MAX - SPEAK_KNEE;
  return SPEAK_KNEE + room * Math.tanh((raw - SPEAK_KNEE) / room);
}

/**
 * What the field is doing right now. A mode does not draw a picture of its own:
 * it names targets for these channels, and each eases toward its target on its
 * own clock, so a behaviour arrives and — when the mode changes — winds down.
 */
type Field = {
  /** The body's radius as a share of IDLE_R; 0 is an empty field */
  scale: number;
  /** Brightness added to the body in place */
  lift: number;
  /** Crumbs streaming in from the edge of the field (connecting) */
  gather: number;
  /** A comet on its orbit, the body gone (working) */
  comet: number;
  /** Her voice: the rim it pushes and the crumbs a syllable throws (speaking) */
  speech: number;
  /** The ERROR letters */
  err: number;
  /** A word's letters (emote) */
  word: number;
};

/** Where a mode wants the field. `e` is seconds since the mode was asked for. */
function targetFor(m: AsciiOrbMode, e: number): Field {
  const rest: Field = {
    scale: 1,
    lift: 0,
    gather: 0,
    comet: 0,
    speech: 0,
    err: 0,
    word: 0,
  };
  switch (m) {
    case "idle":
      return rest;

    // draws in first, then fills back out as the crumbs land in it
    case "connecting": {
      const filled = 1 - Math.exp(-e / GATHER_GROW);
      return {
        ...rest,
        scale: GATHER_DIP + (1 - GATHER_DIP) * filled,
        lift: 0.06 * filled,
        gather: 1,
      };
    }

    case "speaking":
      return { ...rest, speech: 1 };

    // the body goes, and only the comet keeps its orbit
    case "working":
      return { ...rest, scale: 0, comet: 1 };

    case "ending":
      return { ...rest, scale: 0 };

    case "error":
      return { ...rest, scale: 0, err: 1 };
  }
}

/** Crumbs traveling in from the edge of the field to the body's rim, dimming as they land. */
function gatherValue(cell: Cell, t: number, scale: number) {
  const rim = IDLE_R * scale;
  if (cell.speck >= 0.55 || cell.dist < rim * 0.8) return 0;
  // atan2 reaches +PI, which would open a ray past the last one
  const sector = Math.min(
    GATHER_RAYS - 1,
    Math.floor(((cell.angle + Math.PI) / (2 * Math.PI)) * GATHER_RAYS),
  );
  const ray = hash(sector, 5.3);
  const p = (t * GATHER_RATE + ray) % 1;
  const d =
    cell.dist -
    (rim + (GATHER_R - rim) * (1 - p) ** 1.25) -
    (cell.grain - 0.5) * 16;
  // dims as it lands, so a crumb is taken into the body rather than piling on it
  return Math.exp(-(d * d) / 260) * smoothstep(0, 0.2, p) * (1 - p) * 1.1;
}

/** A comet on a thin orbit outside the body: sharp head, long tail. */
function cometValue(cell: Cell, t: number) {
  const d = cell.dist - WORK_R;
  const band = Math.exp(-(d * d) / WORK_BAND);
  const raw = cell.angle - t * WORK_SPIN;
  const da = Math.atan2(Math.sin(raw), Math.cos(raw));
  return band * Math.exp(-(da * da) / (da < 0 ? WORK_TAIL : WORK_HEAD));
}

/**
 * Her voice. Frequency is not mapped to angle: a voice's spectrum barely moves
 * within a sentence, so that freezes into a fixed star. The voice gives the rim
 * its size, its syllables and its lobes, and the whole pattern turns with time.
 * No line in it is clean: the rim is crumbly, and a syllable throws crumbs
 * rather than a ring.
 */
function speechValue(cell: Cell, t: number, v: Voice, amount: number) {
  let raw = SPEAK_BASE + SPEAK_SWELL * v.phrase + SPEAK_KICK * v.bob;
  for (let i = 0; i < SPEAK_LOBES; i++) {
    raw +=
      SPEAK_LOBE_R *
      v.amp[i] *
      Math.sin((i + 2) * (cell.angle + v.spin) + v.phase[i]);
  }
  // the rim grows out of the resting body as she starts and settles back into it
  // when she stops; without this it appears at whatever the first syllable asks
  // for, which reads as the circle jumping bigger
  const edge = IDLE_R + (rimAt(raw) - IDLE_R) * amount;

  // each cell sits a little in or out of the rim, and the offset drifts
  const rough =
    (cell.grain - 0.5) * SPEAK_ROUGH +
    Math.sin(cell.angle * 5 + t * 0.9 + cell.seed * 6.283) * SPEAK_ROUGH * 0.3;
  const d = cell.dist - (edge + rough);
  let value =
    Math.exp(-(d * d) / 800) + Math.exp(-(cell.dist * cell.dist) / 6000) * 0.5;

  // a soft fill out to the rim, with the idle wave still moving through it
  if (cell.dist < edge) {
    value +=
      0.22 *
      (1 - cell.dist / edge) ** 0.6 *
      (0.75 + 0.25 * Math.sin(cell.dist * 0.05 - t * 1.2));
  }

  // crumbs: a sparse share of cells, each thrown past the rim at its own speed
  if (cell.speck < SPECK_SHARE) {
    const speed = RING_SPEED * (0.6 + cell.grain * 0.9);
    for (let i = 0; i < v.rings.length; i++) {
      const ring = v.rings[i];
      const age = t - ring.born;
      const dd = cell.dist - (edge + 6 + age * speed);
      value +=
        Math.exp(-(dd * dd) / 500) *
        ring.power *
        Math.max(0, 1 - age / RING_LIFE);
    }
  }
  return value;
}

/**
 * ERROR, letter by letter: each lights up in turn and goes out the same way.
 * `age` is ERROR's own clock, not the mode's, so leaving the mode fades the
 * letters where they stand instead of restarting their cycle.
 */
function errorValue(cell: Cell, t: number, age: number) {
  if (cell.letter < 0) return 0;
  const pe = age % ERR_CYCLE;
  const jitter = cell.seed * 0.12;
  const appear = smoothstep(
    0,
    1,
    (pe - cell.letter * ERR_STEP_IN - jitter) / ERR_FADE_IN,
  );
  const vanish = smoothstep(
    0,
    1,
    (pe - ERR_HOLD_UNTIL - cell.letter * ERR_STEP_OUT - jitter) / ERR_FADE_OUT,
  );
  const flick = 0.86 + Math.sin(t * 3.5 + cell.seed * 6) * 0.14;
  return Math.max(0, appear - vanish) * flick;
}

/** Marks which cells ink each letter of `text`, fitted to about her body's width; returns the letter count. */
function layWord(cells: Cell[], cw: number, ch: number, text: string) {
  const fit = (rows: number[][]) =>
    Math.max(
      1,
      Math.min(
        3,
        Math.floor((DESIGN * WORD_WIDTH) / (rows[0].length * cw)),
        Math.floor((DESIGN * WORD_HEIGHT) / (rows.length * ch)),
      ),
    );
  // Two words that only fit small on one line are drawn larger on two
  const one = spell(text);
  const two = fit(one) < 3 ? onTwoLines(text) : null;
  const rows = two && fit(two) > fit(one) ? two : one;
  const s = fit(rows);
  let letters = 0;
  for (const cell of cells) {
    cell.word = letterAt(rows, cell.dx, cell.dy, cw, ch, s);
    letters = Math.max(letters, cell.word + 1);
  }
  return letters;
}

/** `text` broken at the space nearest its middle, each line centred, the letters numbered on through; null when it has no space to break at. */
function onTwoLines(text: string): number[][] | null {
  const chars = Array.from(text.trim());
  const spaces = chars.flatMap((char, at) => (char === " " ? [at] : []));
  if (!spaces.length) return null;
  const middle = chars.length / 2;
  const at = spaces.reduce((best, one) =>
    Math.abs(one - middle) < Math.abs(best - middle) ? one : best,
  );
  const head = spell(chars.slice(0, at).join(""));
  const tail = spell(chars.slice(at + 1).join(""));
  if (!head[0].length || !tail[0].length) return null;

  const first = Math.max(-1, ...head.flat()) + 1;
  const width = Math.max(head[0].length, tail[0].length);
  const centred = (row: number[], shift: number) => {
    const left = Math.floor((width - row.length) / 2);
    return [
      ...new Array<number>(left).fill(-1),
      ...row.map((letter) => (letter < 0 ? letter : letter + shift)),
      ...new Array<number>(width - row.length - left).fill(-1),
    ];
  };
  const blank = () => new Array<number>(width).fill(-1);
  return [
    ...head.map((row) => centred(row, 0)),
    blank(),
    blank(),
    ...tail.map((row) => centred(row, first)),
  ];
}

/**
 * A word's letters `age` seconds into its showing: each lights in turn, holds, and goes out in
 * turn — every cell on its own beat, crackling while it changes, and leaving an afterimage.
 */
function wordValue(cell: Cell, t: number, age: number, hold: number) {
  if (cell.word < 0) return 0;
  const jitter = cell.seed * WORD_SCATTER;
  const appear = smoothstep(
    0,
    1,
    (age - cell.word * WORD_STEP_IN - jitter) / WORD_FADE_IN,
  );
  const out = age - hold - cell.word * WORD_STEP_OUT - jitter;
  const vanish = smoothstep(0, 1, out / WORD_FADE_OUT);
  // what the letter drops to, then the afterimage fading out of that
  const residue =
    WORD_RESIDUE * (1 - smoothstep(0, 1, (out - WORD_FADE_OUT) / WORD_LINGER));
  const lit = Math.max(appear - vanish, appear > 0.5 ? residue * vanish : 0);
  const changing = (appear > 0 && appear < 1) || (vanish > 0 && residue > 0);
  const crackle =
    changing &&
    hash(Math.floor(t * WORD_STATIC_RATE) + cell.seed * 97, cell.grain * 31) <
      0.35
      ? 0.25
      : 1;
  const flick = 0.86 + Math.sin(t * 3.5 + cell.seed * 6) * 0.14;
  return lit * crackle * flick;
}

/**
 * One cell's brightness: the body, plus whichever behaviours are up. Her voice
 * hollows the body rather than replacing it, so there is nothing to dissolve
 * between when she starts or stops.
 */
function fieldValue(
  cell: Cell,
  spot: Spot,
  t: number,
  errAge: number,
  wordAge: number,
  wordHold: number,
  f: Field,
  v: Voice,
  smoke: Smoke,
  wind: Wind,
) {
  let value =
    f.scale > 0.02
      ? restValue(
          spot,
          t,
          f.lift,
          IDLE_R * REST_GROW * f.scale,
          f.scale,
          smoke,
          wind,
        ) *
        (1 - 0.6 * f.speech)
      : 0;
  if (f.gather > 0.01) value += gatherValue(cell, t, f.scale) * f.gather;
  if (f.comet > 0.01) value += cometValue(cell, t) * f.comet;
  if (f.speech > 0.01) value += speechValue(cell, t, v, f.speech) * f.speech;
  if (f.err > 0.01) value += errorValue(cell, t, errAge) * f.err;
  if (f.word > 0.01) value += wordValue(cell, t, wordAge, wordHold) * f.word;
  return value;
}

export function AsciiOrb({
  className,
  mode = "idle",
  charset = ASCII_FACE.charset,
  fontSize = ASCII_FACE.fontSize.default,
  density = ASCII_FACE.density.default,
  size = DESIGN,
  color = DEFAULT_COLOR,
  getSpectrum,
  word = null,
  waking = false,
}: AsciiOrbProps) {
  const hostRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cellsRef = useRef<Cell[]>([]);
  /** Cells bucketed by brightness level; reused every frame to avoid garbage */
  const bucketsRef = useRef<{
    ascii: Int32Array[];
    emoji: Int32Array[];
    asciiN: Int32Array;
    emojiN: Int32Array;
    glyph: string[];
    fast: Float32Array;
    slow: Float32Array;
    wasLevel: Int8Array;
    turn: Int32Array;
    pick: Int32Array;
    pool: Int8Array;
    poolFor: Float32Array;
  } | null>(null);
  const charsetRef = useRef(charset);
  /** cur is the color on screen, target the one it eases toward */
  const colorRef = useRef({
    cur: [...color] as [number, number, number],
    target: color,
  });
  /** Side (px) the grid was built for; the loop clears this much */
  const boxRef = useRef(0);

  // the loop mounts once with no deps, so the latest getter comes through a ref
  const specRef = useRef(getSpectrum);
  specRef.current = getSpectrum;

  const voiceRef = useRef<Voice>({
    phrase: 0,
    bob: 0,
    bobVel: 0,
    amp: new Array<number>(SPEAK_LOBES).fill(0),
    // distinct start phases, or the lobes overlap into one lump at first
    phase: Array.from({ length: SPEAK_LOBES }, (_, i) => i * 2.1),
    spin: 0,
    rings: [],
  });

  /** The mode being asked for, and when it was asked for. */
  const modeRef = useRef({ mode, start: 0 });
  /** When she mounted (ms), to tell a word that came with her from one given later. */
  const bornAt = useRef(performance.now());
  /** Where in the wind's noise this face starts, so two loads do not blow the same way. */
  const windSeed = useRef(Math.random() * 90).current;
  /**
   * The field on screen. It only ever eases toward the mode's targets, so it
   * starts drawn in and opens on the first frames like any other arrival.
   */
  const fieldRef = useRef<Field>({
    scale: 0.3,
    lift: 0,
    gather: 0,
    comet: 0,
    speech: 0,
    err: 0,
    word: 0,
  });

  /** The word being shown, when it started, and how many letters it has; its cells carry the rest */
  const wordRef = useRef<{
    text: string;
    start: number;
    letters: number;
    hold: number;
  } | null>(null);
  /** Grid pitch in reference units, for laying a word onto cells that already exist */
  const pitchRef = useRef({ cw: 1, ch: 1 });
  /** When she next looks up, the script she will run when she does, and what she does meanwhile */
  const lookRef = useRef<{
    script: EyeScript | null;
    from: number;
    until: number;
    plan?: Plan | null;
    /** When something else took the face in the middle of this opening (the loop's clock) */
    cut?: number;
  }>({ script: null, from: 0, until: 0 });
  /** Her cells, and which of them is at each place of the grid, for what her pieces lay on her */
  const gridRef = useRef<Grid | null>(null);
  /** Whether she came in waking; the loop reads it once, as she mounts */
  const wakingRef = useRef(waking);

  // grid is rebuilt only when size or density changes
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // actual px pitch for drawing
    const cw = (fontSize * 0.95) / density;
    const ch = (fontSize * 1.25) / density;
    // pitch in reference units, where the tuning constants live
    const norm = DESIGN / size;
    const cwN = cw * norm;
    const chN = ch * norm;
    // scale ERROR so it stays inside the box at any glyph size
    const errScale = Math.max(
      1,
      Math.floor((DESIGN * 0.92) / (ERROR_ROWS[0].length * cwN)),
    );
    boxRef.current = size;
    pitchRef.current = { cw: cwN, ch: chN };

    const cells: Cell[] = [];
    const cols = Math.ceil(size / cw);
    const rows = Math.ceil(size / ch);
    const at = new Int32Array(cols * rows).fill(-1);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const y = r * ch;
        // all positioning is in reference units
        const dx = (x - size / 2) * norm;
        const dy = (y - size / 2) * norm;
        const dist = Math.hypot(dx, dy);

        const letter = letterAt(ERROR_ROWS, dx, dy, cwN, chN, errScale);
        if (letter < 0 && dist > FIELD_R) continue;

        at[r * cols + c] = cells.length;
        cells.push({
          // glyphs sit at the cell center, in actual px
          x: x + cw / 2,
          y: y + ch / 2,
          dx,
          dy,
          dist,
          angle: Math.atan2(dy, dx),
          cos: dist > 0 ? dx / dist : 1,
          sin: dist > 0 ? dy / dist : 0,
          seed: hash(c, r),
          grain: hash(c * 5.7 + 19, r * 2.3 + 53),
          gap: 0.05 + hash(c * 7.3 + 11, r * 3.1 + 5) * 0.3,
          emoji: hash(c * 2.7 + 31, r * 5.9 + 17) < EMOJI_RATIO,
          speck: hash(c * 4.1 + 23, r * 6.3 + 41),
          letter,
          word: -1,
        });
      }
    }

    cellsRef.current = cells;
    gridRef.current = {
      cells,
      cols,
      rows,
      cw: cwN,
      ch: chN,
      half: DESIGN / 2,
      at,
      field: FIELD_R,
    };
    // a word showing while the grid changes is laid onto the new cells
    if (wordRef.current) layWord(cells, cwN, chN, wordRef.current.text);

    // bucketing by level keeps fillStyle changes to one per level
    bucketsRef.current = {
      ascii: Array.from(
        { length: RAMP.length },
        () => new Int32Array(cells.length),
      ),
      emoji: Array.from(
        { length: RAMP.length },
        () => new Int32Array(cells.length),
      ),
      asciiN: new Int32Array(RAMP.length),
      emojiN: new Int32Array(RAMP.length),
      glyph: new Array<string>(cells.length),
      // the phosphor: a cell takes a brighter value at once and decays from it, on two clocks —
      // a short one that carries the body and a long, weaker one that is the tail
      fast: new Float32Array(cells.length),
      slow: new Float32Array(cells.length),
      // what each cell is holding, so it is not re-picked at an unchanged brightness
      wasLevel: new Int8Array(cells.length).fill(-9),
      turn: new Int32Array(cells.length).fill(-9),
      pick: new Int32Array(cells.length),
      // which set has this cell, and for how much longer it keeps it once the wash has passed
      pool: new Int8Array(cells.length),
      poolFor: new Float32Array(cells.length),
    };

    // match canvas resolution to the device pixel ratio
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    host.width = size * dpr;
    host.height = size * dpr;
    host.style.width = `${size}px`;
    host.style.height = `${size}px`;

    const ctx = host.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = GLYPH_FONT(fontSize);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      warmEmoji(ctx, fontSize, cells);
      ctxRef.current = ctx;
    }

    return () => {
      ctx?.clearRect(0, 0, size, size);
      cellsRef.current = [];
      gridRef.current = null;
      bucketsRef.current = null;
    };
  }, [fontSize, density, size]);

  // every frame redraws everything, so the charset only needs a ref update
  useEffect(() => {
    charsetRef.current = charset;
  }, [charset]);

  // color: only the target changes; the drawn color eases toward it
  useEffect(() => {
    colorRef.current.target = color;
  }, [color]);

  // a mode change only moves the targets; the field eases the rest of the way
  useEffect(() => {
    if (modeRef.current.mode === mode) return;
    modeRef.current = { mode, start: performance.now() * 0.001 };
  }, [mode]);

  // a new word starts from its first letter, in place of one still showing; one already up as
  // she mounts (CALL, when the app opens on a ring) starts when she does, lighting in like any other
  useEffect(() => {
    if (!word) return;
    // A word is said as it comes. One handed back later — the goodbye still held when a
    // ring's CALL steps aside — would already be over, so it is not said again
    if (Date.now() - word.at > (word.hold ?? WORD_HOLD) * 1000) return;
    const { cw, ch } = pitchRef.current;
    const now = performance.now();
    wordRef.current = {
      text: word.text,
      start: now * 0.001,
      letters: layWord(cellsRef.current, cw, ch, word.text),
      hold: word.hold ?? WORD_HOLD,
    };
    // A word that came with her has the face from her first frame, so the field is put where the
    // word wants it rather than eased there. Otherwise her body opens on the first frames and is
    // taken away again a moment later, which is a blink on the screen the app opens with.
    if (now - bornAt.current < BORN_WITH_MS) {
      const f = fieldRef.current;
      f.word = 1;
      f.scale = 0;
    }
  }, [word]);

  // animation loop
  useEffect(() => {
    let raf = 0;
    const follower = createVoiceFollower();
    const smoke = createSmoke();
    const expr = createExpression();
    /** Where she is read at the cell being drawn (smoke.ts Spot); one, reused cell to cell */
    const spot: Spot = { dx: 0, dy: 0, dist: 0, px: 0, py: 0, sx: 0, sy: 0 };
    const murmur = new Array<number>(SPECTRUM_BANDS).fill(0);

    let lastT = performance.now() * 0.001;
    /** Glyph clock: seconds the loop has run, so a backgrounded tab resumes where it left off */
    let clock = 0;
    /** Seconds ERROR has been showing (errorValue) */
    let errAge = 0;
    // Waking, her first look is one set for her — a script that looks at you, with the sigh — and
    // one wash goes through her
    const wake = wakingRef.current
      ? { slot: wakingSlot((Math.random() * 4000) | 0) }
      : null;
    if (wake) {
      const script = eyeScript((Math.random() * 1e6) | 0, true);
      lookRef.current = {
        script,
        from: WAKE_LOOK,
        until: WAKE_LOOK + EYES_IN + script.total + EYES_OUT,
      };
    }

    const draw = (nowMs: number) => {
      const t = nowMs * 0.001;
      // a backgrounded tab can deliver seconds in one frame; clamp so phases do not jump
      const dt = Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;
      const ctx = ctxRef.current;
      const bk = bucketsRef.current;
      const grid = gridRef.current;
      if (!ctx || !bk || !grid) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const cs = charsetRef.current;
      const box = boxRef.current;
      bk.asciiN.fill(0);
      bk.emojiN.fill(0);

      // Live voice when available; without one a murmur keeps the orb alive (previews)
      let live: ArrayLike<number> | undefined = specRef.current?.();
      if (!live || live.length < 2) {
        for (let k = 0; k < murmur.length; k++) {
          const a =
            Math.sin(t * 1.7 + k * 1.7) * 0.5 +
            Math.sin(t * 0.8 + k * 0.6) * 0.3 +
            Math.sin(t * 3.0 + k * 2.9) * 0.2;
          murmur[k] = a * 0.5 + 0.5;
        }
        live = murmur;
      }

      // size, syllables and lobes from the voice, once per frame; each band is
      // read inside its own range, or a voice's narrow loud spectrum pins the rim
      const voice = voiceRef.current;
      const heard = follower.read(live, dt);
      voice.phrase = heard.phrase;
      if (heard.onset > 0) {
        voice.bobVel += 0.06 * heard.onset;
        voice.rings.push({ born: t, power: heard.onset });
        if (voice.rings.length > MAX_RINGS) voice.rings.shift();
      }
      // a spring with a period of about 1s; kick it on syllables instead of driving position, or 60fps noise becomes jitter
      voice.bobVel += -voice.bob * 0.012 - voice.bobVel * 0.09;
      voice.bob += voice.bobVel;

      clock += dt;

      for (let i = 0; i < SPEAK_LOBES; i++) {
        // neighbouring bands per lobe, low lobes from low bands
        const from = Math.floor((i * heard.bands.length) / SPEAK_LOBES);
        const to = Math.max(
          from + 1,
          Math.floor(((i + 1) * heard.bands.length) / SPEAK_LOBES),
        );
        let energy = 0;
        for (let j = from; j < to; j++) energy += heard.bands[j];
        energy /= to - from;
        // a random factor that changes about once per second, so lobes keep moving through a held vowel
        const wander = 0.7 + hash(((t * 0.9) | 0) + i * 31, i) * 0.6;
        // different time constants per harmonic, or the star only scales
        voice.amp[i] += (energy * wander - voice.amp[i]) * (0.05 + i * 0.02);
        // own speed, alternating direction, so no standing wave forms
        voice.phase[i] += dt * (0.9 + i * 0.5) * (i % 2 ? -1 : 1);
      }

      // the pattern turns one way, faster while she is mid-phrase
      voice.spin += dt * (SPEAK_SPIN + SPEAK_SPIN_VOICE * voice.phrase);

      while (voice.rings.length > 0 && t - voice.rings[0].born > RING_LIFE) {
        voice.rings.shift();
      }

      // the field eases toward what this mode wants, each channel on its own clock
      const cur = modeRef.current;
      // a word takes the face from the mode until its last letter is out; an error keeps it
      const shown = wordRef.current;
      const wordAge = shown ? t - shown.start : 0;
      const wording =
        shown !== null &&
        cur.mode !== "error" &&
        wordAge <
          shown.hold +
            shown.letters * WORD_STEP_OUT +
            WORD_SCATTER +
            WORD_FADE_OUT +
            WORD_LINGER;
      const want: Field = targetFor(cur.mode, t - cur.start);
      if (wording) {
        want.word = 1;
        // The word owns the face only until its letters start to leave. From there the body grows
        // back underneath them, the way every other change on this face is made. Held to the very
        // end instead, the letters go, the field is empty for most of a second, and then a circle
        // appears out of nothing: a gap, and then a flash.
        if (shown !== null && wordAge < shown.hold) {
          want.scale = 0;
          want.lift = 0;
          want.gather = 0;
          want.comet = 0;
          want.speech = 0;
        }
      }
      const f = fieldRef.current;
      f.scale = toward(
        f.scale,
        want.scale,
        RISE.scale,
        cur.mode === "ending" ? END_FALL : FALL.scale,
        dt,
      );
      f.lift = toward(f.lift, want.lift, RISE.lift, FALL.lift, dt);
      f.gather = toward(f.gather, want.gather, RISE.gather, FALL.gather, dt);
      f.comet = toward(f.comet, want.comet, RISE.comet, FALL.comet, dt);
      f.speech = toward(f.speech, want.speech, RISE.speech, FALL.speech, dt);
      // ERROR's clock runs only in its mode and holds while the letters fade
      // out; an error that finds them already gone starts from the first letter
      if (cur.mode === "error") {
        if (f.err <= 0.01) errAge = 0;
        errAge += dt;
      }
      f.err = toward(f.err, want.err, RISE.err, FALL.err, dt);
      f.word = toward(f.word, want.word, RISE.word, FALL.word, dt);
      const solidError = f.err > 0.5;
      const solidWord = f.word > 0.5;
      const rate = cs === "emojiOnly" ? CHURN_EMOJI : CHURN_ASCII;

      // this frame's wind, which is what her plume leans on
      const wind = windAt(clock, windSeed);
      const fastKeep = Math.exp(-dt / TRAIL_FAST);
      const slowKeep = Math.exp(-dt / TRAIL_SLOW);

      // Her eyes, which belong to resting alone. `held` closes them well before anything else
      // comes up, and the whole thing is skipped while a word or ERROR has the face.
      const restful = f.scale * (1 - f.speech) * (1 - f.comet) * (1 - f.gather);
      let eyes: EyeState | null = null;
      let eyesHeld = 0;
      // for her smoke: how open her eyes are, how far into shutting them, how long since they parted
      let eyesOpen = 0;
      let asleep = 0;
      let sinceLids = -1;
      // the opening under way, and seconds since her lids started to part in it (below 0 before)
      let plan: Plan | null = null;
      let lidsAt = -1;
      const look = lookRef.current;
      const resting = restful > 0.4 && !solidError && !solidWord;
      // how much of her is still resting, which what she has given off goes with (expressions.ts)
      const calm =
        smoothstep(0.4, 0.75, restful) * (1 - smoothstep(0, 0.5, f.word));
      // Something else taking the face in the middle of an opening does not drop it: she falls
      // asleep there and then, in EYES_CUT, and what she was doing stops.
      if (
        !resting &&
        look.cut === undefined &&
        look.script &&
        clock > look.from &&
        clock < look.until
      )
        look.cut = clock;
      if (resting && look.cut === undefined && clock > look.until) {
        // Her first look is as she arrives; after that, when she next looks up is noise. How she
        // wakes and what she does is the next version in her deck, and the script her eyes run
        // is drawn for as long as that takes.
        const first = look.until === 0;
        const next = planOpening(expr, EYES_AWAKE);
        look.plan = next;
        look.script = eyeScript((clock * 1000) | 0, false, next.open);
        look.from =
          clock +
          (first ? WAKE_LOOK : EYES_APART * (0.55 + Math.random() * 0.9));
        look.until =
          look.from +
          EYES_IN +
          Math.max(look.script.total, next.open) +
          EYES_OUT;
      }
      if (resting || look.cut !== undefined) {
        const age = clock - look.from;
        const span = look.until - look.from;
        if (look.script && age > 0) {
          const settled = smoothstep(0.4, 0.75, restful);
          // It opens by the LID, not by the hole filling itself in: a hole that fills cell by
          // cell over a second is something appearing, and a hole that fills itself back in at
          // the end is something dissolving. Neither is what an eye does. The cell noise is
          // still there, but only for the third of a second the lid is moving.
          const upAt = EYES_IN * 0.6;
          const closeAt = span - EYES_OUT - 0.3;
          const sleep =
            look.cut === undefined
              ? clamp01((age - closeAt) / EYES_SHUT)
              : Math.max(
                  clamp01((age - closeAt) / EYES_SHUT),
                  clamp01((clock - look.cut) / EYES_CUT),
                );
          eyesHeld = smoothstep(upAt, upAt + EYES_FILL, age);
          const state = eyeState(look.script, Math.max(0, age - EYES_IN * 0.7));
          const opened = state.lid * smoothstep(upAt, upAt + EYES_OPEN, age);
          const left = (1 - sleep) ** EYES_SLEEP_EASE;
          eyes = {
            ...state,
            gaze: [
              state.gaze[0],
              state.gaze[1] + EYES_SLEEP_DOWN * smoothstep(0, 0.65, sleep),
            ],
            lid: opened * left,
            fall: opened * (1 - left) * (2 * EYES_LID_FALL - 1),
          };
          eyesOpen = eyesHeld * (1 - sleep) * settled;
          asleep = smoothstep(0.1, 0.9, sleep) * settled;
          if (settled > 0.5) sinceLids = age - upAt;
          if (look.cut === undefined) {
            plan = look.plan ?? null;
            lidsAt = age - upAt;
          } else if (sleep >= 1) {
            // shut: the opening is over, and the next comes once she is resting again
            look.until = clock;
            look.cut = undefined;
            eyes = null;
            eyesHeld = 0;
          }
        }
      }
      const restR = IDLE_R * REST_GROW * Math.max(0.02, f.scale);
      // what she does in this opening: her head's pose, her eyes' part in it, what she gives off
      eyes = stepExpression(expr, grid, t, dt, plan, lidsAt, eyes, restR, calm);
      smoke.hush = expr.doing.hush;
      // an opening with no plan is a look set up for her (`waking`), and wakes with the sigh
      stepSmoke(
        smoke,
        t,
        dt,
        eyesOpen,
        asleep,
        sinceLids,
        plan === null || sighs(plan),
      );
      const moved = expr.moved;
      const pieces = busy(expr);

      const all = cellsRef.current;
      for (let ci = 0; ci < all.length; ci++) {
        const cell = all[ci];
        // where she is read here: her grain on her head as it is turned, her outline in its own
        // plane, her smoke where it trails her head
        if (moved) {
          spot.dx = expr.hx[ci];
          spot.dy = expr.hy[ci];
          spot.px = expr.px[ci];
          spot.py = expr.py[ci];
          spot.dist = expr.pd[ci];
          spot.sx = expr.sx[ci];
          spot.sy = expr.sy[ci];
        } else {
          spot.dx = spot.px = spot.sx = cell.dx;
          spot.dy = spot.py = spot.sy = cell.dy;
          spot.dist = cell.dist;
        }
        let v = fieldValue(
          cell,
          spot,
          t,
          errAge,
          wordAge,
          shown?.hold ?? WORD_HOLD,
          f,
          voice,
          smoke,
          wind,
        );
        // the sigh she lets out as her eyes open, over whatever is there
        if (smoke.sigh.live) {
          const sigh = sighValue(spot, t, restR, smoke) * f.scale;
          if (sigh > v) v = sigh;
        }

        const plain = !(
          (solidError && cell.letter >= 0) ||
          (solidWord && cell.word >= 0)
        );
        // what her pieces lay on her here: a crust of dust, or what she has given off, in front
        let piece = 0;
        let pieceFor = 0;
        let covered = false;
        if (pieces && plain) {
          const hit = pieceAt(expr, grid, ci, v, t, restR, f.scale);
          v = hit.v;
          piece = hit.kind;
          pieceFor = hit.hold;
          covered = hit.covers;
        }
        if (plain) {
          // per-cell brightness response breaks concentric rings; multiplicative, so empty (0) stays
          // empty. Narrow on purpose: a wider spread sends more cells to the top rung and more to
          // nothing, which is most of what reads as heavy.
          v *= 0.66 + cell.grain * 0.72;
          // slowly drifting noise on top
          v *=
            0.8 +
            hash(
              Math.floor(cell.dx * 0.05 + t * 0.5),
              Math.floor(cell.dy * 0.05 - t * 0.3),
            ) *
              0.4;

          if (
            v > 0.3 &&
            hash(Math.floor(t * 1.6) * 31.7, cell.seed * 613) > 0.992
          ) {
            v = Math.max(v, 0.9);
          }
        }

        // The wash, and the moment a cell holds its set after the wash has left it. The first
        // wash's place is the same on every mount (its noise is fixed), so it is not drawn: she
        // opens on her waking alone, or, waking, the one set for her takes that place. What her
        // pieces lay on her comes in their own set.
        const washed =
          !plain || piece
            ? 0
            : clock < WASH_APART
              ? wake
                ? washOnce(
                    cell.dx,
                    cell.dy,
                    clock,
                    WAKE_WASH,
                    WAKE_WASH_FOR,
                    wake.slot,
                  )
                : 0
              : washAt(cell.dx, cell.dy, clock, WASH_APART, WASH_HOLD);
        if (piece) {
          bk.pool[ci] = PIECE_POOL + piece;
          bk.poolFor[ci] = pieceFor;
        } else if (washed) {
          bk.pool[ci] = washed;
          bk.poolFor[ci] = WASH_LINGER + cell.grain * WASH_LINGER_MORE;
        } else if (bk.poolFor[ci] > 0) {
          bk.poolFor[ci] -= dt;
          if (bk.poolFor[ci] <= 0) bk.pool[ci] = 0;
        } else {
          bk.pool[ci] = 0;
        }

        // An eye is a hole, and it drops its trail rather than fading: a hole that goes out over
        // the tail time reads as neither open nor shut. Turned, it is read on her head where it
        // faces you, and thick dust over it covers it.
        const hole =
          eyesHeld > 0.03 &&
          eyes !== null &&
          plain &&
          !covered &&
          facing(expr, ci, restR) &&
          inEye(
            moved ? expr.hx[ci] : cell.dx,
            moved ? expr.hy[ci] : cell.dy,
            restR,
            eyesHeld,
            eyes,
            EYE_FIT,
          );
        if (hole) {
          bk.fast[ci] = 0;
          bk.slow[ci] = 0;
          bk.pool[ci] = 0;
          continue;
        }

        // the phosphor: brighten at once, fall away on two clocks
        const lit = (bk.fast[ci] =
          v > bk.fast[ci] * fastKeep ? v : bk.fast[ci] * fastKeep);
        const tail = (bk.slow[ci] =
          v > bk.slow[ci] * slowKeep ? v : bk.slow[ci] * slowKeep);
        v = lit > tail * TRAIL_WEIGHT ? lit : tail * TRAIL_WEIGHT;

        if (plain) {
          const gate = cell.gap + Math.sin(t * 0.28 + cell.seed * 6.283) * 0.05;
          if (v < gate) v = 0;
        }

        v = v < 0 ? 0 : v > 1 ? 1 : v;

        const level = (v * (RAMP.length - 1)) | 0;
        if (level === 0) continue;

        // A glyph is kept until the cell's brightness has really moved, plus a slow churn of its
        // own. Re-picking on a fast clock at an unchanged brightness is what reads as television
        // snow rather than as something moving: the eye follows a glyph's identity.
        const slot = (clock * rate + cell.seed * 7) | 0;
        if (
          slot !== bk.turn[ci] ||
          level - bk.wasLevel[ci] >= 2 ||
          bk.wasLevel[ci] - level >= 2
        ) {
          bk.turn[ci] = slot;
          bk.wasLevel[ci] = level;
          bk.pick[ci] = ((cell.seed * 997) | 0) + slot + level;
        }
        const pick = bk.pick[ci];

        const showEmoji =
          cs === "emojiOnly" ||
          (cs === "emoji" && cell.emoji && level >= EMOJI_MIN_LEVEL);

        // A washed cell keeps its brightness and its bucket — only where its glyph comes from
        // changes, so it is drawn at the same weight as everything around it.
        const set = bk.pool[ci] ? SETS[bk.pool[ci] - 1] : null;
        if (showEmoji) {
          const bag = set?.emoji ?? EMOJI_POOL;
          bk.glyph[ci] = bag[((pick % bag.length) + bag.length) % bag.length];
          bk.emoji[level][bk.emojiN[level]++] = ci;
        } else {
          const bag = set ? set.ascii : RAMP[level];
          bk.glyph[ci] = bag[((pick % bag.length) + bag.length) % bag.length];
          bk.ascii[level][bk.asciiN[level]++] = ci;
        }
      }

      // draw bucketed by brightness level
      ctx.clearRect(0, 0, box, box);
      const cells = cellsRef.current;
      const top = RAMP.length - 1;

      // ease the drawn color toward the target each frame
      const col = colorRef.current;
      for (let i = 0; i < 3; i++) {
        col.cur[i] += (col.target[i] - col.cur[i]) * COLOR_EASE;
      }

      // Brightness is alpha, not color: darkening toward black only disappears on a dark background and inverts on a light one
      ctx.fillStyle = `rgb(${col.cur[0] | 0},${col.cur[1] | 0},${col.cur[2] | 0})`;
      for (let lv = 1; lv <= top; lv++) {
        const n = bk.asciiN[lv];
        if (n === 0) continue;
        // even the top level is not fully opaque; alpha 1 on white is solid black dots
        ctx.globalAlpha = ALPHA_TOP * (lv / top);
        const idx = bk.ascii[lv];
        for (let i = 0; i < n; i++) {
          const cell = cells[idx[i]];
          ctx.fillText(bk.glyph[idx[i]], cell.x, cell.y);
        }
      }

      // Emoji keep their own colour, so alpha is all the shading they have, and alpha alone does
      // not shade a shape (ascii.const emojiWeight): drawn alone the dim end is drawn smaller too.
      const alone = cs === "emojiOnly";
      for (let lv = 1; lv <= top; lv++) {
        const n = bk.emojiN[lv];
        if (n === 0) continue;
        ctx.globalAlpha = emojiAlpha(lv, top, alone);
        if (alone) ctx.font = emojiFont(fontSize, lv, top);
        const idx = bk.emoji[lv];
        for (let i = 0; i < n; i++) {
          const cell = cells[idx[i]];
          ctx.fillText(bk.glyph[idx[i]], cell.x, cell.y);
        }
      }
      if (alone) ctx.font = GLYPH_FONT(fontSize);
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // position is the caller's, via className
  return (
    <canvas
      ref={hostRef}
      className={className}
      aria-hidden
      style={{ display: "block", pointerEvents: "none" }}
    />
  );
}
