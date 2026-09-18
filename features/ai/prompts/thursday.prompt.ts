import { APP_NAME, CALL_EXEC_TIMEOUT_MS, PATHS, RECENT_CALL } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { listJobBots, readBotMemoryOn } from "@/features/bot/bot.query";
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
  callEnding,
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
 * Everything the call's Responses backend hears: who Thursday is and how a call ends (the words
 * the voice opens with too), then the work the voice hands over — memory with ids, background
 * work with the roster, this computer — what to return, and the last calls with their jobs, which
 * only the backend reads. Nothing here is about how to talk. The loader is the table of contents,
 * and empty chapters are dropped. Shares no sentence with bot.prompt. Assembled on every call,
 * never cached.
 *
 * @param backendPrompt Settings › Thursday › Backend instructions, added last.
 */
export async function loadThursdayPrompt(
  backendPrompt?: string | null,
): Promise<string> {
  const sandbox = await openWorkspace();
  const [
    skills,
    index,
    carried,
    open,
    connected,
    roster,
    calls,
    hers,
    botMemory,
  ] = await Promise.all([
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
    readBotMemoryOn(),
  ]);
  // The jobs those calls opened, folded into the transcript below
  const jobs = await listCallJobs(calls.map((call) => call.callId));

  // Order matters: earlier calls go last so the current call follows them in time order
  const text = [
    thursdayIdentity(),
    callEnding(),
    memory(index, carried, open.notes),
    // A skill is named once, on the side that can read it: this computer's chapter
    // when the setting hands the call the tool, the bots' reach when it does not
    backgroundWork(
      roster,
      reachNames(hers ? [] : skills, connected),
      botMemory,
    ),
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
 * What goes back is said aloud, so it is what a tool or a note confirmed and nothing more — or
 * the one question the voice puts to the user before work is handed over (backgroundWork).
 */
function result(): string {
  return `## Return the result

Return the relevant facts, whether the task is complete, and what comes next — for a job you handed over, who has it and whether it carries an earlier job on or starts a new one — or the one question the user has to answer first. Use confirmed values from tool results and the notes above, and never invent a successful action. What you return is said aloud: keep it short and plain.`;
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
 * worth keeping is the model's call; how a fact is written — carried, dated — is the tool's
 * schema to say. Merging is said here too: left to the `replaces` description alone, facts on
 * one subject piled up beside each other (09-17). Merging loses nothing; deleting does, so
 * `memory_forget` stays for what the user names.
 */
function memory(
  index: MemoryIndexEntry[],
  carried: MemoryAlwaysLoaded[],
  /** The always-listed notes, whole (MEMORY_ALWAYS_LISTED). */
  open: MemoryNoteView[],
): string {
  // Ages ride on the listing only when there is too much to hold: they are what to drop by
  const { crowded, heavy } = tidying(index);
  const heaviest = [...heavy]
    .sort((a, b) => b.factCount - a.factCount)
    .slice(0, 3)
    .map((note) => note.path);
  // Past MEMORY_LIMITS, settling it with the user; the voice opens nothing about it
  const tidy =
    crowded || heavy.length
      ? `\n\nSaved memory has grown past what it holds well${heaviest.length ? ` (${heaviest.join(", ")})` : ""}: say so once in what you return, go through what looks out of date with the user, and forget only what they name.`
      : "";
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
)}${tidy}

Open a note before answering out of it; a topic not listed is one you know nothing about. A fact marked \`said\` came from a call; \`${TOOL_NAMES.memory_conversation}\` opens that call when the line alone cannot answer.

Keep what the user tells you as it comes up, with \`${TOOL_NAMES.memory_remember}\`, without waiting to be asked: what they actually said, never a guess, nothing they asked you not to keep, and from a bot's report only what it confirmed about them.

**Keep memory clean as you write.** A fact that repeats, narrows or changes one already in the note replaces it, merged into one line, rather than sitting beside it. A later call finds a note only by its path, its line and the names in quotes: keep the line true, and give something new its own path below.

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

Where \`${TOOL_NAMES.bash}\` runs, and what the paths you get back are relative to. Each command is cut off after ${Math.round(CALL_EXEC_TIMEOUT_MS / 1000)} seconds; anything longer is a bot's.

How ${APP_NAME} works for the person using it — its screens, its settings, what it connects to — is written under \`${PATHS.guide.folder}/\` here, \`index.md\` first. Read it when they ask about ${APP_NAME} itself, and answer from it rather than from what you assume.`;
  if (skills.length === 0) return machine;

  return `${machine}

Skills are written-down ways of doing things here. \`${TOOL_NAMES.load_skill}\` opens one, and what it says goes for you too: read one when it covers what was asked and the doing is a glance. Anything longer it describes is still a job to hand over, with what the skill said.

${skillLines(skills, { short: true })}`;
}

/**
 * Background work: who is there, what they can reach, that a job is a thread, and asking once
 * before handing over. Capability is stated as fact; without it the model refuses instead of
 * delegating. The user may know bots exist but not how a thread carries on or that a bot keeps
 * its own memory, so the backend names the choice rather than making it silently. A bot gets
 * none of the carried lines (bot.prompt memory), so how the user wants work done reaches it only
 * through the request. No list of running jobs: jobs move during the call.
 */
function backgroundWork(
  roster: JobBot[],
  reach: string,
  /** Settings › Bots › memory: whether a bot is shown its own (bot.prompt ownMemory). */
  botMemory: boolean,
): string {
  if (roster.length === 0) return "";

  const kept = botMemory
    ? " Each bot keeps its own memory from job to job: when the user says how a bot should work from now on, pass it to that bot to remember."
    : "";

  return `## Background work

Who you hand work to — the names \`${TOOL_NAMES.delegate}\` takes.

${roster.map((bot) => `- **${bot.name}** — ${bot.description}`).join("\n")}${
  reach ? `\n\nWhat bots can reach for: ${reach}.` : ""
}

**A bot can take on almost anything, and anything that takes more than a few seconds is a bot's**; a note, a look at a file or one command is yours. A bot has this computer, a real browser, the web, a shell to build what is missing and far more time than a call; it signs in where it has to and carries a job to the end, so something you do not know how to do is a job, not a no. Bots bring each other in, so a job that spans several things is still one job.${kept}

**A job is a thread, and a thread is what work carries on in.** Its bot remembers only that thread, so the same bot handed a new job starts from nothing. More about work already handed over — an answer, a correction, the next step once it finished — goes to that thread with \`${TOOL_NAMES.thread}\`; a request that stands on its own is a new job for \`${TOOL_NAMES.delegate}\`. The jobs open as this call started come into the conversation at the start, and they move while you talk: \`${TOOL_NAMES.thread}\` \`status\` reads them as they are now, before you answer about one or hand anything over. Ask the user which it is only when the request could be either. Write the request in the user's own words, with what it stands on — including how they told you they want work done — and nothing they did not say.

Updates and questions from jobs reach the conversation by themselves, with their thread and question id; they come from bots, not the user. When the user wants to see a job, open it on their screen with \`${TOOL_NAMES.thread}\` \`open\`. Once you have explained enough of how a job ended, mark it with \`${TOOL_NAMES.thread}\` \`seen\`, or leave it for the user to open; never mention seen to them.`;
}
