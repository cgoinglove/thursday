import {
  type FinishReason,
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type PrepareStepResult,
  type ProviderMetadata,
  pruneMessages,
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
  isContextOverflow,
  modelErrorToString,
  resolveDefaultModel,
} from "@/features/ai/model";
import { loadBotPrompt } from "@/features/ai/prompts/bot.prompt";
import { sendMessageSpec } from "@/features/ai/tools/bot.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  COMPACT_AT_MIN,
  type JobBot,
  type TokenUsage,
} from "@/features/bot/bot.schema";
import {
  botBrowserSession,
  filesOnDisk,
  openBotFolders,
  openJobScratch,
} from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { estimateTokens } from "@/lib/tokens";
import { findJobBot } from "./bot.query";
import { findThread, listWrittenPaths, writtenPathsIn } from "./thread.query";

/** Events from one participant turn; the runner persists them in that participant's transcript. */
export type BotEvent =
  /** A finished chunk of prose. */
  | { type: "text"; text: string }
  /** A tool call. `id` is where the result lands. */
  | {
      type: "tool";
      id: string;
      name: string;
      input: unknown;
      providerExecuted?: boolean;
      providerOptions?: ProviderMetadata;
    }
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
  /** Normal turn end; interruption is a runtime fact, separate from room completion. */
  | { type: "turn-end"; text: string; stopped: boolean }
  /**
   * The run broke, in words a person can act on; `budget` is where to compact next
   * time, when the model refused the context as too long.
   */
  | { type: "error"; message: string; budget?: number };

/** The event as the thread sees it: which participant and continuation. */
export type ThreadEvent = BotEvent & { bot: string; parent: string | null };

export type RunOptions = {
  signal?: AbortSignal;
  parent?: string | null;
  threadId?: string | null;
  session?: string | null;
  caller: string;
  owner: string;
  contextBudget?: number;
  notes?: () => Promise<string[]>;
  send: (input: {
    id: string;
    to: string;
    text: string;
    kind?: "message" | "question";
    options?: string[] | null;
    replyTo?: string | null;
  }) => Promise<unknown>;
  emit: (event: ThreadEvent) => Promise<void>;
};

const MAX_STEPS = BOT_RUN.steps;
export type RunInput = { bot: string; messages: ModelMessage[] };

export async function runBot(
  input: RunInput,
  options: RunOptions,
): Promise<void> {
  const parent = options.parent ?? null;
  const bot = await findJobBot(input.bot.trim());
  const name = bot?.name ?? input.bot.trim();
  const emit = (event: BotEvent) =>
    options.emit({ ...event, bot: name, parent });

  if (!bot) {
    await emit({
      type: "error",
      message: `No bot named "${input.bot}". Use a name from the list.`,
    });
    return;
  }
  const history = input.messages;

  // Tools are built on the model: web search runs on this bot's model (load-tools).
  const model = await resolveModel(bot);
  const row = options.threadId ? await findThread(options.threadId) : null;
  // Participants share thread files while retaining their own context and browser.
  const [scratch, { own, artifacts }] = await Promise.all([
    options.threadId
      ? openJobScratch(options.threadId, row?.label ?? "job")
      : null,
    openBotFolders(name),
  ]);
  const [prompt, tools] = await Promise.all([
    loadBotPrompt(
      name,
      bot.systemPrompt,
      { owner: options.owner, caller: options.caller, messageId: parent },
      { scratch, own, artifacts },
    ),
    loadTools({
      target: "bot",
      bot: name,
      session:
        options.session ??
        (options.threadId ? botBrowserSession(options.threadId, name) : null),
      model,
    }),
  ]);
  // What the owner set, else the model's own window, else the constant (model.ts
  // compactBudget), and never above where this job last fit: a context the model
  // refused as too long lowers the job's own number (bot.runner). That
  // number belongs to the coordinator; peers use their own model budgets.
  const budget = Math.min(
    await compactBudget(model.ref, bot.compactAt),
    options.contextBudget || Number.POSITIVE_INFINITY,
    (name === options.owner ? row?.contextBudget : 0) ||
      Number.POSITIVE_INFINITY,
  );

  // A committed question to the user ends the turn; the answer brings the bot back (room.query tellRoom).
  let asked = false;
  const agentTools: ToolSet = {
    ...tools,
    [TOOL_NAMES.send_message]: tool({
      description: sendMessageSpec.description,
      inputSchema: sendMessageSpec.parameters,
      execute: async (input, call) => {
        const receipt = await options.send({ ...input, id: call.toolCallId });
        if (input.kind === "question") asked = true;
        return receipt;
      },
    }),
  };
  // Persist local calls before their side effects, and results before another model step.
  // The stream can repeat these events; the writer deduplicates them by call ID.
  const inFlight = new Set<Promise<unknown>>();
  const quiet = silenceWatch(BOT_RUN.silenceMs);
  for (const [toolName, held] of Object.entries(agentTools)) {
    const execute = held.execute;
    if (!execute) continue;
    held.execute = (args, call) => {
      const execution = (async () => {
        options.signal?.throwIfAborted();
        await emit({
          type: "tool",
          id: call.toolCallId,
          name: toolName,
          input: args,
        });
        quiet.hold();
        try {
          options.signal?.throwIfAborted();
          let output = await execute(args, call);
          if (
            output &&
            typeof output === "object" &&
            Symbol.asyncIterator in output
          ) {
            let last: unknown;
            for await (const value of output as AsyncIterable<unknown>)
              last = value;
            output = last;
          }
          await emit({
            type: "tool-result",
            id: call.toolCallId,
            name: toolName,
            output,
          });
          return output;
        } catch (cause) {
          await emit({
            type: "tool-result",
            id: call.toolCallId,
            name: toolName,
            output: modelErrorToString(cause),
            error: true,
          });
          throw cause;
        } finally {
          quiet.release();
        }
      })();
      inFlight.add(execution);
      void execution.finally(() => inFlight.delete(execution)).catch(() => {});
      return execution;
    };
  }

  // The SDK can prepare the next step before the consumer has stored this one.
  let writtenStep: Promise<void> = Promise.resolve();
  let acknowledgeStep = () => {};
  /** Context size the latest step went out at; an overflow shrinks the budget from it. */
  let sent = 0;

  const agent = new ToolLoopAgent({
    model: model.model,
    instructions: prompt.text,
    tools: agentTools,
    stopWhen: [stepCountIs(MAX_STEPS), () => asked],
    prepareStep: async ({ stepNumber, steps, messages }) => {
      await writtenStep;
      options.signal?.throwIfAborted();
      const step: NonNullable<PrepareStepResult<ToolSet>> = {};
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
        await emit({
          type: "compact",
          text,
          usage: summary.usage,
          messages: messages.length,
          tokens: size,
        });
        next = [messages[0], { role: "user", content: text }];
      }

      // Notes said during the last step go in as user turns after everything
      // the model has (and after the summary). Not on the first step.
      const notes = stepNumber > 0 ? ((await options.notes?.()) ?? []) : [];
      if (notes.length) {
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
  const execution = new AbortController();
  const signal = AbortSignal.any([stop, execution.signal]);
  let result;
  try {
    result = await agent.stream({
      messages: history,
      abortSignal: signal,
      onStepEnd: (step) => {
        writtenStep = new Promise<void>((resolve) => {
          acknowledgeStep = resolve;
        });
        steps.push({
          messages: step.response.messages,
          usage: usageOf(step.usage),
        });
      },
    });
  } catch (cause) {
    quiet.end();
    execution.abort();
    await Promise.allSettled([...inFlight]);
    throw cause;
  }

  let writing = "";
  /** Only prose from the final step is returned to the correspondent. */
  let last = "";
  /** Why the latest step ended; prose cut off at the output limit is not an answer. */
  let finish: FinishReason | null = null;

  /**
   * Every way the stream breaks, as the runner takes it: the words for the row, and
   * where to compact next time when the context was refused as too long. The row
   * keeps only the words, so the whole cause is logged here.
   */
  const failed = (cause: unknown): Extract<BotEvent, { type: "error" }> => {
    logger.error(`${name}: the model run broke`, cause);
    const message = modelErrorToString(cause);
    if (!isContextOverflow(cause)) return { type: "error", message };
    const shrunk = Math.floor(
      Math.min(budget, sent || budget) * BOT_RUN.overflowShrink,
    );
    return {
      type: "error",
      message,
      budget: Math.max(COMPACT_AT_MIN, shrunk),
    };
  };

  // An abort ends the stream without a finish; release any waiting take.
  stop.addEventListener(
    "abort",
    () => {
      steps.end();
      acknowledgeStep();
    },
    { once: true },
  );
  try {
    for await (const part of result.fullStream) {
      // Anything at all is the model still there
      quiet.touch();
      switch (part.type) {
        case "start-step":
          last = "";
          writing = "";
          break;

        case "text-delta":
          writing += part.text;
          break;

        case "text-end": {
          const text = writing.trim();
          writing = "";
          if (!text) break;
          last = [last, text].filter(Boolean).join("\n\n");
          await emit({ type: "text", text });
          break;
        }

        case "tool-call": {
          await emit({
            type: "tool",
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
            providerExecuted: part.providerExecuted,
            providerOptions: part.providerMetadata,
          });
          break;
        }

        case "tool-result":
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
          acknowledgeStep();
          break;
        }

        case "abort":
          // The job was stopped: whoever stopped it writes the row (bot.runner)
          if (options.signal?.aborted) return;
          // Otherwise the model went quiet (silenceWatch). The sdk types `reason` as
          // a string but hands over the signal's reason, the watch's DOMException.
          await emit(failed(part.reason ?? "The model stopped sending."));
          return;

        case "error":
          await emit(failed(part.error));
          return;

        default:
          break;
      }
    }
  } finally {
    execution.abort();
    steps.end();
    quiet.end();
    acknowledgeStep();
    await Promise.allSettled([...inFlight]);
  }

  try {
    await result.response;
  } catch (cause) {
    // Stopped between steps: whoever stopped it writes the row
    if (options.signal?.aborted) return;
    await emit(failed(cause));
    return;
  }

  // The provider's filter stopped the answer: there is nothing to continue past
  if (finish === "content-filter") {
    await emit({
      type: "error",
      message: "The provider's content filter stopped the response.",
    });
    return;
  }

  await emit({
    type: "turn-end",
    text: last,
    // A turn that asked the user ends on its tool call by design, not cut off
    stopped:
      !asked &&
      (finish === "length" || finish === "error" || finish === "tool-calls"),
  });
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
) => `Compact your context. The first message above — who handed you the job, and the job — stays exactly as it is. Everything after it is replaced by what you write now, and you carry on from that first message and this alone; nothing else above can be read again. Write it for a fresh copy of you that has your tools, your instructions and that first message, but has seen none of the rest.

Cover all of it, and prefer a fact over a description of a fact:

- **Where the job stands against that first message.** Do not restate the job; say what has changed since — a choice made, a detail settled, an answer that came back, a correction, anything you are still waiting on.
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
 * job's rows — every participant's `write_file` — and off its folder,
 * never asked of the model: a path a summary leaves out is work the next steps redo.
 * Without a thread, the run reads only the messages it is compacting.
 * A listing that fails costs the list, never the compaction.
 */
async function filesUnder(
  threadId: string | null,
  messages: ModelMessage[],
  folder: string | null,
): Promise<string> {
  try {
    const written = threadId
      ? await listWrittenPaths(threadId)
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
 * summary is written by the bot the transcript belongs to, and the provider's
 * cached prefix, instructions first, still matches the run's. A context too
 * long to summarise whole — the very thing a compaction is for — is tried once
 * more without the tool calls and results but the last few. A failure throws
 * with its cause kept. The room pauses for manual recovery; the transcript stays.
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
  if (isContextOverflow(failure)) {
    // pruneMessages drops a call together with its result, so the transcript stays whole
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
     * error mid-step) parks the loop forever, and `answerThread` waits on
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
 * running while tools execute, so a long command
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

/** Build a valid model projection without changing the recorded interruption history. */
export function resumeTranscript(
  transcript: ModelMessage[],
  receipts: ReadonlyMap<string, { messageId: string; to: string }> = new Map(),
): ModelMessage[] {
  type Result = Extract<
    Extract<ModelMessage, { role: "tool" }>["content"][number],
    { type: "tool-result" }
  >;
  const results = new Map<string, Result>();
  const embedded = new Set<string>();
  for (const message of transcript) {
    if (message.role !== "tool" && message.role !== "assistant") continue;
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      if (!results.has(part.toolCallId)) results.set(part.toolCallId, part);
      if (message.role === "assistant") embedded.add(part.toolCallId);
    }
  }
  const out: ModelMessage[] = [];
  const used = new Set<string>();
  for (const message of transcript) {
    if (message.role === "tool") {
      const other = message.content.filter(
        (part) => part.type !== "tool-result",
      );
      if (other.length) out.push({ ...message, content: other });
      continue;
    }
    if (message.role !== "assistant" || typeof message.content === "string") {
      out.push(message);
      continue;
    }
    const owed: Result[] = [];
    const content: typeof message.content = [];
    for (const part of message.content) {
      if (part.type !== "tool-call") {
        content.push(part);
        continue;
      }
      if (used.has(part.toolCallId)) continue;
      let input = part.input;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          input = undefined;
        }
      }
      if (!part.toolCallId || input === undefined) {
        content.push({
          type: "text",
          text: "A tool argument stream was interrupted before a complete call was recorded. Inspect the saved work before continuing.",
        });
        continue;
      }
      const receipt =
        part.toolName === TOOL_NAMES.send_message
          ? receipts.get(part.toolCallId)
          : undefined;
      const result =
        results.get(part.toolCallId) ??
        (receipt
          ? {
              type: "tool-result" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: { type: "json" as const, value: receipt },
            }
          : undefined);
      if (
        part.providerExecuted &&
        (!result || !embedded.has(part.toolCallId))
      ) {
        content.push({
          type: "text",
          text: result
            ? `The provider operation ${part.toolName} returned this data before its native continuation was interrupted: ${JSON.stringify(result.output)}`
            : `The provider operation ${part.toolName} was interrupted without a recorded result. Its remote execution state is unknown.`,
        });
        continue;
      }
      used.add(part.toolCallId);
      content.push({ ...part, input });
      if (!embedded.has(part.toolCallId))
        owed.push(
          result ?? {
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: {
              type: "text",
              value:
                "No result: execution was interrupted before a result was recorded. The outcome is unknown. Inspect the current state before repeating the action.",
            },
          },
        );
    }
    if (content.length) out.push({ ...message, content });
    if (owed.length) out.push({ role: "tool", content: owed });
  }
  return out;
}
