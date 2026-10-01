import { listNoteIndex, readNotes } from "@/features/memory/memory.query";
import { MEMORY_ALWAYS_LISTED } from "@/features/memory/memory.schema";
import { logPromptSize, saidStamp } from "./prompt-helper";
import { memoryChapter } from "./thursday.prompt";

/**
 * Everything the pass after a spoken call hears (memory/call-memory): what it is for and what
 * it keeps, then memory as the call's backend sees it, by the same rules (thursday.prompt
 * memoryChapter). The call itself is the one user turn. What never changes goes first, so the
 * passes after one call and the next read it from the provider's cache.
 */

export type CallMemoryRead = {
  /** When the call began: the day a relative date in it counts from. */
  startedAt: Date;
  /** What was said, in spoken order (thursday.query listCallTalk). */
  talk: { role: "user" | "assistant"; text: string }[];
  /** Whether turns before these were left out (config CALL_MEMORY.turns). */
  clipped: boolean;
  /** What the call kept as it went (memory.query listCallFacts). */
  kept: { id: number; path: string; text: string }[];
};

export async function loadCallMemoryPrompt(
  read: CallMemoryRead,
): Promise<{ system: string; user: string }> {
  const [index, open] = await Promise.all([
    listNoteIndex(),
    // Written out in the prompt, which is not the user asking for them: no read counted
    readNotes(MEMORY_ALWAYS_LISTED, { touch: false }),
  ]);
  const system = [IDENTITY, KEEP, memoryChapter(index, open.notes, true)].join(
    "\n\n",
  );
  const user = [transcript(read), kept(read.kept)].join("\n\n");
  logPromptSize("call-memory", `${system}\n\n${user}`);
  return { system, user };
}

const IDENTITY = `You read a spoken call after it ended. On it the user talked with Thursday, their voice assistant, whose voice alone decided what reached the part of her that keeps memory, and it often kept nothing of what they said about themselves. You keep it now. Nobody is on the line, and nothing you write is said.`;

const KEEP = `## What to keep

The transcript is speech recognition: it can mishear, cut a phrase short, or carry a correction later on. Go by the latest and clearest of what they said.

Keep only what the user said about themselves and their life: who they are, the people in it, what they are going through or working toward, what they like or cannot stand and why, and how they want things done and said. What they actually said, never a guess, never what Thursday said or assumed, and nothing they asked not to keep. Small talk, the weather, a passing reaction and the requests themselves are not facts about them.

What memory already holds, and what was kept during this call (listed after it), is not written again; what changes or narrows one of those replaces it. A date said relative to the call is written as the date it means from the day of the call.

Most calls hold little that is new, and some nothing: then write nothing. Send each note's facts in one write, and when you are done, reply \`done\`.`;

/** The call, speaker by speaker, under the time it began. */
function transcript(read: CallMemoryRead): string {
  const lines = read.talk.map(
    (turn) => `${turn.role === "user" ? "user" : "Thursday"}: ${turn.text}`,
  );
  return `## The call

${saidStamp(read.startedAt)}${read.clipped ? ", its last part" : ""}:

${lines.join("\n")}`;
}

/** What the call kept as it went, with the ids `replaces` takes. */
function kept(facts: CallMemoryRead["kept"]): string {
  return `## Kept during this call

${facts.length ? facts.map((fact) => `- ${fact.path}: ${fact.text} #${fact.id}`).join("\n") : "Nothing."}`;
}
