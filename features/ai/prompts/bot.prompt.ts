import type { ModelMessage } from "ai";
import { format } from "date-fns";
import { PATHS, PROMPT_LINE, WORKSPACE_KEEP } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { botMemoryFolder, listBotMemory } from "@/features/bot/bot.memory";
import { listJobBots, readBotMemoryOn } from "@/features/bot/bot.query";
import type { BotMemory, JobBot, TaskSpeaker } from "@/features/bot/bot.schema";
import { findPinnedTools } from "@/features/connectors/mcp.query";
import type { McpToolRef } from "@/features/connectors/mcp.schema";
import { listNoteIndex } from "@/features/memory/memory.query";
import type { MemoryIndexEntry } from "@/features/memory/memory.schema";
import {
  loadSkills,
  type SkillMetadata,
} from "@/features/skills/skills.discover";
import {
  type MachineTools,
  openWorkspace,
  readMachineTools,
} from "@/features/workspace/workspace";
import { toDate } from "@/lib/date-like";
import { logger } from "@/lib/logger";
import { clip } from "@/lib/utils";
import { listConnectedToolNames } from "../tools/connected";
import {
  type LoadedPrompt,
  logPromptSize,
  mcpToolLines,
  noteLines,
  nowLine,
  skillLines,
} from "./prompt-helper";

/** Assemble this participant's instructions and current return route on every turn. */
export async function loadBotPrompt(
  self: string,
  persona?: string | null,
  seat?: { owner: string; caller: string; messageId: string | null } | null,
  /** The two folders that are this run's rather than the user's (bot.run). */
  folders?: { scratch: string | null; own: string },
): Promise<LoadedPrompt> {
  const sandbox = await openWorkspace();
  const name = self.trim();
  const [skills, index, mcpTools, pinned, allBots, kept, memoryOn, machine] =
    await Promise.all([
      loadSkills(sandbox),
      listNoteIndex(),
      // User-connected servers and the app's studio in one list (tools/connected)
      listConnectedToolNames(),
      // MCP tools this bot already holds; dropped from the listing below
      findPinnedTools(name),
      listJobBots(),
      // What this bot kept on earlier jobs, read off its own folder (bot.memory)
      listBotMemory(name),
      readBotMemoryOn(),
      // One `command -v` sweep; what is here decides the first command (environment)
      readMachineTools(sandbox),
    ]);

  const peers = allBots.filter((bot) => bot.name !== name);

  const text = [
    identity(name, seat),
    memory(index),
    connectedTools(mcpTools, pinned),
    methods(skills),
    environment(sandbox.cwd, machine, folders),
    // After Environment: its folder is named against the Cwd said there
    memoryOn ? ownMemory(botMemoryFolder(name), kept) : "",
    roster(peers),
    collaboration((seat?.owner ?? name) === name),
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

/**
 * The two people every seat works between. Said before anything else, so the
 * rest of the prompt — whose memory, who reads the answer — has someone to refer to.
 */
const PEOPLE = `- **The user** — the one person all of this is for. They talk with Thursday by voice, and they follow this job on their screen.
- **Thursday** — their own personal assistant, one to one. She holds the conversation with them, hands bots the work that takes time, and tells them what comes back.`;

/**
 * Who is who, what machine it is on, and that guesses are not results. How this
 * job reached it is the first message's to say (buildTaskOpening).
 */
function identity(
  name: string,
  seat?: { owner: string; caller: string; messageId: string | null } | null,
): string {
  return [
    `You are ${name}, a participant in this task. ${nowLine()}

${PEOPLE}
- **${seat?.owner ?? name}** — coordinates this task and brings its results to Thursday.
- **You** — keep your own work and conversation across turns. Other participants receive the messages you send, not your private history.
${
  seat
    ? `
Current conversation: ${seat.caller} → ${name}. Your ordinary final text returns to ${seat.caller}. Message ID: ${seat.messageId ?? "initial request"}.`
    : ""
}`,
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

/**
 * Thursday's memory, which a bot only reads (load-tools). The listing alone: the
 * lines she carries into every call are written for her — what to call them, how
 * long an answer runs — and are hers to act on, not a bot's.
 */
function memory(index: MemoryIndexEntry[]): string {
  return `## Thursday's memory of the user

What Thursday keeps from talking with them. Open a note from the listing with \`${TOOL_NAMES.memory_recall}\` when the job needs something about them; what you find out about them goes in your answer, and she keeps what matters.

path — what is under it (facts) "what the user calls it"

${noteLines(index)}`;
}

/**
 * The bot's own memory (features/bot/bot.memory), listed by each file's first line and the day
 * it last changed, both read off the disk, so what a file holds costs one line until a job opens
 * it. Always drawn, so a first job knows it has one. Nothing says what usually goes in first: a
 * line like that is what a first job writes, whether or not the job taught it anything.
 */
function ownMemory(folder: string, kept: BotMemory): string {
  const listing = kept.entries.length
    ? kept.entries
        .map(({ file, line, at }) => {
          const said = line ? ` — ${clip(line, PROMPT_LINE.botMemory)}` : "";
          return `- ${file}${said} · ${format(toDate(at), "yyyy-MM-dd")}`;
        })
        .join("\n")
    : "Empty.";
  const rest =
    kept.total > kept.entries.length
      ? `\n\nThe newest ${kept.entries.length} of ${kept.total}; \`ls ${folder}\` for the rest.`
      : "";

  return `## Your memory

What you kept from your own earlier jobs, in \`${folder}/\` under the Cwd above: one topic per file, its first line saying what it holds, read by no other bot. Keep what a later job would otherwise have to find out again — how a site signs in, the way through its screens, a command that turned out right — with the date you found it true, and fix or delete a file that proved wrong. No passwords, keys or codes.

${listing}${rest}`;
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

Written-down methods. Use the instructions already in your conversation. When the job needs a skill whose full instructions are absent, read it with \`${TOOL_NAMES.load_skill}\` before starting.

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
- \`${folders?.scratch ?? PATHS.scratch}/\` — this job's working material, one folder for every bot on the job: what another bot on it wrote is here too. It is cleared ${Math.round(WORKSPACE_KEEP.forMs / 86_400_000)} days after the job ends, so nothing here is worth keeping.
- \`${folders?.own ?? PATHS.bots}/\` — yours, across every job you run here: your memory, a script you wrote once and will want again, a table you built.

Never the directory above — that is the app you run in; outside the workspace, only where the user pointed you.`;

/** Same roster the voice prompt shows, used the other way: which part of a held job is another bot's. */
function roster(peers: JobBot[]): string {
  if (peers.length === 0) return "";

  return `## Bots

${peers.map((bot) => `- **${bot.name}** — ${bot.description}`).join("\n")}

These lines were written for the user, who reads them on their own screen: where one says "you" it means them, not you.

Send relevant work to another bot with \`${TOOL_NAMES.send_message}\`. Include the context they need: their own history persists, but yours is private. Choose collaborators by what the task needs.`;
}

function collaboration(owner: boolean): string {
  return `## Working together

Use \`${TOOL_NAMES.send_message}\` to contact another participant when you need their help, a clarification, or to share something they need. Continue independent work after sending; replies arrive as new messages. End your turn when you have nothing more to do now. Incoming messages can bring you back.

Address Thursday when you need a decision, permission, or information only the user has. Set up the decision with enough context to answer it; continue work that does not depend on it. Do not guess their answer.

${owner ? "Bring together the work you receive for Thursday. State what was accomplished and what remains unresolved, at the level of detail the user requested." : "Return the findings your current correspondent needs, including exact values, useful file paths, and anything unverified. They cannot read your private work."}

Write plainly in the user's language. Put substantial deliverables under \`${PATHS.artifacts}/\` and include their paths. In Markdown files, reference images by absolute route (\`/api/file/${PATHS.artifacts}/…\`).`;
}

/** How many turns of the call travel with the job: enough for one missed detail, not enough to bury the request. */
export const OPENING_TURNS = 10;

/** A user message's content; every seat's first message is two text parts (buildTaskOpening). */
export type OpeningContent = Extract<ModelMessage, { role: "user" }>["content"];

/** The coordinator keeps the request and available call transcript through every compaction. */
export function buildTaskOpening(input: {
  bot: string;
  request: string;
  conversation: { role: "user" | "assistant"; text: string }[];
  /** Who handed the job over: Thursday during a call, or the user on screen. */
  from: TaskSpeaker;
}): OpeningContent {
  const turns = input.conversation.filter((turn) => turn.text.trim());
  const by = input.from === "user" ? "The user" : "Thursday";
  const job = `## ${by} → ${input.bot}: the job\n\n${input.request.trim()}`;
  const call = turns.length
    ? `## The call the job came from — its last ${turns.length} turns, verbatim

A detail missing from the job may be here — a name, a number, which of two. Where the two disagree the job wins, unless they asked out loud for something to be done and the job only asks about it: then the doing is the job.

${turns
  .map(
    (turn) =>
      `${turn.role === "user" ? "user" : "thursday"}: ${clip(turn.text, PROMPT_LINE.callTurn)}`,
  )
  .join("\n")}`
    : "";
  return [
    {
      type: "text",
      text: `You are ${input.bot}. ${by} hands you this task${input.from === "user" ? " on screen" : " during a call"}.`,
    },
    { type: "text", text: [job, call].filter(Boolean).join("\n\n") },
  ];
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
