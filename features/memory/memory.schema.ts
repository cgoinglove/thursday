import type { ModelMessage } from "ai";
import { z } from "zod";
import { type DateLike, DateLikeSchema, toDate } from "@/lib/date-like";

/**
 * Who put a fact here. Memory is one note kept by three hands — the user typing
 * on the screen, the call as they talk, and a bot that turned something up
 * mid-job — and they are not equally close to the user. A reader that cannot
 * tell them apart reads what a bot inferred as something the user said.
 */
export const MemorySourceSchema = z.enum(["user", "call", "bot"]);

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
        : "";

// Storage is fact-based: one row per fact, history via isLatest.
export const MemoryFactSchema = z.object({
  id: z.number(),
  text: z.string(),
  /** Loaded into every prompt without opening the note (config MEMORY_LIMITS.carried). */
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
    of: "The user themselves — their name, age, what they do, where they live, and whatever else says who they are",
  },
  { path: "preferences", of: "How they want things done, and said" },
  { path: "people/", of: "Someone in their life, and what matters about them" },
  {
    path: "projects/",
    of: "Something with an end — a trip, a purchase, a deadline, a thing being built",
  },
  { path: "topics/", of: "Something ongoing that keeps coming back" },
  { path: "inbox", of: "Nowhere obvious yet" },
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

/**
 * Notes whose listing line the app writes rather than a model: the two root
 * notes it keeps (memory.query ensureRootNotes) and the inbox, which is where
 * a fact lands when its path is not one this listing can carry. A model's
 * `description` for one of these is ignored, so the line cannot drift with
 * whoever wrote last (ai/tools/memory.tool).
 */
export const APP_NAMED_NOTES = [...MEMORY_ALWAYS_LISTED, MEMORY_INBOX];

export const isAppNamed = (path: string) => APP_NAMED_NOTES.includes(path);

/** The line the app writes for one of those. */
export const appNoteLine = (path: string) =>
  MEMORY_PATHS.find((entry) => entry.path === path)?.of ?? null;

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

/** One change a memory edit asked for, waiting on the screen for the user (memory.edit). */
export type MemoryEditCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

/** What one step of a memory edit hands back: its new messages, the changes it waits on, its words. */
export type MemoryEditStep = {
  messages: ModelMessage[];
  calls: MemoryEditCall[];
  text: string;
};

// Model-facing shapes: narrower than the UI's on purpose.

export type MemoryFactRef = {
  /** What `memory_forget` and `replaces` take. */
  id: number;
  text: string;
  /** When the call it was said in started, when a call wrote it. Formatted by the tool, never sent as a Date. */
  saidAt?: Date;
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
