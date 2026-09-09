import { format } from "date-fns";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  listAlwaysLoaded,
  listNoteIndex,
} from "@/features/memory/memory.query";
import {
  ALWAYS_LOADED_MAX,
  MEMORY_INBOX,
  MEMORY_PATHS,
  type MemoryAlwaysLoaded,
  type MemoryIndexEntry,
} from "@/features/memory/memory.schema";
import type { OwedTurn } from "@/features/thursday/thursday.query";
import { logger } from "@/lib/logger";
import {
  carriedLines,
  logPromptSize,
  noteLines,
  nowLine,
} from "./prompt-helper";

/**
 * Everything the read-back hears (features/memory/memory.tidy). One system text
 * and one user turn, assembled fresh for the read so it lists memory as it
 * stands right now. Shares no sentence with the call or bot prompts.
 */

export type TidyRead = {
  /** The turns to read, oldest first, already cut to the window. */
  turns: OwedTurn[];
  /** Facts the calls themselves saved while they ran (memory.query listFactsWrittenBetween). */
  written: MemoryAlwaysLoaded[];
  /** True when older calls were dropped to fit the window. */
  clipped: boolean;
};

export async function loadTidyPrompt(
  read: TidyRead,
): Promise<{ system: string; user: string }> {
  const [index, carried] = await Promise.all([
    listNoteIndex(),
    listAlwaysLoaded(),
  ]);
  const system = [identity(), memory(index, carried), pass()].join("\n\n");
  const user = [transcript(read), written(read.written)].join("\n\n");
  logPromptSize("tidy", `${system}\n\n${user}`);
  logger.debug(`tidy prompt\n${system}\n\n${user}`);
  return { system, user };
}

/** Who this is: a reader after the fact, with nobody on the line. */
function identity(): string {
  return `You are the second reader of Thursday's memory. Thursday is a voice assistant; during a call she saves what she picks up one fact at a time, between sentences, and misses things. You read the same calls afterwards, whole and unhurried, and put memory right. Nobody hears you: there is no user on the line and nothing you write is spoken. ${nowLine()}`;
}

/** Memory as it stands: what is carried, what is listed, where things go. */
function memory(
  index: MemoryIndexEntry[],
  carried: MemoryAlwaysLoaded[],
): string {
  const known = carried.length
    ? `Carried into every call without opening a note (at most ${ALWAYS_LOADED_MAX}):

${carriedLines(carried)}`
    : `Nothing is carried into every call yet (at most ${ALWAYS_LOADED_MAX} lines can be).`;

  return `## Memory

The only thing that survives between calls. One note per subject; a fact is one line that stands on its own later.

${known}

path — what is under it (facts) "what the user calls it"

${noteLines(index)}

${MEMORY_PATHS.map((entry) => `- ${entry.path} — ${entry.of}`).join("\n")}

Open a note with \`${TOOL_NAMES.memory_recall}\` before writing into it; the listing shows counts, not contents.`;
}

/** What the read does and what it leaves alone. The judgement is the model's; the tools bound what it can touch. */
function pass(): string {
  return `## The read

Read what was said, then set memory against it. What came up and is not saved goes in with \`${TOOL_NAMES.memory_remember}\`: one fact per line, dates as dates, under the note it belongs to, with a description and the names they say for a new note. What is saved but the conversation shows has changed is corrected with \`replaces\`, never left standing beside the old line. What was already saved as it went is listed under the transcript; do not save it again, but a clumsy or doubled line among it is fair to replace, and one that is plainly wrong is fair to \`${TOOL_NAMES.memory_forget}\`.

A standing rule they laid down — what to call them, their language, how long an answer runs, when to hang up — is \`alwaysLoad\`. Carried lines are few, so one that has stopped earning its place goes back to ordinary with \`alwaysLoad\` false.

A fact in \`${MEMORY_INBOX}\` that now has an obvious home is written under that note and forgotten from the inbox.

Small talk, the weather, what she said back: not facts. This can end with nothing changed, and often does. When you are done, or there was nothing to do, call \`${TOOL_NAMES.tidy_done}\`.`;
}

/** The conversation as it went, grouped by call, speaker by speaker. */
function transcript(read: TidyRead): string {
  const lines: string[] = [];
  let open: string | null = null;
  for (const turn of read.turns) {
    if (turn.callId !== open) {
      open = turn.callId;
      lines.push(`### ${format(turn.startedAt, "yyyy-MM-dd (EEE) HH:mm")}`);
    }
    lines.push(`${turn.role === "user" ? "user" : "Thursday"}: ${turn.text}`);
  }

  const head = read.clipped
    ? `The most recent turns said since your last read. Older ones went past what fits and are not coming back — what matters most is here.`
    : `Everything said since your last read, oldest call first.`;

  return `## What was said

${head}

${lines.join("\n")}`;
}

/** What the calls saved as they went, so the read reconciles rather than repeats. */
function written(facts: MemoryAlwaysLoaded[]): string {
  if (!facts.length) {
    return `## Saved while it was said

Nothing.`;
  }
  return `## Saved while it was said

${carriedLines(facts)}`;
}
