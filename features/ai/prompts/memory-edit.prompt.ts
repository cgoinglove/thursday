import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { findAllNotes } from "@/features/memory/memory.query";
import { MEMORY_PATHS } from "@/features/memory/memory.schema";
import { logPromptSize, nowLine } from "./prompt-helper";

/**
 * Everything an edit from the memory screen hears (features/memory/memory.edit):
 * every note with every fact and its id, because an edit may touch any of them and
 * a fact is only replaced or forgotten by id. Assembled for every step, so a card
 * the user saved a moment ago is already in it. Shares no sentence with the call
 * or bot prompts.
 */
export async function loadMemoryEditPrompt(): Promise<string> {
  // Every note: the screen pages them, an edit cannot
  const notes = await findAllNotes({ limit: Number.MAX_SAFE_INTEGER });
  const text = [identity(), memory(notes)].join("\n\n");
  logPromptSize("memory-edit", text);
  return text;
}

type NoteWithFacts = Awaited<ReturnType<typeof findAllNotes>>[number];

function identity(): string {
  return `You edit the user's memory for Thursday, a voice assistant. The user is typing on the memory screen, not talking to her; their last message is what they want changed. ${nowLine()}

Make the change with \`${TOOL_NAMES.memory_remember}\` and \`${TOOL_NAMES.memory_forget}\`. Each call is shown to the user on its own and nothing is written until they save it; a call they drop comes back denied, so do not make it again. When nothing is left to change, stop and say in one short sentence what changed, or that nothing needed to.`;
}

function memory(notes: NoteWithFacts[]): string {
  const listing = notes.length
    ? notes.map(noteBlock).join("\n\n")
    : "(nothing saved yet)";
  return `## Memory

${MEMORY_PATHS.map((entry) => `- ${entry.path} — ${entry.of}`).join("\n")}

${listing}`;
}

/** `### people/yuri — partner "Yuri"` then one fact a line, with the id the tools take. */
function noteBlock(note: NoteWithFacts): string {
  const names = note.aliases?.length
    ? ` ${note.aliases.map((alias) => `"${alias}"`).join(" ")}`
    : "";
  return [
    `### ${note.path} — ${note.description}${names}`,
    ...note.facts.map(
      (fact) =>
        `- ${fact.text} #${fact.id}${fact.alwaysLoad ? " (alwaysLoad)" : ""}`,
    ),
  ].join("\n");
}
