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

/**
 * Everything a bot hears. One chapter per function or const; the loader is the table of contents.
 * Each chapter decides for itself whether it is included. Assembled on every run, never cached,
 * so a skill or server added a minute ago is in the next job's prompt.
 * Two seats share this prompt: the bot holding the job, and one borrowed for a part of it
 * (`ask_bot`). Only identity, roster, asking and answering differ between them.
 *
 * @param self This run's bot name; used only to drop itself from the roster.
 * @param persona Owner's instruction for this bot from settings.
 * @param seat The borrowed seat — who handed it this part, every bot above it on the job, whether it may borrow in turn; null for the bot holding the job.
 */
export async function loadBotPrompt(
  self: string,
  persona?: string | null,
  seat?: { askedBy: string; above: string[]; canBorrow: boolean } | null,
  /** The two folders that are this run's rather than the user's (bot.run). */
  folders?: { scratch: string | null; own: string },
): Promise<LoadedPrompt> {
  const sandbox = await openWorkspace();
  const name = self.trim();
  const askedBy = seat?.askedBy ?? null;
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

  // Drop itself and every bot above it on this job, which are blocked waiting on
  // it; the last seat the depth allows has no roster at all (config BOT_RUN.depth)
  const peers =
    seat && !seat.canBorrow
      ? []
      : allBots.filter(
          (bot) => bot.name !== name && !seat?.above.includes(bot.name),
        );

  const text = [
    askedBy ? borrowedIdentity(name, askedBy) : identity(name),
    memory(index),
    connectedTools(mcpTools, pinned),
    methods(skills),
    environment(sandbox.cwd, machine, folders),
    // After Environment: its folder is named against the Cwd said there
    memoryOn ? ownMemory(botMemoryFolder(name), kept) : "",
    roster(peers),
    askedBy ? askingBack(askedBy) : ASKING,
    askedBy ? handingUp(askedBy) : ANSWERING,
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
function identity(name: string): string {
  return [
    // Named, because the owner's prompt may not name it and its own instructions are addressed to it
    `You are ${name}, one of the bots that work for the user. ${nowLine()}

${PEOPLE}
- **You** — you do the work. Your answer goes to Thursday, not to the user, and she tells them what they need from it.`,
    MACHINE,
    NO_GUESSING,
  ].join("\n\n");
}

/** The borrowed seat: between it and Thursday is the bot that borrowed it. */
function borrowedIdentity(name: string, askedBy: string): string {
  return [
    `You are ${name}, one of the bots that work for the user. ${nowLine()}

${PEOPLE}
- **${askedBy}** — a bot on this job, who handed you one part of it. They cannot see your thread.
- **You** — you do that part. What you hand back goes into ${askedBy}'s work as it is, never to Thursday or the user.`,
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

A part of your job another bot is for goes to \`${TOOL_NAMES.ask_bot}\`, because their tools and their practice are the reason they exist. What you build is made of what they bring back, so send for it before you build. A part you could finish in a couple of commands is yours; one that would take a run of its own is theirs. What you were handed stays yours and you answer for it. They get the job, the call it came from and what you write them — not this thread.`;
}

/** The only place a run can stop. */
const ASKING = `## Asking

What you cannot get for yourself — a decision between real options, a detail only the conversation has, a go-ahead before deleting or sending — goes to \`${TOOL_NAMES.ask_thursday}\`, once, with everything in it. Ask before you start, not after an hour; never ask what one command would tell you.

A job that arrives without its shape — several ways to do it, no telling what it is for, a scale nobody named — is planned before it is built: put the plan up in two or three lines with what you need decided. A job asked for as one thing is built, not proposed.

Only what is theirs alone stops the job: a password, a one-time code, a passkey, a permission on their machine. Set it up one action away, ask, and carry on when the answer comes back.`;

const askingBack = (askedBy: string) => `## Asking

What you cannot get for yourself goes to \`${TOOL_NAMES.ask_back}\`: ${askedBy} handed you this part and answers from what they have. They cannot take a question to the user, so for what is the user's alone take the safer reading and say so in what you hand back. Ask before you start, once, whole.`;

/**
 * An answer is sized by the request, not by the shape of a document: this is where
 * the only upper bound on a run is stated, and the one place that says the spoken
 * line is hers to compose. Nothing here asks for a script — a bot that writes to be
 * heard writes for a length rather than for a question, and the padding it adds to
 * reach that length is steps, not words.
 * The step cap is stated nowhere a bot reads: told the number, runs work to it. It is
 * enforced where it cannot be argued with (bot.run `stepCountIs`, and `lastStep`).
 * Images in `.md` need absolute routes because a document opens from two places and relative paths resolve differently.
 */
const ANSWERING = `## Answering

Every job ends with \`${TOOL_NAMES.answer}\`. **Answer what was asked, at the size it was asked**: a question ends in its answer — one number is one line — and a thing to make comes back made, an action done, photos in a page, a comparison in a table. Once you have what they asked for the job is done; the next thing you would go and check is theirs to ask for.

You are answering Thursday, not the user: she picks what to say out of this. Write it plainly, in the user's language — the thread is on their screen as you write it. Anything past a few lines is a file under \`${PATHS.artifacts}/\`, and the answer names its path — it becomes a link on their screen. In a \`.md\`, images only by absolute route (\`/api/file/${PATHS.artifacts}/…\`).`;

const handingUp = (askedBy: string) => `## Answering

Every part ends with \`${TOOL_NAMES.answer}\`; what you hand back goes into ${askedBy}'s own answer. Hand back what the brief asked for, in the shape it asked for, with everything you learned that bears on it — exact values, the paths of files you wrote, what did not work. They cannot see your thread, so long is right here.`;

/** How many turns of the call travel with the job: enough for one missed detail, not enough to bury the request. */
export const OPENING_TURNS = 10;

/** A user message's content; every seat's first message is two text parts (buildTaskOpening). */
export type OpeningContent = Extract<ModelMessage, { role: "user" }>["content"];

/**
 * The first message of the bot holding a job, stored as the thread's first row
 * (seq 0, bot.runner startTask) and read whole on every resume and after every
 * compaction. Two text parts: who is on this job and how it reached them, then
 * the chain — the job as it was handed over and, for a job from a call, that
 * call verbatim, because the request is one sentence the realtime model produced
 * and a detail the user said may only be in the call. The chain is what a
 * borrowed bot inherits (buildHandoff), so its headings name people and never say "you".
 */
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
    { type: "text", text: whoIsWho([input.bot], input.from) },
    { type: "text", text: [job, call].filter(Boolean).join("\n\n") },
  ];
}

/**
 * The first message of a borrowed bot, built by the bot that borrows it (bot.run
 * `ask_bot`) and never stored: the chain it inherits, copied as it is, then what
 * the borrowing bot has done and the part it hands over. `bots` runs from the
 * bot holding the job down to this one, so each hand-off adds one name and two
 * sections and every seat reads the same shape.
 */
export function buildHandoff(input: {
  chain: string;
  bots: string[];
  did: string | null;
  part: string;
}): OpeningContent {
  const to = input.bots.at(-1) ?? "";
  const from = input.bots.at(-2) ?? "";
  const did = input.did?.trim()
    ? `## ${from} → ${to}: what ${from} has done, and why this part is ${to}'s\n\n${input.did.trim()}`
    : "";
  const part = `## ${from} → ${to}: the part\n\n${input.part.trim()}`;
  return [
    { type: "text", text: whoIsWho(input.bots) },
    {
      type: "text",
      text: [input.chain, did, part].filter(Boolean).join("\n\n"),
    },
  ];
}

/**
 * The chain out of a seat's first message, for the next hand-off. A thread
 * opened before the two-part shape has its opening as one string, which is the
 * whole chain there was.
 */
export function chainOf(first: ModelMessage | undefined): string {
  if (first?.role !== "user") return "";
  if (typeof first.content === "string") return first.content;
  const texts = first.content.flatMap((part) =>
    part.type === "text" ? [part.text] : [],
  );
  return texts.at(-1) ?? "";
}

/**
 * The bots on this job, and how it reached the one reading it — the last of
 * `bots`. The user and Thursday are in every seat's prompt (identity); `from` is
 * read only when the reader holds the job.
 */
function whoIsWho(bots: string[], from?: TaskSpeaker): string {
  const you = bots.length - 1;
  const lines = bots.map((bot, index) => {
    if (index === 0) {
      return index === you
        ? `- **${bot} (you)** — ${
            from === "user"
              ? "the user handed you this job on their screen, not during a call"
              : "Thursday handed you this job during a call"
          }.`
        : `- **${bot}** — holds this job and answers for it.`;
    }
    const by = bots[index - 1];
    return index === you
      ? `- **${bot} (you)** — ${by} handed you one part of it: the last section below. You answer to ${by}; nobody else hears from you.`
      : `- **${bot}** — ${by} handed them one part of it.`;
  });
  return `## Who is on this job

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
