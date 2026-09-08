import {
  generateText,
  hasToolCall,
  type LanguageModelUsage,
  stepCountIs,
  type ToolSet,
  tool,
} from "ai";
import { appEvents, presence } from "@/app/api/events/app-event.server";
import { MEMORY_TIDY } from "@/config";
import { loadTools } from "@/features/ai/load-tools";
import {
  getTextModel,
  resolveDefaultModel,
  type TextModel,
} from "@/features/ai/model";
import { TEXT_MODEL_PROVIDERS } from "@/features/ai/model.schema";
import {
  loadTidyPrompt,
  type TidyUnit,
} from "@/features/ai/prompts/memory-tidy.prompt";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { TokenUsage } from "@/features/bot/bot.schema";
import { readConfig } from "@/features/config/config.query";
import {
  isAnyCallLive,
  listCallTranscript,
  listUntidiedCalls,
  markCallTidied,
} from "@/features/thursday/thursday.query";
import { logger } from "@/lib/logger";
import { estimateTokens } from "@/lib/tokens";
import { errorToString } from "@/lib/utils";
import {
  findFactById,
  listFactsWrittenBetween,
  readNotes,
  sameFact,
} from "./memory.query";
import {
  type MemoryTidyChange,
  type MemoryTidyStatusView,
  tidyTally,
  tidyThreshold,
} from "./memory.schema";
import {
  addTidyUsage,
  appendTidyChanges,
  findLastTidyRun,
  findRunningTidyRun,
  insertTidyRun,
  readTidyLevel,
  readTidyModel,
  stopStaleTidyRuns,
  updateTidyRun,
} from "./tidy.query";

/**
 * The tidy pass: after calls, a text model re-reads them and reconciles memory.
 * The unit of work is one call (a long one in parts), each in a fresh context,
 * so the pass never grows past one transcript. The checkpoint is
 * call.tidied_at, stamped per call, so a pass that dies resumes at the first
 * unstamped call. One pass at a time.
 *
 * It starts on its own once enough transcript is pending and the line has
 * been quiet a while (config MEMORY_TIDY), never while a call is up or with no
 * browser on the app; "tidy now" on the screen skips the size check only.
 */

type Current = {
  id: string;
  stop: AbortController;
  done: Promise<void>;
};

type Pinned = {
  __tidy?: {
    current: Current | null;
    timer: ReturnType<typeof setTimeout> | null;
  };
};

/** Pinned to globalThis: next dev reloads this module under a running pass. */
const state = ((globalThis as Pinned).__tidy ??= {
  current: null,
  timer: null,
});

export async function readTidyStatus(): Promise<MemoryTidyStatusView> {
  const [level, model, pending, current, last] = await Promise.all([
    readTidyLevel(),
    readTidyModel(),
    listUntidiedCalls(),
    findRunningTidyRun(),
    findLastTidyRun(),
  ]);
  return {
    level,
    model: model ? `${model.provider}/${model.model}` : null,
    pendingTokens: pending.reduce((sum, call) => sum + call.tokens, 0),
    pendingCalls: pending.length,
    threshold: tidyThreshold(level),
    current,
    last,
  };
}

/** Arms the quiet timer; a call ending, or a browser arriving, calls this. Re-armed on each, so the pass waits for a real lull. */
export function scheduleTidy() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void startTidy().then((outcome) => {
      if (outcome !== "started") logger.debug(`tidy: not now (${outcome})`);
    });
  }, MEMORY_TIDY.quietMs);
}

export type TidyStart =
  | "started"
  | "off"
  | "running"
  | "call-live"
  | "browser-gone"
  | "nothing"
  | "under";

/**
 * Starts a pass if it is due. `force` skips the size and quiet checks (the
 * screen's "tidy now"), not the one-at-a-time rule.
 */
export async function startTidy(
  options: { force?: boolean } = {},
): Promise<TidyStart> {
  if (state.current) return "running";
  const level = await readTidyLevel();
  const threshold = tidyThreshold(level);
  if (threshold === null) return "off";
  if (!options.force) {
    if (!presence.watching) return "browser-gone";
    if (await isAnyCallLive()) return "call-live";
  }

  const pending = await listUntidiedCalls();
  if (!pending.length) return "nothing";
  if (!options.force) {
    const tokens = pending.reduce((sum, call) => sum + call.tokens, 0);
    const oldestDays = (Date.now() - pending[0].endedAt.getTime()) / 86_400_000;
    if (tokens < threshold && oldestDays < MEMORY_TIDY.staleDays) {
      return "under";
    }
  }

  // Resolved before the row exists so the row can name what it ran on; a
  // missing key becomes a failed row the screen can show
  const batch = pending.slice(0, MEMORY_TIDY.maxCalls).map((call) => call.id);
  let model: TextModel;
  try {
    model = await resolveTidyModel();
  } catch (cause) {
    const run = await insertTidyRun({
      provider: "-",
      model: "-",
      callIds: batch,
    });
    await updateTidyRun(run.id, {
      status: "failed",
      error: errorToString(cause),
      endedAt: new Date(),
    });
    return "started";
  }

  const run = await insertTidyRun({
    provider: model.ref.provider,
    model: model.ref.model,
    callIds: batch,
  });
  const stop = new AbortController();
  const done = drive(run.id, batch, model, stop.signal)
    .catch((cause) => logger.error(`tidy ${run.id}`, cause))
    .finally(() => {
      if (state.current?.id === run.id) state.current = null;
    });
  state.current = { id: run.id, stop, done };
  return "started";
}

/** Stops the pass in progress, if any, and records why. The stamped calls stay stamped. */
export async function stopTidy(reason: string) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const current = state.current;
  if (!current) return;
  current.stop.abort();
  await current.done;
  await updateTidyRun(current.id, {
    status: "stopped",
    error: reason,
    endedAt: new Date(),
  });
}

/** At boot (instrumentation): a row the last process left running is not running now. */
export async function sweepTidy() {
  await stopStaleTidyRuns("The server restarted.");
}

/** The picked model while its key is set, else the app default (ai/model resolveDefaultModel). */
async function resolveTidyModel(): Promise<TextModel> {
  const picked = await readTidyModel();
  if (
    picked &&
    (await readConfig(TEXT_MODEL_PROVIDERS[picked.provider].apiKeyName))
  ) {
    return getTextModel(picked);
  }
  return getTextModel(await resolveDefaultModel());
}

async function drive(
  runId: string,
  callIds: string[],
  model: TextModel,
  signal: AbortSignal,
) {
  let done = 0;
  let failure: string | null = null;
  const tools = logged(await loadTools({ target: "tidy" }), (changes) =>
    appendTidyChanges(runId, changes),
  );

  try {
    for (const callId of callIds) {
      if (signal.aborted) break;
      const call = await listCallTranscript(callId);
      // Deleted from history since the pass was planned, or nothing to read
      if (call?.endedAt && call.turns.length) {
        const written = await listFactsWrittenBetween(
          call.startedAt,
          call.endedAt,
        );
        const parts = splitTurns(call.turns, MEMORY_TIDY.unitTokens);
        for (const [at, turns] of parts.entries()) {
          if (signal.aborted) break;
          await readUnit(
            runId,
            model,
            tools,
            {
              startedAt: call.startedAt,
              endedAt: call.endedAt,
              turns,
              part:
                parts.length > 1
                  ? { index: at + 1, count: parts.length }
                  : null,
              written,
            },
            signal,
          );
        }
      }
      if (signal.aborted) break;
      await markCallTidied(callId);
      done += 1;
      await updateTidyRun(runId, { done });
    }
  } catch (cause) {
    if (!signal.aborted) failure = errorToString(cause);
  }

  // Whoever aborted writes the row (stopTidy)
  if (signal.aborted) return;

  await updateTidyRun(runId, {
    status: failure ? "failed" : "done",
    error: failure,
    endedAt: new Date(),
  });
  if (failure) return;

  const run = await findLastTidyRun();
  appEvents.emit({
    type: "memory-tidied",
    tally: tidyTally(run?.id === runId ? run.changes : []),
  });
}

/** One model context over one stretch of a call. Ends on `tidy_done` or the step cap. */
async function readUnit(
  runId: string,
  model: TextModel,
  tools: ToolSet,
  unit: TidyUnit,
  signal: AbortSignal,
) {
  const { system, user } = await loadTidyPrompt(unit);
  await generateText({
    model: model.model,
    system,
    tools,
    messages: [{ role: "user", content: user }],
    stopWhen: [
      stepCountIs(MEMORY_TIDY.steps),
      hasToolCall(TOOL_NAMES.tidy_done),
    ],
    abortSignal: signal,
    onStepFinish: async (step) => {
      await addTidyUsage(runId, usageOf(step.usage));
    },
  });
}

/** Cuts a transcript into stretches under `budget` tokens, on turn boundaries. */
function splitTurns<T extends { text: string }>(
  turns: T[],
  budget: number,
): T[][] {
  const parts: T[][] = [];
  let part: T[] = [];
  let spent = 0;
  for (const turn of turns) {
    const cost = estimateTokens(turn.text) + 4;
    if (part.length && spent + cost > budget) {
      parts.push(part);
      part = [];
      spent = 0;
    }
    part.push(turn);
    spent += cost;
  }
  if (part.length) parts.push(part);
  return parts;
}

const usageOf = (usage: LanguageModelUsage): TokenUsage => ({
  input: usage.inputTokens ?? 0,
  output: usage.outputTokens ?? 0,
});

/**
 * Wraps the two writing tools so every write lands in the run's log. Reads
 * what is there first: a line the note already holds is not an addition
 * (memory.query writeNotes skips it), and a forgotten fact must be named
 * before it is gone.
 */
function logged(
  tools: ToolSet,
  log: (changes: MemoryTidyChange[]) => Promise<void>,
): ToolSet {
  const remember = tools[TOOL_NAMES.memory_remember];
  const forget = tools[TOOL_NAMES.memory_forget];
  if (!remember?.execute || !forget?.execute) return tools;

  type Remember = {
    path: string;
    facts:
      | {
          text: string;
          replaces: number | null;
          alwaysLoad: boolean | null;
        }[]
      | null;
  };

  return {
    ...tools,
    [TOOL_NAMES.memory_remember]: tool({
      ...remember,
      execute: async (input: Remember, options) => {
        const { notes } = await readNotes([input.path], { touch: false });
        const held = new Set(
          (notes[0]?.facts ?? []).map((fact) => sameFact(fact.text)),
        );
        const path = notes[0]?.path ?? input.path.trim();
        const output = await remember.execute?.(input, options);
        const changes: MemoryTidyChange[] = [];
        for (const fact of input.facts ?? []) {
          const text = fact.text.trim();
          if (!text) continue;
          const op: MemoryTidyChange["op"] | null =
            fact.alwaysLoad === true
              ? "carry"
              : fact.alwaysLoad === false
                ? "uncarry"
                : fact.replaces != null
                  ? "replace"
                  : held.has(sameFact(text))
                    ? null
                    : "add";
          if (op) changes.push({ op, path, text });
        }
        await log(changes);
        return output;
      },
    }),
    [TOOL_NAMES.memory_forget]: tool({
      ...forget,
      execute: async (input: { factId: number }, options) => {
        const fact = await findFactById(input.factId);
        const output = await forget.execute?.(input, options);
        if (fact) {
          await log([{ op: "forget", path: fact.path, text: fact.text }]);
        }
        return output;
      },
    }),
  };
}
