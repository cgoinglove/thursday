import { tool } from "ai";
import * as z from "zod";
import { appEvents } from "@/app/api/events/app-event.server";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  forgetFactById,
  readNotes,
  resolveNotePath,
  writeNotes,
} from "@/features/memory/memory.query";
import {
  ALWAYS_LOADED_MAX,
  isAlwaysListed,
  isMemoryPath,
  MANY_FACTS,
  MEMORY_ALWAYS_LISTED,
  MEMORY_INBOX,
} from "@/features/memory/memory.schema";

const GONE =
  "Deleted for good. The listing in your instructions is from when this session opened and still shows it that way until the next one.";

const WROTE =
  "Saved. The listing in your instructions is from when this session opened and will not show this until the next one — the note below is current.";

/** Attached only when a note past MANY_FACTS is actually opened, instead of a standing rule in the prompt. */
const tooMany = (path: string, count: number) =>
  ` ${path} carries ${count} facts — enough that it is worth tidying. Put it on screen with \`${TOOL_NAMES.memory_show}\` and ask which of it they no longer need.`;

export const createMemoryTools = () => ({
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
      const { notes } = await readNotes([path]);
      const note = notes[0];
      // A missing note is an answer to relay, not a reason to retry spellings
      if (!note)
        return { note: `Nothing on the listing called ${path.trim()}.` };
      return note.facts.length > MANY_FACTS
        ? { ...note, note: tooMany(note.path, note.facts.length).trim() }
        : note;
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
            .describe("One statement that stands on its own later."),
          replaces: z
            .number()
            .int()
            .nullable()
            .describe(
              "The id of the fact this replaces — from this note as handed back here or by `memory_recall`. Null if this is new. A fact that stopped being true is replaced rather than deleted, and so is a note saying the same thing twice: replacing keeps what changed on the record, deleting does not.",
            ),
          alwaysLoad: z
            .boolean()
            .nullable()
            .describe(
              `True carries this line into every call's instructions without opening its note — for what to call them, their language and register, a standing rule. At most ${ALWAYS_LOADED_MAX}. Null leaves it; false makes a carried line an ordinary fact.`,
            ),
        })
        .array()
        .nullable()
        .describe(
          "What to write under this note. Send everything that came up at once: one call is one pause in the conversation, three calls are three. Null when only naming it.",
        ),
      description: z
        .string()
        .nullable()
        .describe(
          `One line saying what this note is about, not what it currently says. Give it for a new note, or when the line no longer fits. Null leaves it; ${MEMORY_ALWAYS_LISTED.join(" and ")} keep their own line.`,
        ),
      aliases: z
        .string()
        .array()
        .nullable()
        .describe(
          'What the user calls this note out loud, in the language they say it — the words they would use to ask for it, not the facts inside. A note at people/yuri might be "Yuri" and "my wife". Replaces the set it has, so send the whole set. Null leaves it.',
        ),
    }),
    execute: async (input) => {
      // Resolve the name the way recall does (memory.query resolveNotePath), so a note opened by alias is written to itself, not inbox
      const said = input.path.trim();
      const known = await resolveNotePath(said);
      const aliases = input.aliases ?? null;
      // The listing line of the always-listed notes belongs to the app (memory.query ensureRootNotes);
      // the model's description is ignored there. `alwaysLoad` is not forced on them either:
      // the first-call opener (thursday.prompt) asks the model to set it.
      const owned = isAlwaysListed(known ?? said);
      const description = owned ? null : input.description?.trim() || null;
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
      const filed =
        known || isMemoryPath(said)
          ? { path: known ?? said, description, aliases, facts }
          : {
              path: MEMORY_INBOX,
              description: "Facts with nowhere obvious to go",
              facts,
            };

      const write = await writeNotes([filed]);

      // The write already succeeded; what follows are requests, not failures.
      // A path filed elsewhere must be said, or the model reports it saved where it asked.
      const elsewhere =
        filed.path !== said
          ? ` Filed under ${filed.path}: "${said}" is not a path this listing can carry. If that is not where it belongs, write it again under one that is.`
          : "";

      const unnamed = write.unnamed.length
        ? ` ${write.unnamed[0]} is new and has no line yet — the listing shows its first fact instead. Call again with \`description\` (one line about what it is) and \`aliases\` (the names they say for it).`
        : "";
      // Carried lines are full: saved as an ordinary fact, and the user picks what to drop (ALWAYS_LOADED_MAX)
      const notLoaded = write.notLoaded.length
        ? ` All ${ALWAYS_LOADED_MAX} carried lines are taken, so ${write.notLoaded
            .map((text) => `"${text}"`)
            .join(
              ", ",
            )} saved as an ordinary fact. Say which carried line you would drop for it and let them choose.`
        : "";
      return {
        ...write.notes[0],
        note: `${WROTE}${elsewhere}${unnamed}${notLoaded}`,
      };
    },
  }),

  [TOOL_NAMES.memory_show]: tool({
    description: `Put a note on the user's screen so they can see it while you
talk about it, and take it away again. They cannot edit it there — they say
what to drop and you drop it.`,
    inputSchema: z.object({
      path: z
        .string()
        .nullable()
        .describe(
          "The note to put on screen, exactly as the listing writes it. Null takes it away.",
        ),
    }),
    execute: async ({ path }) => {
      if (!path?.trim()) {
        appEvents.emit({ type: "memory-view", path: null });
        return { note: "Taken off the screen." };
      }
      // The screen gets only the path and reads facts over GET, so deletions show up on their own
      const { notes } = await readNotes([path], { touch: false });
      const note = notes[0];
      if (!note) {
        return { note: `Nothing on the listing called ${path.trim()}.` };
      }
      appEvents.emit({ type: "memory-view", path: note.path });
      return {
        ...note,
        note: "It is on their screen now, in this order. Ask what they no longer need, and forget only what they name.",
      };
    },
  }),

  [TOOL_NAMES.memory_forget]: tool({
    description: "Delete one fact for good.",
    inputSchema: z.object({
      factId: z
        .number()
        .int()
        .describe("The id that came with the fact when the note was opened."),
    }),
    execute: async ({ factId }) => {
      const forgotten = await forgetFactById(factId);
      if (!forgotten) {
        return { note: `No fact with id ${factId}. Nothing was deleted.` };
      }

      // The note goes with its last fact; the listing still shows it until the next session, so say so
      if (forgotten.noteGone) {
        return {
          note: `${GONE} That was the last fact under ${forgotten.path}, so the note went with it.`,
        };
      }
      const { notes } = await readNotes([forgotten.path], { touch: false });
      return { ...notes[0], note: GONE };
    },
  }),
});

/**
 * The bot's write. Same act under the same name, without what only the call can
 * do: no `replaces`, no carried lines, no naming a note — a bot has neither the
 * user in front of it nor the listing's history. Rare by nature; what the job
 * turned up belongs in the report, and only what outlives the job comes here.
 */
export const botRememberTool = tool({
  description:
    "Save a lasting fact about the user. Only for what outlives this job; what the job itself turned up goes in the report.",
  inputSchema: z.object({
    path: z
      .string()
      .describe(
        "Exactly as the listing writes it, or a new path following the same convention.",
      ),
    facts: z
      .string()
      .array()
      .describe("One statement each, standing on its own later."),
  }),
  execute: async ({ path, facts }) => {
    const said = path.trim();
    const written = facts.map((text) => text.trim()).filter(Boolean);
    if (!written.length) return { note: "Nothing to write: send a fact." };

    const known = await resolveNotePath(said);
    // A path outside the convention goes to inbox, as it does for the call
    const filed = known || isMemoryPath(said) ? (known ?? said) : MEMORY_INBOX;

    await writeNotes([
      { path: filed, facts: written.map((text) => ({ text })) },
    ]);

    // A write filed elsewhere must be said, or the report claims the wrong place
    return {
      note:
        filed === said
          ? `Saved to ${filed}.`
          : `Saved to ${filed}: "${said}" is not a path this listing can carry.`,
    };
  },
});
