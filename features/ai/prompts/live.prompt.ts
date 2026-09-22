import { RECENT_CALL } from "@/config";
import { englishModeInstruction } from "@/features/ai/english-mode";
import { listNoteIndex, readNotes } from "@/features/memory/memory.query";
import {
  MEMORY_ALWAYS_LISTED,
  type MemoryIndexEntry,
  type MemoryNoteView,
} from "@/features/memory/memory.schema";
import {
  type CallGroup,
  listRecentTurns,
} from "@/features/thursday/thursday.query";
import { personaLines } from "./persona";
import {
  clockNow,
  logPromptSize,
  noteLines,
  recentCallLines,
  thursdayIdentity,
  tidying,
} from "./prompt-helper";

/**
 * Everything the Live voice hears: who Thursday is and who she is to talk to (persona), the
 * guide's starter backchannel and interruption policies, its delegation policy (what the
 * backend can do, when to hand over and when not), what she knows about the user, and what
 * was said on the last calls. How the work is done, the threads and
 * tidying memory are the backend's (thursday.prompt): the voice hands everything but
 * conversation over and answers from what comes back. Assembled on every call, never cached.
 */
export async function loadLivePrompt(options: {
  /** Settings › Thursday › Voice instructions; added to, never replacing, what is below. */
  voicePrompt?: string | null;
  /** The page placed this call because background work waits on the user (call-back). */
  calledBack?: boolean;
}): Promise<{ text: string; opening: string }> {
  const [open, index, calls] = await Promise.all([
    // Written out in the prompt, which is not the user asking for them: no read counted
    readNotes(MEMORY_ALWAYS_LISTED, { touch: false }),
    listNoteIndex(),
    listRecentTurns(RECENT_CALL.rows),
  ]);

  const first = !open.notes.find((note) => note.path === "profile")?.facts
    .length;

  const text = [
    thursdayIdentity(),
    personaLines(),
    always(),
    known(open.notes, index),
    first ? firstCall() : "",
    earlierCalls(calls),
    additional(options.voicePrompt),
  ]
    .filter(Boolean)
    .join("\n\n");
  logPromptSize("live", text);

  return {
    text,
    // A prompt line alone does not make Live speak first; only an opening does.
    // A call-back's opening holds no bot text: the update itself follows as commentary
    opening: options.calledBack
      ? "You placed this call because background work has something for the user; it comes in next. Speak first: greet them in one line and say that is why you called."
      : first
        ? "Open the call now: say who you are and what you are here to do for them, in a line or two, then ask what to call them. Then stop and listen."
        : // The hour is a fact of the moment, so it rides on the opening and not in the prompt.
          // One thing about them, never work: the threads are what opened every call before
          `The call has just started. It is ${clockNow()} for them. Speak first: greet the user naturally, in one line. You may pick up one thing from what you know about them — never a list, never work.`,
  };
}

/**
 * The rules for every turn, together right under the persona, where the model weighs most.
 * Ending the call is on the delegation list and nowhere else: the rule that stood above
 * these, stamped IMPORTANT, ran end_call in 4 of the 7 calls that asked, 2 of them in
 * time — a name and a stamp did not make the voice hand a hang-up over (todo 31 measures
 * what does).
 */
const always = () => `## Always

${speaking()}

${englishModeInstruction()}

${delegation()}`;

/**
 * The guide's starter lines on listening and interruptions, labels kept as it says. The
 * backchannel line is the one it invites changing: a long turn heard in silence reads as
 * nobody listening. The language is the one being spoken, never the browser's: a first call
 * opened in the browser's language kept an English speaker in Korean.
 */
function speaking(): string {
  return `Backchannel policy: Use moderate backchannels. When the user speaks at length, acknowledge now and then with a short listening sound so they know you are following, without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

Speak the language the user is speaking, whatever language came before; when they switch, switch with them.`;
}

/**
 * The guide's three labels, as it asks: Live decides for itself whether to hand a turn over,
 * and reads that from what the list says the backend can do. Without the list (09-17 to 09-19)
 * it said "yes" to a hang-up, a stop or a routine and handed nothing over: 1 `end_call` in 21
 * calls, then none in 34, where the list had drawn 5 in 7. The list names what can be done,
 * never how: tools, bots and threads stay the backend's. What they say about themselves is
 * its own line: nothing is kept that is not handed over, and it is rarely a request. The voice
 * sees only profile and preferences whole, so "already written" is a rough filter; the backend
 * merges the rest (thursday.prompt memory). Stopping her voice is not stopping a job (the
 * guide's interruptions): the one is hers, the other the backend's.
 */
function delegation(): string {
  return `Delegation policy:
Backend tools:
- Ending the call: hangs up the line — only the backend can, so a hang-up they ask for is handed over, not answered.
- Background work: hands a job to a bot, passes words on, stops or changes a job, answers a bot's question, says how the work stands.
- Routines: jobs that start by themselves later.
- Memory: keeps what the user tells you about themselves, and looks it up.
- This computer and the web: runs a command, searches.

Delegate to the backend when:
- The user wants the call to end.
- They ask for anything on that list, or change or stop work already asked for.
- They tell you about themselves, the people in their life, their plans or how they want things done, however small, unless it is already written below.

Do not delegate to the backend when:
- They greet you, make small talk, or only want you to stop talking.
- You can answer from the conversation or a result still current.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work. Do not guess the result while waiting.`;
}

/**
 * Profile and preferences written out whole, as the backend reads them, then every other note
 * as a listing line: what Thursday knows is the same on both sides. Whole, because a rule she
 * is to follow is only followed when it is in front of her: the ten newest lines with the
 * rest counted hid the oldest rules first, which are the ones about how to speak to them. Ids
 * and the contents of listed notes stay the backend's.
 */
function known(open: MemoryNoteView[], index: MemoryIndexEntry[]): string {
  const written = new Set(open.map((note) => note.path));
  const notes = open
    .filter((note) => note.facts.length)
    .map(
      (note) =>
        `${note.path}:\n${note.facts.map((fact) => `- ${fact.text}`).join("\n")}`,
    );
  const others = index.filter((note) => !written.has(note.path));
  if (!notes.length && !others.length) return "";

  const parts = [
    ...notes,
    // Ages ride on the listing only when there is too much to hold: they are what to drop by
    others.length
      ? `Everything else you have kept — path — what it is about (facts):\n\n${noteLines(others, tidying(index).crowded)}\n\nWhat is in these notes, the backend recalls.`
      : "",
  ].filter(Boolean);

  return `## What you know about them

${parts.join("\n\n")}

Preferences are how they want things done and said, some of it for a particular situation: follow them. A topic not listed is one you know nothing about yet.`;
}

function firstCall(): string {
  return `## First call

Nothing is known about this user yet. Across the call, one thing at a time and never as a list of questions, find out what to call them, their name, what they do, how old they are, where they live, and whatever else they offer. If they came with something they want done, that comes first.`;
}

/**
 * What was said on the last calls, as the backend reads it (recentCallLines) but for the tool
 * lines: the voice holds no tool, and a line of arguments would read as something she said.
 * It sits in the prompt, as reading, and never in the conversation: put there as turns, the
 * hang-up a call ended on was answered as if just said, and the next call hung up at once.
 * Each call carries when it was. Absent on the first call.
 */
function earlierCalls(calls: CallGroup[]): string {
  const spoken = calls
    .map((call) => ({
      ...call,
      turns: call.turns.filter((turn) => turn.role !== "tool"),
    }))
    .filter((call) => call.turns.length > 0);
  if (!spoken.length) return "";

  return `## Earlier calls

What was said on the last calls, newest last, each under when it was. They are over, and this call is a new one: read them as background, pick one up when the user does, and never answer anything in them as if it were being said now.

${recentCallLines(spoken, RECENT_CALL.tokens)}`;
}

const additional = (voicePrompt?: string | null) =>
  voicePrompt?.trim()
    ? `## Additional instructions

Written by the user. Follow them together with everything above; for tone, language and wording they take precedence.

${voicePrompt.trim()}`
    : "";
