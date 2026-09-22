// Glyph vocabulary shared by the ascii orb and the ascii field. No "use client"
// so the schema can read it too.

/**
 * Glyph candidates per brightness level; a cell picks one so equal levels do
 * not form rings. No dense glyphs (blocks, filled shapes, @#MW): brightness
 * comes from alpha, glyphs only add texture.
 */
export const RAMP: string[][] = [
  [" "],
  [" ", ".", "`"],
  [".", ",", "·", "'"],
  [":", ";", "-", "^"],
  ["=", "+", "~", '"'],
  ["*", "?", "◦", "j"],
  ["c", "v", "○", "7"],
  ["o", "x", "◇", "い"],
  ["s", "y", "t", "あ"],
  ["e", "a", "u", "な"],
  ["k", "w", "z", "や"],
  ["q", "h", "n", "米"],
];

/** Emoji mixed into the glyphs, spread across the color wheel. */
export const EMOJI_POOL = [
  // red
  "🍎",
  "🌹",
  "🍓",
  "❤️",
  "🎈",
  "🧨",
  "🔴",
  // orange
  "🍊",
  "🔥",
  "🦊",
  "🏀",
  "🧡",
  "🍑",
  // yellow
  "⭐",
  "🍋",
  "🌻",
  "💛",
  "🐥",
  "🌟",
  "🍌",
  // green
  "🍀",
  "🌿",
  "🐸",
  "🥝",
  "💚",
  "🌵",
  "🥑",
  // blue
  "💧",
  "🌊",
  "🫐",
  "🐳",
  "💙",
  "🔵",
  "🧊",
  // purple
  "🍇",
  "💜",
  "🔮",
  "🟣",
  "🪻",
  "🍆",
  // pink
  "🌸",
  "🌷",
  "💗",
  "🦩",
  "🩷",
  // brown
  "🍫",
  "🐻",
  "🌰",
  "🥐",
  // monochrome
  "🤍",
  "☁️",
  "🖤",
  "⚪",
  "⚫",
  "🦢",
  // multicolor
  "🌈",
  "🦜",
  "🎨",
  "🪩",
  "🦄",
  "✨",
  "🍬",
  "🎡",
];

/** Opacity of the brightest level. */
export const ALPHA_TOP = 0.82;

/**
 * Where an emoji stands on the ramp when emoji are all there is, 0 to 1. Not the level itself:
 * an emoji cannot shade. A "." is a tenth of an "\u7C73" in ink, while a pale emoji is the same
 * nine pixels across as a bright one, so eleven even steps come out as one weight everywhere and
 * what she has thrown weighs what her body weighs. This splits them instead — the bottom rungs
 * are the halo and fall away fast, and everything from the body up is simply there.
 */
export function emojiWeight(level: number, top: number) {
  return smoothstep(0.05, 0.42, level / top);
}

/**
 * How brightly an emoji is drawn at brightness level `level` of `top`. Sprinkled over an ascii
 * body they are the highlights and never the dim end, so they start high; drawn alone they carry
 * the whole ramp.
 */
export function emojiAlpha(level: number, top: number, alone: boolean) {
  return alone
    ? 0.06 + emojiWeight(level, top) * 0.94
    : 0.35 + (level / top) * 0.65;
}

/** Fraction of cells that hold an emoji. */
export const EMOJI_RATIO = 0.11;
/** Minimum brightness level for an emoji cell. */
export const EMOJI_MIN_LEVEL = 6;
/** Glyph changes per second. */
export const CHAR_RATE = 2.2;
/** Emoji changes per second; emoji are expensive to draw. */
export const EMOJI_CHAR_RATE = 0.6;

/**
 * Letters for words on the face (ERROR, and what `emote` shows): five rows, `#`
 * is ink. A space is a narrow gap; lowercase is drawn in capitals.
 */
export const LETTERS: Record<string, readonly string[]> = {
  A: [".##.", "#..#", "####", "#..#", "#..#"],
  B: ["###.", "#..#", "###.", "#..#", "###."],
  C: [".###", "#...", "#...", "#...", ".###"],
  D: ["###.", "#..#", "#..#", "#..#", "###."],
  E: ["####", "#...", "###.", "#...", "####"],
  F: ["####", "#...", "###.", "#...", "#..."],
  G: [".###", "#...", "#.##", "#..#", ".###"],
  H: ["#..#", "#..#", "####", "#..#", "#..#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..##", "...#", "...#", "#..#", ".##."],
  K: ["#..#", "#.#.", "##..", "#.#.", "#..#"],
  L: ["#...", "#...", "#...", "#...", "####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".##.", "#..#", "#..#", "#..#", ".##."],
  P: ["###.", "#..#", "###.", "#...", "#..."],
  Q: [".##.", "#..#", "#..#", "#.#.", ".#.#"],
  R: ["###.", "#..#", "###.", "#.#.", "#..#"],
  S: [".###", "#...", ".##.", "...#", "###."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#..#", "#..#", "#..#", "#..#", ".##."],
  V: ["#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#..#", "#..#", ".##.", "#..#", "#..#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["####", "...#", ".##.", "#...", "####"],
  "0": [".##.", "#.##", "#..#", "##.#", ".##."],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###.", "...#", ".##.", "#...", "####"],
  "3": ["###.", "...#", ".##.", "...#", "###."],
  "4": ["#..#", "#..#", "####", "...#", "...#"],
  "5": ["####", "#...", "###.", "...#", "###."],
  "6": [".##.", "#...", "###.", "#..#", ".##."],
  "7": ["####", "...#", "..#.", ".#..", ".#.."],
  "8": [".##.", "#..#", ".##.", "#..#", ".##."],
  "9": [".##.", "#..#", ".###", "...#", ".##."],
  "!": ["#", "#", "#", ".", "#"],
  "?": ["###.", "...#", ".##.", "....", ".#.."],
  ".": [".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", ".#", "#."],
  "'": ["#", "#", ".", ".", "."],
  "-": ["...", "...", "###", "...", "..."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  ":": [".", "#", ".", "#", "."],
  "(": [".#", "#.", "#.", "#.", ".#"],
  ")": ["#.", ".#", ".#", ".#", "#."],
  "<": ["..#", ".#.", "#..", ".#.", "..#"],
  ">": ["#..", ".#.", "..#", ".#.", "#.."],
  "^": [".#.", "#.#", "...", "...", "..."],
  "~": ["....", ".#.#", "#.#.", "....", "...."],
  "♥": [".#.#.", "#####", "#####", ".###.", "..#.."],
  " ": ["..", "..", "..", "..", ".."],
};

/** The longest word the face shows: eight letters still sit inside her body at the default glyph size. */
export const FACE_WORD_MAX = 8;

/** The marks a word may use besides A–Z, 0–9 and a space. */
export const FACE_WORD_MARKS = Object.keys(LETTERS).filter(
  (char) => !/^[A-Z0-9 ]$/.test(char),
);

/** The first character of `text` the face has no letter for, or null. */
export function undrawable(text: string) {
  return (
    Array.from(text.toUpperCase()).find((char) => !(char in LETTERS)) ?? null
  );
}

/** Deterministic per-cell random in [0, 1): the same (x, y) always hashes the same. */
export function hash(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
