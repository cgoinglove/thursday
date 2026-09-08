import { SPECTRUM_BANDS } from "@/lib/realtime/realtime.tap";

/**
 * Vocabulary a mark is drawn from. Lives outside the renderer (a client
 * component) so the zod schema and the settings screen can read it on the server.
 */

/** Spectrum band count comes from the tap that fills them. */
export const MARK_BANDS = SPECTRUM_BANDS;

/** Every silhouette a mark can draw. */
export const MARK_SHAPES = ["blob", "poly", "squircle"] as const;

export type MarkShape = (typeof MARK_SHAPES)[number];

/**
 * Follows the theme's text colour. Distinct from no colour at all: an unset
 * colour means nobody chose (a bot then gets one from its name hash).
 */
export const MARK_SYSTEM = "currentColor";

const MARK_COLORS = [
  { id: "system", label: "System", value: MARK_SYSTEM },
  { id: "slate", label: "Slate", value: "#64748B" },
  { id: "indigo", label: "Indigo", value: "#6366F1" },
  { id: "blue", label: "Blue", value: "#3B82F6" },
  { id: "cyan", label: "Cyan", value: "#06B6D4" },
  { id: "teal", label: "Teal", value: "#14B8A6" },
  { id: "green", label: "Green", value: "#22C55E" },
  { id: "lime", label: "Lime", value: "#84CC16" },
  { id: "amber", label: "Amber", value: "#F59E0B" },
  { id: "orange", label: "Orange", value: "#F97316" },
  { id: "red", label: "Red", value: "#EF4444" },
  { id: "pink", label: "Pink", value: "#EC4899" },
  { id: "violet", label: "Violet", value: "#8B5CF6" },
  { id: "fuchsia", label: "Fuchsia", value: "#D946EF" },
  { id: "rose", label: "Rose", value: "#F43F5E" },
  { id: "sky", label: "Sky", value: "#0EA5E9" },
  { id: "emerald", label: "Emerald", value: "#10B981" },
  { id: "yellow", label: "Yellow", value: "#EAB308" },
  { id: "stone", label: "Stone", value: "#78716C" },
  // Dark enough to carry weight on light themes, light enough not to sink into a dark background.
  { id: "navy", label: "Navy", value: "#1E3A8A", dark: true },
  { id: "ocean", label: "Ocean", value: "#155E75", dark: true },
  { id: "pine", label: "Pine", value: "#166534", dark: true },
  { id: "moss", label: "Moss", value: "#3F6212", dark: true },
  { id: "olive", label: "Olive", value: "#854D0E", dark: true },
  { id: "rust", label: "Rust", value: "#9A3412", dark: true },
  { id: "wine", label: "Wine", value: "#9F1239", dark: true },
  { id: "plum", label: "Plum", value: "#6B21A8", dark: true },
  { id: "grape", label: "Grape", value: "#5B21B6", dark: true },
  { id: "iron", label: "Iron", value: "#334155", dark: true },
] as const satisfies readonly {
  id: string;
  label: string;
  value: string;
  /** Marks the dark row; MARK_PALETTE_ROWS splits on it. */
  dark?: true;
}[];

export type MarkColor = (typeof MARK_COLORS)[number];

/** Colour by name, for code that hardcodes one (seed bots) so it stays inside the palette. */
export const MARK_INK = Object.fromEntries(
  MARK_COLORS.map((color) => [color.id, color.value]),
) as Record<MarkColor["id"], string>;

/** Every preset that is an actual colour (no "system"), for swatch pickers and random picks. */
export const MARK_PALETTE: string[] = MARK_COLORS.filter(
  (color) => color.value !== MARK_SYSTEM,
).map((color) => color.value);

/** The app's two status colours. A face wearing one reads as a state it is not in, so no roll lands on them. */
const STATUS_INK: string[] = [MARK_INK.amber, MARK_INK.red];

/** `count` distinct colours in random order. Fewer than asked when the palette runs out. */
export function randomMarkColors(count: number): string[] {
  const pool = MARK_PALETTE.filter((color) => !STATUS_INK.includes(color));
  for (let at = pool.length - 1; at > 0; at--) {
    const swap = Math.floor(Math.random() * (at + 1));
    [pool[at], pool[swap]] = [pool[swap], pool[at]];
  }
  return pool.slice(0, count);
}

/** MARK_PALETTE split into a light row and a dark row, so pickers break the line on meaning. */
export const MARK_PALETTE_ROWS: string[][] = [
  MARK_COLORS.filter(
    (color) => color.value !== MARK_SYSTEM && !("dark" in color),
  ).map((color) => color.value),
  MARK_COLORS.filter((color) => "dark" in color).map((color) => color.value),
];
