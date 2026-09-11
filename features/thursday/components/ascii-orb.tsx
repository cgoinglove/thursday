"use client";

import { useEffect, useRef } from "react";
import { ASCII_FACE } from "@/config";
import {
  createVoiceFollower,
  SPECTRUM_BANDS,
} from "@/lib/realtime/realtime.tap";
import {
  ALPHA_TOP,
  CHAR_RATE,
  EMOJI_CHAR_RATE,
  EMOJI_MIN_LEVEL,
  EMOJI_POOL,
  EMOJI_RATIO,
  hash,
  RAMP,
  smoothstep,
} from "../ascii.const";
import type { AsciiCharset } from "../face.const";

export type AsciiOrbMode =
  | "idle"
  | "connecting"
  | "speaking"
  /** Running a tool; alive without speaking */
  | "working"
  | "error";

/** The list lives in face.const so the settings schema can build the enum without importing this component. */
export type AsciiOrbCharset = AsciiCharset;

/** Expressions the orb can wear while speaking. */
export type AsciiOrbEmotion = "happy" | "sad" | "love";

export type AsciiOrbProps = {
  className?: string;
  mode?: AsciiOrbMode;
  /** "emoji" sprinkles emoji in; "emojiOnly" is all emoji */
  charset?: AsciiOrbCharset;
  /** Expression while speaking; null for none */
  emotion?: AsciiOrbEmotion | null;
  /** Glyph size (px) */
  fontSize?: number;
  /** Cell density; above 1 packs tighter */
  density?: number;
  /**
   * Voice bands, low to high, 0..1, read once per frame. Drives the swell while
   * speaking; without it a synthetic waveform keeps the orb alive (previews).
   */
  getSpectrum?: () => ArrayLike<number>;
  /** Side length (px). Everything scales with it; cell count scales with area. */
  size?: number;
  /**
   * Orb color (RGB). Dark cells fade toward transparent, not black, so the
   * shading reads the same on light and dark backgrounds. Changes ease in.
   */
  color?: [number, number, number];
};

/** Peak brightness of the default grey orb */
const DEFAULT_COLOR: [number, number, number] = [235, 235, 235];

/** Color easing per frame (0.05 is about 0.5s) */
const COLOR_EASE = 0.05;

/** ERROR: 4 cells per letter, 1 gap (24 x 5) */
const ERROR_BITMAP = [
  "████ ███  ███   ██  ███ ",
  "█    █  █ █  █ █  █ █  █",
  "███  ███  ███  █  █ ███ ",
  "█    █ █  █ █  █  █ █ █ ",
  "████ █  █ █  █  ██  █  █",
];

/** Expression bitmaps, 21 x 13; the top 7 rows are eyes, the rest mouth. */
const FACE_COLS = 21;
const FACE_ROWS = 13;
const EYE_ROWS = 7;
const FACES: Record<AsciiOrbEmotion, string[]> = {
  happy: [
    ".....................",
    ".....................",
    "....███.......███....",
    "...█████.....█████...",
    "...█████.....█████...",
    "....███.......███....",
    ".....................",
    ".....................",
    "█...................█",
    ".██...............██.",
    "...███.........███...",
    "......█████████......",
    ".....................",
  ],
  sad: [
    ".....................",
    ".....................",
    "....███.......███....",
    "...█████.....█████...",
    "...█████.....█████...",
    "....███.......███....",
    ".....................",
    ".....................",
    "......█████████......",
    "...███.........███...",
    ".██...............██.",
    "█...................█",
    ".....................",
  ],
  love: [
    ".....................",
    "...██.██.....██.██...",
    "..███████...███████..",
    "..███████...███████..",
    "...█████.....█████...",
    "....███.......███....",
    ".....█.........█.....",
    ".....................",
    "█...................█",
    ".██...............██.",
    "...███.........███...",
    "......█████████......",
    ".....................",
  ],
};

/** Expression fade out, blank, fade in (seconds) */
const FACE_OUT = 0.36;
const FACE_BLANK = 0.14;
const FACE_IN = 0.95;
/** Glyph swap rate for face cells (per second), slower than the background */
const FACE_CHAR_RATE = 0.75;

/** Reference size the tuning constants assume; coordinates are normalized to it. */
const DESIGN = 680;
/** Radius (reference units) within which cells exist. Must stay under DESIGN/2 or the canvas clips it. */
const FIELD_R = 328;

/** Speaking: reference-unit px the rim is pushed by each channel. */
/** Where the rim sits while the voice is at the bottom of its range */
const SPEAK_BASE = 184;
/** Swell across a phrase at the top of the voice's range */
const SPEAK_SWELL = 40;
/** Kick per syllable */
const SPEAK_KICK = 120;
/** Rotating lobes, harmonics 2 and up (the first harmonic shifts the whole circle) */
const SPEAK_LOBES = 4;
/** Max depth of one lobe */
const SPEAK_LOBE_R = 34;
/**
 * Rim range. Past SPEAK_KNEE the rim slows into SPEAK_MAX rather than stopping
 * at it, so a loud syllable still reads as a push instead of a flat edge. Max
 * stays inside FIELD_R or thrown crumbs die at the edge; min keeps a deep
 * breath from collapsing to a dot.
 */
const SPEAK_MIN = 130;
const SPEAK_KNEE = 244;
const SPEAK_MAX = 278;
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
  /** The voice inside its own range over about half a second (realtime.tap createVoiceFollower) */
  phrase: number;
  /** Spring kicked by each syllable */
  bob: number;
  bobVel: number;
  /** Lobe strength and angle */
  amp: number[];
  phase: number[];
  /** One throw of crumbs per syllable */
  rings: { born: number; power: number }[];
};

/** Crossfade between modes (s) */
const XFADE = 1.5;
/** Time for a mode to fill in on its own (s) */
const INTRO = XFADE;

/**
 * Idle radius. The max drawable radius is DESIGN/2, so this sets the budget
 * for SPEAK_MAX and the rings above it. The visible body is about half, since
 * the idle wave fades from 0.55 x IDLE_R.
 */
const IDLE_R = 190;

/** Connecting: radius and width of the band that spreads and holds */
const CONNECT_R = 235;
const CONNECT_BAND = 6000;

/** Working: a comet orbiting just outside the idle circle */
const WORK_R = 238;
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

type Cell = {
  /** Draw position on the canvas */
  x: number;
  y: number;
  /** Position in reference units */
  dx: number;
  dy: number;
  dist: number;
  angle: number;
  /** Per-cell random (0..1) */
  seed: number;
  /** Per-cell brightness response (0..1); without it cells at equal distance fall into the same step and form rings */
  grain: number;
  /** Below this brightness the cell is empty; random gaps */
  gap: number;
  /** Order this cell lights up when an expression appears (0..1) */
  birth: number;
  /** Order this cell goes out when an expression leaves; differs from birth */
  death: number;
  /** Emoji slot in emoji mode */
  emoji: boolean;
  /** Below SPECK_SHARE, a crumb a syllable throws outward */
  speck: number;
  /** Index of the ERROR letter this cell belongs to, or -1 */
  letter: number;
};

/** Index of the ERROR letter at (dx,dy), or -1 */
function errorLetterAt(
  dx: number,
  dy: number,
  cw: number,
  ch: number,
  s: number,
) {
  const rows = ERROR_BITMAP.length;
  const cols = ERROR_BITMAP[0].length;
  const bx = Math.floor(dx / (cw * s) + cols / 2);
  const by = Math.floor(dy / (ch * s) + rows / 2);

  if (by < 0 || by >= rows) return -1;
  const line = ERROR_BITMAP[by];
  if (bx < 0 || bx >= line.length) return -1;
  if (line[bx] !== "█") return -1;
  return Math.floor(bx / 5);
}

/** Expression sample: 0 none, 1 eye, 2 mouth */
function faceSample(
  em: AsciiOrbEmotion,
  dx: number,
  dy: number,
  cw: number,
  ch: number,
  s: number,
) {
  const bx = Math.floor(dx / (cw * s) + FACE_COLS / 2);
  const by = Math.floor(dy / (ch * s) + FACE_ROWS / 2);
  if (by < 0 || by >= FACE_ROWS || bx < 0 || bx >= FACE_COLS) return 0;
  if (FACES[em][by][bx] !== "█") return 0;
  return by < EYE_ROWS ? 1 : 2;
}

/** Idle: a soft breathing wave inside a small circle */
function idleValue(cell: Cell, t: number) {
  const body = 1 - smoothstep(IDLE_R * 0.55, IDLE_R, cell.dist);
  const w = Math.sin(cell.dist * 0.05 - t * 0.4);
  const breath = Math.sin(t * 0.35) * 0.07;
  return (0.58 + w * 0.2 + breath) * body;
}

/** The rim's radius for a raw push: as pushed up to SPEAK_KNEE, then easing into SPEAK_MAX. */
function rimAt(raw: number) {
  if (raw <= SPEAK_KNEE) return Math.max(SPEAK_MIN, raw);
  const room = SPEAK_MAX - SPEAK_KNEE;
  return SPEAK_KNEE + room * Math.tanh((raw - SPEAK_KNEE) / room);
}

/**
 * Brightness of one mode; mode transitions blend two of these.
 * @param e seconds since the mode started
 */
function valueFor(m: AsciiOrbMode, cell: Cell, t: number, e: number, v: Voice) {
  switch (m) {
    case "idle":
      return idleValue(cell, t) * smoothstep(0, 1, Math.min(1, e / INTRO));

    // ring spreads outward while the idle circle clears
    case "connecting": {
      const k = smoothstep(0, 1, Math.min(1, e / 1.8));
      // spread far enough to reach the outer debris
      const d = cell.dist - CONNECT_R * k;
      // a wide, soft band so no crisp donut edge forms
      const band = Math.exp(-(d * d) / CONNECT_BAND);
      // scatter intensity per cell by distance and angle so no inside/outside gradient forms
      const grain =
        0.2 +
        hash(Math.floor(cell.dist / 9), Math.floor(cell.angle * 11)) * 0.85 +
        hash(cell.seed * 137, 7) * 0.5;
      const ring = band * grain * k;
      return ring + idleValue(cell, t) * (1 - k);
    }

    /**
     * Speaking. Frequency is not mapped to angle: a voice's spectrum barely
     * moves within a sentence, so that freezes into a fixed star. The voice
     * gives size, syllables and lobe strength; rotation comes from time, each
     * lobe at its own speed in alternating directions. No line in it is clean:
     * the rim is crumbly, and a syllable throws crumbs rather than a ring.
     */
    case "speaking": {
      const grow = smoothstep(0, 1, Math.min(1, e / 0.8));

      let raw =
        IDLE_R +
        (SPEAK_BASE - IDLE_R + SPEAK_SWELL * v.phrase + SPEAK_KICK * v.bob) *
          grow;
      for (let i = 0; i < SPEAK_LOBES; i++) {
        raw +=
          SPEAK_LOBE_R *
          v.amp[i] *
          Math.sin((i + 2) * cell.angle + v.phase[i]) *
          grow;
      }
      const edge = rimAt(raw);

      // each cell sits a little in or out of the rim, and the offset drifts
      const rough =
        (cell.grain - 0.5) * SPEAK_ROUGH +
        Math.sin(cell.angle * 5 + t * 0.9 + cell.seed * 6.283) *
          SPEAK_ROUGH *
          0.3;
      const d = cell.dist - (edge + rough);
      const rim = Math.exp(-(d * d) / 800);
      const core = Math.exp(-(cell.dist * cell.dist) / 6000) * 0.5;
      // a soft fill toward the center, with the idle wave still moving through it
      const inside =
        cell.dist < edge
          ? 0.3 *
            (1 - cell.dist / edge) ** 0.6 *
            (0.75 + 0.25 * Math.sin(cell.dist * 0.05 - t * 1.2))
          : 0;

      // crumbs: a sparse share of cells, each thrown past the rim at its own speed
      let out = 0;
      if (cell.speck < SPECK_SHARE) {
        const speed = RING_SPEED * (0.6 + cell.grain * 0.9);
        for (let i = 0; i < v.rings.length; i++) {
          const ring = v.rings[i];
          const age = t - ring.born;
          const dd = cell.dist - (edge + 6 + age * speed);
          out +=
            Math.exp(-(dd * dd) / 500) *
            ring.power *
            Math.max(0, 1 - age / RING_LIFE);
        }
      }

      return rim + core + inside + out;
    }

    /**
     * Working: the idle circle stays and a comet orbits outside it. Ignores
     * the voice and never ends.
     */
    case "working": {
      const k = smoothstep(0, 1, Math.min(1, e / 0.7));

      // orbit: a thin band at a fixed radius
      const d = cell.dist - WORK_R;
      const band = Math.exp(-(d * d) / WORK_BAND);

      // sharp head, long tail
      const raw = cell.angle - t * WORK_SPIN;
      const da = Math.atan2(Math.sin(raw), Math.cos(raw));
      const comet = Math.exp(-(da * da) / (da < 0 ? WORK_TAIL : WORK_HEAD));

      // the center stays empty; a single orbit reads as "working"
      return band * comet * k + idleValue(cell, t) * (1 - k);
    }

    case "error": {
      if (cell.letter < 0) return 0;

      const pe = e % ERR_CYCLE;
      const li = cell.letter;
      const jitter = cell.seed * 0.12;

      const appear = smoothstep(
        0,
        1,
        (pe - li * ERR_STEP_IN - jitter) / ERR_FADE_IN,
      );
      const vanish = smoothstep(
        0,
        1,
        (pe - ERR_HOLD_UNTIL - li * ERR_STEP_OUT - jitter) / ERR_FADE_OUT,
      );
      const on = Math.max(0, appear - vanish);
      const flick = 0.86 + Math.sin(t * 3.5 + cell.seed * 6) * 0.14;
      return on * flick;
    }
  }
}

export function AsciiOrb({
  className,
  mode = "idle",
  charset = ASCII_FACE.charset,
  emotion = null,
  fontSize = ASCII_FACE.fontSize.default,
  density = ASCII_FACE.density.default,
  size = DESIGN,
  color = DEFAULT_COLOR,
  getSpectrum,
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
  } | null>(null);
  const charsetRef = useRef(charset);
  /** cur is the color on screen, target the one it eases toward */
  const colorRef = useRef({
    cur: [...color] as [number, number, number],
    target: color,
  });
  /** Cell pitch and bitmap scale; follow the size knob */
  const metricsRef = useRef({
    cw: 1,
    ch: 1,
    errScale: 3,
    faceScale: 3,
    size: 0,
  });

  const emoRef = useRef<{
    cur: AsciiOrbEmotion | null;
    prev: AsciiOrbEmotion | null;
    start: number;
  }>({ cur: emotion, prev: null, start: -Infinity });

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
    rings: [],
  });

  const curRef = useRef({ mode, start: 0 });
  const prevRef = useRef<{ mode: AsciiOrbMode; start: number } | null>(null);
  const xfadeStartRef = useRef(-Infinity);

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
    // scale ERROR and the faces so they stay inside the box at any glyph size
    const errScale = Math.max(
      1,
      Math.floor((DESIGN * 0.92) / (ERROR_BITMAP[0].length * cwN)),
    );
    const faceScale = Math.max(
      1,
      Math.floor((DESIGN * 0.82) / (FACE_COLS * cwN)),
    );
    metricsRef.current = { cw: cwN, ch: chN, errScale, faceScale, size };

    const cells: Cell[] = [];
    const cols = Math.ceil(size / cw);
    const rows = Math.ceil(size / ch);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const y = r * ch;
        // all positioning is in reference units
        const dx = (x - size / 2) * norm;
        const dy = (y - size / 2) * norm;
        const dist = Math.hypot(dx, dy);

        const letter = errorLetterAt(dx, dy, cwN, chN, errScale);
        if (letter < 0 && dist > FIELD_R) continue;

        cells.push({
          // glyphs sit at the cell center, in actual px
          x: x + cw / 2,
          y: y + ch / 2,
          dx,
          dy,
          dist,
          angle: Math.atan2(dy, dx),
          seed: hash(c, r),
          grain: hash(c * 5.7 + 19, r * 2.3 + 53),
          gap: 0.05 + hash(c * 7.3 + 11, r * 3.1 + 5) * 0.3,
          // independent order per cell, so cells appear one at a time rather than in clumps
          birth: hash(c * 3.1 + 7, r * 5.7 + 2),
          death: hash(c * 9.4 + 3, r * 2.6 + 8),
          emoji: hash(c * 2.7 + 31, r * 5.9 + 17) < EMOJI_RATIO,
          speck: hash(c * 4.1 + 23, r * 6.3 + 41),
          letter,
        });
      }
    }

    cellsRef.current = cells;

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
      ctx.font = `700 ${fontSize}px ui-monospace,SFMono-Regular,Menlo,monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctxRef.current = ctx;
    }

    return () => {
      ctx?.clearRect(0, 0, size, size);
      cellsRef.current = [];
      bucketsRef.current = null;
    };
  }, [fontSize, density, size]);

  // expression change: old one leaves, brief blank, new one appears
  useEffect(() => {
    const e = emoRef.current;
    if (e.cur === emotion) return;
    emoRef.current = {
      cur: emotion,
      prev: e.cur,
      start: performance.now() * 0.001,
    };
  }, [emotion]);

  // every frame redraws everything, so the charset only needs a ref update
  useEffect(() => {
    charsetRef.current = charset;
  }, [charset]);

  // color: only the target changes; the drawn color eases toward it
  useEffect(() => {
    colorRef.current.target = color;
  }, [color]);

  // mode change: remember the previous mode and start a crossfade
  useEffect(() => {
    const now = performance.now() * 0.001;
    if (curRef.current.mode !== mode) {
      prevRef.current = { ...curRef.current };
      curRef.current = { mode, start: now };
      xfadeStartRef.current = now;
    } else {
      curRef.current = { mode, start: now };
    }
  }, [mode]);

  // animation loop
  useEffect(() => {
    let raf = 0;
    const follower = createVoiceFollower();
    const murmur = new Array<number>(SPECTRUM_BANDS).fill(0);

    let lastT = performance.now() * 0.001;

    const draw = (nowMs: number) => {
      const t = nowMs * 0.001;
      // a backgrounded tab can deliver seconds in one frame; clamp so phases do not jump
      const dt = Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;
      const ctx = ctxRef.current;
      const bk = bucketsRef.current;
      if (!ctx || !bk) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const cs = charsetRef.current;
      const { cw, ch, faceScale, size: box } = metricsRef.current;
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
        voice.phase[i] += dt * (0.5 + i * 0.37) * (i % 2 ? -1 : 1);
      }

      while (voice.rings.length > 0 && t - voice.rings[0].born > RING_LIFE) {
        voice.rings.shift();
      }

      const cur = curRef.current;
      const prev = prevRef.current;
      const k = smoothstep(
        0,
        1,
        Math.min(1, (t - xfadeStartRef.current) / XFADE),
      );
      const blending = prev !== null && k < 1;
      const keepGlyphSolid =
        cur.mode === "error" || (blending && prev?.mode === "error");

      // expression state
      const emo = emoRef.current;
      const ep = t - emo.start;
      // old one leaves cell by cell, blank, new one appears cell by cell
      const rawOut = Math.min(1, Math.max(0, ep / FACE_OUT));
      const rawIn = Math.min(
        1,
        Math.max(0, (ep - FACE_OUT - FACE_BLANK) / FACE_IN),
      );
      const faceBusy = emo.cur !== null || ep < FACE_OUT + FACE_BLANK + FACE_IN;
      const faceKind = (em: AsciiOrbEmotion, cell: Cell) =>
        faceSample(em, cell.dx, cell.dy, cw, ch, faceScale);
      /** Brightness from an already sampled eye/mouth kind */
      const faceValue = (s: number, cell: Cell) => {
        if (s === 0) return 0;
        // brighter in the middle, slightly darker outward
        const shade = 0.74 + 0.26 * (1 - Math.min(1, cell.dist / 270));
        // slowly drifting holes; darkened cells fall under the gap threshold so the face is not a solid slab
        const holes =
          0.42 +
          hash(
            Math.floor(cell.dx * 0.09 + t * 0.25),
            Math.floor(cell.dy * 0.09 - t * 0.18),
          ) *
            0.85;
        return (s === 1 ? 1 : 0.88) * shade * holes;
      };

      /** A few specks of dust around the face, like idle */
      const faceDust = (cell: Cell) => {
        if (cell.seed < 0.976) return 0;
        // each speck floats at its own distance so they do not line up in a band
        const r = 195 + hash(cell.seed * 311, 9) * 160;
        const fall = Math.exp(-((cell.dist - r) ** 2) / 7000);
        // own blink rate and phase
        const sp = 0.5 + hash(cell.seed * 47, 21) * 1.5;
        return fall * (0.5 + 0.5 * Math.sin(t * sp + cell.seed * 300)) * 0.36;
      };

      const all = cellsRef.current;
      for (let ci = 0; ci < all.length; ci++) {
        const cell = all[ci];
        let v = valueFor(cur.mode, cell, t, t - cur.start, voice);

        if (blending && prev) {
          const pv = valueFor(prev.mode, cell, t, t - prev.start, voice);
          v = pv + (v - pv) * k;
        }

        if (!(keepGlyphSolid && cell.letter >= 0)) {
          // per-cell brightness response breaks concentric rings; multiplicative, so empty (0) stays empty
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

          const gate = cell.gap + Math.sin(t * 0.28 + cell.seed * 6.283) * 0.05;
          if (v < gate) v = 0;
        }

        // With an expression set, the whole field switches to it once the
        // previous content (blob or old face) is fully gone
        let solid = false;
        if (faceBusy) {
          // per-cell order with a narrow window: cells snap on and off rather than fade
          const gone = smoothstep(0, 1, (rawOut * 1.1 - cell.death) / 0.08);
          const born = smoothstep(0, 1, (rawIn * 1.1 - cell.birth) / 0.08);

          // sample the bitmap once per expression
          const kCur = emo.cur ? faceKind(emo.cur, cell) : 0;
          const kPrev = emo.prev ? faceKind(emo.prev, cell) : 0;

          const dust = faceDust(cell);
          const oldV = emo.prev ? faceValue(kPrev, cell) + dust : v;
          const newV = emo.cur ? faceValue(kCur, cell) + dust : v;

          v = oldV * (1 - gone) + newV * born;
          solid = (kCur > 0 && born > 0.05) || (kPrev > 0 && gone < 0.95);
        }

        v = v < 0 ? 0 : v > 1 ? 1 : v;

        const level = (v * (RAMP.length - 1)) | 0;
        if (level === 0) continue;

        // face cells swap glyphs slowly, or the shape drowns in noise
        const rate = solid
          ? FACE_CHAR_RATE
          : cs === "emojiOnly"
            ? EMOJI_CHAR_RATE
            : CHAR_RATE;
        const slot = (t * rate + cell.seed * 7) | 0;

        const showEmoji =
          cs === "emojiOnly" ||
          (cs === "emoji" && cell.emoji && level >= EMOJI_MIN_LEVEL);

        if (showEmoji) {
          const i =
            (((cell.seed * EMOJI_POOL.length) | 0) + slot) % EMOJI_POOL.length;
          bk.glyph[ci] = EMOJI_POOL[i];
          bk.emoji[level][bk.emojiN[level]++] = ci;
        } else {
          const variants = RAMP[level];
          const i =
            (((cell.seed * variants.length) | 0) + slot) % variants.length;
          bk.glyph[ci] = variants[i];
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

      // emoji keep their own color, so only alpha varies
      for (let lv = 1; lv <= top; lv++) {
        const n = bk.emojiN[lv];
        if (n === 0) continue;
        ctx.globalAlpha = 0.35 + (lv / top) * 0.65;
        const idx = bk.emoji[lv];
        for (let i = 0; i < n; i++) {
          const cell = cells[idx[i]];
          ctx.fillText(bk.glyph[idx[i]], cell.x, cell.y);
        }
      }
      ctx.globalAlpha = 1;

      if (!blending && prev) prevRef.current = null;

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
