import { asSchema, type ToolSet, tool } from "ai";
import { formatDistanceToNowStrict } from "date-fns";
import { IS_DEV } from "@/config";
import type { TextModel } from "@/features/ai/model";
import { clockNow, tidying } from "@/features/ai/prompts/prompt-helper";
import {
  answerTool,
  askThursdayTool,
  delegateSpec,
  taskSpec,
} from "@/features/ai/tools/bot.tool";
import { CALL_TOOLS } from "@/features/ai/tools/call.tool";
import { createMcpTools } from "@/features/ai/tools/mcp.tool";
import {
  botRememberTool,
  createMemoryTools,
} from "@/features/ai/tools/memory.tool";
import { createSearchTool } from "@/features/ai/tools/search.tool";
import { createSkillTools } from "@/features/ai/tools/skills.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { createWorkspaceTools } from "@/features/ai/tools/workspace.tool";
import { taskActivity } from "@/features/bot/bot.schema";
import { listNoteIndex } from "@/features/memory/memory.query";
import { loadSkills } from "@/features/skills/skills.discover";
import { readCallSkillsOn } from "@/features/thursday/thursday.query";
import { jobShellEnv, openWorkspace } from "@/features/workspace/workspace";
import { toDate } from "@/lib/date-like";
import { logger } from "@/lib/logger";
import { estimateTokens } from "@/lib/tokens";
import { clip } from "@/lib/utils";

/**
 * Which tools each runtime is handed; what it is told about them is the prompt's job.
 * Every tool runs on the server, including calls made during a voice session; only `end_call`
 * has no execute (the page hangs up). The split is by time, not capability: anything that
 * presupposes waiting (MCP, studio, browser) belongs to the bot. Every runtime writes to
 * memory, but only the call gets the whole of it: revising, carrying and naming need the user there.
 * Skills are the one thing that crosses back, and only when asked for: the call reads one itself
 * when Settings › Thursday says so (thursday.query readCallSkillsOn).
 */

export type ToolTarget = "thursday" | "bot" | "memory-edit";

/** Which runtime is running, and what that run knows about itself. */
export type ToolRun =
  | {
      target: "thursday";
      /** The current call; written on the task row `delegate` opens. */
      callId?: string | null;
    }
  | {
      target: "bot";
      /** This run's bot name, the key of the bot table. */
      bot: string;
      /** The browser session this run's shell drives (workspace.ts jobShellEnv): the job's, or a borrowed bot's own. */
      session?: string | null;
      /** The model this run already resolved (bot.run resolveModel); its own native search is what `web_search` uses when no Exa key is set (tools/search.tool). */
      model?: TextModel | null;
    }
  /** An edit from the memory screen (memory/memory.edit): memory's read and two writes, run as the model calls them. */
  | { target: "memory-edit" };

/**
 * Starting work and following it. bot.runner is imported dynamically to break a cycle
 * (runner -> bot.run -> this file). `delegate` records which call opened the job; that decides
 * who is told when it ends (bot.runner).
 */
function createTaskTools(callId: string | null | undefined): ToolSet {
  return {
    [TOOL_NAMES.delegate]: tool({
      description: delegateSpec.description,
      inputSchema: delegateSpec.parameters,
      execute: async ({ bot, request, label }) => {
        // Checked here, not by the run: by then the model has already said someone has it.
        // Resolved the same way the run resolves it (findJobBot)
        const { findJobBot, listJobBots } = await import(
          "@/features/bot/bot.query"
        );
        const found = await findJobBot(bot);
        // A switched-off bot resolves (a job it already has still resumes) but is
        // not one to pick, so it fails here rather than in listJobBots.
        if (!found || found.disabled) {
          const names = (await listJobBots()).map((one) => one.name);
          return `There is no bot called "${bot}". The bots are: ${names.join(", ")}. Nothing was handed over — call again with one of those.`;
        }

        // The row carries the bot's own spelling, not the transcript's
        const { startTask } = await import("@/features/bot/bot.runner");
        const id = await startTask({ bot: found.name, request, label, callId });
        return {
          taskId: id,
          // The label is the handle: without it in front of her, a follow-up
          // becomes a second job instead of a word to the one running
          note: `${found.name} has "${label}". Say so and keep talking — the result is put in front of you later. Everything further about it — an answer, a correction, carrying it on after it answers — is \`${TOOL_NAMES.task}\` with "${label}".`,
        };
      },
    }),

    [TOOL_NAMES.task]: tool({
      description: taskSpec.description,
      inputSchema: taskSpec.parameters,
      execute: async ({ action, task, answer }) => {
        const { listTaskHistory, resolveTask } = await import(
          "@/features/bot/task.query"
        );
        if (action === "status") {
          // `status` only reads, and text left in `answer` reaches nobody — it
          // has arrived carrying the instruction a job was waiting for. The read
          // still answers; the note is what stops the loss being silent
          const dropped = answer?.trim()
            ? {
                note: "The text in `answer` was not passed on — `status` only reads. Send it again as `answer` if the bot is meant to hear it.",
              }
            : {};
          // The clock, because the one in the instructions is from when the call
          // opened and a call can run for hours; `since` is measured against this.
          const now = { now: clockNow() };
          // A named job comes back whole; the list clips outcomes, and the model pads a clipped answer
          if (task) {
            const found = await resolveTask(task);
            const one = found;
            if (!one) return await noSuchJob(task);
            return {
              ...now,
              ...dropped,
              label: one.label,
              bot: one.bot,
              status: one.status,
              since: formatDistanceToNowStrict(toDate(one.updatedAt), {
                addSuffix: true,
              }),
              outcome: one.outcome,
              ...(one.status === "waiting" && one.pending?.options.length
                ? { options: one.pending.options }
                : {}),
            };
          }
          const tasks = await listTaskHistory({ limit: 8 });
          // No threads — only as much as is worth reading out: what it is
          // asking, the one line of what it is doing, or how it ended
          return {
            ...now,
            ...dropped,
            tasks: tasks.map((task) => ({
              label: task.label,
              bot: task.bot,
              status: task.status,
              since: formatDistanceToNowStrict(toDate(task.updatedAt), {
                addSuffix: true,
              }),
              ...(task.ask
                ? { asking: task.ask.question, options: task.ask.options }
                : {}),
              ...(task.status === "running"
                ? { now: taskActivity(task.lines) }
                : {}),
              ...(task.outcome && task.status !== "waiting"
                ? { outcome: clip(task.outcome, 200) }
                : {}),
            })),
          };
        }
        // A name is how a job is taken, but the one that just moved is what
        // "that one" means out loud, and making the model fetch a label it
        // already heard is what sends it to `delegate` instead. Cancel still
        // needs the name: it cannot be taken back.
        const { listInboxTasks } = await import("@/features/bot/task.query");
        const one = task
          ? await resolveTask(task)
          : action === "answer"
            ? ((await listInboxTasks())[0] ?? null)
            : null;
        if (!one) {
          if (task) return await noSuchJob(task);
          return action === "answer"
            ? "No job has moved yet — say which one, or check `status` first."
            : "Say which job — by its label. Call `status` with no job named to see them.";
        }

        const { answerTask, cancelTask } = await import(
          "@/features/bot/bot.runner"
        );
        if (action === "cancel") {
          await cancelTask(one.id);
          return { label: one.label, status: "cancelled" };
        }
        if (!answer?.trim()) return "Say what to pass on.";
        await answerTask(one.id, answer.trim());
        return {
          // Named even when the model named it: with no job given this is the
          // one that moved last, and saying which makes a wrong one obvious
          label: one.label,
          bot: one.bot,
          status: "running",
          note:
            one.status === "running"
              ? "The bot reads it before its next step."
              : "The bot picks the job back up from there.",
        };
      },
    }),
  };
}

/** An unresolved reference answers with the recent jobs; a bare "no such job" is read as an error and relayed as one. */
async function noSuchJob(ref: string): Promise<string> {
  const { listTaskHistory } = await import("@/features/bot/task.query");
  const recent = await listTaskHistory({ limit: 5 });
  if (!recent.length) return "No jobs have been handed over yet.";
  const names = recent
    .map((task) => `"${task.label}" (${task.bot}, ${task.status})`)
    .join(", ");
  return `There is no job called "${ref}". The latest are: ${names}. Call again with one of those names.`;
}

/**
 * What the set costs the model, beside the prompt's own line (prompts/prompt-helper
 * logPromptSize). Descriptions and schemas are both counted because both are sent
 * on every step. No budget here: the set is decided by the code, except for the MCP
 * tools a bot is pinned to — those show up by name.
 */
async function logToolSize(target: ToolTarget, tools: ToolSet): Promise<void> {
  const rows: { name: string; tokens: number }[] = [];
  for (const [name, held] of Object.entries(tools)) {
    const schema = await asSchema(held.inputSchema).jsonSchema;
    // A description may be a function of the call's context; only a fixed one is counted
    const said = typeof held.description === "string" ? held.description : "";
    rows.push({
      name,
      tokens: estimateTokens(said) + estimateTokens(JSON.stringify(schema)),
    });
  }
  rows.sort((a, b) => b.tokens - a.tokens);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  logger.debug(
    `${target} tools ${total} tokens over ${rows.length} — ${rows
      .map((row) => `${row.name} ${row.tokens}`)
      .join(", ")}`,
  );
}

export async function loadTools(run: ToolRun): Promise<ToolSet> {
  const tools = await buildTools(run);
  // Measured only where the line would be printed: the schemas have to be built
  // to be counted, and unlike a prompt this set does not grow with use.
  if (IS_DEV) await logToolSize(run.target, tools);
  return tools;
}

async function buildTools(run: ToolRun): Promise<ToolSet> {
  if (run.target === "memory-edit") {
    // Memory's own read and writes, in the user's hand: they asked for it on
    // screen. Opening a note to change it is not a recall (memory.tool countReads)
    const hand = createMemoryTools("user", null, { countReads: false });
    return {
      [TOOL_NAMES.memory_recall]: hand[TOOL_NAMES.memory_recall],
      [TOOL_NAMES.memory_remember]: hand[TOOL_NAMES.memory_remember],
      [TOOL_NAMES.memory_forget]: hand[TOOL_NAMES.memory_forget],
    };
  }

  // The runtime is the hand: the call as the user talks, a bot mid-job
  // (memory.tool botRememberTool records its own).
  const memory = createMemoryTools(
    "call",
    run.target === "thursday" ? (run.callId ?? null) : null,
  );

  const sandbox = await openWorkspace();

  if (run.target === "thursday") {
    // memory_show only when there is something to tidy (prompt-helper tidying)
    const { [TOOL_NAMES.memory_show]: show, ...always } = memory;
    const { crowded, heavy } = tidying(await listNoteIndex());
    // Off unless switched on: a skill is a page of instructions arriving
    // mid-sentence. Switched off, the prompt does not list them as hers either
    // (thursday.prompt), so the two always say the same thing
    const skills = (await readCallSkillsOn())
      ? createSkillTools({ sandbox, skills: await loadSkills(sandbox) })
      : {};

    return {
      ...always,
      ...(crowded || heavy.length ? { [TOOL_NAMES.memory_show]: show } : {}),
      ...skills,
      // The shell alone. A whole file is a job, not a glance (workspace.tool)
      ...createWorkspaceTools(sandbox, { write: false }),
      // Handing work over, following it, and hanging up belong to the voice session only
      ...createTaskTools(run.callId),
      ...CALL_TOOLS,
    };
  }

  // A bot works inside a job it did not open: it can pull another bot in but cannot start a job.
  // `ask_bot` and `ask_back` are attached by the runner (bot.run), which swaps `ask_thursday`
  // for `ask_back` in a borrowed bot. `answer` ends every run.
  const skills = await loadSkills(sandbox);
  return {
    // A bot reads memory and adds to it; the rest of the set is the call's
    // (memory.tool botRememberTool), and there is no screen to show a note on
    [TOOL_NAMES.memory_recall]: memory[TOOL_NAMES.memory_recall],
    [TOOL_NAMES.memory_conversation]: memory[TOOL_NAMES.memory_conversation],
    [TOOL_NAMES.memory_remember]: botRememberTool,
    // Exa when its key is set, else this bot's own model when it can search;
    // absent when neither, and the browser is the way in (search.tool)
    ...(await createSearchTool(run.model, sandbox)),
    // The browser rides in the shell: its session is this seat's — the job's, or
    // a borrowed bot's own — set by the server rather than typed by the model
    // (workspace.ts jobShellEnv)
    ...createWorkspaceTools(sandbox, {
      write: true,
      env: jobShellEnv(run.session),
      // What the shell is like and what this machine has, on the first command
      // of the run only (workspace.tool shellGuide). The call gets no guide:
      // one command is a glance, not a job to plan around
      guide: true,
    }),
    // Pinned tools come with schemas; the rest sit behind `tool_search`, absent when nothing is left to find (mcp.tool)
    ...(await createMcpTools(run.bot, sandbox)),
    ...createSkillTools({ sandbox, skills }),
    [TOOL_NAMES.ask_thursday]: askThursdayTool,
    [TOOL_NAMES.answer]: answerTool,
  };
}
