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

/** Fraction of cells that hold an emoji. */
export const EMOJI_RATIO = 0.11;
/** Minimum brightness level for an emoji cell. */
export const EMOJI_MIN_LEVEL = 6;
/** Glyph changes per second. */
export const CHAR_RATE = 2.2;
/** Emoji changes per second; emoji are expensive to draw. */
export const EMOJI_CHAR_RATE = 0.6;

/** Deterministic per-cell random in [0, 1): the same (x, y) always hashes the same. */
export function hash(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
