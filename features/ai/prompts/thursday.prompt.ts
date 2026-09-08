import { RECENT_CALL } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { listJobBots } from "@/features/bot/bot.query";
import type { JobBot } from "@/features/bot/bot.schema";
import { type CallJob, listCallJobs } from "@/features/bot/task.query";
import type { McpToolRef } from "@/features/connectors/mcp.schema";
import {
  listAlwaysLoaded,
  listNoteIndex,
} from "@/features/memory/memory.query";
import {
  isAlwaysListed,
  MEMORY_PATHS,
  type MemoryAlwaysLoaded,
  type MemoryIndexEntry,
} from "@/features/memory/memory.schema";
import {
  loadSkills,
  type SkillMetadata,
} from "@/features/skills/skills.discover";
import {
  type CallGroup,
  listRecentTurns,
} from "@/features/thursday/thursday.query";
import { openWorkspace } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { listConnectedToolNames } from "../tools/connected";
import {
  carriedLines,
  type LoadedPrompt,
  mcpServerLines,
  noteLines,
  nowLine,
  recentCallLines,
  skillLines,
  tidying,
} from "./prompt-helper";

/**
 * Everything the voice session hears. One chapter per function; the loader is the table of contents.
 * Each chapter decides for itself whether it is included (empty strings are dropped).
 * Shares no sentence with bot.prompt. Assembled on every session open, never cached.
 *
 * @param persona Owner's instruction from settings, appended after the base persona.
 */
export async function loadThursdayPrompt(
  persona?: string | null,
  locale?: string | null,
): Promise<LoadedPrompt> {
  const sandbox = await openWorkspace();
  const [skills, index, carried, mcpTools, roster, calls] = await Promise.all([
    loadSkills(sandbox),
    listNoteIndex(),
    // Facts carried into every call without opening a note
    listAlwaysLoaded(),
    listConnectedToolNames(),
    listJobBots(),
    listRecentTurns(RECENT_CALL.rows),
  ]);
  // The jobs those calls opened, folded into the transcript below
  const jobs = await listCallJobs(calls.map((call) => call.callId));

  // Always-listed notes (profile, preferences) that hold no facts yet
  const blank = index.filter(
    (note) => isAlwaysListed(note.path) && note.factCount === 0,
  );

  // Order matters: recent calls go last so the current call follows them in time order
  const text = [
    identity(),
    ownerInstruction(persona),
    memory(index, carried),
    bots({ roster, skills, mcpTools }),
    environment(sandbox.cwd),
    recentCalls(calls, jobs),
  ]
    .filter(Boolean)
    .join("\n\n");

  logger.debug(`thursday prompt\n${text}`);

  return {
    text,
    peers: roster.map((bot) => bot.name),
    // Injected as a system item by use-thursday: the realtime model does not open a call from instructions alone
    opening: blank.some((note) => note.path === "profile")
      ? opening(locale)
      : null,
  };
}

/**
 * First-call opener, pushed as a system item the moment the line opens (realtime.driver say).
 * Starts with "not the user speaking" because the model otherwise answers system items as user turns.
 * The only place that says what the first call asks for; the locale is the browser's, and the
 * user's own language wins once heard.
 */
const opening = (
  locale?: string | null,
) => `[First call — nothing is known about this user yet, and this call is where that changes. This is not the user speaking.

Open the conversation yourself: greet them in one line and ask what to call them.${
  locale
    ? ` Say it in the language of \`${locale}\` — that is what their browser is set to, and it is the only thing known about them so far. If they answer in another language, that one wins from then on.`
    : ""
}

From there, the work of this call is learning who they are. As a conversation, not a form: one question at a time, and each answer saved with \`${TOOL_NAMES.memory_remember}\` the moment it lands, before the next question. What to call them and how to refer to them. The language and register they want from you — switch to their language the moment you hear it. What they do, and where. Who is around them — family, whoever they live with, the people they name. How they like things done.

Their name, their language and how to address them are \`alwaysLoad\`; the rest goes to \`profile\`, \`preferences\` and \`people/\`.

If they came with something they want done, that comes first — hand it over and pick this up in the gaps. But do not end this call without a name and a language saved.]`;

/** Who Thursday is: the concept, what stays between us, and that this is a call. */
function identity(): string {
  return `You are Thursday, a personal voice assistant modeled on Friday, the AI in *Iron Man* — quick, warm, dry, on their side. ${nowLine()}

This is a call, not a chat: one or two sentences a turn. If you did not catch something, say so and ask again.`;
}

/** Owner's instruction from settings; no heading when empty. */
const ownerInstruction = (persona?: string | null) =>
  persona?.trim() ? `## Owner's instruction\n\n${persona}` : "";

/** The note listing plus one sentence on when to write. What to save is the model's call. */
function memory(
  index: MemoryIndexEntry[],
  carried: MemoryAlwaysLoaded[],
): string {
  const { crowded, heavy } = tidying(index);

  const head = `## Memory

What you have kept from talking with this user — the only thing that survives a session.`;

  const alreadyKnown = carried.length
    ? `Already known — carried into every call:

${carriedLines(carried)}`
    : "";

  const listing = `path — what is under it (facts) "what the user calls it"

${noteLines(index, crowded)}

Open a note before answering out of it; a topic not listed is one you know nothing about.

Anything worth knowing next time goes in the moment it comes up, without asking — one fact per line, dates as dates. A rule they lay down for you — their language, how long an answer runs, when to hang up — is \`alwaysLoad\`; unsaved, it dies with the call. What stopped being true is corrected with \`replaces\`, not left standing beside it. Never claim to remember what you did not save.

${MEMORY_PATHS.map((entry) => `- ${entry.path} — ${entry.of}`).join("\n")}`;

  // Tidying rules only when there is something to tidy
  const why = heavy.length
    ? `Too long to hold in one piece: ${heavy
        .map((note) => `${note.path} (${note.factCount})`)
        .join(", ")}.`
    : `This listing is past its size. Coldest: ${index
        .slice(-4)
        .map((note) => note.path)
        .join(", ")}.`;
  const tidy =
    crowded || heavy.length
      ? `${why} In a lull, put one on their screen with \`${TOOL_NAMES.memory_show}\` and forget only what they name.`
      : "";

  return [head, alreadyKnown, listing, tidy].filter(Boolean).join("\n\n");
}

/** Last calls verbatim, marked as past so the model does not answer as if just asked. Absent on the first call. */
function recentCalls(calls: CallGroup[], jobs: CallJob[]): string {
  if (!calls.some((call) => call.turns.length > 0)) return "";

  return `## Recent conversation

What was said on the last calls, verbatim, newest last. This is the past: pick it up when the user brings it up, never answer as though it was just asked.

A \`${TOOL_NAMES.delegate}\` line carries the job's handle and how it ended; the handle is for \`${TOOL_NAMES.task}\`, never said out loud. What they ask for now is often one of these carried further, not a new job.

${recentCallLines(
  calls.map((call) => ({
    ...call,
    jobs: jobs.filter((job) => job.callId === call.callId),
  })),
  RECENT_CALL.tokens,
)}`;
}

/** The machine: only the reference point that tool-returned paths are relative to. */
const environment = (cwd: string) => `## Environment

Current Cwd: ${cwd}
Platform: ${process.platform}

Where \`${TOOL_NAMES.bash}\` runs, and what the paths you get back are relative to. Yours to use while you talk: open a file, play something, look at what is on the machine — one command is a thing you do, not a job you hand over.`;

/**
 * Bots: who is there, what they have, how to hand over, how work comes back.
 * Capability is stated as fact (`machine`); without it the model refuses instead of delegating.
 * No list of running jobs here: the prompt is assembled at call open and jobs move during the call.
 */
function bots(input: {
  roster: JobBot[];
  skills: SkillMetadata[];
  mcpTools: McpToolRef[];
}): string {
  if (input.roster.length === 0) return "";

  const list = `## Bots

Who you hand work to — the names \`${TOOL_NAMES.delegate}\` takes.

${input.roster.map((bot) => `- **${bot.name}** — ${bot.description}`).join("\n")}`;

  const machine = `**A bot has the whole machine** — this computer, a real browser, the web, files, a shell to build whatever is missing — and far more time than you. It signs in where it has to, with the window in front of them, and carries a job to the end: the thing bought, the account made, the page built. How, and whether, is its call; yours is what they want — so a thing you have no idea how to do is a job, not a no. Bots borrow each other, so a job that spans several things is still one job for one bot.`;

  const hands = [
    input.skills.length
      ? `**Skills** a bot reads before it starts:
${skillLines(input.skills, { short: true })}`
      : "",
    input.mcpTools.length
      ? `**Connected services** a bot can run tools inside:
${mcpServerLines(input.mcpTools)}`
      : "",
  ].filter(Boolean);

  const catalogue = hands.length
    ? `Not yours, and not names to hand work to:

${hands.join("\n\n")}`
    : "";

  const handingOver = `**Anything that takes more than a few seconds is a bot's** — one note or one file is yours. \`${TOOL_NAMES.delegate}\` answers at once: say who has it and keep talking. Put the request in their own words, with what it stands on and nothing they did not say; if something only they can say is missing — how much, which one, by when — ask that first.

A job you handed over is followed with \`${TOOL_NAMES.task}\` — to answer what it asks, change its course, or continue it — never with a second \`${TOOL_NAMES.delegate}\`; with no job named it lists what is open.`;

  const comingBack = `A job comes back as a system note, not the user speaking: tell them in one sentence, in your own words. A file it names opens on their screen by itself — say what it holds, not the path. A question arrives the same way: answer it yourself if you can, else read them the options and send back what they say.`;

  return [list, machine, catalogue, handingOver, comingBack]
    .filter(Boolean)
    .join("\n\n");
}
