import {
  generateText,
  hasToolCall,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type PrepareStepResult,
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
  modelErrorToString,
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
  type JobBot,
  NO_TOKENS,
  type TokenUsage,
} from "@/features/bot/bot.schema";
import {
  closeHiddenBrowser,
  openBotFolder,
  openJobScratch,
} from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { estimateTokens } from "@/lib/tokens";
import { hasNotesRequest, keepNotes } from "./bot.notes";
import { findJobBot, readBotNotesOn } from "./bot.query";
import { findTask, optionsOf } from "./task.query";

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
  | { type: "tool-result"; id: string; name: string; output: unknown }
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
   * step, or the run ended with nothing handed back. A stopped job waits to be
   * continued; any other answer ends it.
   */
  | { type: "answer"; text: string; stopped: boolean }
  | { type: "error"; message: string };

/** The event as the thread sees it: which bot, inside which `ask_bot` call. */
export type TaskEvent = BotEvent & { bot: string; parent: string | null };

export type RunOptions = {
  signal?: AbortSignal;
  depth?: number;
  /** The `ask_bot` call this run answers; null for the job's own bot. */
  parent?: string | null;
  /** The job this runs inside. The shell pins its browser session to it (workspace.ts). */
  taskId?: string | null;
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
    });
    return;
  }

  // Tools are built on the model: web search runs on this bot's model (load-tools).
  const model = await resolveModel(bot);
  // One folder per job, not per bot: bots borrowed with `ask_bot` work inside
  // the same job and share its material (workspace.ts jobScratch).
  const [scratch, own] = await Promise.all([
    options.taskId
      ? openJobScratch(
          options.taskId,
          (await findTask(options.taskId))?.label ?? "job",
        )
      : null,
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
      taskId: options.taskId,
      model,
    }),
  ]);
  // What the owner set, else the model's own window, else the constant (model.ts compactBudget)
  const budget = await compactBudget(model.ref, bot.compactAt);

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
      let next = messages;
      // The opening survives every compaction, so past it and one summary there is nothing to compact
      if (size > budget && messages.length > 2) {
        const summary = await compact(model.model, agentTools, messages, {
          signal: options.signal,
          budget,
        });
        logger.debug(
          `compacted ${messages.length} messages at ${size} tokens (budget ${budget})`,
        );
        pending.compact = {
          type: "compact",
          text: summary.text,
          usage: summary.usage,
          messages: messages.length,
          tokens: size,
        };
        next = [messages[0], { role: "user", content: summary.text }];
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
  const result = await agent.stream({
    messages: history,
    abortSignal: options.signal,
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
  /** What the bot wants changed about its own instructions (bot.tool `notes`); applied after the answer. */
  let wants: string | null = null;

  // An abort ends the stream without a finish; release any waiting take.
  options.signal?.addEventListener("abort", () => steps.end(), { once: true });
  try {
    for await (const part of result.fullStream) {
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
            wants = notesRequestOf(part.input);
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

        case "finish-step": {
          const step = await steps.take();
          if (step) await emit({ type: "step", ...step, budget });
          break;
        }

        case "error":
          await emit({
            type: "error",
            message: modelErrorToString(part.error),
          });
          return;

        default:
          break;
      }
    }
  } finally {
    steps.end();
  }

  try {
    await result.response;
  } catch (cause) {
    await emit({ type: "error", message: modelErrorToString(cause) });
    return;
  }

  // Asking wins over answering: the loop halts on the ask.
  if (asked) {
    await emit({ type: "waiting", ...asked });
    return;
  }

  if (answered) {
    await emit({ type: "answer", ...answered });
    // After the answer, never before, and only when the bot asked for something:
    // a job that changed nothing about this machine must not cost a model call.
    if (hasNotesRequest(wants) && (await readBotNotesOn())) {
      await keepNotes({
        bot: name,
        model: model.model,
        want: wants as string,
        signal: options.signal,
      });
    }
    return;
  }

  // The sdk stops on a step with no tool call regardless of `stopWhen`. Prose
  // there is an answer given without the tool and ends the job like one; nothing
  // at all, or prose on the step the cap narrowed to `answer`, is a stop.
  await emit({
    type: "answer",
    text: last ?? "Stopped without handing anything back.",
    stopped: last === null || stepAt >= MAX_STEPS - 1,
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

/** A provider that cannot send null in a string field writes the word instead. */
const NO_NOTES = new Set(["null", "none", "n/a", "-", "없음"]);

/** `answer`'s `notes` as the pass takes it. */
function notesRequestOf(input: unknown): string | null {
  const said = (input as { notes?: unknown })?.notes;
  const text = typeof said === "string" ? said.trim() : "";
  return text && !NO_NOTES.has(text.toLowerCase()) ? text : null;
}

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

/**
 * The model summarizes its own context and continues from the summary. Tools
 * are passed with calling off: providers refuse a history of tool calls
 * without the tools that made them. A failure throws and the runner closes
 * the run as `failed`; the thread stays.
 */
async function compact(
  model: LanguageModel,
  tools: ToolSet,
  messages: ModelMessage[],
  options: { signal?: AbortSignal; budget: number },
): Promise<{ text: string; usage: TokenUsage }> {
  try {
    const { text, usage } = await generateText({
      model,
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
    });
    const summary = text.trim();
    if (summary) {
      return {
        text: `${COMPACT_PREAMBLE}\n\n${summary}`,
        usage: usageOf(usage),
      };
    }
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new Error(
      `Could not compact the context (${modelErrorToString(cause)}).`,
    );
  }
  throw new Error(
    "The summary of the context came back empty, so there is nothing to carry on from.",
  );
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
        // The borrowed bot gets its own browser session under this call's id.
        // When it answers, the same rule as a job's end: what it showed on their
        // screen stays, what nobody can see closes (workspace.ts closeHiddenBrowser).
        const taskId = asker.options.taskId
          ? `${asker.options.taskId}-${call.toolCallId.slice(0, 8)}`
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
              depth: asker.depth + 1,
              parent: call.toolCallId,
              taskId,
              answer,
            },
          );
          return exchanges.length
            ? `${outcome}\n\n${exchangeLines(bot, exchanges)}`
            : outcome;
        } finally {
          if (taskId) void closeHiddenBrowser(taskId);
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
 * between the two (a closed browser pauses every run, a restart abandons them)
 * and a call with no result is refused outright — which gets one saying so,
 * right after it. Nothing else changes: `compact` is the one thing that
 * shortens a bot's own thread.
 */
export function resumeThread(thread: ModelMessage[]): ModelMessage[] {
  const answered = new Set<string>();
  for (const message of thread) {
    if (message.role !== "tool") continue;
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
              output: { type: "text" as const, value: INTERRUPTED },
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
