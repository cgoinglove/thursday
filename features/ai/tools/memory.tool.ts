import { tool } from "ai";
import * as z from "zod";
import { MEMORY_LIMITS } from "@/config";
import { saidStamp } from "@/features/ai/prompts/prompt-helper";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  createNoteWithFacts,
  describeNote,
  forgetFactById,
  readNotes,
  writeFacts,
} from "@/features/memory/memory.query";
import {
  isAlwaysListed,
  isMemoryPath,
  MEMORY_ALWAYS_LISTED,
  MEMORY_PATHS,
  type MemoryNoteView,
  type MemorySource,
} from "@/features/memory/memory.schema";

/** `profile, preferences, people/<name>, …` — the shapes a new note's path may take. */
const PATH_SHAPES = MEMORY_PATHS.map((entry) =>
  entry.path.endsWith("/") ? `${entry.path}<name>` : entry.path,
).join(", ");

const GONE =
  "Deleted for good. The listing in your instructions is from when this session opened and still shows it that way until the next one.";

const WROTE =
  "Saved. The listing in your instructions is from when this session opened and will not show this until the next one — the note below is current.";

const missing = (path: string) => `Nothing on the listing called ${path}.`;

/**
 * A note as a model reads it: how many facts it holds now, and `said` on each
 * fact a call wrote — the local time of that call, the same stamp its
 * conversation opens with, so a fact from a call already in the prompt reads
 * as that call. Never the Date itself: it would serialise as UTC.
 */
const withCount = (note: MemoryNoteView) => ({
  ...note,
  facts: note.facts.map(({ saidAt, ...fact }) =>
    saidAt ? { ...fact, said: saidStamp(saidAt) } : fact,
  ),
  factCount: note.facts.length,
});

/**
 * Said when a note has outgrown the recommended size, and only then — the write
 * itself always goes through. It names no tool: this one answers the call and a
 * bot, and how to settle it with the user is the call's to say (prompts/thursday.prompt);
 * the ask is the same either way, because a bot that turned up a fact can hand
 * the same request back with it.
 */
const overSize = (count: number) =>
  count > MEMORY_LIMITS.factsPerNote
    ? ` This note now holds ${count} facts, past the ${MEMORY_LIMITS.factsPerNote} one note holds well. Ask the user which of it is no longer true and delete what they name.`
    : "";

/**
 * A line past the cap is refused rather than cut: cut, the listing would carry
 * half a sentence and nobody would be told. Checked here and not in the schema so
 * the answer is one line the model can act on (memory.schema NoteLineSchema is
 * the screen's).
 */
const tooLong = (line: string) =>
  line.length > MEMORY_LIMITS.descriptionChars
    ? {
        note: `That line runs to ${line.length} characters; a note's line is one line, under ${MEMORY_LIMITS.descriptionChars}. Say what the note is about — the facts inside say the rest.`,
      }
    : null;

const PATH_ARG = z
  .string()
  .describe("Exactly as the listing writes it — the path.");

const FACT_TEXT = z
  .string()
  .describe(
    'One statement that stands on its own later — a date as a date, never "next week".',
  );

/**
 * Memory's writes are three tools with every argument required — a new note
 * with its line, facts under a note that exists, and the line itself — where one
 * tool with optional fields had a cheap model rewriting the line on every write
 * and filling every field it was shown (memory.schema, .claude/rules/model.md).
 *
 * @param source Which hand these writes are recorded under. The runtime knows
 * it without being told, so no model ever chooses it (load-tools,
 * memory.schema MemorySource).
 * @param callId The call these tools serve, when there is one: recorded on
 * what is written, so a fact reads with when it was said.
 * @param options.countReads Whether opening a note counts as reading it. The
 * counts rank notes cold in the call prompt, so only a runtime that recalls on
 * the user's behalf counts; an edit opening a note to change it does not.
 */
export const createMemoryTools = (
  source: MemorySource,
  callId: string | null = null,
  { countReads = true }: { countReads?: boolean } = {},
) => ({
  [TOOL_NAMES.memory_recall]: tool({
    description: "Open one note from the listing, whole.",
    inputSchema: z.object({ path: PATH_ARG }),
    execute: async ({ path }) => {
      const { notes } = await readNotes([path], { touch: countReads });
      const note = notes[0];
      // A missing note is an answer to relay, not a reason to retry spellings
      if (!note) return { note: missing(path.trim()) };
      const over = overSize(note.facts.length);
      return over ? { ...withCount(note), note: over.trim() } : withCount(note);
    },
  }),

  [TOOL_NAMES.memory_create]: tool({
    description:
      "Start a note for a subject that is not on the listing: its path, the line it is listed by, and its first facts.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          `A new path following the listing's convention — one of ${PATH_SHAPES} — for the person, project or topic the facts are about. A fact goes under the one note it is about; other notes name it rather than repeat it.`,
        ),
      description: z
        .string()
        .describe(
          "One line saying what this note is about, with the names the user calls it by, so the listing alone tells whether to open it. What it is about — never a list of what is inside.",
        ),
      facts: z
        .object({ text: FACT_TEXT })
        .array()
        .min(1)
        .describe(
          "What to keep under it. Send everything that came up at once: one call is one pause in the conversation, three calls are three.",
        ),
    }),
    execute: async ({ path, description, facts }) => {
      const target = path.trim();
      const line = description.trim();
      // Refused rather than filed elsewhere: a note is found by its path and its line, and a catch-all keeps neither
      if (!isMemoryPath(target)) {
        return {
          note: `Nothing was saved: "${target}" is not a path this listing can carry. Write it again under one of ${PATH_SHAPES}.`,
        };
      }
      if (isAlwaysListed(target)) {
        return {
          note: `${target} is always on the listing: \`${TOOL_NAMES.memory_remember}\` adds to it.`,
        };
      }
      const refused = tooLong(line);
      if (refused) return refused;

      const note = await createNoteWithFacts(
        target,
        line,
        facts,
        source,
        callId,
      );
      if (!note) {
        return {
          note: `${target} is already on the listing: \`${TOOL_NAMES.memory_remember}\` adds to it, \`${TOOL_NAMES.memory_describe}\` changes its line.`,
        };
      }
      const written = withCount(note);
      return { ...written, note: `${WROTE}${overSize(written.factCount)}` };
    },
  }),

  [TOOL_NAMES.memory_remember]: tool({
    description: "Write facts under a note that is on the listing.",
    inputSchema: z.object({
      path: PATH_ARG,
      facts: z
        .object({
          text: FACT_TEXT,
          replaces: z
            .number()
            .int()
            .nullish()
            .describe(
              `The id of the fact this replaces — from this note as handed back here or by \`${TOOL_NAMES.memory_recall}\`. Null if this is new. A fact that stopped being true is replaced rather than deleted, and so is a note saying the same thing twice: replacing keeps what changed on the record, deleting does not.`,
            ),
        })
        .array()
        .min(1)
        .describe(
          "What to write under this note. Send everything that came up at once: one call is one pause in the conversation, three calls are three.",
        ),
    }),
    execute: async ({ path, facts }) => {
      const target = path.trim();
      const note = await writeFacts(target, facts, source, callId);
      // The next step is named: a subject with no note gets one, and gets its line with it
      if (!note) {
        return {
          note: `${missing(target)} A subject that is not on the listing gets a note of its own: \`${TOOL_NAMES.memory_create}\`, with its line.`,
        };
      }
      const written = withCount(note);
      return { ...written, note: `${WROTE}${overSize(written.factCount)}` };
    },
  }),

  [TOOL_NAMES.memory_describe]: tool({
    description:
      "Change the line a note is listed by, when it no longer says what the note is about.",
    inputSchema: z.object({
      path: PATH_ARG,
      description: z
        .string()
        .describe(
          "The new line, whole: what this note is about, with the names the user calls it by. Never a list of what is inside.",
        ),
    }),
    execute: async ({ path, description }) => {
      const target = path.trim();
      const line = description.trim();
      // The listing line of the always-listed notes is the app's (memory.schema MEMORY_ALWAYS_LISTED)
      if (isAlwaysListed(target)) {
        return {
          note: `${MEMORY_ALWAYS_LISTED.join(" and ")} keep their own line; it is not yours to change.`,
        };
      }
      const refused = tooLong(line);
      if (refused) return refused;
      if (!(await describeNote(target, line))) return { note: missing(target) };
      return {
        path: target,
        description: line,
        note: "Renamed. The listing in your instructions is from when this session opened and still shows the old line until the next one.",
      };
    },
  }),

  [TOOL_NAMES.memory_forget]: tool({
    description: "Delete facts for good.",
    inputSchema: z.object({
      factIds: z
        .number()
        .int()
        .array()
        .min(1)
        .describe(
          "The ids that came with the facts when their notes were opened — every one to delete, in one call.",
        ),
    }),
    execute: async ({ factIds }) => {
      const missingIds: number[] = [];
      /** Notes that lost their last fact, and went with it (memory.query forgetFactById). */
      const gone: string[] = [];
      /** Notes that still hold something, handed back as they are now. */
      const left = new Set<string>();
      for (const id of new Set(factIds)) {
        const forgotten = await forgetFactById(id);
        if (!forgotten) {
          missingIds.push(id);
          continue;
        }
        if (forgotten.noteGone) {
          left.delete(forgotten.path);
          gone.push(forgotten.path);
        } else {
          left.add(forgotten.path);
        }
      }

      if (!gone.length && !left.size) {
        return {
          note: `No fact with id ${missingIds.join(", ")}. Nothing was deleted.`,
        };
      }

      // The notes that went are still on the listing until the next session, so say so
      const said = [
        GONE,
        gone.length === 1
          ? `That was the last fact under ${gone[0]}, so the note went with it.`
          : gone.length
            ? `That was the last of ${gone.join(", ")}, so those notes went with them.`
            : "",
        missingIds.length
          ? `No fact with id ${missingIds.join(", ")}, so those were skipped.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (!left.size) return { note: said };
      const { notes } = await readNotes([...left], { touch: false });
      return { notes: notes.map(withCount), note: said };
    },
  }),
});
