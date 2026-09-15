import { asSchema, type ToolSet, tool } from "ai";
import { formatDistanceToNowStrict } from "date-fns";
import { CALL_EXEC_TIMEOUT_MS, IS_DEV } from "@/config";
import type { TextModel } from "@/features/ai/model";
import { clockNow } from "@/features/ai/prompts/prompt-helper";
import { delegateSpec, threadSpec } from "@/features/ai/tools/bot.tool";
import { CALL_TOOLS } from "@/features/ai/tools/call.tool";
import { createMcpTools } from "@/features/ai/tools/mcp.tool";
import { createMemoryTools } from "@/features/ai/tools/memory.tool";
import { createSearchTool } from "@/features/ai/tools/search.tool";
import { createSkillTools } from "@/features/ai/tools/skills.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { createWorkspaceTools } from "@/features/ai/tools/workspace.tool";
import { threadActivity } from "@/features/bot/bot.schema";
import { loadSkills } from "@/features/skills/skills.discover";
import { readCallSkillsOn } from "@/features/thursday/thursday.query";
import { jobShellEnv, openWorkspace } from "@/features/workspace/workspace";
import { toDate } from "@/lib/date-like";
import { logger } from "@/lib/logger";
import { isPublicError } from "@/lib/public-error";
import { estimateTokens } from "@/lib/tokens";
import { clip } from "@/lib/utils";

/**
 * Which tools each runtime is handed; what it is told about them is the prompt's job.
 * Every tool runs on the server, including calls made during a voice session; only `end_call`
 * has no execute (the page hangs up). The split is by time, not capability: anything that
 * presupposes waiting (MCP, studio, browser) belongs to the bot. Only the call and an edit on
 * the memory screen write to memory: revising, carrying and naming need the user there. A bot reads it.
 * Skills are the one thing that crosses back, and only when asked for: the call reads one itself
 * when Settings › Thursday says so (thursday.query readCallSkillsOn).
 */

export type ToolTarget = "thursday" | "bot" | "memory-edit";

/** Which runtime is running, and what that run knows about itself. */
export type ToolRun =
  | {
      target: "thursday";
      /** The current call; written on the thread row `delegate` opens. */
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
function createThreadTools(callId: string | null | undefined): ToolSet {
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
        const { startThread } = await import("@/features/bot/bot.runner");
        const id = await startThread({
          bot: found.name,
          request,
          label,
          callId,
          from: "thursday",
        });
        return {
          threadId: id,
          // The label is the handle: without it in front of her, a follow-up
          // becomes a second job instead of a word to the one running
          note: `${found.name} has "${label}". Its updates reach the conversation on their own. Anything further about this work — an answer, a correction, the next step once it finishes — is \`${TOOL_NAMES.thread}\` with "${label}".`,
        };
      },
    }),

    [TOOL_NAMES.thread]: tool({
      description: threadSpec.description,
      inputSchema: threadSpec.parameters,
      execute: async ({ action, thread, answer, recipient, replyTo }) => {
        const { listThreadOverview, resolveThread } = await import(
          "@/features/bot/thread.query"
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
          if (thread) {
            const found = await resolveThread(thread);
            const one = found;
            if (!one) return await noSuchJob(thread);
            const { findThreadView } = await import(
              "@/features/bot/thread.query"
            );
            const room = (await findThreadView(one.id))?.room;
            return {
              ...now,
              ...dropped,
              label: one.label,
              id: one.id,
              bot: one.bot,
              ...(room
                ? { participants: room.participants, questions: room.questions }
                : {}),
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
          const threads = await listThreadOverview();
          // No messages — only as much as is worth reading out: what it is
          // asking, the one line of what it is doing, or how it ended
          return {
            ...now,
            ...dropped,
            threads: threads.map((thread) => ({
              id: thread.id,
              label: thread.label,
              bot: thread.bot,
              status: thread.status,
              ...(thread.room
                ? {
                    participants: thread.room.participants,
                    questions: thread.room.questions.map((question) => ({
                      ...question,
                      text: clip(question.text, 200),
                    })),
                  }
                : {}),
              since: formatDistanceToNowStrict(toDate(thread.updatedAt), {
                addSuffix: true,
              }),
              ...(thread.ask
                ? { asking: thread.ask.question, options: thread.ask.options }
                : {}),
              ...(thread.status === "running"
                ? { now: threadActivity(thread.lines) }
                : {}),
              ...(thread.outcome && thread.status !== "waiting"
                ? { outcome: clip(thread.outcome, 200) }
                : {}),
            })),
          };
        }
        // A name is how a job is taken, but the one that just moved is what
        // "that one" means out loud, and making the model fetch a label it
        // already heard is what sends it to `delegate` instead. Cancel still
        // needs the name: it cannot be taken back.
        const { listInboxThreads, markSeen } = await import(
          "@/features/bot/thread.query"
        );
        const unnamed = !thread && (action === "answer" || action === "open");
        const inbox = unnamed ? await listInboxThreads() : [];
        // An unnamed answer is for the open question; with questions in two
        // jobs, which one it answers is the user's to say
        const asking =
          action === "answer"
            ? inbox.filter((row) => row.room?.questions.length)
            : [];
        if (asking.length > 1)
          return `Questions are waiting in more than one job: ${asking
            .map(
              (row) =>
                `"${row.label}" (${row.room?.questions.map((question) => question.bot).join(", ")})`,
            )
            .join(", ")}. Name the job.`;
        const one = thread
          ? await resolveThread(thread)
          : unnamed
            ? (asking[0] ?? inbox[0] ?? null)
            : null;
        if (!one) {
          if (thread) return await noSuchJob(thread);
          return unnamed
            ? "No job has moved yet — say which one, or check `status` first."
            : "Say which job — by its label. Call `status` with no job named to see them.";
        }

        if (action === "open") {
          // The room on the call screen draws the inbox; an older job is only in the history
          const room = unnamed ? inbox : await listInboxThreads();
          if (!room.some((row) => row.id === one.id))
            return `"${one.label}" is older than the call screen keeps; it is under Settings › Threads.`;
          const { appEvents } = await import(
            "@/app/api/events/app-event.server"
          );
          appEvents.emit({ type: "showThread", threadId: one.id });
          return { label: one.label, open: true };
        }
        if (action === "seen") {
          // The same as opening it on screen: it leaves the work waiting on the user
          await markSeen([one.id]);
          return { label: one.label, seen: true };
        }
        const { answerThread, cancelThread } = await import(
          "@/features/bot/bot.runner"
        );
        if (action === "cancel") {
          await cancelThread(one.id);
          return { label: one.label, status: "cancelled" };
        }
        if (!answer?.trim()) return "Say what to pass on.";
        let told: Awaited<ReturnType<typeof answerThread>>;
        try {
          told = await answerThread(
            one.id,
            answer.trim(),
            "thursday",
            recipient ?? undefined,
            replyTo ?? undefined,
          );
        } catch (cause) {
          // Which question, or that it is gone, is the model's to fix: one line it can act on
          if (isPublicError(cause)) return cause.message;
          throw cause;
        }
        if (told?.answered)
          return {
            label: one.label,
            answered: told.answered,
            note: `${told.answered.bot} has the answer to its question and goes on from it.`,
          };
        return {
          // Named even when the model named it: with no job given this is the
          // one that moved last, and saying which makes a wrong one obvious
          label: one.label,
          bot: told?.to ?? one.bot,
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
  const { listThreadOverview } = await import("@/features/bot/thread.query");
  const recent = await listThreadOverview();
  if (!recent.length) return "No jobs have been handed over yet.";
  const names = recent
    .map((thread) => `"${thread.label}" (${thread.bot}, ${thread.status})`)
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

  // The call's hand; a fact it writes is tied to the call it was said in. A bot
  // is handed only the reads from it (below).
  const { [TOOL_NAMES.memory_conversation]: conversation, ...memory } =
    createMemoryTools(
      "call",
      run.target === "thursday" ? (run.callId ?? null) : null,
    );
  const readBack: ToolSet = {
    [TOOL_NAMES.memory_conversation]: conversation,
  };

  const sandbox = await openWorkspace();

  if (run.target === "thursday") {
    // Off unless switched on: a skill is a page of instructions arriving
    // mid-sentence. Switched off, the prompt does not list them as hers either
    // (thursday.prompt), so the two always say the same thing
    const skills = (await readCallSkillsOn())
      ? createSkillTools({ sandbox, skills: await loadSkills(sandbox) })
      : {};

    return {
      ...memory,
      ...readBack,
      ...skills,
      // The shell alone, for no longer than her answer can wait on it (config
      // CALL_EXEC_TIMEOUT_MS). A whole file is a job, not a glance (workspace.tool)
      ...createWorkspaceTools(sandbox, {
        write: false,
        timeoutMs: CALL_EXEC_TIMEOUT_MS,
      }),
      // Handing work over, following it, and hanging up belong to the voice session only
      ...createThreadTools(run.callId),
      ...CALL_TOOLS,
    };
  }

  // A bot works inside a job it did not open: it can pull another bot in but cannot start a job.
  // The runner attaches messaging with the active continuation (bot.run).
  const skills = await loadSkills(sandbox);
  return {
    // A bot only reads memory: every write is the call's, and there is no screen to show a note on
    [TOOL_NAMES.memory_recall]: memory[TOOL_NAMES.memory_recall],
    ...readBack,
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
      // Its own memory stays within its limits whichever of the two writes it (bot.memory)
      memoryOf: run.bot,
    }),
    // Pinned tools come with schemas; the rest sit behind `tool_search`, absent when nothing is left to find (mcp.tool)
    ...(await createMcpTools(run.bot, sandbox)),
    ...createSkillTools({ sandbox, skills }),
  };
}
