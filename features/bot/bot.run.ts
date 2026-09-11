import {
  type FinishReason,
  generateText,
  hasToolCall,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type PrepareStepResult,
  pruneMessages,
  type StepResult,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  tool,
} from "ai";
import { BOT_RUN } from "@/config";
import { loadTools } from "@/features/ai/load-tools";
import {
  compactBudget,
  getTextModel,
  type ModelFailure,
  modelErrorToString,
  modelFailureOf,
  resolveDefaultModel,
} from "@/features/ai/model";
import {
  buildHandoff,
  chainOf,
  loadBotPrompt,
} from "@/features/ai/prompts/bot.prompt";
import {
  answerAccepted,
  askBackSpec,
  askBotSpec,
} from "@/features/ai/tools/bot.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  COMPACT_AT_MIN,
  type JobBot,
  NO_TOKENS,
  type TokenUsage,
} from "@/features/bot/bot.schema";
import {
  closeHiddenBrowser,
  filesOnDisk,
  openBotFolder,
  openJobScratch,
} from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { estimateTokens } from "@/lib/tokens";
import { findJobBot } from "./bot.query";
import {
  findTask,
  listWrittenPaths,
  optionsOf,
  writtenPathsIn,
} from "./task.query";

/**
 * The bot loop behind `delegate`: one model with its own prompt, tools and
 * context. Only the `answer` reaches Thursday; every event goes through
 * `emit` and the runner (bot.runner) writes it to the task's thread.
 */

/** One thing that happened in a run. The runner adds which bot and inside which `ask_bot` call. */
export type BotEvent =
  /** A finished chunk of prose. */
  | { type: "text"; text: string }
  /** A tool call. `id` is where the result lands. */
  | { type: "tool"; id: string; name: string; input: unknown }
  | {
      type: "tool-result";
      id: string;
      name: string;
      output: unknown;
      /** The tool threw; `output` is what it said. */
      error?: boolean;
    }
  /**
   * A step finished; `messages` is what the model sees next time.
   * `budget` is where this run compacts (config BOT_RUN).
   */
  | {
      type: "step";
      messages: ModelMessage[];
      usage: TokenUsage;
      budget: number;
    }
  /**
   * The context passed its budget and the model summarized it (compact). The
   * runner stores `text` as the compact row a resume restarts from. `usage`
   * is the summary's cost; `messages`/`tokens` what it replaced.
   */
  | {
      type: "compact";
      text: string;
      usage: TokenUsage;
      messages: number;
      tokens: number;
    }
  /** Words from the user read before this step (`RunOptions.notes`). Stored as a user row between two steps. */
  | { type: "interjection"; text: string }
  /** This bot answered a borrowed bot's `ask_back` (answerBack). No row of its own; `usage` is charged to the job. */
  | { type: "answered"; question: string; text: string; usage: TokenUsage }
  /**
   * Stopped for an answer. `id` is the `ask_thursday` call the answer becomes
   * the result of; null when asking whether to continue, then the answer is a
   * fresh user turn.
   */
  | { type: "waiting"; id: string | null; question: string; options: string[] }
  /**
   * The only thing that reaches Thursday. `stopped` is the app's word, never the
   * model's: the step cap forced this answer, the answer was refused on the last
   * step, the output limit cut it off, or the run ended with nothing handed back.
   * A stopped job waits to be continued; any other answer ends it.
   */
  | { type: "answer"; text: string; stopped: boolean }
  /**
   * The run broke. `failure` is whose it is to fix (model.ts modelFailureOf) — a
   * retry's, a compaction's, or a person's — and `budget` where to compact next
   * time, when the model refused the context as too long.
   */
  | {
      type: "error";
      message: string;
      failure: ModelFailure;
      budget?: number;
    };

/** The event as the thread sees it: which bot, inside which `ask_bot` call. */
export type TaskEvent = BotEvent & { bot: string; parent: string | null };

export type RunOptions = {
  signal?: AbortSignal;
  depth?: number;
  /** The `ask_bot` call this run answers; null for the job's own bot. */
  parent?: string | null;
  /**
   * The job this runs inside, for every seat on it — a borrowed bot's too. Its row
   * names the one folder they all work in (workspace.ts jobScratch).
   */
  taskId?: string | null;
  /**
   * The browser session this seat's shell drives (workspace.ts jobShellEnv): the
   * job's own when unset, a borrowed bot's under its call, so two seats never click
   * in one window.
   */
  session?: string | null;
  /**
   * Drained once per step boundary; each string goes in front of the model as
   * a user turn before the next step. Only the job's own bot has one.
   */
  notes?: () => string[];
  /** Answers a borrowed run's `ask_back` from the asking bot's context (answerBack). Without it the tool is not attached. */
  answer?: (question: string) => Promise<string>;
  emit: (event: TaskEvent) => Promise<void>;
};

/**
 * At the step cap the last step is forced to `answer` (lastStep) and the job goes
 * to `waiting`. The context budget is the model's own window where that can be
 * known (model.ts compactBudget); past it the run compacts and carries on from
 * the summary.
 */
const MAX_STEPS = BOT_RUN.steps;

/**
 * Where a run starts: a job's thread (the opening message first time, past
 * stretches plus new turns on resume), or an `ask_bot` brief plus `context`
 * from the asking bot (`askedBy`).
 */
export type RunInput =
  | { bot: string; messages: ModelMessage[] }
  | {
      bot: string;
      request: string;
      context?: string | null;
      askedBy: string;
      /** What the borrowing bot inherited, handed down under the part (bot.prompt buildHandoff). */
      chain: string;
      /** Every bot above this one on the job, the holder first; `askedBy` is the last. */
      above: string[];
    };

export async function runBot(
  input: RunInput,
  options: RunOptions,
): Promise<void> {
  const depth = options.depth ?? 0;
  const parent = options.parent ?? null;
  const name = input.bot.trim();
  const emit = (event: BotEvent) =>
    options.emit({ ...event, bot: name, parent });

  const bot = await findJobBot(name);
  if (!bot) {
    await emit({
      type: "error",
      message: `No bot named "${input.bot}". Use a name from the list.`,
      failure: "fatal",
    });
    return;
  }
  // Switched off is not a bot to pick — the backstop for every fresh start
  // (`delegate`, `ask_bot`, the screen). A resume carries `messages` instead and
  // is let through: its thread already exists and the user can still answer it.
  if (bot.disabled && "request" in input) {
    await emit({
      type: "error",
      message: `${bot.name} is switched off. Use a name from the list.`,
      failure: "fatal",
    });
    return;
  }

  // Tools are built on the model: web search runs on this bot's model (load-tools).
  const model = await resolveModel(bot);
  // The job's row: the same one for every seat on the job, a borrowed bot's too
  const row = options.taskId ? await findTask(options.taskId) : null;
  // One folder per job, not per bot: bots borrowed with `ask_bot` work inside
  // the same job and share its material (workspace.ts jobScratch).
  const [scratch, own] = await Promise.all([
    options.taskId ? openJobScratch(options.taskId, row?.label ?? "job") : null,
    openBotFolder(name),
  ]);
  const [prompt, tools] = await Promise.all([
    loadBotPrompt(
      name,
      bot.systemPrompt,
      "askedBy" in input
        ? {
            askedBy: input.askedBy,
            above: input.above,
            canBorrow: depth < BOT_RUN.depth,
          }
        : null,
      { scratch, own },
    ),
    loadTools({
      target: "bot",
      bot: name,
      // A borrowed bot drives a browser session of its own; everyone else the job's
      session: options.session ?? options.taskId,
      model,
    }),
  ]);
  // What the owner set, else the model's own window, else the constant (model.ts
  // compactBudget), and never above where this job last fit: a context the model
  // refused as too long lowers the job's own number (bot.runner parkTask). That
  // number is the holder's; a borrowed bot runs on a model of its own.
  const budget = Math.min(
    await compactBudget(model.ref, bot.compactAt),
    ("askedBy" in input ? 0 : row?.contextBudget) || Number.POSITIVE_INFINITY,
  );

  const history: ModelMessage[] =
    "messages" in input
      ? input.messages
      : [
          {
            role: "user",
            content: buildHandoff({
              chain: input.chain,
              bots: [...input.above, name],
              did: input.context ?? null,
              part: input.request,
            }),
          },
        ];

  /** Remaining `ask_back` calls for a borrowed bot; the tool counts it down. */
  const asks = { left: BOT_RUN.askBack };
  // A borrowed bot asks back instead of asking Thursday. Any seat above the
  // depth limit may borrow in turn, handing down the chain it was handed.
  const seatTools =
    "askedBy" in input ? withAskBack(tools, asks, options) : tools;
  const agentTools =
    depth < BOT_RUN.depth
      ? withAskBot(seatTools, {
          name,
          model: model.model,
          instructions: prompt.text,
          peers: prompt.peers,
          depth,
          chain: chainOf(history[0]),
          above: "askedBy" in input ? input.above : [],
          options,
          emit,
        })
      : seatTools;

  /**
   * A compaction decided in `prepareStep` is emitted from the loop at
   * `start-step`, not from the callback: the sdk prepares step N+1 while the
   * loop may still be reading step N, and the row must sit between the two
   * steps (that position is what a resume restarts from, task.query listThread).
   */
  const pending: {
    compact: Extract<BotEvent, { type: "compact" }> | null;
    /** Emitted at the same place, after the compaction. */
    interjections: string[];
  } = { compact: null, interjections: [] };

  /** Stops the stream when the model goes quiet (config BOT_RUN.silenceMs). */
  const quiet = silenceWatch(BOT_RUN.silenceMs);
  /** Context size the latest step went out at; an overflow shrinks the budget from it. */
  let sent = 0;

  const agent = new ToolLoopAgent({
    model: model.model,
    instructions: prompt.text,
    tools: agentTools,
    // The loop ends on an accepted answer or at the step cap (the last step is
    // forced to answer). A refused answer does not end it. `ask_thursday` has
    // no execute, but invalid arguments come back as a tool-error and the loop
    // would go on, so the stop is on the call itself.
    stopWhen: [
      stepCountIs(MAX_STEPS),
      answerAccepted_,
      hasToolCall(TOOL_NAMES.ask_thursday),
    ],
    prepareStep: async ({ stepNumber, steps, messages }) => {
      let step = lastStep(stepNumber);
      // Remove `ask_back` once spent. The last step is already narrowed to `answer`.
      if (!step.activeTools && asks.left <= 0) {
        step = {
          ...step,
          activeTools: Object.keys(agentTools).filter(
            (held) => held !== TOOL_NAMES.ask_back,
          ),
        };
      }
      // The provider's input count includes instructions and tool schemas the
      // estimate cannot see; the estimate covers a provider that reports none.
      const measured = steps.at(-1)?.usage.inputTokens ?? 0;
      const size = Math.max(measured, sizeOf(messages));
      sent = size;
      let next = messages;
      // The opening survives every compaction, so past it and one summary there is nothing to compact
      if (size > budget && messages.length > 2) {
        // One long call that sends nothing until it is done, and bounds itself
        quiet.hold();
        const summary = await compact(model.model, agentTools, messages, {
          signal: options.signal,
          budget,
          instructions: prompt.text,
        }).finally(quiet.release);
        logger.debug(
          `compacted ${messages.length} messages at ${size} tokens (budget ${budget})`,
        );
        // Which files the job has is read off its rows and the disk, never asked of the model
        const text = `${summary.text}${await filesUnder(row?.id ?? null, messages, scratch)}`;
        pending.compact = {
          type: "compact",
          text,
          usage: summary.usage,
          messages: messages.length,
          tokens: size,
        };
        next = [messages[0], { role: "user", content: text }];
      }

      // Notes said during the last step go in as user turns after everything
      // the model has (and after the summary). Not on the first step.
      const notes = stepNumber > 0 ? (options.notes?.() ?? []) : [];
      if (notes.length) {
        pending.interjections.push(...notes);
        next = [
          ...next,
          ...notes.map((text) => ({ role: "user" as const, content: text })),
        ];
      }

      if (next === messages) return step;
      // Carried forward by the sdk: from here the steps stack on these
      return { ...step, messages: next };
    },
  });

  // Step messages arrive by callback and the stream by loop, with no ordering
  // between them: the callback queues, the loop takes at `finish-step`.
  const steps = stepQueue();
  // The job stopping and the model going quiet end the stream the same way;
  // which of the two it was is read at `abort`
  const stop = options.signal
    ? AbortSignal.any([options.signal, quiet.signal])
    : quiet.signal;
  quiet.touch();
  const result = await agent.stream({
    messages: history,
    abortSignal: stop,
    onStepEnd: (step) =>
      steps.push({
        messages: step.response.messages,
        usage: usageOf(step.usage),
      }),
  });

  let writing = "";
  /** The last chunk of prose; used only if the run ends without an answer. */
  let last: string | null = null;
  /** The `ask_thursday` call the loop stopped on. */
  let asked: { id: string; question: string; options: string[] } | null = null;
  /** The answer (bot.tool answerSpec). */
  let answered: { text: string; stopped: boolean } | null = null;
  /** Index of the step being read; `lastStep` narrows the one at MAX_STEPS - 1. */
  let stepAt = -1;
  /** Why the latest step ended; prose cut off at the output limit is not an answer. */
  let finish: FinishReason | null = null;
  /** Tool calls still running: the model is not expected to send anything meanwhile. */
  const working = new Set<string>();

  /** A break as the runner takes it; an overflow carries where to compact next time. */
  const failed = (cause: unknown): Extract<BotEvent, { type: "error" }> => {
    const failure = modelFailureOf(cause);
    const message = modelErrorToString(cause);
    if (failure !== "overflow") return { type: "error", message, failure };
    const shrunk = Math.floor(
      Math.min(budget, sent || budget) * BOT_RUN.overflowShrink,
    );
    return {
      type: "error",
      message,
      failure,
      budget: Math.max(COMPACT_AT_MIN, shrunk),
    };
  };

  // An abort ends the stream without a finish; release any waiting take.
  stop.addEventListener("abort", () => steps.end(), { once: true });
  try {
    for await (const part of result.fullStream) {
      // Anything at all is the model still there
      quiet.touch();
      switch (part.type) {
        case "start-step":
          stepAt += 1;
          if (pending.compact) {
            await emit(pending.compact);
            pending.compact = null;
          }
          for (const text of pending.interjections.splice(0)) {
            await emit({ type: "interjection", text });
          }
          break;

        case "text-delta":
          writing += part.text;
          break;

        case "text-end": {
          const text = writing.trim();
          writing = "";
          if (!text) break;
          last = text;
          await emit({ type: "text", text });
          break;
        }

        case "tool-call": {
          if (part.toolName === TOOL_NAMES.ask_thursday) {
            const args = part.input as {
              question?: unknown;
              options?: unknown;
            };
            asked = {
              id: part.toolCallId,
              question: String(args.question ?? ""),
              options: optionsOf(args.options),
            };
          } else if (part.toolName === TOOL_NAMES.answer) {
            const args = part.input as { result?: unknown };
            answered = {
              text: String(args.result ?? "").trim(),
              // The last step offers nothing but `answer`: an answer there is the cap's doing
              stopped: stepAt >= MAX_STEPS - 1,
            };
          }
          // A tool at work sends nothing, and bounds itself (bash, connected
          // tools, a borrowed bot's own watch); `ask_thursday` never runs
          if (
            !part.providerExecuted &&
            part.toolName !== TOOL_NAMES.ask_thursday
          ) {
            working.add(part.toolCallId);
            quiet.hold();
          }
          await emit({
            type: "tool",
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
          });
          break;
        }

        case "tool-result":
          if (working.delete(part.toolCallId)) quiet.release();
          // A refused answer is not the ending, unless the step cap ends the run
          // on this step; then the text still reaches the user, as a stop.
          if (
            part.toolName === TOOL_NAMES.answer &&
            answered &&
            !answerAccepted(part.output)
          ) {
            answered = {
              text: `${answered.text}\n\n${outputText(part.output)}`,
              stopped: true,
            };
          }
          // A provider-executed tool (web search) lands here too; the step's own
          // messages decide where it belongs (bot.runner).
          await emit({
            type: "tool-result",
            id: part.toolCallId,
            name: part.toolName,
            output: part.output,
          });
          break;

        case "tool-error":
          if (working.delete(part.toolCallId)) quiet.release();
          // The model reads it and carries on; the row shows it now rather than
          // when the step ends
          await emit({
            type: "tool-result",
            id: part.toolCallId,
            name: part.toolName,
            output: modelErrorToString(part.error),
            error: true,
          });
          break;

        case "finish-step": {
          finish = part.finishReason;
          const step = await steps.take();
          if (step) await emit({ type: "step", ...step, budget });
          break;
        }

        case "abort":
          // The job was stopped: whoever stopped it writes the row (bot.runner)
          if (options.signal?.aborted) return;
          // Otherwise the model went quiet (silenceWatch)
          await emit({
            type: "error",
            message: part.reason ?? "The model stopped sending.",
            failure: "transient",
          });
          return;

        case "error":
          await emit(failed(part.error));
          return;

        default:
          break;
      }
    }
  } finally {
    steps.end();
    quiet.end();
  }

  try {
    await result.response;
  } catch (cause) {
    // Stopped between steps: whoever stopped it writes the row
    if (options.signal?.aborted) return;
    await emit(failed(cause));
    return;
  }

  // Asking wins over answering: the loop halts on the ask.
  if (asked) {
    await emit({ type: "waiting", ...asked });
    return;
  }

  if (answered) {
    await emit({ type: "answer", ...answered });
    return;
  }

  // The provider's filter stopped the answer: there is nothing to continue past
  if (finish === "content-filter") {
    await emit({
      type: "error",
      message: "The provider's content filter stopped the response.",
      failure: "fatal",
    });
    return;
  }

  // The sdk stops on a step with no tool call regardless of `stopWhen`. Prose
  // there is an answer given without the tool and ends the job like one;
  // nothing at all, prose cut off at the output limit, or prose on the step the
  // cap narrowed to `answer`, is a stop — continuing picks up where it broke off.
  await emit({
    type: "answer",
    text: last ?? "Stopped without handing anything back.",
    stopped: last === null || finish === "length" || stepAt >= MAX_STEPS - 1,
  });
}

/** The last step ended on an answer the tool accepted. `hasToolCall` would also stop on a refused one. */
const answerAccepted_ = ({ steps }: { steps: StepResult<ToolSet>[] }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (result) =>
        result.toolName === TOOL_NAMES.answer && answerAccepted(result.output),
    ) ?? false;

/**
 * The step before the cap is narrowed to `answer` and required to call it,
 * so a run out of budget ends with something a person can act on.
 */
function lastStep(stepNumber: number): NonNullable<PrepareStepResult<ToolSet>> {
  if (stepNumber < MAX_STEPS - 1) return {};
  return {
    activeTools: [TOOL_NAMES.answer],
    toolChoice: { type: "tool", toolName: TOOL_NAMES.answer },
  };
}

/** Rough token weight of a message list. The provider's own count wins when it reports one (prepareStep). */
function sizeOf(messages: ModelMessage[]): number {
  return messages.reduce(
    (sum, message) =>
      sum +
      estimateTokens(
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      ) +
      4,
    0,
  );
}

/** Instructions for compacting. The summary replaces everything above it, opening included, so it must restate the job. */
const compactInstructions = (
  words: number,
) => `Compact your context. The first message above — the job, the call it came from, and anything handed over with it — stays exactly as it is. Everything after it is replaced by what you write now, and you carry on from that first message and this alone; nothing else above can be read again. Write it for a fresh copy of you that has your tools, your instructions and that first message, but has seen none of the rest.

Cover all of it, and prefer a fact over a description of a fact:

- **Where the job stands against that first message.** Do not restate the job or the call; say what has changed since — a choice made, a detail settled, an answer that came back, a correction, anything you are still waiting on.
- **What is already true.** Every value you have — numbers, names, dates, ids, urls, prices, times — written out, not referred to. A value you leave out is one the next steps go and fetch again.
- **Where you are.** Which page the browser is on by url, whether you are signed in and to what, what is running, what you were in the middle of. Element refs do not survive this: name what to look for, never a ref.
- **Files.** Every path you wrote or read, and one line on what each holds.
- **What did not work**, and why: the url that 404s, the endpoint that needs POST not GET, the selector that is not there, the site that refuses a headless browser, the argument a tool rejected. This is the part that stops the next steps repeating an hour of yours.
- **What is left**, in the order you would do it.

Plain text, under ${words} words. No preamble, no headings about the summary itself, no account of how you have been going.`;

/** Word cap for a summary, scaled to the budget it stands in for (config BOT_RUN.summaryWords). */
const summaryWords = (budget: number) => {
  const { min, max, perTokens } = BOT_RUN.summaryWords;
  return Math.min(max, Math.max(min, Math.round(budget / perTokens)));
};

/** Prefix of the summary that follows the first message after a compaction (and on a resume). */
const COMPACT_PREAMBLE =
  "Everything between the first message and here was compacted. Below is your own summary of it; carry on from the first message and this.";

/** Heads the file list under a compaction summary (filesUnder). */
const FILES_HEAD =
  "Files this job has on disk now — open one rather than fetching again what is in it:";

/**
 * The files a job has on disk, as lines under its compaction summary. Read off the
 * job's rows — every `write_file`, its borrowed bots' included — and off its folder,
 * never asked of the model: a path a summary leaves out is work the next steps redo.
 * A borrowed run has no rows of its own and reads the messages it is compacting.
 * A listing that fails costs the list, never the compaction.
 */
async function filesUnder(
  taskId: string | null,
  messages: ModelMessage[],
  folder: string | null,
): Promise<string> {
  try {
    const written = taskId
      ? await listWrittenPaths(taskId)
      : writtenPathsIn(messages.map((message) => message.content));
    const files = await filesOnDisk(written, folder);
    if (!files.length) return "";
    const shown = files.slice(-BOT_RUN.compactFiles);
    const older = files.length - shown.length;
    const lines = shown.map((path) => `- ${path}`);
    if (older) lines.unshift(`- …and ${older} older ones`);
    return `\n\n${FILES_HEAD}\n${lines.join("\n")}`;
  } catch (cause) {
    logger.warn("files under the summary could not be listed", cause);
    return "";
  }
}

/**
 * The model summarizes its own context and continues from the summary. Tools
 * are passed with calling off: providers refuse a history of tool calls
 * without the tools that made them. The run's own instructions go too: the
 * summary is written by the bot the thread belongs to, and the provider's
 * cached prefix, instructions first, still matches the run's. A context too
 * long to summarise whole — the very thing a compaction is for — is tried once
 * more without the tool calls and results but the last few. A failure throws
 * with its cause kept: the runner parks what a retry or a smaller budget can
 * fix (bot.runner parkTask) and fails the rest; the thread stays.
 */
async function compact(
  model: LanguageModel,
  tools: ToolSet,
  messages: ModelMessage[],
  options: { signal?: AbortSignal; budget: number; instructions: string },
): Promise<{ text: string; usage: TokenUsage }> {
  let failure: unknown;
  try {
    return await summarize(model, tools, messages, options);
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    failure = cause;
  }
  if (modelFailureOf(failure) === "overflow") {
    // pruneMessages drops a call together with its result, so the thread stays whole
    const lighter = pruneMessages({
      messages,
      toolCalls: "before-last-4-messages",
      emptyMessages: "remove",
    });
    try {
      return await summarize(model, tools, lighter, options);
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      failure = cause;
    }
  }
  throw new Error(
    `Could not compact the context (${modelErrorToString(failure)}).`,
    { cause: failure },
  );
}

/** One summarising call. Nothing streams back, so its whole length is one silence (config BOT_RUN.silenceMs). */
async function summarize(
  model: LanguageModel,
  tools: ToolSet,
  messages: ModelMessage[],
  options: { signal?: AbortSignal; budget: number; instructions: string },
): Promise<{ text: string; usage: TokenUsage }> {
  const { text, usage } = await generateText({
    model,
    system: options.instructions,
    tools,
    toolChoice: "none",
    messages: [
      ...messages,
      {
        role: "user",
        content: compactInstructions(summaryWords(options.budget)),
      },
    ],
    abortSignal: options.signal,
    timeout: BOT_RUN.silenceMs,
  });
  const summary = text.trim();
  if (!summary) {
    // A blank reply is the model's hiccup, not the job's: worth another try
    throw Object.assign(
      new Error(
        "The summary of the context came back empty, so there is nothing to carry on from.",
      ),
      { isRetryable: true },
    );
  }
  return { text: `${COMPACT_PREAMBLE}\n\n${summary}`, usage: usageOf(usage) };
}

/** Step messages handed from `onStepEnd` to the loop. A take that arrives before the push waits. */
type FinishedStep = { messages: ModelMessage[]; usage: TokenUsage };

function stepQueue() {
  const ready: FinishedStep[] = [];
  const waiting: Array<(step: FinishedStep | null) => void> = [];
  let ended = false;
  return {
    push(step: FinishedStep) {
      const waiter = waiting.shift();
      if (waiter) waiter(step);
      else ready.push(step);
    },
    take(): Promise<FinishedStep | null> {
      const next = ready.shift();
      if (next) return Promise.resolve(next);
      if (ended) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
    /**
     * No more steps are coming; release waiting takes with `null`. Without
     * this, a `finish-step` whose `onStepEnd` never fires (abort, provider
     * error mid-step) parks the loop forever, and `answerTask` waits on
     * `run.done` while holding the job's lock (bot.runner).
     */
    end() {
      ended = true;
      for (const waiter of waiting.splice(0)) waiter(null);
    },
  };
}

/**
 * The clock behind `BOT_RUN.silenceMs`: aborts its signal once nothing has
 * arrived for that long. Held while something other than the model does the
 * work — a tool, a compaction — since those send nothing and bound themselves;
 * `touch` starts it over. Not the sdk's `timeout.chunkMs`: that clock keeps
 * running while tools execute, so a long command or a borrowed bot's whole run
 * would trip it.
 */
function silenceWatch(ms: number) {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = 0;
  let ended = false;
  const arm = () => {
    clearTimeout(timer);
    timer = undefined;
    if (ended || held > 0) return;
    timer = setTimeout(() => {
      stop.abort(
        new DOMException(
          `The model sent nothing for ${Math.round(ms / 60_000)} minutes.`,
          "TimeoutError",
        ),
      );
    }, ms);
  };
  return {
    signal: stop.signal,
    touch: arm,
    hold: () => {
      held += 1;
      arm();
    },
    release: () => {
      held = Math.max(0, held - 1);
      arm();
    },
    /** The run is over; nothing is watched any more. */
    end: () => {
      ended = true;
      arm();
    },
  };
}

/** The sdk gives undefined when unknown; 0 sums correctly. */
const usageOf = (usage: LanguageModelUsage): TokenUsage => ({
  input: usage.inputTokens ?? 0,
  output: usage.outputTokens ?? 0,
});

/** A bot with both model columns set uses them; otherwise the app default (resolveDefaultModel). */
function resolveModel(bot: JobBot) {
  if (bot.provider && bot.model) {
    return getTextModel({ provider: bot.provider, model: bot.model });
  }
  return resolveDefaultModel().then(getTextModel);
}

/** A whole run as one string; this is all `ask_bot` receives. A stopped run still comes back, marked as such. */
export async function runBotToText(
  input: Extract<RunInput, { request: string }>,
  options: RunOptions,
): Promise<string> {
  let outcome = "";
  let failure: string | null = null;
  await runBot(input, {
    ...options,
    emit: async (event) => {
      if (event.type === "answer") {
        outcome = event.stopped
          ? `${event.text}\n\n(As far as they got — they stopped before finishing.)`
          : event.text;
      }
      if (event.type === "error") failure = event.message;
      await options.emit(event);
    },
  });
  if (failure) publicError(failure);
  return outcome;
}

/**
 * `ask_bot` gets its execute here, not in loadTools (loadTools importing this
 * file would be a cycle). With no peers the tool is absent rather than refusing.
 * The borrowed bot's events go to the same thread under this call's id, and
 * `answer` serves its `ask_back` from `call.messages`, the context that
 * produced this call. Exchanges ride back inside the result so this thread
 * keeps them.
 */
function withAskBot(
  tools: ToolSet,
  asker: {
    name: string;
    model: LanguageModel;
    instructions: string;
    /** Bots it can call; itself excluded (bot.prompt). */
    peers: string[];
    depth: number;
    /** The chain this bot inherited, handed down under the part it hands over. */
    chain: string;
    /** Bots above this one on the job, which are blocked waiting on it. */
    above: string[];
    options: RunOptions;
    emit: (event: BotEvent) => Promise<void>;
  },
): ToolSet {
  if (asker.peers.length === 0) return tools;

  const agentTools: ToolSet = {
    ...tools,
    [TOOL_NAMES.ask_bot]: tool({
      description: askBotSpec.description,
      inputSchema: askBotSpec.parameters,
      execute: async ({ bot, request, context }, call) => {
        // A bot above is blocked waiting on this very call; borrowing it back never returns
        if (bot === asker.name || asker.above.includes(bot)) {
          return `${bot} is already on this job, above you and waiting on your part. Pick another bot, or do it yourself.`;
        }
        // The borrowed bot works in the job's folder but drives a browser session
        // of its own, under this call's id. When it answers, the same rule as a
        // job's end: what it showed on their screen stays, what nobody can see
        // closes (workspace.ts closeHiddenBrowser).
        const session = asker.options.taskId
          ? `${asker.options.session ?? asker.options.taskId}-${call.toolCallId.slice(0, 8)}`
          : null;
        const exchanges: { question: string; answer: string }[] = [];
        const answer = async (question: string) => {
          const reply = await answerBack({
            model: asker.model,
            instructions: asker.instructions,
            // Same tools, calling off (see compact).
            tools: agentTools,
            messages: call.messages,
            asked: { bot, request },
            question,
            signal: asker.options.signal,
          });
          await asker.emit({ type: "answered", question, ...reply });
          exchanges.push({ question, answer: reply.text });
          return reply.text;
        };
        try {
          const outcome = await runBotToText(
            {
              bot,
              request,
              context,
              askedBy: asker.name,
              chain: asker.chain,
              above: [...asker.above, asker.name],
            },
            {
              ...asker.options,
              // This call's signal, not the job's: a stream that ends — the job
              // stopping, or the model going quiet — ends the part it waited on
              signal: call.abortSignal ?? asker.options.signal,
              depth: asker.depth + 1,
              parent: call.toolCallId,
              session,
              answer,
            },
          );
          return exchanges.length
            ? `${outcome}\n\n${exchangeLines(bot, exchanges)}`
            : outcome;
        } finally {
          if (session) void closeHiddenBrowser(session);
        }
      },
    }),
  };
  return agentTools;
}

/** Appended under the answer: what the borrowed bot asked and what this bot answered. */
function exchangeLines(
  bot: string,
  exchanges: { question: string; answer: string }[],
): string {
  return exchanges
    .map(
      ({ question, answer }) =>
        `(On the way ${bot} asked you: "${question}" — you answered: "${answer}")`,
    )
    .join("\n");
}

/**
 * A borrowed bot's tools: `ask_thursday` removed (the bot above is blocked on
 * this run, so a wait here never resolves), `ask_back` added when there is an
 * `answer`. prepareStep removes it once `asks.left` reaches zero.
 */
function withAskBack(
  tools: ToolSet,
  asks: { left: number },
  options: RunOptions,
): ToolSet {
  const own = { ...tools };
  delete own[TOOL_NAMES.ask_thursday];
  const { answer } = options;
  if (!answer) return own;
  return {
    ...own,
    [TOOL_NAMES.ask_back]: tool({
      description: askBackSpec.description,
      inputSchema: askBackSpec.parameters,
      execute: async ({ question }) => {
        asks.left -= 1;
        return answer(question);
      },
    }),
  };
}

/** Prompt for answering a borrowed bot's `ask_back`. The blocked call is restated because the sdk's `messages` stop just before it. */
const answerInstructions = (
  asked: { bot: string; request: string },
  question: string,
) => `You handed one part of your job to ${asked.bot}:

> ${asked.request.trim()}

Before going on, they ask you:

> ${question.trim()}

Answer from what you already have — the request as it reached you, the call it came out of, what you found before asking them. A few lines, plain text, and nothing else: no tools run here. If it is not in what you have, say so rather than guess, and say which way to go without it.`;

/**
 * One call, no loop: the asking bot's model over its own context plus the
 * question. A provider failure returns a fallback text instead of throwing;
 * only an abort propagates.
 */
async function answerBack(input: {
  model: LanguageModel;
  instructions: string;
  tools: ToolSet;
  messages: ModelMessage[];
  asked: { bot: string; request: string };
  question: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: TokenUsage }> {
  try {
    const { text, usage } = await generateText({
      model: input.model,
      system: input.instructions,
      tools: input.tools,
      toolChoice: "none",
      messages: [
        ...input.messages,
        {
          role: "user",
          content: answerInstructions(input.asked, input.question),
        },
      ],
      abortSignal: input.signal,
      // One-shot: nothing streams back, so its whole length is one silence
      timeout: BOT_RUN.silenceMs,
    });
    return {
      text:
        text.trim() ||
        "They had nothing to add. Go on with your best reading, and say what you assumed in what you hand back.",
      usage: usageOf(usage),
    };
  } catch (cause) {
    if (input.signal?.aborted) throw cause;
    logger.warn(`ask_back: ${modelErrorToString(cause)}`);
    return {
      text: `No answer came back (${modelErrorToString(cause)}). Go on with your best reading, and say what you assumed in what you hand back.`,
      usage: NO_TOKENS,
    };
  }
}

/**
 * The stored thread as a resuming run reads it: the rows as they were written,
 * each tool call with its result, so a resumed run carries on the conversation
 * it was having and a provider's prefix cache still matches from its first call.
 * The one repair is a call whose result never arrived — the run was stopped
 * between the two (a closed browser, a restart, a model that went quiet) and a
 * call with no result is refused outright — which gets one saying so, right
 * after it. An `ask_bot` call cut off that way carries what the borrowed bot
 * had written by then, so its part is picked up rather than asked for again
 * from nothing. Nothing else changes: `compact` is the one thing that shortens
 * a bot's own thread.
 */
export function resumeThread(
  thread: ModelMessage[],
  /** Borrowed bots' last lines, by `ask_bot` call id (task.query listBorrowedTails). */
  borrowed: ReadonlyMap<string, { bot: string; tail: string }> = new Map(),
): ModelMessage[] {
  const answered = new Set<string>();
  for (const message of thread) {
    // A provider-run tool (web search) answers inside the assistant message
    if (message.role !== "tool" && message.role !== "assistant") continue;
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") answered.add(part.toolCallId);
    }
  }

  const out: ModelMessage[] = [];
  let owed: Extract<ModelMessage, { role: "tool" }>["content"] = [];
  for (const message of thread) {
    if (owed.length && message.role === "tool") {
      out.push({ ...message, content: [...owed, ...message.content] });
      owed = [];
      continue;
    }
    if (owed.length) {
      out.push({ role: "tool", content: owed });
      owed = [];
    }
    out.push(message);
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    owed = message.content.flatMap((part) =>
      part.type === "tool-call" && !answered.has(part.toolCallId)
        ? [
            {
              type: "tool-result" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: {
                type: "text" as const,
                value: interrupted(part, borrowed),
              },
            },
          ]
        : [],
    );
  }
  if (owed.length) out.push({ role: "tool", content: owed });
  return out;
}

/** What a resumed run reads where a call's result never arrived (resumeThread). */
const INTERRUPTED =
  "No result: the run was stopped before this call returned. Check what it did before relying on it.";

/** INTERRUPTED, or for a borrowed bot's part, what it had written when the run stopped. */
function interrupted(
  call: { toolCallId: string; toolName: string },
  borrowed: ReadonlyMap<string, { bot: string; tail: string }>,
): string {
  const cut =
    call.toolName === TOOL_NAMES.ask_bot
      ? borrowed.get(call.toolCallId)
      : undefined;
  if (!cut) return INTERRUPTED;
  return `No result: the run was stopped before ${cut.bot} answered, and they are not working on it any more. What they had written by then:\n\n${cut.tail}\n\nCheck what they did before relying on it, then finish the part yourself or hand them what is left.`;
}

/** Just the text out of the shape a tool result reached the model in (ai-sdk ToolResultOutput). */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  const wrapped = output as { type?: string; value?: unknown } | null;
  if (wrapped && typeof wrapped === "object" && "value" in wrapped) {
    return typeof wrapped.value === "string"
      ? wrapped.value
      : JSON.stringify(wrapped.value ?? "");
  }
  return JSON.stringify(output ?? "");
}
