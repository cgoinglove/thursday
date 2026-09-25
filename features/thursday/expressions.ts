// Her expressions: how she wakes each time her eyes open, and the one thing she does before she
// shuts them again. One file, because the whole feature is here — the pieces, the deck that deals
// them, the pose they put her head in, what she gives off while she does them, and the test her
// renderer asks per cell — and it comes out again by deleting this and the lines in ascii-orb that
// call it.
//
// A piece is a pose over time: where her head is, how it leans, turns, nods and stretches, what her
// lids do, and for some, what else happens — her smoke held back, a crust of dust on her, dust and
// smoke given off. Nothing is drawn on her that is not her: what she gives off is laid on her own
// cells, in front of her. A turn, a nod or a spin is read on a ball, so her grain and her eyes go
// round her face — and behind it — while her outline stays round.
//
// Every opening of her eyes is one version: a way to wake and a feeling, dealt from a shuffled deck
// of every pair, so each comes once before any comes twice, and never the same wake twice running.
// Every number here is the drawing, tuned by eye on the face itself. No "use client": pure
// functions and one piece of state per face.

import { smoothstep } from "./ascii.const";
import type { EyeState } from "./eyes";
import { fbm, vnoise } from "./field";

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Up over the first three tenths of a..b, down over the last three. */
const bump = (u: number, a: number, b: number) =>
  smoothstep(a, a + (b - a) * 0.3, u) *
  (1 - smoothstep(b - (b - a) * 0.3, b, u));

/** Her head's pose, as the pieces lay it. */
type Pose = {
  /** Where her head is, as shares of her radius, and how it leans (rad). */
  x: number;
  y: number;
  rot: number;
  /** A turn, a nod, and a spin about an axis `axis` off upright (rad), all read on a ball. */
  yaw: number;
  pitch: number;
  spin: number;
  axis: number;
  /** How she is stretched. */
  sx: number;
  sy: number;
  /** Each lid (1 open), how large her eyes are, and where they look, as shares of her radius. */
  lidL: number;
  lidR: number;
  size: number;
  gx: number;
  gy: number;
};

const POSE0: Pose = {
  x: 0,
  y: 0,
  rot: 0,
  yaw: 0,
  pitch: 0,
  spin: 0,
  axis: 0,
  sx: 1,
  sy: 1,
  lidL: 1,
  lidR: 1,
  size: 1,
  gx: 0,
  gy: 0,
};

/**
 * What the pieces do besides her pose, written fresh every frame: `hush` holds her smoke back, and
 * `crust` is the dust she wakes under.
 */
type Doing = { hush: number; crust: number };

/** What she gives off is one of these, and is drawn in the matching set of PIECE_SETS. */
const SMOKE = 1;
const DUST = 2;

/**
 * The glyphs of what she gives off, in the wash's shape (wash.ts): a breath of smoke, and dust. Dust
 * has no emoji of its own (null) — it is her own, thinned out, since a colour of its own read as
 * paint.
 */
export const PIECE_SETS: readonly {
  letters: readonly string[];
  emoji: readonly string[] | null;
}[] = [
  {
    letters: ["~", "s", "S", "§", "~", "∫", "s", "≈", "S", "~"],
    emoji: ["💨", "☁️", "🌫️", "💨", "☁️", "🫧", "💭", "💨", "☁️", "🌫️"],
  },
  { letters: ["*", ":", "'", ".", "*", ",", ":", "`", "*", ";"], emoji: null },
];

/** While her eyes are up her head is never quite still: a slow turn this far either way (rad). */
const DRIFT_YAW = 0.08;
/** Her smoke follows her head this late (s). */
const SMOKE_LAG = 0.12;
/**
 * With nothing to do her head comes back slowly (HEAD_SETTLE, a time constant in seconds), so a
 * head sunk into sleep settles rather than springs; cut short by something else taking the face,
 * it comes back quicker (HEAD_CUT), along with the rest of her.
 */
const HEAD_SETTLE = 0.6;
const HEAD_CUT = 0.3;

/**
 * Waking under dust: a crust over her face (CRUST_*), and a few hard shakes of her head, smaller
 * each time (SHAKE_*), that throw it off. Dust leaves the way a rug's does: each time her head
 * stops at the end of a swing, what was on the side that was leading keeps going — a lump of it
 * flies off that way, out past her, swelling, slowing and sinking, with a few heavy bits that drop
 * — and that much of the crust is gone (the first throw the most). A few specks come off wherever
 * the crust has just gone (SHED_RATE), carried with the speed her face had there (FLING, at most
 * FLING_MAX). Its tone follows how thick it is (DUST_MAX, DUST_FILL): specks where it is thin, a
 * middle weight where it is thickest, never her heaviest glyphs — pinned at one tone, a cloud of
 * it has no light and dark in it.
 */
const CRUST_GRAIN = 0.022;
const CRUST_TONE = 0.42;
const SHED_RATE = 0.06;
const DUST_MAX = 0.5;
const DUST_FILL = 1.5;
const SHAKE = 0.55;
const SHAKE_HZ = 2.5;
const SHAKE_DECAY = 0.55;
const SHAKE_THROWS = 5;
const FLING = 0.55;
const FLING_MAX = 260;
const THROW_SHARE = (() => {
  let sum = 0;
  for (let k = 0; k < SHAKE_THROWS; k++) sum += Math.exp(-k / 1.6);
  return Array.from(
    { length: SHAKE_THROWS },
    (_, k) => Math.exp(-k / 1.6) / sum,
  );
})();

/** The slant her head goes round on in a spin, off upright (rad). */
const SPIN_AXIS = 0.62;

/**
 * The long breath out: how fast it leaves her, puffs a second at its hardest, and how big a puff
 * grows (reference units). Her space is round, and its edge is VAPE_WALL of the field: what reaches
 * it turns and runs along it (pushed on at VAPE_RUN, fading), each puff for a while of its own
 * (VAPE_PEEL, seconds) before it rolls inward to a place of its own anywhere from her middle to the
 * edge, pulled there VAPE_IN hard — so the whole round fills, not a ring round her or a pool below.
 */
const VAPE_SPEED = 165;
const VAPE_RATE = 110;
const VAPE_GROW = 96;
const VAPE_WALL = 0.88;
const VAPE_RUN = 120;
const VAPE_PEEL = [0.1, 1.2] as const;
const VAPE_IN = 1.2;

/** How many puffs she can have out at once, so a long breath cannot run away with a frame. */
const PARTS_MAX = 2200;

/** Something she gives off (partsStep moves it and lays it on her cells). */
type Part = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** How thick it is, and how it thins as it goes (a power of how far through its life it is). */
  a: number;
  fadeP: number;
  /** It swells from r0 to r1, most of the way by `grow` seconds. */
  r0: number;
  r1: number;
  grow: number;
  /** How much of its speed it keeps a second; how it sinks, and how it rises once riseT has passed. */
  keep: number;
  fall: number;
  rise: number;
  riseT: number;
  /** How hard the air curls it, and how much it spreads out sideways as it goes. */
  curl: number;
  splay: number;
  kind: number;
  /** How long a cell it passed over keeps its glyphs (s). */
  hold: number;
  seed: number;
  /** A breath knows the edge of her space (0 for none), its own place in it, and when it goes there. */
  wall: number;
  home: number;
  peel: number;
  side: number;
  hitAt: number;
  peeled: boolean;
};

/** Her cells as her renderer lays them, and which cell is at each place of the grid. */
export type Grid = {
  cells: readonly {
    dx: number;
    dy: number;
    dist: number;
    cos: number;
    sin: number;
    grain: number;
  }[];
  cols: number;
  rows: number;
  /** One grid step across and down, in reference units. */
  cw: number;
  ch: number;
  /** How far from her centre the grid's first column and row are, in reference units. */
  half: number;
  /** The cell at column c, row r is at[r * cols + c]; -1 where there is none. */
  at: Int32Array;
  /** The radius within which she has cells at all. */
  field: number;
};

type PlanItem = {
  key: PieceKey;
  /** Seconds after her lids part that it starts. */
  at: number;
  /** Mirrored, left for right. */
  m: boolean;
  /** How many throws of dust it has made, and puffs it owes. */
  thrown: number;
  owed: number;
};

/** One opening of her eyes: the pieces, and how long her eyes stay up (s). */
export type Plan = { items: PlanItem[]; open: number };

type Piece = {
  /** She wakes with it: it starts before her lids part, and it is dealt first. */
  wake?: boolean;
  /** She lets out the waking sigh (smoke.ts) as her lids part. */
  sighs?: boolean;
  /** How long it runs (s). */
  len: number;
  /** Its last pose is kept while her eyes close. */
  hold?: boolean;
  pose(u: number, m: boolean): Pose;
  fx?(
    u: number,
    m: boolean,
    o: Doing,
    e: Expression,
    grid: Grid,
    item: PlanItem,
    dt: number,
    R: number,
  ): void;
};

const PIECES = {
  // the sigh of smoke she has always woken with
  now: { wake: true, sighs: true, len: 0, pose: () => POSE0 },

  // her eyes crack open under a crust of dust, a few hard shakes throw it off, and she is wide awake
  dust: {
    wake: true,
    len: 2.4,
    pose(u, m) {
      const s = m ? -1 : 1;
      const a =
        SHAKE *
        smoothstep(0.16, 0.3, u) *
        Math.exp(-Math.max(0, u - 0.3) / SHAKE_DECAY);
      const ph = TAU * SHAKE_HZ * (u - 0.2);
      const lid =
        0.3 + 0.2 * smoothstep(0.05, 0.25, u) + 0.5 * smoothstep(1.35, 1.75, u);
      const wide = bump(u, 1.45, 2.4);
      return {
        ...POSE0,
        yaw: s * a * Math.sin(ph),
        x: s * 0.035 * a * Math.sin(ph - 0.5),
        rot: s * 0.03 * a * Math.sin(ph + 0.9),
        y: -0.02 * wide,
        lidL: lid,
        lidR: lid,
        size: 1 + 0.06 * wide,
      };
    },
    fx(u, m, o, e, _grid, item, _dt, R) {
      const s = m ? -1 : 1;
      // the ends of the swings: her head stops there, and what it was carrying does not
      let left = 1;
      for (let k = 0; k < SHAKE_THROWS; k++) {
        const at = 0.2 + (0.25 + 0.5 * k) / SHAKE_HZ;
        left -= THROW_SHARE[k] * smoothstep(at - 0.03, at + 0.1, u);
        if (u >= at && item.thrown <= k) {
          item.thrown = k + 1;
          throwDust(e, s * (k % 2 ? -1 : 1), THROW_SHARE[k], R);
        }
      }
      o.crust = Math.max(
        o.crust,
        u < 0 ? smoothstep(-0.8, -0.3, u) : Math.max(0, left),
      );
    },
  },

  // she has her back to you, and comes round to face you as she wakes: her eyes come round the
  // side of her already opening. Her head turns, not the smoke round her: wound round with her, the
  // whole field swirled, and it read as the space turning rather than her
  turn: {
    wake: true,
    len: 1.8,
    pose(u, m) {
      const s = m ? -1 : 1;
      const turn = TAU * smoothstep(-0.6, 0.95, u);
      const settle =
        u > 0.95 ? -0.1 * Math.sin(Math.min(1, (u - 0.95) / 0.6) * Math.PI) : 0;
      const lid = smoothstep(0, 0.3, u);
      return {
        ...POSE0,
        spin: s * (turn + settle),
        axis: s * 0.22,
        y: -0.02 * bump(u, 0.5, 1.6),
        lidL: lid,
        lidR: lid,
      };
    },
  },

  // a long pull — her smoke drawn in, her eyes half shut, her head back a little — let out slowly,
  // a great deal of it: a thick cloud poured down from under her face that rolls out along the
  // round edge of her space, up both sides, and fills it, hanging a long while
  vape: {
    len: 6.6,
    pose(u) {
      const pull = bump(u, 0.2, 1.7);
      const out = smoothstep(1.7, 2.3, u) * (1 - smoothstep(5.2, 6.4, u));
      const lid = 1 - 0.35 * pull - 0.42 * out;
      return {
        ...POSE0,
        pitch: 0.12 * pull - 0.08 * out,
        y: -0.02 * pull + 0.015 * out,
        sx: 1 + 0.03 * pull,
        sy: 1 + 0.03 * pull,
        lidL: lid,
        lidR: lid,
      };
    },
    fx(u, _m, o, e, grid, item, dt, R) {
      if (u < 0 || u > 6.8) return;
      o.hush = Math.max(o.hush, 0.8 * bump(u, 0.2, 2));
      const blow =
        u > 1.8 && u < 5.4
          ? smoothstep(1.8, 2.2, u) *
            (0.4 + 0.6 * Math.exp(-(u - 1.8) / 1.6)) *
            (1 - smoothstep(4.5, 5.4, u))
          : 0;
      if (blow > 0) breatheOut(e, grid, item, blow, dt, R);
    },
  },

  // she looks one way and the other, her head turning with her eyes
  look: {
    len: 2.8,
    pose(u, m) {
      const s = m ? -1 : 1;
      const l = bump(u, 0.45, 1.35);
      const r = bump(u, 1.45, 2.45);
      return {
        ...POSE0,
        yaw: s * (-0.42 * l + 0.42 * r),
        gx: s * (-0.08 * l + 0.08 * r),
        x: s * (-0.03 * l + 0.03 * r),
        rot: s * (-0.03 * l + 0.03 * r),
      };
    },
  },

  // one eye, and her head leans with it
  wink: {
    len: 2,
    pose(u, m) {
      const w = bump(u, 0.8, 1.35);
      const lean = 0.08 * bump(u, 0.7, 1.55);
      return m
        ? { ...POSE0, lidL: 1 - w, rot: -lean }
        : { ...POSE0, lidR: 1 - w, rot: lean };
    },
  },

  // her lids grow heavy and her head sinks, she catches herself once, and gives in; `hold` keeps
  // her sunk while her eyes close, so her head never springs back before she sleeps
  sleepy: {
    len: 3.2,
    hold: true,
    pose(u) {
      const nod = bump(u, 1.5, 1.95);
      const heavy =
        0.8 * smoothstep(0.1, 1.5, u) * (1 - 0.8 * nod) +
        0.2 * smoothstep(1.95, 3.1, u);
      const lid = 1 - 0.7 * heavy;
      return {
        ...POSE0,
        y: 0.07 * heavy,
        rot: 0.1 * heavy,
        gy: 0.05 * heavy,
        lidL: lid,
        lidR: lid,
      };
    },
  },

  // a wind-up, then her whole head goes round once on a slant — her face goes over and behind and
  // comes back up the other side — and she comes out of it dizzy
  spin: {
    len: 3,
    pose(u, m) {
      const s = m ? -1 : 1;
      const turn = -0.25 * bump(u, 0, 0.45) + TAU * smoothstep(0.3, 1.75, u);
      const dizzy =
        u > 1.7 ? Math.exp(-(u - 1.7) / 0.55) * smoothstep(1.7, 1.85, u) : 0;
      const w = TAU * 1.5 * (u - 1.7);
      const lid = 1 - 0.3 * dizzy;
      return {
        ...POSE0,
        spin: s * turn,
        axis: s * SPIN_AXIS,
        x: 0.035 * dizzy * Math.sin(w),
        y: 0.022 * dizzy * Math.cos(w),
        rot: 0.07 * dizzy * Math.sin(w + 0.6),
        gx: 0.06 * dizzy * Math.sin(w * 1.3),
        gy: 0.04 * dizzy * Math.cos(w * 1.3),
        lidL: lid,
        lidR: lid,
      };
    },
  },
} satisfies Record<string, Piece>;

type PieceKey = keyof typeof PIECES;
const PIECE: Record<PieceKey, Piece> = PIECES;
const KEYS = Object.keys(PIECES) as PieceKey[];
const WAKES = KEYS.filter((key) => PIECE[key].wake);
const FEELS = KEYS.filter((key) => !PIECE[key].wake);

/** How one face does its expressions: its deck, its pose, and what it has given off. */
export type Expression = {
  /** Versions still to deal, dealt from the end, and the wake dealt last. */
  deck: [PieceKey, PieceKey][];
  lastWake: PieceKey | null;
  /** Her head's pose now, and her smoke's, a beat behind; what the pieces do, as asked and as eased. */
  head: Pose;
  smoke: Pose;
  want: Doing;
  doing: Doing;
  /** Her turn, slowed for her smoke to swing after; how fast her head is turning (rad/s). */
  yawSlow: number;
  yawV: number;
  /** Her head or her smoke is off its plain place this frame; her head is turned (read on the ball). */
  moved: boolean;
  turned: boolean;
  /** Per cell while moved: her head on the ball (hx, hy; hz toward you), in its own plane (px, py, pd), and her smoke (sx, sy). */
  hx: Float32Array;
  hy: Float32Array;
  hz: Float32Array;
  px: Float32Array;
  py: Float32Array;
  pd: Float32Array;
  sx: Float32Array;
  sy: Float32Array;
  /** The crust: how much of it there is, its noise, which cells had it last frame, how many had it. */
  crust: number;
  crustSeed: number;
  crustWas: Uint8Array;
  crusted: number;
  crustedNow: number;
  /** What she has given off, and per cell how thick it is there, the thickest puff's, its kind, and how long the cell keeps it. */
  parts: Part[];
  live: boolean;
  /** How much of her is resting this frame (0..1): what she has given off is as thick as that. */
  calm: number;
  thick: Float32Array;
  top: Float32Array;
  kind: Int8Array;
  keep: Float32Array;
};

export function createExpression(): Expression {
  const none = new Float32Array(0);
  return {
    deck: [],
    lastWake: null,
    head: { ...POSE0 },
    smoke: { ...POSE0 },
    want: { hush: 0, crust: 0 },
    doing: { hush: 0, crust: 0 },
    yawSlow: 0,
    yawV: 0,
    moved: false,
    turned: false,
    hx: none,
    hy: none,
    hz: none,
    px: none,
    py: none,
    pd: none,
    sx: none,
    sy: none,
    crust: 0,
    crustSeed: Math.random() * 40,
    crustWas: new Uint8Array(0),
    crusted: 0,
    crustedNow: 0,
    parts: [],
    live: false,
    calm: 1,
    thick: none,
    top: none,
    kind: new Int8Array(0),
    keep: none,
  };
}

/** Per-cell arrays the size of the grid; a new grid starts them clean, and anything given off with them. */
function fit(e: Expression, n: number) {
  if (e.hx.length === n) return;
  e.hx = new Float32Array(n);
  e.hy = new Float32Array(n);
  e.hz = new Float32Array(n);
  e.px = new Float32Array(n);
  e.py = new Float32Array(n);
  e.pd = new Float32Array(n);
  e.sx = new Float32Array(n);
  e.sy = new Float32Array(n);
  e.crustWas = new Uint8Array(n);
  e.thick = new Float32Array(n);
  e.top = new Float32Array(n);
  e.kind = new Int8Array(n);
  e.keep = new Float32Array(n);
  e.parts.length = 0;
  e.live = false;
}

/**
 * The next version from the deck. A new deck is shuffled until no wake sits next to itself, the
 * last one dealt included; about one shuffle in twenty is, so this ends at once.
 */
function deal(e: Expression): [PieceKey, PieceKey] {
  const deck = e.deck;
  if (!deck.length) {
    for (const wake of WAKES) for (const feel of FEELS) deck.push([wake, feel]);
    for (let tries = 0; tries < 200; tries++) {
      for (let k = deck.length - 1; k > 0; k--) {
        const j = (Math.random() * (k + 1)) | 0;
        [deck[k], deck[j]] = [deck[j], deck[k]];
      }
      let ok = deck[deck.length - 1][0] !== e.lastWake;
      for (let k = 1; ok && k < deck.length; k++)
        ok = deck[k][0] !== deck[k - 1][0];
      if (ok) break;
    }
  }
  const version = deck.pop() ?? [WAKES[0], FEELS[0]];
  e.lastWake = version[0];
  return version;
}

/**
 * The next opening of her eyes: she wakes one way, stays up about `awake` seconds, shows one
 * feeling at the end of it, and goes to sleep with it.
 */
export function planOpening(e: Expression, awake: number): Plan {
  const [wake, feel] = deal(e);
  const up = awake * (0.75 + Math.random() * 0.5);
  const feelAt = Math.max(
    Math.max(PIECE[wake].len, 1.5) + 0.8,
    up - PIECE[feel].len,
  );
  const item = (key: PieceKey, at: number): PlanItem => ({
    key,
    at,
    m: Math.random() < 0.5,
    thrown: 0,
    owed: 0,
  });
  return {
    items: [item(wake, 0), item(feel, feelAt)],
    open: feelAt + PIECE[feel].len + (PIECE[feel].hold ? 0 : 0.8),
  };
}

/** Whether an opening lets out the waking sigh as her lids part. */
export function sighs(plan: Plan | null) {
  return plan !== null && PIECE[plan.items[0].key].sighs === true;
}

/** Head to screen for a pose: the slanted spin, then the turn, then the nod. Row-major. */
function orient(q: Pose) {
  const cy = Math.cos(q.yaw);
  const sy = Math.sin(q.yaw);
  const cp = Math.cos(q.pitch);
  const sp = Math.sin(q.pitch);
  // Ry(yaw) · Rx(pitch): a positive turn takes her face to the right, a positive nod lifts it
  const m = [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
  if (!q.spin) return m;
  // about the axis (ax, ay, 0), Rodrigues
  const ax = Math.sin(q.axis);
  const ay = Math.cos(q.axis);
  const c = Math.cos(q.spin);
  const s = Math.sin(q.spin);
  const k = 1 - c;
  const S = [
    c + ax * ax * k,
    ax * ay * k,
    ay * s,
    ax * ay * k,
    c + ay * ay * k,
    -ax * s,
    -ay * s,
    ax * s,
    c,
  ];
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let col = 0; col < 3; col++)
      out[r * 3 + col] =
        S[r * 3] * m[col] +
        S[r * 3 + 1] * m[3 + col] +
        S[r * 3 + 2] * m[6 + col];
  return out;
}

const ease = (was: number, want: number, tau: number, dt: number) =>
  was + (want - was) * (1 - Math.exp(-dt / tau));

const still = (q: Pose) =>
  Math.abs(q.x) +
    Math.abs(q.y) +
    Math.abs(q.rot) +
    Math.abs(q.yaw) +
    Math.abs(q.pitch) +
    Math.abs(q.spin) +
    Math.abs(q.sx - 1) +
    Math.abs(q.sy - 1) <
  1e-4;

/**
 * Once a frame, before her cells. `plan` is the opening running now (null for none), `u` seconds
 * since her lids started to part (below 0 before), `eyes` the eyes as their script has them, `R`
 * her radius now, and `calm` how much of her is resting: as another mode or a word takes the face,
 * what she has given off thins out with it and is gone, and her head hurries back. Returns the eyes
 * with the pieces' lids, size and gaze on them.
 */
export function stepExpression(
  e: Expression,
  grid: Grid,
  t: number,
  dt: number,
  plan: Plan | null,
  u: number,
  eyes: EyeState | null,
  R: number,
  calm: number,
): EyeState | null {
  fit(e, grid.cells.length);
  e.calm = calm;
  e.crusted = e.crustedNow;
  e.crustedNow = 0;

  let pose = POSE0;
  const o = e.want;
  o.hush = 0;
  o.crust = 0;
  if (plan && u > -1) {
    const p = { ...POSE0 };
    let any = false;
    for (const item of plan.items) {
      const piece = PIECE[item.key];
      const v = u - item.at;
      piece.fx?.(v, item.m, o, e, grid, item, dt, R);
      if (v < (piece.wake ? -0.8 : 0) || (!piece.hold && v > piece.len + 0.6))
        continue;
      const q = piece.pose(v, item.m);
      if (q === POSE0) continue;
      any = true;
      p.x += q.x;
      p.y += q.y;
      p.rot += q.rot;
      p.yaw += q.yaw;
      p.pitch += q.pitch;
      p.spin += q.spin;
      if (q.spin) p.axis = q.axis;
      p.gx += q.gx;
      p.gy += q.gy;
      p.sx *= q.sx;
      p.sy *= q.sy;
      p.lidL *= q.lidL;
      p.lidR *= q.lidR;
      p.size *= q.size;
    }
    if (eyes && u >= 0) {
      p.yaw +=
        DRIFT_YAW *
        (fbm(t * 0.13 + 3.1, 1.7, 0.4, 2) - 0.5) *
        2 *
        smoothstep(0, 1.2, u) *
        clamp01(eyes.lid);
      any = true;
    }
    if (any) pose = p;
  }

  // what the pieces do, eased so nothing snaps
  const d = e.doing;
  d.hush = ease(d.hush, o.hush, 0.15, dt);
  d.crust = ease(d.crust, o.crust, 0.1, dt);
  e.crust = d.crust;

  // her head follows its pose closely, but once nothing is running it comes back slowly, so a head
  // sunk into sleep settles rather than springs; a spin comes back the short way round
  const hp = e.head;
  const wasYaw = hp.yaw;
  const back = pose !== POSE0 ? 0.045 : calm < 0.99 ? HEAD_CUT : HEAD_SETTLE;
  hp.spin =
    pose.spin +
    Math.atan2(Math.sin(hp.spin - pose.spin), Math.cos(hp.spin - pose.spin));
  if (pose.spin) hp.axis = pose.axis;
  hp.x = ease(hp.x, pose.x, back, dt);
  hp.y = ease(hp.y, pose.y, back, dt);
  hp.rot = ease(hp.rot, pose.rot, back, dt);
  hp.yaw = ease(hp.yaw, pose.yaw, back, dt);
  hp.pitch = ease(hp.pitch, pose.pitch, back, dt);
  hp.spin = ease(hp.spin, pose.spin, back, dt);
  hp.sx = ease(hp.sx, pose.sx, back, dt);
  hp.sy = ease(hp.sy, pose.sy, back, dt);
  e.yawV = (hp.yaw - wasYaw) / Math.max(dt, 1e-3);

  // her smoke follows her head a beat late, and swings the way her face went only on a slow turn
  const sp = e.smoke;
  e.yawSlow = ease(e.yawSlow, hp.yaw, 0.3, dt);
  const k = 1 - Math.exp(-dt / SMOKE_LAG);
  sp.x += (hp.x + 0.25 * Math.sin(e.yawSlow) - sp.x) * k;
  sp.y += (hp.y - sp.y) * k;
  sp.rot += (hp.rot - sp.rot) * k;
  sp.sx += (hp.sx - sp.sx) * k;
  sp.sy += (hp.sy - sp.sy) * k;

  e.moved = !(still(hp) && still(sp));
  e.turned = Math.abs(hp.yaw) + Math.abs(hp.pitch) + Math.abs(hp.spin) > 1e-4;
  if (e.moved) lay(e, grid, R);
  partsStep(e, grid, t, dt);

  if (!eyes || pose === POSE0) return eyes;
  return {
    ...eyes,
    gaze: [eyes.gaze[0] + pose.gx, eyes.gaze[1] + pose.gy],
    lids: [pose.lidL, pose.lidR],
    size: pose.size,
  };
}

/**
 * Every cell in her head's frame and her smoke's. Her head: a turn, a nod or a spin is read on a
 * ball — what shows at a point of her face is what the turn brought round to it, from behind her
 * too (hz below 0) — so her eyes and her grain slide round her while her outline (pd, in her own
 * plane) stays round. Her smoke: where her head was a beat ago, leaning as it leaned, never turned.
 */
function lay(e: Expression, grid: Grid, R: number) {
  const cells = grid.cells;
  const hp = e.head;
  {
    const c = Math.cos(hp.rot);
    const s = Math.sin(hp.rot);
    const ox = hp.x * R;
    const oy = hp.y * R;
    const M = e.turned ? orient(hp) : null;
    const R2 = R * R;
    for (let i = 0; i < cells.length; i++) {
      const qx = cells[i].dx - ox;
      const qy = cells[i].dy - oy;
      const lx = (qx * c + qy * s) / hp.sx;
      const ly = (-qx * s + qy * c) / hp.sy;
      e.px[i] = lx;
      e.py[i] = ly;
      e.pd[i] = Math.hypot(lx, ly);
      if (M) {
        const z = Math.sqrt(Math.max(0, R2 - lx * lx - ly * ly));
        e.hx[i] = M[0] * lx + M[3] * ly + M[6] * z;
        e.hy[i] = M[1] * lx + M[4] * ly + M[7] * z;
        e.hz[i] = M[2] * lx + M[5] * ly + M[8] * z;
      } else {
        e.hx[i] = lx;
        e.hy[i] = ly;
        e.hz[i] = 1;
      }
    }
  }
  const sp = e.smoke;
  const c = Math.cos(sp.rot);
  const s = Math.sin(sp.rot);
  const ox = sp.x * R;
  const oy = sp.y * R;
  for (let i = 0; i < cells.length; i++) {
    const qx = cells[i].dx - ox;
    const qy = cells[i].dy - oy;
    e.sx[i] = (qx * c + qy * s) / sp.sx;
    e.sy[i] = (-qx * s + qy * c) / sp.sy;
  }
}

/** Where a point of her head (reference units, her own frame) is on the screen now, turns aside. */
function headPoint(e: Expression, x: number, y: number, R: number) {
  const q = e.head;
  const c = Math.cos(q.rot);
  const s = Math.sin(q.rot);
  const lx = x * q.sx;
  const ly = y * q.sy;
  return [q.x * R + lx * c - ly * s, q.y * R + lx * s + ly * c] as const;
}

function emit(e: Expression, part: Omit<Part, "age" | "seed">) {
  if (e.parts.length >= PARTS_MAX) return;
  e.parts.push({ ...part, age: 0, seed: Math.random() * 60 });
}

const LOOSE = {
  rise: 0,
  riseT: 1,
  splay: 0,
  wall: 0,
  home: 0,
  peel: 0,
  side: 0,
  hitAt: -1,
  peeled: false,
};

/**
 * One throw of dust off her, the way `dir` her head was going: lumps from the half of her face that
 * was leading, flying out past her rim that way — the bigger the throw, the more and the faster —
 * and a few heavy bits that drop.
 */
function throwDust(e: Expression, dir: number, share: number, R: number) {
  const hp = e.head;
  const k = Math.min(1.4, share * 3.2);
  const lumps = 4 + Math.round(6 * k);
  for (let lump = 0; lump < lumps; lump++) {
    // where on her face this lump comes from: the leading half, top to bottom
    const ly = (Math.random() - 0.5) * 1.6 * R;
    const reach = Math.sqrt(Math.max(0, R * R - ly * ly));
    const lx = dir * reach * (0.1 + 0.8 * Math.random());
    const speed = (230 + 170 * Math.random()) * (0.55 + 0.45 * k);
    const up = (Math.random() - 0.6) * 90 + (ly / R) * 50;
    for (let n = 0; n < 7; n++) {
      const sp = speed * (0.75 + 0.5 * Math.random());
      emit(e, {
        ...LOOSE,
        x: hp.x * R + lx + (Math.random() - 0.5) * 24,
        y: hp.y * R + ly + (Math.random() - 0.5) * 24,
        vx: dir * sp,
        vy: up + (Math.random() - 0.5) * 50,
        life: 1.3 + 0.8 * Math.random(),
        a: 0.55 + 0.3 * Math.random(),
        r0: 4,
        r1: 30 + 20 * Math.random(),
        grow: 0.5,
        keep: 0.35,
        fall: 45,
        curl: 40,
        kind: DUST,
        hold: 0,
        fadeP: 1.5,
      });
    }
    for (let n = 0; n < 3; n++) {
      emit(e, {
        ...LOOSE,
        x: hp.x * R + lx,
        y: hp.y * R + ly,
        vx: dir * speed * (0.8 + 0.5 * Math.random()),
        vy: up - 40 * Math.random(),
        life: 0.6 + 0.4 * Math.random(),
        a: 0.9,
        r0: 1.5,
        r1: 2.5,
        grow: 1,
        keep: 0.4,
        fall: 320,
        curl: 0,
        kind: DUST,
        hold: 0,
        fadeP: 1,
      });
    }
  }
}

/**
 * The breath out: thick puffs leaving from under her face, slow and downward, that swell a great
 * deal, sink a while and then rise, curling, and run along the round edge of her space when they
 * reach it; drawn in smoke glyphs, and leaving some of her made of them for a while where they pass
 * over her.
 */
function breatheOut(
  e: Expression,
  grid: Grid,
  item: PlanItem,
  blow: number,
  dt: number,
  R: number,
) {
  const [mx, my] = headPoint(e, 0, 0.55 * R, R);
  const wall = grid.field * VAPE_WALL;
  item.owed += VAPE_RATE * blow * dt;
  while (item.owed >= 1) {
    item.owed -= 1;
    // down, spreading as it goes; it keeps going a long way before it slows, and only much later lifts
    const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const sp = VAPE_SPEED * (0.6 + 0.4 * blow) * (0.7 + 0.6 * Math.random());
    emit(e, {
      x: mx + (Math.random() - 0.5) * 26,
      y: my + (Math.random() - 0.5) * 10,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 5 + 2.5 * Math.random(),
      a: 0.75,
      r0: 10,
      r1: VAPE_GROW * (0.7 + 0.6 * Math.random()),
      grow: 1.6,
      keep: 0.55,
      fall: 10,
      rise: 30,
      riseT: 3.6,
      curl: 85,
      splay: 55,
      wall,
      home: wall * Math.random() ** 0.85 * 0.92,
      peel: VAPE_PEEL[0] + (VAPE_PEEL[1] - VAPE_PEEL[0]) * Math.random(),
      side: 0,
      hitAt: -1,
      peeled: false,
      kind: SMOKE,
      hold: 3,
      fadeP: 2.4,
    });
  }
}

/** A swirl with no source or sink, from one octave of noise — what makes smoke curl. */
const CURL = { x: 0, y: 0 };
function curlAt(x: number, y: number, t: number) {
  const X = x * 0.011;
  const Y = y * 0.011;
  const Z = t * 0.3;
  const h = 0.25;
  CURL.x = (vnoise(X, Y + h, Z) - vnoise(X, Y - h, Z)) / (2 * h);
  CURL.y = -(vnoise(X + h, Y, Z) - vnoise(X - h, Y, Z)) / (2 * h);
}

/**
 * Everything she has given off, one frame: carried, slowed, sunk or lifted, curled, swollen and
 * thinned — and laid on her cells as a thickness that adds up where puffs overlap, never past full.
 */
function partsStep(e: Expression, grid: Grid, t: number, dt: number) {
  const P = e.parts;
  if (!P.length && !e.live) return;
  // gone with her calm, it does not come back when she settles again
  if (e.calm < 0.02) P.length = 0;
  e.thick.fill(0);
  e.top.fill(0);
  e.keep.fill(0);
  let j = 0;
  for (const p of P) {
    p.age += dt;
    if (p.age >= p.life) continue;
    const x0 = p.x;
    const y0 = p.y;
    const keep = p.keep ** dt;
    p.vx *= keep;
    p.vy *= keep;
    p.vy += (p.fall - p.rise * Math.min(1, p.age / p.riseT)) * dt;
    // and some of it spreads out sideways as it goes, the way a thick breath does
    if (p.splay)
      p.vx +=
        (p.vx === 0 ? (p.seed % 2 < 1 ? -1 : 1) : Math.sign(p.vx)) *
        p.splay *
        Math.min(1, p.age / 0.8) *
        dt;
    if (p.wall) edge(p, dt);
    let cx = 0;
    let cy = 0;
    if (p.curl) {
      // young, it goes where it was sent; older, it is the air's
      const cf = p.curl * Math.min(1, p.age / 0.4);
      curlAt(p.x + p.seed * 7, p.y, t);
      cx = CURL.x * cf;
      cy = CURL.y * cf;
    }
    p.x += (p.vx + cx) * dt;
    p.y += (p.vy + cy) * dt;
    const a =
      p.a *
      (1 - (p.age / p.life) ** p.fadeP) *
      smoothstep(0, 0.06, p.age) *
      e.calm;
    const r = p.r0 + (p.r1 - p.r0) * (1 - Math.exp(-p.age / p.grow));
    // laid all along the way it went this frame, so a fast one is a streak and never a hop
    const n = Math.min(
      4,
      Math.max(1, Math.ceil(Math.hypot(p.x - x0, p.y - y0) / 7)),
    );
    for (let s = 1; s <= n; s++)
      splat(
        e,
        grid,
        x0 + ((p.x - x0) * s) / n,
        y0 + ((p.y - y0) * s) / n,
        r,
        a / Math.sqrt(n),
        p.kind,
        p.hold,
      );
    P[j++] = p;
  }
  P.length = j;
  e.live = j > 0;
}

/**
 * Her space is round: a breath that runs into its edge turns and runs along it and keeps going
 * round it — up both sides and over her, where the two streams meet — then, after its run, rolls
 * in to its own place in her space and hardly lifts any more, so the bottom stays full.
 */
function edge(p: Part, dt: number) {
  const d = Math.hypot(p.x, p.y);
  if (d > p.wall * 0.94) {
    const nx = p.x / d;
    const ny = p.y / d;
    const tx = -ny;
    const ty = nx;
    const vr = p.vx * nx + p.vy * ny;
    if (!p.side) {
      const vt = p.vx * tx + p.vy * ty;
      p.side = Math.abs(vt) > 1 ? Math.sign(vt) : p.seed % 2 < 1 ? -1 : 1;
    }
    if (d > p.wall && vr > 0) {
      p.vx += -vr * nx + p.side * vr * 0.85 * tx;
      p.vy += -vr * ny + p.side * vr * 0.85 * ty;
    }
    // the run fades as it goes, so it slows over her instead of going round and round
    const run = VAPE_RUN * Math.max(0, 1 - p.age / 3.2);
    p.vx += p.side * tx * run * dt;
    p.vy += p.side * ty * run * dt;
    if (d > p.wall) {
      p.x -= nx * (d - p.wall) * 0.5;
      p.y -= ny * (d - p.wall) * 0.5;
    }
    if (p.hitAt < 0) p.hitAt = p.age;
  }
  if (p.hitAt >= 0 && p.age - p.hitAt > p.peel && d > 1) {
    if (!p.peeled) {
      p.peeled = true;
      p.rise = Math.min(p.rise, 14);
    }
    const pull =
      VAPE_IN * (d - p.home) * Math.min(1, (p.age - p.hitAt - p.peel) / 0.6);
    p.vx -= (p.x / d) * pull * dt;
    p.vy -= (p.y / d) * pull * dt;
  }
}

/** One soft round puff on her cells: adds to what is there (never past full); the kind is the thickest puff's. */
function splat(
  e: Expression,
  grid: Grid,
  x: number,
  y: number,
  r: number,
  a: number,
  kind: number,
  hold: number,
) {
  const reach = Math.min(70, r + 9);
  const gc = (x + grid.half) / grid.cw;
  const gr = (y + grid.half) / grid.ch;
  const rx = reach / grid.cw;
  const ry = reach / grid.ch;
  const c0 = Math.max(0, Math.floor(gc - rx));
  const c1 = Math.min(grid.cols - 1, Math.ceil(gc + rx));
  const r0 = Math.max(0, Math.floor(gr - ry));
  const r1 = Math.min(grid.rows - 1, Math.ceil(gr + ry));
  const k = 1 / (reach * reach);
  const cells = grid.cells;
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      const i = grid.at[row * grid.cols + c];
      if (i < 0) continue;
      const ex = cells[i].dx - x;
      const ey = cells[i].dy - y;
      const q = 1 - (ex * ex + ey * ey) * k;
      if (q <= 0) continue;
      const w = a * q * q;
      e.thick[i] += w - e.thick[i] * w;
      if (w > e.top[i]) {
        e.top[i] = w;
        e.kind[i] = kind;
      }
      if (hold > e.keep[i]) e.keep[i] = hold;
    }
  }
}

/** Whether anything of hers needs asking per cell this frame. */
export function busy(e: Expression) {
  return e.live || e.crust > 0.004 || e.crusted > 0;
}

/** Whether an eye may be cut at cell `i`: turned, only on the ball of her, facing you. */
export function facing(e: Expression, i: number, R: number) {
  return !e.turned || (e.pd[i] < R * 0.985 && e.hz[i] > 0);
}

/**
 * One cell, read back: its value now, the kind of what is over it (0 for none; its set in
 * PIECE_SETS is kind - 1), how long the cell keeps that set (s), and whether it covers an eye.
 */
const HIT = { v: 0, kind: 0, hold: 0, covers: false };

/**
 * What her pieces do to cell `i` whose value is `v`: the crust over her and the specks it sheds as
 * it goes, and what she has given off, in front of her. `R` is her radius now and `scale` her share
 * of it.
 */
export function pieceAt(
  e: Expression,
  grid: Grid,
  i: number,
  v: number,
  t: number,
  R: number,
  scale: number,
) {
  const cell = grid.cells[i];
  HIT.v = v;
  HIT.kind = 0;
  HIT.hold = 0;
  HIT.covers = false;
  if (e.crust > 0.004 || e.crusted > 0) {
    const X = e.moved ? e.hx[i] : cell.dx;
    const Y = e.moved ? e.hy[i] : cell.dy;
    const D = e.moved ? e.pd[i] : cell.dist;
    const inBody = 1 - smoothstep(R * 0.92, R * 1.1, D);
    let on = false;
    if (inBody > 0.05) {
      const bar =
        0.12 +
        0.76 * fbm(X * CRUST_GRAIN + e.crustSeed, Y * CRUST_GRAIN, 2.7, 2);
      on = e.crust > bar;
      if (on) {
        HIT.v =
          CRUST_TONE *
          (0.5 + 0.9 * fbm(X * 0.09, Y * 0.09, 5.5, 2)) *
          inBody *
          scale;
        HIT.kind = DUST;
        HIT.hold = 0.15;
        e.crustedNow++;
      }
    }
    if (e.crustWas[i] && !on && Math.random() < SHED_RATE) shed(e, cell, R);
    e.crustWas[i] = on ? 1 : 0;
  }
  if (e.live) {
    const thick = e.thick[i];
    if (thick > 0.02) {
      const kind = e.kind[i];
      const d =
        thick *
        scale *
        (0.6 +
          0.8 *
            vnoise(
              cell.dx * 0.04 + t * 0.3,
              cell.dy * 0.04 - t * 0.2,
              t * 0.5,
            ));
      const bar = 0.1 + 0.3 * cell.grain;
      if (d > bar) {
        HIT.v =
          kind === DUST
            ? DUST_MAX * (1 - Math.exp(-DUST_FILL * d))
            : 0.3 + 0.62 * Math.min(1, d);
        HIT.kind = kind;
        HIT.hold = 0.12;
        // thick dust covers her eyes; the smoke she breathes out never does — they look out through it
        if (d > 0.45 && kind === DUST) HIT.covers = true;
      } else if (e.keep[i] > 0 && d > bar * 0.5) {
        HIT.kind = kind;
        HIT.hold = e.keep[i] * (0.5 + cell.grain);
      }
    }
  }
  return HIT;
}

/** A speck off the crust where it has just gone, with the speed her face had there, and out. */
function shed(e: Expression, cell: Grid["cells"][number], R: number) {
  const z = Math.sqrt(Math.max(0, R * R - cell.dist * cell.dist));
  const fling = Math.max(-FLING_MAX, Math.min(FLING_MAX, e.yawV * z * FLING));
  const sp = 90 + 80 * Math.random();
  emit(e, {
    ...LOOSE,
    x: cell.dx,
    y: cell.dy,
    vx: fling + cell.cos * sp,
    vy: cell.sin * sp - 30,
    life: 1 + 0.7 * Math.random(),
    a: 0.45 + 0.25 * Math.random(),
    r0: 3,
    r1: 18 + 12 * Math.random(),
    grow: 0.6,
    keep: 0.3,
    fall: 45,
    curl: 35,
    kind: DUST,
    hold: 0,
    fadeP: 1.5,
  });
  // and now and then a heavier bit that drops
  if (Math.random() < 0.35)
    emit(e, {
      ...LOOSE,
      x: cell.dx,
      y: cell.dy,
      vx: fling + cell.cos * (120 + 80 * Math.random()),
      vy: cell.sin * sp - 50,
      life: 0.6 + 0.4 * Math.random(),
      a: 0.9,
      r0: 1.5,
      r1: 2.5,
      grow: 1,
      keep: 0.4,
      fall: 300,
      curl: 0,
      kind: DUST,
      hold: 0,
      fadeP: 1,
    });
}
