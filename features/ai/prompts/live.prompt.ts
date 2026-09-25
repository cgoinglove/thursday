import { RECENT_CALL } from "@/config";
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
  styleLines,
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
  /** Settings › Thursday › Style, in their own words: over the picked character, never replacing it. */
  stylePrompt?: string | null;
  /** The page placed this call because background work waits on the user (call-back). */
  calledBack?: boolean;
  /** Settings › Thursday › Style: which character she is on this call (persona). */
  persona?: string;
}): Promise<{ text: string; opening: string }> {
  const [open, index, calls] = await Promise.all([
    // Written out in the prompt, which is not the user asking for them: no read counted
    readNotes(MEMORY_ALWAYS_LISTED, { touch: false }),
    listNoteIndex(),
    listRecentTurns(RECENT_CALL.rows),
  ]);

  const first = !open.notes.find((note) => note.path === "profile")?.facts
    .length;
  const earlier = earlierCalls(calls);

  const text = [
    thursdayIdentity(),
    personaLines(options.persona),
    always(),
    known(open.notes, index),
    first ? firstCall() : "",
    earlier,
    styleLines(options.stylePrompt),
  ]
    .filter(Boolean)
    .join("\n\n");
  logPromptSize("live", text);

  return {
    text,
    // A prompt line alone does not make Live speak first; only an opening does.
    // A call-back's opening holds no bot text: the update itself follows as commentary.
    // Introducing herself is for a user never spoken to: with a profile still empty but
    // earlier calls read to her, that opening left her silent until the user spoke
    opening: options.calledBack
      ? "You placed this call because background work has something for the user; it comes in next. Speak first: greet them in one line and say that is why you called."
      : first && !earlier
        ? "Open the call now: say who you are and what you are here to do for them, in a line or two, then ask what to call them. Then stop and listen."
        : // The hour is a fact of the moment, so it rides on the opening and not in the prompt.
          // One thing about them, never work: the threads are what opened every call before
          `The call has just started. It is ${clockNow()} for them. Speak first: greet the user naturally, in one line. You may pick up one thing from what you know about them — never a list, never work.`,
  };
}

/**
 * The rules for every turn, together right under the persona, where the model weighs most.
 * Ending the call is on the delegation list and nowhere else: a rule of its own, even one
 * naming `end_call` and stamped IMPORTANT, did not make the voice hand a hang-up over.
 */
const always = () => `## Always

${speaking()}

${delegation()}`;

/**
 * The guide's starter lines on listening and interruptions, as it writes them: how much
 * anyone wants to be backchannelled at is how they want to be spoken to, which is theirs to
 * say and lives in their memory. The language is the one being spoken, never the browser's:
 * a first call opened in the browser's language kept a caller in the wrong one.
 */
function speaking(): string {
  return `Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

Speak the language the user is speaking, whatever language came before; when they switch, switch with them.`;
}

/**
 * The guide's three labels, as it asks: Live decides for itself whether to hand a turn over,
 * and reads that from what the list says the backend can do. Without the list it said "yes"
 * to a hang-up, a stop or a routine and handed nothing over. The list names what can be done,
 * never how: tools, bots and threads stay the backend's. What they say about themselves is
 * its own line: nothing is kept that is not handed over, and it is rarely a request. It names
 * the kinds, reactions first: a complaint about how she talks otherwise passes as small talk. The voice
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
- They tell you something about themselves, however small, unless it is already written below: what they loved or could not stand and why, about you as well; what they are going through or working toward; good news; a story from their past; the people in their life; how they want things done.

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
