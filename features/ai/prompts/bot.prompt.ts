import { BOT_NOTES, BOT_RUN, PATHS } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  listJobBots,
  readBotNote,
  readBotNotesOn,
} from "@/features/bot/bot.query";
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
import {
  type MachineTools,
  openWorkspace,
  readMachineTools,
} from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { clip } from "@/lib/utils";
import { listConnectedToolNames } from "../tools/connected";
import {
  carriedLines,
  type LoadedPrompt,
  logPromptSize,
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
  /** The two folders that are this run's rather than the user's (bot.run). */
  folders?: { scratch: string | null; own: string },
): Promise<LoadedPrompt> {
  const sandbox = await openWorkspace();
  const name = self.trim();
  const [
    skills,
    index,
    carried,
    mcpTools,
    pinned,
    allBots,
    ownNote,
    notesOn,
    machine,
  ] = await Promise.all([
    loadSkills(sandbox),
    listNoteIndex(),
    listAlwaysLoaded(),
    // User-connected servers and the app's studio in one list (tools/connected)
    listConnectedToolNames(),
    // MCP tools this bot already holds; dropped from the listing below
    findPinnedTools(name),
    listJobBots(),
    // What this bot left itself; kept by the pass that runs after a job (bot.notes)
    readBotNote(name),
    readBotNotesOn(),
    // One `command -v` sweep; what is here decides the first command (environment)
    readMachineTools(sandbox),
  ]);

  // Drop self so a bot cannot call itself; a borrowed bot has no roster at all (bot.run MAX_DEPTH)
  const peers = askedBy ? [] : allBots.filter((bot) => bot.name !== name);

  const text = [
    askedBy ? borrowedIdentity(name, askedBy) : identity(name),
    memory(index, carried),
    notesOn ? notes(ownNote) : "",
    connectedTools(mcpTools, pinned),
    methods(skills),
    environment(sandbox.cwd, machine, folders),
    roster(peers),
    askedBy ? askingBack(askedBy) : ASKING,
    askedBy ? handingUp(askedBy) : FINISHING,
    // Last, so it is the closest thing to the work and outranks the rest
    ownerInstruction(persona),
  ]
    .filter(Boolean)
    .join("\n\n");

  logPromptSize("bot", text);
  logger.debug(`bot prompt\n${text}`);

  return {
    text,
    peers: peers.map((bot) => bot.name),
    opening: null,
  };
}

/** Who the bot is, what machine it is on, and that guesses are not results. */
function identity(name: string): string {
  return [
    // Named, because the owner's prompt may not name it and its own instructions are addressed to it
    `You are ${name}, a worker. Thursday handed you a job while she keeps talking to the user — they speak to her and to nobody else, and what she reads them out of your report is the only part of this that reaches them. You are not in that conversation and never address the user. This thread is drawn on their screen while you work, though: not written to them, but not private either. ${nowLine()}`,
    MACHINE,
    NO_GUESSING,
  ].join("\n\n");
}

/** The borrowed seat: above it is the borrowing bot, not Thursday. */
function borrowedIdentity(name: string, askedBy: string): string {
  return [
    `You are ${name}, a worker. ${askedBy} is holding a job Thursday handed them and has handed one part of it to you. The user speaks to Thursday and to nobody else; you never address them, and what you hand back goes into ${askedBy}'s report as-is. This thread is drawn on their screen while you work: not written to them, but not private either. ${nowLine()}`,
    MACHINE,
    NO_GUESSING,
  ].join("\n\n");
}

const MACHINE = `**You are on a real computer — the user's own.** You have a shell and a filesystem, and the job is done, not described: where there is no tool for something, write one — in \`node\` unless they asked for another language, the runtime this app itself runs on. Reach for \`${TOOL_NAMES.bash}\` before concluding that something cannot be done, but after the roster, not instead of it: a script you write to do another bot's job is the long way round.

**What is missing gets installed**, onto the machine once they say yes. What is already there is nobody's question — Environment says what this machine has.

**Bring back the thing itself** — their own machine, their own accounts, their own copy of whatever they sent you for — not a smaller safer version of it, and not a note on why you did not.`;

const NO_GUESSING = `**Never present a guess as a result.** She says it out loud as fact. Say which part is unverified and why.`;

/**
 * What the owner wrote about this bot in settings. Carries the sentence that
 * settles a conflict: everything above is the app's default, and a bot whose
 * own instructions lose to a default is not the bot the owner configured.
 */
const ownerInstruction = (persona?: string | null) =>
  persona?.trim()
    ? `## Owner's instructions

Written by the person this bot works for. Where these and anything above disagree, these win.

${persona.trim()}`
    : "";

/** A bot reads memory and adds to it; revising and naming are the call's (load-tools), so the chapter is that small. */
function memory(
  index: MemoryIndexEntry[],
  carried: MemoryAlwaysLoaded[],
): string {
  const head = `## Memory

What the user's assistant knows about them. Thursday keeps it as she talks with them, and everyone reads it.

Yours to read, and to add to when the work turns up something about *them* that outlives the job; what the job itself turned up goes in your report. It describes the user, not you: how they are named and spoken to is hers to use with them, not yours to borrow. What you learn about this machine is not memory — that is your own instructions, below.`;

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
 * The bot's own notes, carried between jobs (database bot_note). Always drawn, empty or not,
 * so a first job knows it has them. What belongs in them is on `report`, the only place a
 * change can be asked for (tools/bot.tool); the chapter is what they are and that they last.
 * The line about what goes in first shows only while they are empty — a standing instruction
 * to write something turns every job into a note, and there is nothing to nudge once a bot
 * has one. The count is here for the same reason: the room left is a fact, not a target.
 */
function notes(own: string | null): string {
  return `## Your own instructions

What you wrote to yourself on earlier jobs here, to get better at this machine. Only you read it, and it is the one thing that reaches your next job. What belongs in it is what working here is like — the command that turns out to be the right one, the flag it needs, the tool this platform does not have. Not what the user is like: that is Memory, above, and everyone reads that one.

${own ?? "Empty. What usually goes in first is whatever you had to find out before you could start."}

(${own?.length ?? 0}/${BOT_NOTES.chars} characters)`;
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

/**
 * The machine, then the workspace. What is installed is read as the prompt is
 * assembled (workspace.ts readMachineTools) rather than left to the job to find
 * out: a bot that has to check first spends a step on it, and one that guesses
 * writes for a runtime that is not here. Naming what is absent does as much
 * work as naming what is present — it is the half a model otherwise assumes.
 * The three folders are named once; `write_file` refuses anything else
 * (workspace.ts writeRefusal).
 */
const environment = (
  cwd: string,
  machine: MachineTools,
  folders?: { scratch: string | null; own: string },
) => `## Environment

Current Cwd: ${cwd}
Platform: ${process.platform}
${machineLines(machine)}

Read off this machine as the job opened, so it is current: reach for what is here instead of checking for it.

Your workspace — \`${TOOL_NAMES.bash}\` runs here. Everything you write goes in one of these, and they are kept apart because what is in them lives for different lengths of time:

- \`${PATHS.artifacts}/\` — finished work the user opens, one entry per result. Theirs, and it stays.
- \`${PATHS.projects}/\` — code you build, one folder each. It outlives this job, and a project's dependencies install inside it, never at the workspace root.
- \`${folders?.scratch ?? PATHS.scratch}/\` — this job's working material. It goes when the job does, so nothing here is worth keeping.
- \`${folders?.own ?? PATHS.bots}/\` — yours, across every job you run here. A script you wrote once and will want again, a table you built. Your own instructions can name what is in it.

Never the directory above — that is the app you run in; outside the workspace, only where the user pointed you.`;

/** Same roster the voice prompt shows, used the other way: which part of a held job is another bot's. */
function roster(peers: JobBot[]): string {
  if (peers.length === 0) return "";

  return `## Bots

${peers.map((bot) => `- **${bot.name}** — ${bot.description}`).join("\n")}

These lines were written for the user, who reads them on their own screen: where one says "you" it means them, not you.

A part of your job another bot is for goes to \`${TOOL_NAMES.ask_bot}\`, because their tools and their practice are the reason they exist. What you build is made of what they bring back, so send for it before you build. A part you could finish in a couple of commands is yours; one that would take a run of its own is theirs. The job stays yours and you report; they see only your brief — not the call, not this thread.`;
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

/** One line per kind, absences included. Only a bot gets these: the call runs one command as a glance. */
function machineLines(machine: MachineTools): string {
  const line = (label: string, of: MachineTools["runtimes"]) =>
    `${label}: ${of.found.length ? of.found.join(", ") : "none"}.${
      of.missing.length ? ` Not here: ${of.missing.join(", ")}.` : ""
    }`;
  // Not a preference: openWorkspace writes the pnpm fence, and an `npm install`
  // in a project here resolves against that rather than against the project
  const fenced = machine.managers.found.includes("pnpm")
    ? " Use pnpm, not npm — this workspace is fenced for it (`pnpm-workspace.yaml`, `.npmrc`)."
    : "";
  return [
    line("Runtimes", machine.runtimes),
    `${line("Package managers", machine.managers)}${fenced}`,
    machine.browser === null
      ? ""
      : machine.browser
        ? "Browser: installed."
        : "Browser: not installed — `playwright-cli install-browser chromium` puts one there.",
  ]
    .filter(Boolean)
    .join("\n");
}
