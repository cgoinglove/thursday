// No "use client": the zod schema and the settings screen read these lists too.

/** The glyph sets an ascii orb can be drawn with. */
export const ASCII_CHARSETS = ["ascii", "emoji", "emojiOnly"] as const;

export type AsciiCharset = (typeof ASCII_CHARSETS)[number];
