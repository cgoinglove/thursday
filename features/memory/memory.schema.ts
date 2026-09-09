import { z } from "zod";
import { type DateLike, DateLikeSchema, toDate } from "@/lib/date-like";

/**
 * Who put a fact here. Memory is one note kept by four hands — the user typing
 * on the screen, the call as they talk, a bot that turned something up mid-job,
 * and the pass that reads calls back afterwards — and they are not equally
 * close to the user. A reader that cannot tell them apart reads what a bot
 * inferred as something the user said.
 */
export const MemorySourceSchema = z.enum(["user", "call", "bot", "tidy"]);

export type MemorySource = z.infer<typeof MemorySourceSchema>;

/**
 * How a source reads on screen. Recorded for the person looking at their own
 * memory, not for a model: a bare `bot` in a prompt says nothing a reader can
 * act on — it cannot tell whether that was itself — and costs a sentence to
 * explain. Empty where it was never recorded.
 */
export const memorySourceLabel = (source: MemorySource | null | undefined) =>
  source === "user"
    ? "you"
    : source === "call"
      ? "on a call"
      : source === "bot"
        ? "a bot"
        : source === "tidy"
          ? "read back"
          : "";

// Storage is fact-based: one row per fact, history via isLatest.
export const MemoryFactSchema = z.object({
  id: z.number(),
  text: z.string(),
  /** Loaded into every prompt without opening the note (ALWAYS_LOADED_MAX). */
  alwaysLoad: z.boolean(),
  /** Null on rows written before the hand was recorded. */
  source: MemorySourceSchema.nullish(),
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

// Reading calls back (memory.tidy): its settings and the run row the screen draws.

/** Config keys (features/config config.query) the settings live under. */
export const MEMORY_TIDY_KEYS = {
  /** "on" switches it on; anything else, unset included, is off. */
  on: "MEMORY_TIDY",
  /** `provider/model`; unset runs on the app default (ai/model resolveDefaultModel). */
  model: "MEMORY_TIDY_MODEL",
} as const;

/**
 * Off unless switched on. A read costs a whole context of a text model, so
 * nothing starts spending until the user asks for it — and a model must be
 * picked as well (memory.tidy startTidy).
 */
export const isTidyOn = (value: string | undefined) => value?.trim() === "on";

export const MEMORY_TIDY_STATUSES = [
  "running",
  "done",
  "stopped",
  "failed",
] as const;
export type MemoryTidyStatus = (typeof MEMORY_TIDY_STATUSES)[number];

/** One thing a read changed; the run row keeps them in order. */
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
  /** The calls this read covered and stamped, oldest first. */
  callIds: z.string().array(),
  /** Turns it actually read. Fewer than were owed when older ones were dropped. */
  messages: z.number(),
  changes: MemoryTidyChangeSchema.array(),
  error: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  startedAt: DateLikeSchema,
  endedAt: DateLikeSchema.nullable(),
});
export type MemoryTidyRun = z.infer<typeof MemoryTidyRunSchema>;

/** What the setting reads (app/api/memory/tidy). */
export type MemoryTidyStatusView = {
  on: boolean;
  /** The picked model as `provider/model`, or null for the app default. */
  model: string | null;
  /** Turns said since the last read, and how many it takes to run. */
  pending: number;
  every: number;
  /** The read in progress, if any. */
  current: MemoryTidyRun | null;
  /** The most recent finished read. */
  last: MemoryTidyRun | null;
};

/** Counts per op for one line on screen: "3 added, 1 revised". */
export function tidyTally(changes: MemoryTidyChange[]): string {
  const count = (op: MemoryTidyChange["op"]) =>
    changes.filter((change) => change.op === op).length;
  const said = (
    [
      [count("add"), "added"],
      [count("replace"), "revised"],
      [count("forget"), "dropped"],
      [count("carry"), "carried"],
      [count("uncarry"), "uncarried"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);
  return said.length ? said.join(", ") : "nothing to change";
}
