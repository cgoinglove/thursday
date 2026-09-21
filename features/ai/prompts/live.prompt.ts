import { RECENT_CALL } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  listAlwaysLoaded,
  listNoteIndex,
  readNotes,
} from "@/features/memory/memory.query";
import {
  MEMORY_ALWAYS_LISTED,
  type MemoryAlwaysLoaded,
  type MemoryIndexEntry,
  type MemoryNoteView,
} from "@/features/memory/memory.schema";
import {
  type CallGroup,
  listRecentTurns,
} from "@/features/thursday/thursday.query";
import {
  carriedLines,
  clockNow,
  expandedFacts,
  logPromptSize,
  noteLines,
  recentCallLines,
  thursdayIdentity,
  tidying,
} from "./prompt-helper";

/**
 * Everything the Live voice hears: who Thursday is and how a call ends (the words the backend
 * opens with too), the guide's starter backchannel and interruption policies, its delegation
 * policy (what the backend can do, when to hand over and when not), what she knows about
 * the user, and what was said on the last calls. How the work is done, the threads and
 * tidying memory are the backend's (thursday.prompt): the voice hands everything but
 * conversation over and answers from what comes back. Assembled on every call, never cached.
 */
export async function loadLivePrompt(options: {
  /** Settings › Thursday › Voice instructions; added to, never replacing, what is below. */
  voicePrompt?: string | null;
  /** The page placed this call because background work waits on the user (call-back). */
  calledBack?: boolean;
}): Promise<{ text: string; opening: string }> {
  const [carried, open, index, calls] = await Promise.all([
    listAlwaysLoaded(),
    // Written out in the prompt, which is not the user asking for them: no read counted
    readNotes(MEMORY_ALWAYS_LISTED, { touch: false }),
    listNoteIndex(),
    listRecentTurns(RECENT_CALL.rows),
  ]);

  const first = !open.notes.find((note) => note.path === "profile")?.facts
    .length;

  const text = [
    thursdayIdentity(),
    always(),
    known(open.notes, carried, index),
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
        : // The hour is a fact of the moment, so it rides on the opening and not in the prompt
          `The call has just started. It is ${clockNow()} for them. Speak first: greet the user naturally, in one line.`,
  };
}

/**
 * The rules for every turn, together right under the identity, where the model weighs most.
 * One heading marks them; `IMPORTANT` stays on the ending rule alone, the one that failed
 * without it (09-17), so stamping it on all of them would thin it out.
 */
const always = () => `## Always

${ending()}

${speaking()}

${delegation()}`;

/**
 * How a call ends, as the voice can end it: it holds no tools, so it says yes and hands the turn
 * over, and the backend runs the tool. The rule both prompts shared until 09-20 ("forget every
 * other task, answer yes, then use the tool") left the voice saying yes and going quiet with the
 * line still open, four times in five. The tool is still named, the one name the voice sees, so
 * ending reads as something done rather than said.
 */
const ending = () =>
  `IMPORTANT — always follow this: when the user wants the call to end, however they say it, answer yes in one word of their language and hand it to the backend at once. Only the backend can end the line, with the ${TOOL_NAMES.end_call} tool; saying yes alone leaves it open.`;

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
- Ending the call: hangs up the line.
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
 * Profile and preferences written out by the same rule as the backend's (expandedFacts), carried
 * facts from other notes, then every other note as a listing line: what Thursday knows is the
 * same on both sides. Ids and the contents of listed notes stay the backend's.
 */
function known(
  open: MemoryNoteView[],
  carried: MemoryAlwaysLoaded[],
  index: MemoryIndexEntry[],
): string {
  const carriedIds = new Set(carried.map((fact) => fact.id));
  const written = new Set(open.map((note) => note.path));
  const notes = open
    .filter((note) => note.facts.length)
    .map((note) => {
      const { shown, hidden } = expandedFacts(note.facts, carriedIds);
      const lines = shown.map((fact) => `- ${fact.text}`);
      if (hidden) lines.push(`- … ${hidden} more in this note`);
      return `${note.path}:\n${lines.join("\n")}`;
    });
  const elsewhere = carried.filter((fact) => !written.has(fact.path));
  const others = index.filter((note) => !written.has(note.path));
  if (!notes.length && !elsewhere.length && !others.length) return "";

  const parts = [
    ...notes,
    elsewhere.length
      ? `Carried into every call:\n${carriedLines(elsewhere, { ids: false })}`
      : "",
    // Ages ride on the listing only when there is too much to hold: they are what to drop by
    others.length
      ? `Everything else you have kept — path — what it is about (facts) "what they call it":\n\n${noteLines(others, tidying(index).crowded)}\n\nWhat is in these notes, the backend recalls.`
      : "",
  ].filter(Boolean);

  return `## What you know about them

${parts.join("\n\n")}

Preferences are how they want things done and said: follow them. A topic not listed is one you know nothing about yet.`;
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
