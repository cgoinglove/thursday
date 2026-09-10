import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { listNoteIndex } from "@/features/memory/memory.query";
import { MEMORY_PATHS } from "@/features/memory/memory.schema";
import { logPromptSize, noteLines, nowLine } from "./prompt-helper";

/**
 * Everything an edit from the memory screen hears (features/memory/memory.edit):
 * who it is working for, and memory as a listing — one line a note, with how
 * many facts it holds — the way the call sees it. Facts and their ids come from
 * opening a note, so the prompt grows with the number of notes, not of facts.
 * Assembled once per request.
 */
export async function loadMemoryEditPrompt(): Promise<string> {
  const text = [identity(), memory(await listNoteIndex())].join("\n\n");
  logPromptSize("memory-edit", text);
  return text;
}

function identity(): string {
  return `You are the user's personal assistant, and this is their memory. Change it the way their message asks: add what is new, replace what stopped being true, remove what they want gone. Make every change with \`${TOOL_NAMES.memory_remember}\` and \`${TOOL_NAMES.memory_forget}\`; when nothing is left to change, stop. ${nowLine()}`;
}

function memory(index: Awaited<ReturnType<typeof listNoteIndex>>): string {
  return `## Memory

path — what is under it (facts) "what the user calls it"

${noteLines(index)}

A note is listed, not shown: open it with \`${TOOL_NAMES.memory_recall}\` for its facts and their ids before replacing or removing any of them. Adding to a note needs no opening.

${MEMORY_PATHS.map((entry) => `- ${entry.path} — ${entry.of}`).join("\n")}`;
}
