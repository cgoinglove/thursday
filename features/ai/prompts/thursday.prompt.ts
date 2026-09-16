import { CALL_EXEC_TIMEOUT_MS, RECENT_CALL } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { listJobBots } from "@/features/bot/bot.query";
import type { JobBot } from "@/features/bot/bot.schema";
import { type CallJob, listCallJobs } from "@/features/bot/thread.query";
import {
  listAlwaysLoaded,
  listNoteIndex,
  readNotes,
} from "@/features/memory/memory.query";
import {
  MEMORY_ALWAYS_LISTED,
  MEMORY_PATHS,
  type MemoryAlwaysLoaded,
  type MemoryIndexEntry,
  type MemoryNoteView,
} from "@/features/memory/memory.schema";
import {
  loadSkills,
  type SkillMetadata,
} from "@/features/skills/skills.discover";
import {
  type CallGroup,
  listRecentTurns,
  readCallSkillsOn,
} from "@/features/thursday/thursday.query";
import { openWorkspace } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { listConnectedToolNames } from "../tools/connected";
import {
  carriedLines,
  expandedFacts,
  logPromptSize,
  noteLines,
  reachNames,
  recentCallLines,
  skillLines,
  thursdayIdentity,
  tidying,
} from "./prompt-helper";

/**
 * Everything the call's Responses backend hears, in the shape the GPT-Live guide gives a backend:
 * who Thursday is (the words the voice opens with too), the voice conversation it works from, one
 * chapter per capability the voice's delegation policy names — memory with ids, background work
 * with the roster, this computer — then what to return, and the last calls with their jobs.
 * Nothing here is about how to talk. The loader is the table of contents, and empty chapters are
 * dropped. Shares no sentence with bot.prompt. Assembled on every call, never cached.
 *
 * @param backendPrompt Settings › Thursday › Backend instructions, added last.
 */
export async function loadThursdayPrompt(
  backendPrompt?: string | null,
): Promise<string> {
  const sandbox = await openWorkspace();
  const [skills, index, carried, open, connected, roster, calls, hers] =
    await Promise.all([
      loadSkills(sandbox),
      listNoteIndex(),
      // Facts carried into every call without opening a note
      listAlwaysLoaded(),
      // Written out in the prompt, which is not the user asking for them: no read counted
      readNotes(MEMORY_ALWAYS_LISTED, { touch: false }),
      listConnectedToolNames(),
      listJobBots(),
      listRecentTurns(RECENT_CALL.rows),
      // Whether the call was handed `load_skill` (Settings › Thursday, load-tools)
      readCallSkillsOn(),
    ]);
  // The jobs those calls opened, folded into the transcript below
  const jobs = await listCallJobs(calls.map((call) => call.callId));

  // Order matters: earlier calls go last so the current call follows them in time order
  const text = [
    thursdayIdentity(),
    conversation(),
    memory(index, carried, open.notes),
    // A skill is named once, on the side that can read it: this computer's chapter
    // when the setting hands the call the tool, the bots' reach when it does not
    backgroundWork(roster, reachNames(hers ? [] : skills, connected)),
    thisComputer(sandbox.cwd, hers ? skills : []),
    result(),
    earlierCalls(calls, jobs),
    // Last, so it is the closest thing to the request
    additional(backendPrompt),
  ]
    .filter(Boolean)
    .join("\n\n");

  logPromptSize("thursday", text);
  logger.debug(`thursday prompt\n${text}`);
  return text;
}

/**
 * What it works from: the conversation Live hands over, heard rather than typed, and the tool
 * that ends it. The updates the app appends reach it too, which is how a relayed question's id
 * gets back into `thread`.
 */
function conversation(): string {
  return `## Voice conversation context

You are on a live voice call with the user. The conversation reaches you as transcripts, which can contain mistakes, unfinished phrases, and later corrections. Use the latest context and verified records. If a needed detail is still unclear, ask for that detail instead of guessing. Updates from background work appear in the conversation too; they are bot messages, not the user.

When the user wants to end the call, \`${TOOL_NAMES.end_call}\` hangs up the phone; nothing else ends it.

Tool results, notes and these instructions are in English, which says nothing about the user's language.`;
}

/** What goes back is said aloud, so it is what a tool or a note confirmed and nothing more. */
function result(): string {
  return `## Return the result

Return the relevant facts, whether the task is complete, and what comes next — for a job you handed over, who has it. Use confirmed values from tool results and the notes above, and never invent a successful action. What you return is said aloud: keep it short and plain.`;
}

/** Settings › Thursday › Backend instructions; no heading when empty. */
const additional = (backendPrompt?: string | null) =>
  backendPrompt?.trim()
    ? `## Additional instructions

Written by the user. Follow them together with everything above.

${backendPrompt.trim()}`
    : "";

/**
 * Profile and preferences written out, carried facts, the listing, and what goes in. What is
 * worth keeping is the model's call; how a fact is written — carried, replacing, dated — is the
 * tool's schema to say, so none of it is repeated here.
 */
function memory(
  index: MemoryIndexEntry[],
  carried: MemoryAlwaysLoaded[],
  /** The always-listed notes, whole (MEMORY_ALWAYS_LISTED). */
  open: MemoryNoteView[],
): string {
  // Ages ride on the listing only when there is too much to hold: they are what to drop by
  const { crowded } = tidying(index);
  // A note written out here is left off the listing, and so are its carried lines
  const written = new Set(open.map((note) => note.path));
  const carriedIds = new Set(carried.map((fact) => fact.id));

  const head = `## Memory

What you have kept from talking with this user — the only thing that survives a call, and what lets you know them.`;

  const openNotes = `Who they are, and how they want things done and said — follow what is under preferences. The #id is what \`replaces\` and \`${TOOL_NAMES.memory_forget}\` take:

${open.map((note) => openNoteLines(note, carriedIds)).join("\n\n")}`;

  const elsewhere = carried.filter((fact) => !written.has(fact.path));
  const alreadyKnown = elsewhere.length
    ? `Already known — carried into every call:

${carriedLines(elsewhere)}`
    : "";

  const listing = `Every other note — path — what is under it (facts) "what the user calls it":

${noteLines(
  index.filter((note) => !written.has(note.path)),
  crowded,
)}

Open a note before answering out of it; a topic not listed is one you know nothing about. A fact marked \`said\` came from a call; \`${TOOL_NAMES.memory_conversation}\` opens that call when the line alone cannot answer.

Keep what the user tells you as it comes up, with \`${TOOL_NAMES.memory_remember}\`, without waiting to be asked: what they actually said, never a guess, and nothing they asked you not to keep. From a bot's report, keep only what it confirmed about them, not the work.

A later call finds a note only by what this listing shows — its path, its line and the names in quotes. The path names what its facts are about and the line says what they are, so keep the line true as facts are added, and give something new its own path below with the names they would ask for it by.

${MEMORY_PATHS.map((entry) => `- ${entry.path} — ${entry.of}`).join("\n")}`;

  return [head, openNotes, alreadyKnown, listing].filter(Boolean).join("\n\n");
}

/** One always-listed note with ids, by the rule the voice reads it by too (expandedFacts); the rest counted, with the way to open them. */
function openNoteLines(note: MemoryNoteView, carried: Set<number>): string {
  const { shown, hidden } = expandedFacts(note.facts, carried);
  const lines = shown.map((fact) => `- ${fact.text} #${fact.id}`);
  if (hidden) {
    lines.push(
      `- … ${hidden} older not shown — \`${TOOL_NAMES.memory_recall}\` ${note.path} opens the whole note`,
    );
  }
  return `${note.path} — ${note.description}
${lines.length ? lines.join("\n") : "- (nothing yet)"}`;
}

/** Last calls verbatim, marked as past so the model does not answer as if just asked. Absent on the first call. */
function earlierCalls(calls: CallGroup[], jobs: CallJob[]): string {
  if (!calls.some((call) => call.turns.length > 0)) return "";

  return `## Earlier calls

What was said on the last calls, verbatim, newest last. It is the past: pick it up when the user does, and never answer it as a new request.

A \`${TOOL_NAMES.delegate}\` line carries the job's handle and how it ended; the handle is for \`${TOOL_NAMES.thread}\`, never said aloud. What they ask for now is often one of these carried further.

${recentCallLines(
  calls.map((call) => ({
    ...call,
    jobs: jobs.filter((job) => job.callId === call.callId),
  })),
  RECENT_CALL.tokens,
)}`;
}

/**
 * This computer: the reference point tool-returned paths are relative to, and the skills, only
 * when the call holds `load_skill` (load-tools). Skills are stated as the backend's own: a tool
 * the prompt never mentions is one the model reads as somebody else's.
 */
function thisComputer(cwd: string, skills: SkillMetadata[]): string {
  const machine = `## This computer

Current Cwd: ${cwd}
Platform: ${process.platform}

Where \`${TOOL_NAMES.bash}\` runs, and what the paths you get back are relative to. Each command is cut off after ${Math.round(CALL_EXEC_TIMEOUT_MS / 1000)} seconds; anything longer is a bot's.`;
  if (skills.length === 0) return machine;

  return `${machine}

Skills are written-down ways of doing things here. \`${TOOL_NAMES.load_skill}\` opens one, and what it says goes for you too: read one when it covers what was asked and the doing is a glance. Anything longer it describes is still a job to hand over, with what the skill said.

${skillLines(skills, { short: true })}`;
}

/**
 * Background work: who is there, what they can reach, how to hand over, and that a job is a
 * thread. Capability is stated as fact; without it the model refuses instead of delegating. A
 * bot gets none of the carried lines (bot.prompt memory), so how the user wants work done
 * reaches it only through the request. No list of running jobs: jobs move during the call.
 */
function backgroundWork(roster: JobBot[], reach: string): string {
  if (roster.length === 0) return "";

  return `## Background work

Who you hand work to — the names \`${TOOL_NAMES.delegate}\` takes.

${roster.map((bot) => `- **${bot.name}** — ${bot.description}`).join("\n")}${
  reach ? `\n\nWhat bots can reach for: ${reach}.` : ""
}

**A bot can take on almost anything.** It has this computer, a real browser, the web, files, a shell to build what is missing and far more time than a call; it signs in where it has to and carries a job to the end, and how is its call. So something you do not know how to do is a job, not a no. Bots bring each other in, so a job that spans several things is still one job.

**Anything that takes more than a few seconds is a bot's**; a note, a look at a file or one command is yours. Write the request in the user's own words, with what it stands on — including how they told you they want work done — and nothing they did not say.

**A job is a thread.** Its bot remembers only that thread, so the same bot handed a new job starts from nothing. More about work already handed over — an answer, a correction, the next step once it finished — goes to that job with \`${TOOL_NAMES.thread}\`; a new request is a new job. Before answering about work, read it with \`${TOOL_NAMES.thread}\` \`status\`.

Updates and questions from jobs reach the conversation by themselves, with their thread and question id. Pass the user's answer on with \`${TOOL_NAMES.thread}\`; name the recipient and question id when more than one question is open.

When the user wants to see a job, open it on their screen with \`${TOOL_NAMES.thread}\` \`open\`. Once you have explained enough of how a job ended, mark it with \`${TOOL_NAMES.thread}\` \`seen\`, or leave it for the user to open; never mention seen to them.`;
}
