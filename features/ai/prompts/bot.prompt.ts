import type { ModelMessage } from "ai";
import { format } from "date-fns";
import {
  BOT_MEMORY_LIMITS,
  BOT_WORK,
  PATHS,
  PROMPT_LINE,
  WORKSPACE_KEEP,
} from "@/config";
import { botGuideLine } from "@/features/ai/guide";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { botMemoryFolder, listBotMemory } from "@/features/bot/bot.memory";
import {
  findJobBot,
  listJobBots,
  readBotMemoryOn,
} from "@/features/bot/bot.query";
import {
  type BotMemory,
  type BotWorkLine,
  type JobBot,
  rosterLine,
  type ThreadRoutine,
  type ThreadSpeaker,
  workHandle,
} from "@/features/bot/bot.schema";
import { listBotWork } from "@/features/bot/thread.query";
import { findPinnedTools } from "@/features/connectors/mcp.query";
import type { McpToolRef } from "@/features/connectors/mcp.schema";
import { listNoteIndex } from "@/features/memory/memory.query";
import type { MemoryIndexEntry } from "@/features/memory/memory.schema";
import {
  loadSkills,
  type SkillMetadata,
} from "@/features/skills/skills.discover";
import { pathsIn } from "@/features/workspace/file-kind";
import {
  type MachineTools,
  openWorkspace,
  readMachineTools,
} from "@/features/workspace/workspace";
import { toDate } from "@/lib/date-like";
import { clip } from "@/lib/utils";
import { listConnectedToolNames } from "../tools/connected";
import {
  botWorkHead,
  logPromptSize,
  mcpToolLines,
  noteLines,
  nowLine,
  skillLines,
} from "./prompt-helper";

/** Where this turn sits: the thread, who coordinates it, and who is asking. */
type Seat = {
  thread: string | null;
  owner: string;
  caller: string;
};

/** Assemble this participant's instructions and current return route on every turn. */
export async function loadBotPrompt(
  self: string,
  persona?: string | null,
  seat?: Seat | null,
  /** This run's folders: the job's, the bot's own, and where its finished work goes (bot.run). */
  folders?: { scratch: string | null; own: string; artifacts: string },
): Promise<{ text: string }> {
  const sandbox = await openWorkspace();
  const name = self.trim();
  const [
    skills,
    index,
    mcpTools,
    pinned,
    allBots,
    kept,
    memoryOn,
    machine,
    work,
  ] = await Promise.all([
    // Its own skills beside everyone's (skills.discover ownSkills)
    loadSkills(sandbox, name),
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
    // Its desks in every other thread, as they stand this turn (thread.query)
    listBotWork(name, seat?.thread ?? null),
  ]);

  const peers = allBots.filter((bot) => bot.name !== name);
  // A switched-off bot still finishes the jobs it has, and the roster leaves it out
  const me =
    allBots.find((bot) => bot.name === name) ?? (await findJobBot(name));

  const text = [
    identity(name, me, seat),
    memory(index),
    connectedTools(mcpTools, pinned),
    methods(skills),
    environment(sandbox.cwd, machine, folders),
    // After Environment: its folder is named against the Cwd said there
    memoryOn ? ownMemory(botMemoryFolder(name), kept) : "",
    otherThreads(name, work),
    roster(peers),
    collaboration(name, seat),
    // Last, so it is the closest thing to the work and outranks the rest
    ownerInstruction(persona),
  ]
    .filter(Boolean)
    .join("\n\n");

  logPromptSize("bot", text);

  return { text };
}

/**
 * Who is who, how the job gets done, and that guesses are not results. The people come
 * first so the rest — whose memory, who reads the answer — has someone to refer to. Its
 * own roster line goes under its name, since the roster below leaves it out. How this job
 * reached it is the first message's to say (buildThreadOpening).
 */
function identity(name: string, me: JobBot | null, seat?: Seat | null): string {
  const owner = seat?.owner ?? name;
  const coordinator =
    owner === name
      ? "**You** coordinate this thread: its result goes from you to Thursday."
      : `**${owner}** coordinates this thread and brings its result to Thursday.`;
  const current = seat
    ? `\n\nCurrent conversation: ${seat.caller} → ${name}. Your final text goes back to ${seat.caller}.`
    : "";

  const known = me ? `\nOthers know you as: ${rosterLine(me)}` : "";

  return `You are ${name}, one of the bots in this thread. ${nowLine()}${known}

- **The user** — the one person all of this is for. They talk with Thursday by voice and follow this thread on their screen.
- **Thursday** — their personal assistant. She talks with them, hands bots the work that takes time, and tells them what comes back.
- ${coordinator}
- **Everyone on it** keeps their own work and conversation; the others see only the messages sent to them.${current}

**The job is done, not described.** You are on the user's own computer, with a shell, files and the web, and how you get there is yours: when one way fails, try another; where no tool exists, write one — \`node\` is always here. Before deciding something cannot be done, look at what you have — your tools, the other bots, this machine. Bring back the thing itself — their account, their file, the real result — not a smaller, safer stand-in, and not a note on why not.

**Never present a guess as a result.** Thursday says what you return out loud, as fact: say which part is unverified and why.`;
}

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

What Thursday keeps from talking with them. When the job needs something about them, open the note with \`${TOOL_NAMES.memory_recall}\`; a fact marked \`said\` came from a call. What you learn about them goes in your answer — Thursday decides what to keep.

path — what it is about (facts)

${noteLines(index)}`;
}

/**
 * The bot's own memory (features/bot/bot.memory), listed by each file's first line and the day
 * it last changed, both read off the disk, so what a file holds costs one line until a job opens
 * it. Always drawn, so a first job knows it has one. Nothing says what usually goes in first: a
 * line like that is what a first job writes, whether or not the job taught it anything. The
 * limits are said as a size only; a write past them is undone by the tools (bot.memory).
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

What you learned on your own earlier jobs, in \`${folder}/\`: one topic per file, its first line saying what it holds, read by no other bot, up to ${BOT_MEMORY_LIMITS.files} files of ${BOT_MEMORY_LIMITS.chars.toLocaleString("en-US")} characters each. It is how you get better at this work. When a job teaches you something a later one would otherwise find out again — how a site signs in, the way through its screens, a command that turned out right — or the user asks you to remember how to work, keep it with the date it was true, and fix or delete what proved wrong. No passwords, keys or codes.

${listing}${rest}`;
}

/**
 * The bot's other threads (thread.query listBotWork), so a new thread does not start from
 * nothing: what it is on now and what it ended lately, each with its own last words there
 * and the files those name. Facts only; what to make of them is the bot's. Read again every
 * turn like the memory listing, so an open thread reads as it stands, and not drawn at all
 * for a bot on its first thread.
 */
function otherThreads(
  name: string,
  work: { open: BotWorkLine[]; recent: BotWorkLine[] },
): string {
  if (!work.open.length && !work.recent.length) return "";

  const line = (row: BotWorkLine) => {
    const said = row.said ? ` — ${clip(row.said, BOT_WORK.said)}` : "";
    // Read off all of its words, not the part the line keeps: where the result is outlasts the cut
    const files = row.said ? pathsIn(row.said).slice(0, BOT_WORK.files) : [];
    const named = files.length
      ? ` · ${files.map((path) => `\`${path}\``).join(", ")}`
      : "";
    return `- ${row.cut ? `[${workHandle(row.id)}] ` : ""}${botWorkHead(row, name)}${said}${named}`;
  };
  const group = (title: string, rows: BotWorkLine[]) =>
    rows.length ? `${title}\n${rows.map(line).join("\n")}` : "";
  // Said only while the tool is held, which is only while a line was cut (tools/bot.tool)
  const opens = [...work.open, ...work.recent].some((row) => row.cut)
    ? ` A line with an id in brackets was cut short: \`${TOOL_NAMES.thread_recall}\` opens that one whole, for when this job builds on it.`
    : "";

  return `## Your other threads

Your threads besides this one. You remember none of them here: each line is where it stands, your own last words there, and the files those words name.${opens}

${[group("Open", work.open), group("Ended", work.recent)].filter(Boolean).join("\n")}`;
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
    ? " The ones you already hold are in your tools instead."
    : "";

  return `## Connected tools

${mcpToolLines(unheld)}

Names only: \`${TOOL_NAMES.tool_search}\` returns what each one takes, \`${TOOL_NAMES.tool_call}\` runs one.${pinnedNote}`;
}

/** Full skill descriptions: the description is what makes a skill the right one to open (the call shows only the first sentence). */
function methods(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "";

  return `## Skills

Written-down ways of doing things. Open one with \`${TOOL_NAMES.load_skill}\` before a job it covers, unless its instructions are already in your conversation.

${skillLines(skills)}`;
}

/**
 * The machine, then the workspace. What is installed is read as the prompt is
 * assembled (workspace.ts readMachineTools) rather than left to the job to find
 * out: a bot that has to check first spends a step on it, and one that guesses
 * writes for a runtime that is not here. Naming what is absent does as much
 * work as naming what is present — it is the half a model otherwise assumes.
 * Said as what is here, not a limit: a bare listing reads as the only runtimes allowed.
 * The folders are the app's rules; `write_file` refuses anything else
 * (workspace.ts writeRefusal).
 */
const environment = (
  cwd: string,
  machine: MachineTools,
  folders?: { scratch: string | null; own: string; artifacts: string },
) => `## Environment

Current Cwd: ${cwd}
Platform: ${process.platform}
${machineLines(machine)}

Read off this machine as the job opened: what is already here, not the limit of what you can use.

Your workspace, where \`${TOOL_NAMES.bash}\` runs. Everything you write goes in one of these folders, kept apart because what is in them lives for different lengths of time:

- \`${folders?.artifacts ?? PATHS.artifacts}/\` — finished work the user opens, one entry per result. Theirs, and it stays.
- \`${PATHS.projects}/\` — code you build, one folder each; it outlives this job, and its dependencies install inside it, never at the workspace root.
- \`${folders?.scratch ?? PATHS.scratch}/\` — this job's working material, shared by every bot on it; cleared ${Math.round(WORKSPACE_KEEP.forMs / 86_400_000)} days after the job ends.
- \`${folders?.own ?? PATHS.bots}/\` — yours across every job you run here: what you keep for next time.

Inside the workspace, set up whatever the job needs yourself; installing anything machine-wide waits for the user's yes. Never the directory above the workspace — it is the app's, not the user's; outside the workspace, only where the user pointed you.

${botGuideLine()}`;

/** The other bots, used the other way from the call's roster: which part of a held job is someone else's. */
function roster(peers: JobBot[]): string {
  if (peers.length === 0) return "";

  return `## Bots

${peers.map((bot) => `- **${bot.name}** — ${rosterLine(bot)}`).join("\n")}

These lines were written for the user: where one says "you", it means them. When part of the job is another bot's strength, bring it in with \`${TOOL_NAMES.send_message}\` rather than rebuilding it yourself.`;
}

/**
 * How participants reach each other. Nobody reads anyone else's transcript, so the one thing that
 * decides whether collaboration works is what a single message carries. What becomes of the files
 * a result names is the runner's rule (bot.runner, the `artifact` event), said in the same terms.
 */
function collaboration(name: string, seat?: Seat | null): string {
  const owner = (seat?.owner ?? name) === name;
  const ending = owner
    ? `While work you handed out is still out, your result waits for it: end your turn and its answer wakes you; write the result once everything you asked for is in. Bring what you received together into one result for Thursday: what was done, where it is, what you decided that the request did not say, and what is still open, at the detail the user asked for. Every file you name in it is drawn under your words in the thread and waits in the screen's corner for the user to open, so name each one you want them to see — the page to read first, then the rest.`
    : `Your final text is your answer to ${seat?.caller ?? "whoever asked"}, and all they see of your work: give them everything they need to carry on. When you cannot go on without something from them, end with that question instead; their reply brings you back with all you have done still in front of you.`;

  return `## Working together

Nobody sees your work but you, and you see only what others send you, so whatever crosses between you has to stand on its own. A request says what is wanted, what is already known or done, and where the files are; an answer gives exact values, file paths and what is still unverified. Tell a bot you handed work to when what it depends on changes: it reads that before its next step. End your turn when you have nothing more to do now: replies arrive as new messages and wake you.

Ask the user, through Thursday, with kind \`question\` only for a decision, permission or something only they know: clearly, with the context to answer, and short options when they help. Use kind \`message\` for news that needs no answer, and your final text for the result.

${ending}

Write in the user's language, and name the paths of finished work. In Markdown, reference images by absolute route (\`/api/file/${PATHS.artifacts}/…\`).`;
}

/** A user message's content; every seat's first message is two text parts (buildThreadOpening). */
type OpeningContent = Extract<ModelMessage, { role: "user" }>["content"];

/**
 * Who handed the job over, and the job — nothing from the call it came from. The request
 * carries what the bot needs (delegate's schema says so), and the opening outlives every
 * compaction: a call pasted here would still be read long after, by a user talking to the
 * bot on screen. A routine's run says so, and how its last run ended: a past fact, true for
 * as long as the thread lives.
 */
export function buildThreadOpening(input: {
  bot: string;
  request: string;
  /** Who handed the job over: Thursday during a call, or the user on screen. */
  from: ThreadSpeaker;
  /** Set when a routine the user made opens it; nobody is there as it starts. */
  routine?: ThreadRoutine | null;
}): OpeningContent {
  if (input.routine) {
    const { when, last } = input.routine;
    const before = last
      ? ` Its last run ended ${format(last.at, "yyyy-MM-dd HH:mm")}: ${clip(last.said, PROMPT_LINE.jobOutcome)}`
      : " This is its first run.";
    return [
      {
        type: "text",
        text: `You are ${input.bot}. A routine the user set up hands you this thread: it starts by itself, ${when}, and nobody is watching as it does.${before}`,
      },
      {
        type: "text",
        text: `## The routine → ${input.bot}: the job\n\n${input.request.trim()}`,
      },
    ];
  }
  const by = input.from === "user" ? "The user" : "Thursday";
  return [
    {
      type: "text",
      text: `You are ${input.bot}. ${by} hands you this thread${input.from === "user" ? " on screen" : " during a call"}.`,
    },
    {
      type: "text",
      text: `## ${by} → ${input.bot}: the job\n\n${input.request.trim()}`,
    },
  ];
}

/**
 * One line per kind, absences included. Only a bot gets these: the call runs one command as a
 * glance. How to install a missing browser is the browser skill's to say, not the prompt's.
 */
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
      : `Browser: ${machine.browser ? "installed" : "not installed"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}
