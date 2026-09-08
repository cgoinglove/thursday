// No "use client": the zod schema and the settings screen read these lists too.

/** The renderers Thursday can be drawn with (SVG mark or glyph canvas). */
export const FACE_KINDS = ["mark", "ascii"] as const;

export type FaceKind = (typeof FACE_KINDS)[number];

/** The glyph sets an ascii orb can be drawn with. */
export const ASCII_CHARSETS = ["ascii", "emoji", "emojiOnly"] as const;

export type AsciiCharset = (typeof ASCII_CHARSETS)[number];
