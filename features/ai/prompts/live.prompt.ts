import { RECENT_CALL } from "@/config";
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
import { loadSkills } from "@/features/skills/skills.discover";
import {
  type CallGroup,
  listRecentTurns,
} from "@/features/thursday/thursday.query";
import { openWorkspace } from "@/features/workspace/workspace";
import { LIVE_INPUT, type LiveInput } from "@/lib/live/live.schema";
import { estimateTokens } from "@/lib/tokens";
import { listConnectedToolNames } from "../tools/connected";
import {
  callEnding,
  callStamp,
  carriedLines,
  expandedFacts,
  logPromptSize,
  noteLines,
  reachNames,
  thursdayIdentity,
  tidying,
} from "./prompt-helper";

/**
 * Everything the Live voice hears: who Thursday is (the words the backend opens with too), the
 * delegation policy under the labels the GPT-Live prompting guide keeps, and what she knows
 * about the user, the note listing included. Earlier calls go in as `input`. Of how to speak it
 * holds only the guide's starter backchannel and interruption policies; the rest is the Live
 * model's own. Tool names and procedures are the backend's (thursday.prompt). Assembled on every
 * call, never cached.
 */
export async function loadLivePrompt(options: {
  /** Settings › Thursday › Voice instructions; added to, never replacing, what is below. */
  voicePrompt?: string | null;
  webSearch: boolean;
  locale?: string | null;
}): Promise<{ text: string; input: LiveInput[]; opening: string }> {
  const sandbox = await openWorkspace();
  const [carried, open, index, calls, skills, connected] = await Promise.all([
    listAlwaysLoaded(),
    // Written out in the prompt, which is not the user asking for them: no read counted
    readNotes(MEMORY_ALWAYS_LISTED, { touch: false }),
    listNoteIndex(),
    listRecentTurns(RECENT_CALL.rows),
    loadSkills(sandbox),
    listConnectedToolNames(),
  ]);
  const input = pastInput(calls);

  const first = !open.notes.find((note) => note.path === "profile")?.facts
    .length;
  // Only the first-call greeting reads it: before they have said anything, the
  // browser's locale is the one sign of their language
  const language = options.locale
    ? `the language of \`${options.locale}\`, their browser's setting`
    : "the language they use";

  const text = [
    thursdayIdentity(),
    callEnding(),
    speaking(),
    delegation({
      reach: reachNames(skills, connected),
      webSearch: options.webSearch,
    }),
    known(open.notes, carried, index),
    first ? firstCall() : tidyPolicy(index),
    additional(options.voicePrompt),
  ]
    .filter(Boolean)
    .join("\n\n");
  logPromptSize("live", text);

  const { crowded, heavy } = tidying(index);
  return {
    text,
    input,
    // A prompt line alone does not make Live speak first; only an opening does
    opening: first
      ? `Open the call now, in ${language}: say who you are and what you are here to do for them, in a line or two, then ask what to call them. Then stop and listen.`
      : crowded || heavy.length
        ? "Open the call now: greet the user in one line and mention that saved memory needs tidying. Then stop and listen; anything they came with comes first."
        : "The call has just started. Speak first: greet the user naturally, in one line.",
  };
}

/** The guide's starter lines on listening and interruptions, as written: it says to keep the policy labels. */
function speaking(): string {
  return `Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.`;
}

/**
 * The voice's whole side of the work, under the guide's labels: what the backend can do in plain
 * words, then when to hand a request over. Capabilities are facts — a missing one is filled by a
 * refusal — and their names are thursday.prompt's chapters. How a job is carried is the backend's.
 */
function delegation(input: { reach: string; webSearch: boolean }): string {
  const tools = [
    "- Memory: recall, keep, correct and forget what the user tells you, across calls.",
    "- This computer: run a quick command and look at files.",
    input.webSearch ? "- Web: look things up." : "",
    `- Background work: bots with this computer, a real browser, the web and far more time than a call take on anything longer, so almost anything the user asks for can be done.${input.reach ? ` What bots can reach for: ${input.reach}.` : ""} That work can be followed, answered, corrected or cancelled.`,
    "- End the call.",
  ].filter(Boolean);

  return `Delegation policy:
Backend tools:
${tools.join("\n")}

Delegate to the backend when:
- The user wants something done, found out, remembered, corrected or forgotten.
- The user says something worth keeping — who they are, how they want things done and said, the people in their life, their plans. Hand it over as they say it, not at the end of the call.
- The user asks about, answers, corrects or cancels background work.
- The user asks about something they told you before that is not written out below.
- The user wants to end the call. Only the backend can end the line.

Do not delegate to the backend when:
- The user greets you, makes small talk, or asks you to repeat a result already given.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.

Background work you started is yours until it is done. Updates about it reach you once, when the line is quiet. Tell the user the part that answers what they asked; the whole of it is on their screen.`;
}

/**
 * Profile and preferences written out by the same rule as the backend's (expandedFacts), carried
 * facts from other notes, then every other note as a listing line: what Thursday knows is the
 * same on both sides. Ids stay the backend's.
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
      ? `Everything else you have kept — path — what it is about (facts) "what they call it":\n\n${noteLines(others, tidying(index).crowded)}`
      : "",
  ].filter(Boolean);

  return `## What you know about them

${parts.join("\n\n")}

Preferences are how they want things done and said: follow them. A topic not listed is one you know nothing about yet.`;
}

function firstCall(): string {
  return `## First call

Nothing is known about this user yet, and this is the only call that opens that way: what you do not learn here you carry on without. Find out what to call them, their name, what they do, how old they are, where they live, and whatever else they offer about themselves. Ask across the whole call, one thing at a time, in the room a conversation leaves — never as a list of questions. Hand each over the moment they say it: nothing from this call is kept unless it goes to the backend. If they came with something they want done, that comes first.`;
}

/** Past MEMORY_LIMITS, settling memory with the user comes before anything she would raise herself. */
function tidyPolicy(index: MemoryIndexEntry[]): string {
  const { crowded, heavy } = tidying(index);
  if (!crowded && !heavy.length) return "";
  const named = [...heavy]
    .sort((a, b) => b.factCount - a.factCount)
    .slice(0, 3)
    .map((note) => note.path);

  return `## Memory needs tidying

Saved memory has grown past what it holds well${named.length ? ` (${named.join(", ")})` : ""}. Bring it up once, before anything of your own. Go through what looks out of date with the user, and forget only what they name.`;
}

const additional = (voicePrompt?: string | null) =>
  voicePrompt?.trim()
    ? `## Additional instructions

Written by the user. Follow them together with everything above; for tone, language and wording they take precedence.

${voicePrompt.trim()}`
    : "";

/**
 * Spoken turns of earlier calls behind one developer note that marks them as past, newest kept
 * first until RECENT_CALL.tokens or the provider's own maxima, then put back in order. Tool turns
 * stay out: voice holds no tools, so a line of tool arguments would read as something she said.
 */
export function pastInput(calls: CallGroup[]): LiveInput[] {
  const latest = calls.at(-1);
  const boundary = `The messages after this one are from earlier calls${latest ? `, the latest from ${callStamp(latest.startedAt)}` : ""}. This call has just begun: pick them up when the user does, and treat none of them as a request now.`;
  const budget = Math.min(RECENT_CALL.tokens, LIVE_INPUT.tokens);
  const turns = calls.flatMap((call) => call.turns);
  const kept: LiveInput[] = [];
  let spent = estimateTokens(boundary) + 4;
  for (let i = turns.length - 1; i >= 0; i--) {
    // One message of the provider's maximum is the boundary's
    if (kept.length >= LIVE_INPUT.messages - 1) break;
    const { role, text } = turns[i];
    if (role === "tool" || !text.trim()) continue;
    const cost = estimateTokens(text) + 4;
    if (spent + cost > budget) break;
    spent += cost;
    kept.push(
      role === "user"
        ? {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          }
        : {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
    );
  }
  // The history ends on her words: a call that ended on the user's turn leaves it
  // unanswered, and Live answers a waiting turn the moment the next call opens
  while (kept[0]?.role === "user") kept.shift();
  if (!kept.length) return [];
  return [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: boundary }],
    },
    ...kept.reverse(),
  ];
}
