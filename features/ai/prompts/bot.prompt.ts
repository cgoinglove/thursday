import { BOT_RUN, PATHS } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { listJobBots } from "@/features/bot/bot.query";
import type { JobBot } from "@/features/bot/bot.schema";
import { findPinnedTools } from "@/features/connectors/mcp.query";
import type { McpToolRef } from "@/features/connectors/mcp.schema";
import {
  listAlwaysLoaded,
  listNoteIndex,
} from "@/features/memory/memory.query";
import type {
  MemoryAlwaysLoaded,
  MemoryIndexEntry,
} from "@/features/memory/memory.schema";
import {
  loadSkills,
  type SkillMetadata,
} from "@/features/skills/skills.discover";
import { openWorkspace } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { clip } from "@/lib/utils";
import { listConnectedToolNames } from "../tools/connected";
import {
  carriedLines,
  type LoadedPrompt,
  mcpToolLines,
  noteLines,
  nowLine,
  skillLines,
} from "./prompt-helper";

/**
 * Everything a bot hears. One chapter per function or const; the loader is the table of contents.
 * Each chapter decides for itself whether it is included. Assembled on every run, never cached,
 * so a skill or server added a minute ago is in the next job's prompt.
 * Two seats share this prompt: the bot holding the job, and one borrowed for a part of it
 * (`ask_bot`). Only identity, roster, asking and finishing differ between them.
 *
 * @param self This run's bot name; used only to drop itself from the roster.
 * @param persona Owner's instruction for this bot from settings.
 * @param askedBy Name of the borrowing bot in the borrowed seat; null for the bot holding the job.
 */
export async function loadBotPrompt(
  self: string,
  persona?: string | null,
  askedBy?: string | null,
): Promise<LoadedPrompt> {
  const sandbox = await openWorkspace();
  const name = self.trim();
  const [skills, index, carried, mcpTools, pinned, allBots] = await Promise.all(
    [
      loadSkills(sandbox),
      listNoteIndex(),
      listAlwaysLoaded(),
      // User-connected servers and the app's studio in one list (tools/connected)
      listConnectedToolNames(),
      // MCP tools this bot already holds; dropped from the listing below
      findPinnedTools(name),
      listJobBots(),
    ],
  );

  // Drop self so a bot cannot call itself; a borrowed bot has no roster at all (bot.run MAX_DEPTH)
  const peers = askedBy ? [] : allBots.filter((bot) => bot.name !== name);

  const text = [
    askedBy ? borrowedIdentity(askedBy) : identity(),
    ownerInstruction(persona),
    memory(index, carried),
    connectedTools(mcpTools, pinned),
    methods(skills),
    environment(sandbox.cwd),
    roster(peers),
    askedBy ? askingBack(askedBy) : ASKING,
    askedBy ? handingUp(askedBy) : FINISHING,
  ]
    .filter(Boolean)
    .join("\n\n");

  logger.debug(`bot prompt\n${text}`);

  return {
    text,
    peers: peers.map((bot) => bot.name),
    opening: null,
  };
}

/** Who the bot is, what machine it is on, and that guesses are not results. */
function identity(): string {
  return [
    `You are a worker. Thursday handed you a job while she keeps talking to the user; you are not in that conversation and never speak to the user directly. ${nowLine()}`,
    MACHINE,
    NO_GUESSING,
  ].join("\n\n");
}

/** The borrowed seat: above it is the borrowing bot, not Thursday. */
function borrowedIdentity(askedBy: string): string {
  return [
    `You are a worker. ${askedBy} is holding a job Thursday handed them and has handed one part of it to you. You never speak to the user: ${askedBy} reports, and what you hand back goes into their report as-is. ${nowLine()}`,
    MACHINE,
    NO_GUESSING,
  ].join("\n\n");
}

const MACHINE = `**You are on a real computer — the user's own.** You have a shell and a filesystem, and the job is done, not described. If there is no tool for something, write one; if a runtime or a package is missing, install it. Reach for \`${TOOL_NAMES.bash}\` before you conclude that something cannot be done.

**Bring back the thing itself** — their own machine, their own accounts, their own copy of whatever they sent you for — not a smaller safer version of it, and not a note on why you did not.`;

const NO_GUESSING = `**Never present a guess as a result.** She says it out loud as fact. Say which part is unverified and why.`;

/** Owner's instruction for this bot from settings; no heading when empty. */
const ownerInstruction = (persona?: string | null) =>
  persona?.trim() ? `## Owner's instructions\n\n${persona.trim()}` : "";

/** A bot reads memory and adds to it; revising and naming are the call's (load-tools), so the chapter is that small. */
function memory(
  index: MemoryIndexEntry[],
  carried: MemoryAlwaysLoaded[],
): string {
  const head = `## Memory

What the user's assistant knows about them — yours to read, and to add to when the work turns up something about them that outlives the job. What the job itself turned up goes in your report. It describes the user, not you: how they are named and spoken to is hers to use with them, not yours to borrow.`;

  const alreadyKnown = carried.length
    ? `Already known:

${carriedLines(carried)}`
    : "";

  const listing = `path — what is under it (facts) "what the user calls it"

${noteLines(index)}

A topic not listed is one nobody knows anything about.`;

  return [head, alreadyKnown, listing].filter(Boolean).join("\n\n");
}

/**
 * Names only; schemas stay behind `tool_search`. Without the list the model cannot tell
 * "no such tool" from "not searched yet".
 */
function connectedTools(tools: McpToolRef[], pinned: McpToolRef[]): string {
  const held = new Set(pinned.map((entry) => `${entry.server}/${entry.name}`));
  const unheld = tools.filter(
    (entry) => !held.has(`${entry.server}/${entry.name}`),
  );
  if (unheld.length === 0) return "";

  const pinnedNote = held.size
    ? ` What is not listed above you are already holding — it is in your tools.`
    : "";

  return `## Connected tools

${mcpToolLines(unheld)}

Names only: \`${TOOL_NAMES.tool_search}\` returns what each one takes, \`${TOOL_NAMES.tool_call}\` runs one.${pinnedNote}`;
}

/** Full skill descriptions (the voice prompt shows only the first sentence). */
function methods(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "";

  return `## Skills

Written-down methods. When the job is one of these, read it with \`${TOOL_NAMES.load_skill}\` before starting.

${skillLines(skills)}`;
}

/** Names the three workspace folders once; `write_file` refuses anything else (workspace.ts writeRefusal). */
const environment = (cwd: string) => `## Environment

Current Cwd: ${cwd}
Platform: ${process.platform}

Your workspace — \`${TOOL_NAMES.bash}\` runs here. Everything you write goes in one of three folders: \`${PATHS.artifacts}/\` (finished work the user opens), \`${PATHS.projects}/\` (code you build), \`${PATHS.scratch}/\` (everything in progress). Never the directory above — that is the app you run in; outside the workspace, only where the user pointed you.`;

/** Same roster the voice prompt shows, used the other way: which part of a held job is another bot's. */
function roster(peers: JobBot[]): string {
  if (peers.length === 0) return "";

  return `## Bots

${peers.map((bot) => `- **${bot.name}** — ${bot.description}`).join("\n")}

A part of your job another bot is for goes to \`${TOOL_NAMES.ask_bot}\` — including when a tool in your own hand would half-do it, because their tools and their practice are the reason they exist. What you build is made of what they bring back, so send for it before you build; doing it yourself is what is left when nobody fits. The job stays yours and you report; they see only your brief — not the call, not this thread — so brief them whole.`;
}

/** The only place a run can stop. The user's request to buy, pay or top up is itself the go-ahead. */
const ASKING = `## Asking

What you cannot get for yourself — a decision between real options, a detail only the conversation has, a go-ahead before deleting or sending — goes to \`${TOOL_NAMES.ask_thursday}\`, once, with everything in it. Ask before you start, not after an hour; never ask what one command would tell you.

A job that arrives without its shape — several ways to do it, no telling what it is for, a scale nobody named — is planned before it is built: put the plan up in two or three lines with what you need decided. A job asked for as one thing is built, not proposed.

A request that says buy, pay, top up is the go-ahead — press the button. Only what is theirs alone stops the job: a password, a one-time code, a passkey, a permission on their machine. Set it up one action away, ask, and carry on when the answer comes back.`;

const askingBack = (askedBy: string) => `## Asking

What you cannot get for yourself goes to \`${TOOL_NAMES.ask_back}\`: ${askedBy} handed you this part and answers from what they have. They cannot take a question to the user, so for what is the user's alone take the safer reading and say so in what you hand back. Ask before you start, once, whole.`;

const STEP_CAP = `Your steps are capped at ${BOT_RUN.steps}; running long, report what you have with \`complete: false\` while the summary is still yours to write.`;

/**
 * The job ends in the thing that was asked for; no prescribed document shape.
 * Images in `.md` need absolute routes because a document opens from two places and relative paths resolve differently.
 */
const FINISHING = `## Finishing

Every job ends with \`${TOOL_NAMES.report}\`, in the user's language, written to be heard — she reads it out loud. **The job ends in the thing that was asked for**: an action with the action done, photos in a page with the photos in it, a comparison in a table. Anything that does not fit in a few lines is a file under \`${PATHS.artifacts}/\`, and the report names its path — it becomes a link on their screen. In a \`.md\`, images only by absolute route (\`/api/file/${PATHS.artifacts}/…\`).

\`complete: false\` when part of the request is genuinely undone — say where you got to and the user decides. ${STEP_CAP}`;

const handingUp = (askedBy: string) => `## Finishing

Every part ends with \`${TOOL_NAMES.report}\`; what you hand back goes into ${askedBy}'s own report. Hand back what the brief asked for, in the shape it asked for, with everything you learned that bears on it — exact values, the paths of files you wrote, what did not work. They cannot see your thread, so long is right here. \`complete: false\` when part of the brief is undone, with where you got to. ${STEP_CAP}`;

/** How many turns of the call travel with the job: enough for one missed detail, not enough to bury the request. */
export const OPENING_TURNS = 10;
const OPENING_TURN_CHARS = 160;

/**
 * The first message a bot reads: the request plus the last turns of the call, verbatim.
 * The request is one sentence the realtime model produced; a detail the user said may only be here.
 * Stored as the thread's first row (seq 0) so it survives a resume (bot.runner).
 */
export function buildTaskOpening(input: {
  request: string;
  conversation: { role: "user" | "assistant"; text: string }[];
}): string {
  const turns = input.conversation.filter((turn) => turn.text.trim());
  if (!turns.length) return input.request;

  const lines = turns.map(
    (turn) =>
      `${turn.role === "user" ? "user" : "thursday"}: ${clip(turn.text, OPENING_TURN_CHARS)}`,
  );
  return `${input.request}

## The call, just before this reached you

A detail that is not in the request may be here — a name, a number, which one of two. The request wins where they disagree, with one exception: when they asked out loud for something to be *done* and the request only asks about it, the doing is the job.

${lines.join("\n")}`;
}
