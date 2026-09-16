/**
 * Vocabulary a mark is drawn from. Lives outside the renderer (a client
 * component) so the zod schema and the settings screen can read it on the server.
 */

/** Every silhouette a mark can draw. */
export const MARK_SHAPES = ["blob", "poly", "squircle", "heart"] as const;

export type MarkShape = (typeof MARK_SHAPES)[number];

/**
 * Follows the theme's text colour. Distinct from no colour at all: an unset
 * colour means nobody chose. BotMark draws both in currentColor; only the
 * picker tells them apart.
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
  // No darker neutrals: black is the theme dot, and a dark grey sinks into a dark theme.
] as const satisfies readonly {
  id: string;
  label: string;
  value: string;
}[];

export type MarkColor = (typeof MARK_COLORS)[number];

/** Colour by name, so code that names one (the status inks below) stays inside the palette. */
export const MARK_INK = Object.fromEntries(
  MARK_COLORS.map((color) => [color.id, color.value]),
) as Record<MarkColor["id"], string>;

/** Every preset that is an actual colour (no "system"), for swatch pickers and random picks. */
export const MARK_PALETTE: string[] = MARK_COLORS.filter(
  (color) => color.value !== MARK_SYSTEM,
).map((color) => color.value);

/** The app's two status colours. A face wearing one reads as a state it is not in, so no roll lands on them. */
const STATUS_INK: string[] = [MARK_INK.amber, MARK_INK.red];

/** How the renderer lays a paint's colours out. */
export type MarkPaintLook = "flow" | "duo" | "aurora";

const hues = (list: number[], lightness: number, chroma: number) =>
  list.map((hue) => `oklch(${lightness} ${chroma} ${hue})`);

/**
 * Paints a body can wear in place of its colour. Each names its colours once, for
 * the renderer and for the swatch that picks it. Aurora lists its night first
 * (two colours), then one light per curtain.
 */
export const MARK_PAINTS = {
  rainbow: {
    label: "Rainbow",
    look: "flow",
    colors: hues([0, 45, 90, 140, 190, 240, 290, 330, 360], 0.77, 0.16),
  },
  duo: { label: "Duo", look: "duo", colors: ["#818CF8", "#F472B6"] },
  aurora: {
    label: "Aurora",
    look: "aurora",
    edge: "dark",
    colors: ["#1a2f73", "#2c56c9", "#34d399", "#22d3ee", "#a7f3d0"],
  },
  "aurora-pink": {
    label: "Pink aurora",
    look: "aurora",
    edge: "dark",
    colors: ["#3a1478", "#7c3aed", "#f472b6", "#e879f9", "#fbcfe8"],
  },
} satisfies Record<
  string,
  {
    label: string;
    look: MarkPaintLook;
    colors: string[];
    /** A dark body: the mark draws its eyes, which as holes would show the dark page it sinks into. */
    edge?: "dark";
  }
>;

export type MarkPaint = keyof typeof MARK_PAINTS;

export type MarkPaintSpec = (typeof MARK_PAINTS)[MarkPaint];

export const MARK_PAINT_IDS = Object.keys(MARK_PAINTS) as [
  MarkPaint,
  ...MarkPaint[],
];

/** What a body wears: one palette colour, or one of MARK_PAINTS in its place. */
export type MarkFill = { color: string } | { paint: MarkPaint };

/**
 * `count` distinct fills in random order. Colours and paints come out of one
 * pool, so a paint is rolled as often as its share of the vocabulary; a face
 * nobody drew wears the same range as one somebody picked. Fewer than asked when
 * the pool runs out.
 */
export function randomMarkFills(count: number): MarkFill[] {
  const pool: MarkFill[] = [
    ...MARK_PALETTE.filter((color) => !STATUS_INK.includes(color)).map(
      (color) => ({ color }),
    ),
    ...MARK_PAINT_IDS.map((paint) => ({ paint })),
  ];
  for (let at = pool.length - 1; at > 0; at--) {
    const swap = Math.floor(Math.random() * (at + 1));
    [pool[at], pool[swap]] = [pool[swap], pool[at]];
  }
  return pool.slice(0, count);
}

/** A paint as a still CSS background, for the swatch that picks it. */
export function paintSwatch(paint: MarkPaint): string {
  const { look, colors } = MARK_PAINTS[paint];
  if (look === "aurora") {
    return `radial-gradient(circle at 35% 30%, ${colors[2]}, transparent 70%), linear-gradient(180deg, ${colors[0]}, ${colors[1]})`;
  }
  return `linear-gradient(135deg, ${colors.join(", ")})`;
}
