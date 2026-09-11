import { tool } from "ai";
import * as z from "zod";
import { MEMORY_CONVERSATION_PAGE, MEMORY_LIMITS } from "@/config";
import {
  callStamp,
  conversationLines,
  saidStamp,
} from "@/features/ai/prompts/prompt-helper";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  findFactCall,
  forgetFactById,
  readNotes,
  resolveNotePath,
  writeNotes,
} from "@/features/memory/memory.query";
import {
  APP_NAMED_NOTES,
  appNoteLine,
  isAppNamed,
  isMemoryPath,
  MEMORY_INBOX,
  type MemoryNoteView,
  type MemorySource,
} from "@/features/memory/memory.schema";
import { readCallConversation } from "@/features/thursday/thursday.query";

const GONE =
  "Deleted for good. The listing in your instructions is from when this session opened and still shows it that way until the next one.";

const WROTE =
  "Saved. The listing in your instructions is from when this session opened and will not show this until the next one — the note below is current.";

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

/** Why a fact has no conversation to open, by the hand that wrote it. */
const noConversation = (source: MemorySource | null) =>
  source === "user"
    ? "Typed on the screen — there is no conversation behind it."
    : source === "bot"
      ? "Saved by a bot during a job — there is no conversation behind it."
      : "The conversation it was saved in is not kept.";

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
 * @param source Which hand these writes are recorded under. The runtime knows
 * it without being told, so no model ever chooses it (load-tools,
 * memory.schema MemorySource).
 * @param callId The call these tools serve, when there is one: recorded on
 * what `memory_remember` writes, and the conversation `memory_conversation`
 * does not hand back because the model is already in it.
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
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Exactly as the listing writes it — the path, or one of the names in quotes after it.",
        ),
    }),
    execute: async ({ path }) => {
      const { notes } = await readNotes([path], { touch: countReads });
      const note = notes[0];
      // A missing note is an answer to relay, not a reason to retry spellings
      if (!note)
        return { note: `Nothing on the listing called ${path.trim()}.` };
      const over = overSize(note.facts.length);
      return over ? { ...withCount(note), note: over.trim() } : withCount(note);
    },
  }),

  [TOOL_NAMES.memory_remember]: tool({
    description: `Write to one note: facts, and the line the listing shows for it. The path is the key — a path not on the listing is created (with at least one fact), one that is gets amended.`,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Exactly as the listing writes it, or a new path following the same convention.",
        ),
      facts: z
        .object({
          text: z
            .string()
            .describe(
              'One statement that stands on its own later — a date as a date, never "next week".',
            ),
          replaces: z
            .number()
            .int()
            .nullish()
            .describe(
              "The id of the fact this replaces — from this note as handed back here or by `memory_recall`. Null if this is new. A fact that stopped being true is replaced rather than deleted, and so is a note saying the same thing twice: replacing keeps what changed on the record, deleting does not.",
            ),
          alwaysLoad: z
            .boolean()
            .nullish()
            .describe(
              `True carries this line into every call's instructions without opening its note — for what every call needs before any note is opened: what to call them, their language and register. At most ${MEMORY_LIMITS.carried}. Null leaves it; false makes a carried line an ordinary fact.`,
            ),
        })
        .array()
        .nullish()
        .describe(
          "What to write under this note. Send everything that came up at once: one call is one pause in the conversation, three calls are three. Null when only naming it.",
        ),
      description: z
        .string()
        .nullish()
        .describe(
          `One line saying what this note is about, not what it currently says. Give it for a new note, or when the line no longer fits. Null leaves it; ${APP_NAMED_NOTES.join(", ")} keep their own line.`,
        ),
      aliases: z
        .string()
        .array()
        .nullish()
        .describe(
          'What the user calls this note out loud, in the language they say it — the words they would use to ask for it, not the facts inside. A note at people/yuri might be "Yuri" and "my wife". Replaces the set it has, so send the whole set. Null leaves it.',
        ),
    }),
    execute: async (input) => {
      // Resolve the name the way recall does (memory.query resolveNotePath), so a note opened by alias is written to itself, not inbox
      const said = input.path.trim();
      const known = await resolveNotePath(said);
      const aliases = input.aliases ?? null;
      // The listing line of the app-named notes is the app's (memory.schema
      // isAppNamed); the model's description is ignored there and its own line
      // written instead, so the inbox cannot end up described by whatever fell
      // into it. `alwaysLoad` is not forced on them: the first-call opener
      // (thursday.prompt) asks the model to set it.
      const target = known ?? said;
      const description = isAppNamed(target)
        ? appNoteLine(target)
        : input.description?.trim() || null;
      const facts = input.facts ?? [];
      if (!facts.length && !description && !aliases) {
        return {
          note: "Nothing to write: send facts, a line, names, or any of them.",
        };
      }
      // Naming amends, never creates: a note without facts is not listed (memory.query listNoteIndex)
      if (!known && !facts.length) {
        return {
          note: `Nothing on the listing called ${said}. A note comes into being with a fact — send at least one.`,
        };
      }
      // A new path outside the convention goes to inbox, which keeps its own line and takes no aliases
      const toInbox = !known && !isMemoryPath(said);
      const filed = toInbox
        ? {
            path: MEMORY_INBOX,
            description: appNoteLine(MEMORY_INBOX),
            facts,
          }
        : { path: target, description, aliases, facts };

      const write = await writeNotes([filed], source, callId);

      // The write already succeeded; what follows are requests, not failures.
      // Only a path that landed in inbox is said: one reached by a name the
      // listing carries is where it was asked for, however it was spelled.
      const elsewhere = toInbox
        ? ` Filed under ${filed.path}: "${said}" is not a path this listing can carry. If that is not where it belongs, write it again under one that is.`
        : "";

      const unnamed = write.unnamed.length
        ? ` ${write.unnamed[0]} is new and has no line yet — the listing shows its first fact instead. Call again with \`description\` (one line about what it is) and \`aliases\` (the names they say for it).`
        : "";
      // Carried lines are full: saved as an ordinary fact, and the user picks what to drop (config MEMORY_LIMITS.carried)
      const notLoaded = write.notLoaded.length
        ? ` All ${MEMORY_LIMITS.carried} carried lines are taken, so ${write.notLoaded
            .map((text) => `"${text}"`)
            .join(
              ", ",
            )} saved as an ordinary fact. Say which carried line you would drop for it and let them choose.`
        : "";
      const written = withCount(write.notes[0]);
      return {
        ...written,
        note: `${WROTE}${elsewhere}${unnamed}${notLoaded}${overSize(written.factCount)}`,
      };
    },
  }),

  [TOOL_NAMES.memory_conversation]: tool({
    description:
      "Open the conversation a fact was saved in, whole: what each side said, and which tools were used.",
    inputSchema: z.object({
      factId: z
        .number()
        .int()
        .describe("The id that came with the fact when its note was opened."),
      page: z
        .number()
        .int()
        .min(1)
        .nullish()
        .describe(
          `${MEMORY_CONVERSATION_PAGE} turns a page, oldest first. Null for the first.`,
        ),
    }),
    execute: async ({ factId, page }) => {
      const fact = await findFactCall(factId);
      if (!fact) return { note: `No fact with id ${factId}.` };
      if (!fact.callId) return { note: noConversation(fact.source) };
      // Already in the model's context: handing it back only spends it twice
      if (fact.callId === callId) {
        return {
          note: "Said in this call — it is the conversation you are in.",
        };
      }

      const at = page ?? 1;
      const read = await readCallConversation(
        fact.callId,
        at,
        MEMORY_CONVERSATION_PAGE,
      );
      if (!read) return { note: noConversation(fact.source) };
      const pages = Math.max(
        1,
        Math.ceil(read.total / MEMORY_CONVERSATION_PAGE),
      );
      if (at > pages) {
        return {
          note: `That conversation has ${pages} page${pages > 1 ? "s" : ""}.`,
        };
      }
      return {
        when: callStamp(read.startedAt),
        page: at,
        pages,
        conversation: conversationLines(read.turns),
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
      const missing: number[] = [];
      /** Notes that lost their last fact, and went with it (memory.query forgetFactById). */
      const gone: string[] = [];
      /** Notes that still hold something, handed back as they are now. */
      const left = new Set<string>();
      for (const id of new Set(factIds)) {
        const forgotten = await forgetFactById(id);
        if (!forgotten) {
          missing.push(id);
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
          note: `No fact with id ${missing.join(", ")}. Nothing was deleted.`,
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
        missing.length
          ? `No fact with id ${missing.join(", ")}, so those were skipped.`
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
