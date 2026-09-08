import { z } from "zod";
import { MEMORY_TIDY } from "@/config";
import { type DateLike, DateLikeSchema, toDate } from "@/lib/date-like";

// Storage is fact-based: one row per fact, history via isLatest.
export const MemoryFactSchema = z.object({
  id: z.number(),
  text: z.string(),
  /** Loaded into every prompt without opening the note (ALWAYS_LOADED_MAX). */
  alwaysLoad: z.boolean(),
  createdAt: DateLikeSchema,
});

export const MemoryNoteSchema = z.object({
  id: z.number(),
  path: z.string(),
  description: z.string(),
  aliases: z.string().array().nullish(),
  /** Created by the user; never auto-deleted when empty. */
  ownedByUser: z.boolean(),
  hits: z.number(),
  lastReadAt: DateLikeSchema.nullable(),
  createdAt: DateLikeSchema,
  updatedAt: DateLikeSchema,
  factCount: z.number(),
  facts: MemoryFactSchema.array(),
});

export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export type MemoryNote = z.infer<typeof MemoryNoteSchema>;

/**
 * Where notes may live and what each place holds. The prompt lists it, writes
 * validate against it, the screen groups by it. Everything here may be read aloud.
 */
export const MEMORY_PATHS = [
  {
    path: "profile",
    of: "The user themselves — who they are, what they do, where, how they live",
  },
  { path: "preferences", of: "How they like things done, and said" },
  {
    path: "people/",
    of: "Who someone is to them, and what matters about them",
  },
  { path: "projects/", of: "Something they are building or running" },
  { path: "plans/", of: "A trip, an appointment, a purchase, a deadline" },
  { path: "topics/", of: "Anything else worth its own note" },
  { path: "inbox", of: "Nowhere obvious to go" },
] as const;

/** Where anything outside the convention lands. */
export const MEMORY_INBOX = "inbox";

/** Notes without a section. */
export const MEMORY_ROOT_NOTES = MEMORY_PATHS.filter(
  (entry) => !entry.path.endsWith("/"),
).map((entry) => entry.path) as ("profile" | "preferences" | "inbox")[];

/** Notes about a named thing live under one of these. */
export const MEMORY_SECTIONS = MEMORY_PATHS.filter((entry) =>
  entry.path.endsWith("/"),
).map((entry) => entry.path.slice(0, -1)) as (
  | "people"
  | "projects"
  | "plans"
  | "topics"
)[];

const MEMORY_PATH_RE = new RegExp(
  `^(?:${MEMORY_ROOT_NOTES.join("|")}|(?:${MEMORY_SECTIONS.join("|")})/.+)$`,
);

export const isMemoryPath = (path: string) => MEMORY_PATH_RE.test(path);

/** Notes that stay listed with zero facts; their description is app-owned. */
export const MEMORY_ALWAYS_LISTED: string[] = ["profile", "preferences"];

export const isAlwaysListed = (path: string) =>
  MEMORY_ALWAYS_LISTED.includes(path);

/** Threshold, not a cap: a note above this is flagged for tidying but never truncated. */
export const MANY_FACTS = 100;

/** Max facts loaded into every session prompt; enforced by the write path, not the prompt. */
export const ALWAYS_LOADED_MAX = 14;

export type MemorySection =
  | "you"
  | (typeof MEMORY_SECTIONS)[number]
  | typeof MEMORY_INBOX;

/** How the screen groups notes; derived from MEMORY_PATHS. */
export function sectionOf(path: string): MemorySection {
  if (path === "profile" || path === "preferences") return "you";
  const head = path.slice(0, path.indexOf("/"));
  return (MEMORY_SECTIONS as readonly string[]).includes(head)
    ? (head as (typeof MEMORY_SECTIONS)[number])
    : MEMORY_INBOX;
}

// Model-facing shapes: narrower than the UI's on purpose.

export type MemoryFactRef = {
  /** What `memory_forget` and `replaces` take. */
  id: number;
  text: string;
};

/** A fact carried at the top of the prompt, with its note path. */
export type MemoryAlwaysLoaded = {
  id: number;
  path: string;
  text: string;
};

/** A note as returned by recall or after a write. */
export type MemoryNoteView = {
  path: string;
  description: string;
  facts: MemoryFactRef[];
};

/** One note per write; `path` is the upsert key, the rest is the note's new state. */
export type MemoryNoteWrite = {
  path: string;
  /** Replaces wholesale when given; omitted leaves the current one. */
  description?: string | null;
  /** Spoken names for the note. Replaces wholesale when given. */
  aliases?: string[] | null;
  facts?:
    | {
        text: string;
        replaces?: number | null;
        /** Omitted: false for new facts, unchanged for revised ones. */
        alwaysLoad?: boolean | null;
      }[]
    | null;
};

export type MemoryWrite = {
  /** Touched notes re-read after the write, fact ids included. */
  notes: MemoryNoteView[];
  /** Notes this write created without a description. */
  unnamed: string[];
  /** Facts stored as ordinary because no alwaysLoad slot was free. */
  notLoaded: string[];
};

/** One line of the note index in the system prompt. */
export type MemoryIndexEntry = {
  path: string;
  description: string;
  aliases?: string[] | null;
  factCount: number;
  /** Last recall, or creation when never recalled. */
  lastSeenAt: DateLike;
};

/** 'people/alice' → 'alice'; bare paths name themselves. */
export function noteTitle(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Recall score used for ranking: reads warm a note, neglect cools it. */
export function recallScore(note: {
  hits: number;
  lastReadAt: DateLike | null;
  createdAt: DateLike;
}): number {
  // Wire data is an ISO string, drizzle returns a Date; both accepted.
  const last = toDate(note.lastReadAt ?? note.createdAt);
  const days = Math.max(0, (Date.now() - last.getTime()) / 86_400_000);
  return (note.hits + 1) / (1 + days);
}

export function isFading(
  note: Parameters<typeof recallScore>[0] & { path: string },
): boolean {
  return !isAlwaysListed(note.path) && recallScore(note) < 0.15;
}

// The tidy pass (memory.tidy): settings, the run row as the screen sees it.

/**
 * How eagerly memory is re-read after calls. Each level is a pending-transcript
 * size (config MEMORY_TIDY.threshold); `off` never runs.
 */
export const MEMORY_TIDY_LEVELS = ["off", "often", "normal", "rarely"] as const;
export const MemoryTidyLevelSchema = z.enum(MEMORY_TIDY_LEVELS);
export type MemoryTidyLevel = z.infer<typeof MemoryTidyLevelSchema>;

export const MEMORY_TIDY_LEVEL_DEFAULT: MemoryTidyLevel = "normal";

export const MEMORY_TIDY_LEVEL_LABEL: Record<MemoryTidyLevel, string> = {
  off: "Off",
  often: "Often",
  normal: "Normal",
  rarely: "Rarely",
};

/** Pending transcript tokens that start a pass; null means never. */
export const tidyThreshold = (level: MemoryTidyLevel): number | null =>
  level === "off" ? null : MEMORY_TIDY.threshold[level];

/** Config keys (features/config config.query) the tidy settings live under. */
export const MEMORY_TIDY_KEYS = {
  level: "MEMORY_TIDY",
  /** `provider/model`; unset runs on the app default (ai/model resolveDefaultModel). */
  model: "MEMORY_TIDY_MODEL",
} as const;

export const MEMORY_TIDY_STATUSES = [
  "running",
  "done",
  "stopped",
  "failed",
] as const;
export type MemoryTidyStatus = (typeof MEMORY_TIDY_STATUSES)[number];

/** One thing the pass changed; the run row keeps them in order. */
export const MemoryTidyChangeSchema = z.object({
  op: z.enum(["add", "replace", "forget", "carry", "uncarry"]),
  path: z.string(),
  text: z.string(),
});
export type MemoryTidyChange = z.infer<typeof MemoryTidyChangeSchema>;

export const MemoryTidyRunSchema = z.object({
  id: z.string(),
  status: z.enum(MEMORY_TIDY_STATUSES),
  provider: z.string(),
  model: z.string(),
  callIds: z.string().array(),
  done: z.number(),
  changes: MemoryTidyChangeSchema.array(),
  error: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  startedAt: DateLikeSchema,
  endedAt: DateLikeSchema.nullable(),
});
export type MemoryTidyRun = z.infer<typeof MemoryTidyRunSchema>;

/** What the tidy screen reads (app/api/memory/tidy). */
export type MemoryTidyStatusView = {
  level: MemoryTidyLevel;
  /** The picked model as `provider/model`, or null for the app default. */
  model: string | null;
  /** Transcript tokens of calls not yet read, and where a pass starts. */
  pendingTokens: number;
  pendingCalls: number;
  threshold: number | null;
  /** The pass in progress, if any. */
  current: MemoryTidyRun | null;
  /** The most recent finished pass. */
  last: MemoryTidyRun | null;
};

/** Counts per op for one line on screen: "4 added · 2 forgotten". */
export function tidyTally(changes: MemoryTidyChange[]): string {
  const count = (op: MemoryTidyChange["op"]) =>
    changes.filter((change) => change.op === op).length;
  const parts = [
    [count("add"), "added"],
    [count("replace"), "revised"],
    [count("forget"), "forgotten"],
    [count("carry"), "carried"],
    [count("uncarry"), "uncarried"],
  ] as const;
  const said = parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
  return said.length ? said.join(" · ") : "nothing changed";
}
