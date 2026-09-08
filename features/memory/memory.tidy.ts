import {
  generateText,
  hasToolCall,
  type LanguageModelUsage,
  stepCountIs,
  type ToolSet,
  tool,
} from "ai";
import { appEvents } from "@/app/api/events/app-event.server";
import { MEMORY_TIDY } from "@/config";
import { loadTools } from "@/features/ai/load-tools";
import {
  getTextModel,
  modelErrorToString,
  type TextModel,
} from "@/features/ai/model";
import { loadTidyPrompt } from "@/features/ai/prompts/memory-tidy.prompt";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { TokenUsage } from "@/features/bot/bot.schema";
import {
  listOwedTurns,
  listUnreadCallIds,
  markCallsRead,
  type OwedTurn,
} from "@/features/thursday/thursday.query";
import { logger } from "@/lib/logger";
import { errorToString } from "@/lib/utils";
import {
  findFactById,
  findNoteByPath,
  listFactsWrittenBetween,
  resolveNotePath,
  sameFact,
} from "./memory.query";
import {
  type MemoryTidyChange,
  type MemoryTidyStatusView,
  tidyTally,
} from "./memory.schema";
import {
  addTidyUsage,
  appendTidyChanges,
  findLastTidyRun,
  findRunningTidyRun,
  insertTidyRun,
  readTidyModel,
  readTidyOn,
  stopStaleTidyRuns,
  updateTidyRun,
} from "./tidy.query";

/**
 * Reading calls back: when a call ends, a text model re-reads what was said and
 * reconciles memory with it. One read is one model context over the most recent
 * `MEMORY_TIDY.messages` turns; every unread call is stamped when it finishes,
 * older ones included, so a backlog collapses into one read instead of many and
 * the recent conversation is what survives. The checkpoint is call.tidied_at,
 * so a read that dies leaves everything it did not stamp for the next one.
 * One read at a time.
 */

type Current = { id: string; stop: AbortController; done: Promise<void> };

type Pinned = { __tidy?: { current: Current | null } };

/** Pinned to globalThis: next dev reloads this module under a running read. */
const state = ((globalThis as Pinned).__tidy ??= { current: null });

export async function readTidyStatus(): Promise<MemoryTidyStatusView> {
  const [on, model, owed, current, last] = await Promise.all([
    readTidyOn(),
    readTidyModel(),
    listOwedTurns(),
    findRunningTidyRun(),
    findLastTidyRun(),
  ]);
  return {
    on,
    model: model ? `${model.provider}/${model.model}` : null,
    pending: owed.length,
    every: MEMORY_TIDY.messages,
    current,
    last,
  };
}

export type TidyStart =
  | "started"
  | "off"
  | "no-model"
  | "running"
  | "nothing"
  | "under";

/**
 * Starts a read if enough has been said. Called when a call ends; `force` is
 * the screen's "Read now" and skips the count, not the one-at-a-time rule.
 */
export async function startTidy(
  options: { force?: boolean } = {},
): Promise<TidyStart> {
  if (state.current) return "running";
  if (!(await readTidyOn())) return "off";
  // Before anything is read: with no model picked there is nothing to run on,
  // and falling back to the app default would spend on a model nobody chose
  // for this (resolveTidyModel).
  if (!(await readTidyModel())) return "no-model";

  // Ids first: a call ending between the two reads is then in `owed` but not in
  // `callIds`, so it stays unread instead of being stamped unread.
  const callIds = await listUnreadCallIds();
  const owed = await listOwedTurns();
  if (!owed.length) return "nothing";
  if (!options.force && owed.length < MEMORY_TIDY.messages) return "under";

  // Turns past the window are dropped and their calls stamped with the rest:
  // the recent conversation is what is worth reading.
  const turns = owed.slice(-MEMORY_TIDY.messages);
  const clipped = turns.length < owed.length;

  // Resolved before the row exists so the row can name what it ran on; a
  // missing key becomes a failed row the screen can show.
  let model: TextModel;
  try {
    model = await resolveTidyModel();
  } catch (cause) {
    const run = await insertTidyRun({
      provider: "-",
      model: "-",
      callIds,
      messages: turns.length,
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
    callIds,
    messages: turns.length,
  });
  const stop = new AbortController();
  const done = drive(run.id, { turns, clipped, callIds }, model, stop.signal)
    .catch((cause) => logger.error(`tidy ${run.id}`, cause))
    .finally(() => {
      if (state.current?.id === run.id) state.current = null;
    });
  state.current = { id: run.id, stop, done };
  return "started";
}

/** Stops the read in progress, if any, and records why. Nothing is stamped, so the next read picks it all up. */
export async function stopTidy(reason: string) {
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

/**
 * The picked model, and only that one. `startTidy` has already refused to run
 * without a pick; a pick whose key is gone throws here and becomes a failed row,
 * which is what says which key to put back.
 */
async function resolveTidyModel(): Promise<TextModel> {
  const picked = await readTidyModel();
  if (!picked) throw new Error("No model is set for reading calls back.");
  return getTextModel(picked);
}

async function drive(
  runId: string,
  read: { turns: OwedTurn[]; clipped: boolean; callIds: string[] },
  model: TextModel,
  signal: AbortSignal,
) {
  const tools = logged(await loadTools({ target: "tidy" }), (changes) =>
    appendTidyChanges(runId, changes),
  );

  let failure: string | null = null;
  try {
    // What the calls saved as they went, so the read amends rather than repeats
    const written = await listFactsWrittenBetween(
      read.turns[0].startedAt,
      new Date(),
    );
    const { system, user } = await loadTidyPrompt({ ...read, written });

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
      onStepFinish: (step) => addTidyUsage(runId, usageOf(step.usage)),
    });
    // Inside the try: a stamp that does not land is a read that has to happen
    // again, and the changes it already wrote are deduplicated on the next one
    // (memory.query writeNotes sameFact).
    if (!signal.aborted) await markCallsRead(read.callIds);
  } catch (cause) {
    if (!signal.aborted) failure = modelErrorToString(cause);
  }

  // Whoever aborted writes the row (stopTidy); nothing is stamped either way
  if (signal.aborted) return;

  await updateTidyRun(runId, {
    status: failure ? "failed" : "done",
    error: failure,
    endedAt: new Date(),
  });

  const run = await findLastTidyRun();
  appEvents.emit({
    type: "memory-tidied",
    failed: Boolean(failure),
    tally: failure ?? tidyTally(run?.id === runId ? run.changes : []),
  });
}

const usageOf = (usage: LanguageModelUsage): TokenUsage => ({
  input: usage.inputTokens ?? 0,
  output: usage.outputTokens ?? 0,
});

/**
 * Wraps the two writing tools so every write lands in the run's log. The note is
 * read first, because what the write means is only visible against what was
 * there: a line the note already holds is not an addition (memory.query
 * writeNotes skips it), only a change to whether it is carried; and a forgotten
 * fact has to be named before it is gone.
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
      | { text: string; replaces: number | null; alwaysLoad: boolean | null }[]
      | null;
  };

  return {
    ...tools,
    [TOOL_NAMES.memory_remember]: tool({
      ...remember,
      execute: async (input: Remember, options) => {
        // Resolved the way the tool resolves it, so a note written by alias is
        // compared against itself rather than read as new
        const known = await resolveNotePath(input.path);
        const before = known ? await findNoteByPath(known) : null;
        const byText = new Map(
          (before?.facts ?? []).map((fact) => [sameFact(fact.text), fact]),
        );
        const ids = new Set((before?.facts ?? []).map((fact) => fact.id));
        const path = before?.path ?? input.path.trim();

        const output = await remember.execute?.(input, options);

        const changes: MemoryTidyChange[] = [];
        for (const fact of input.facts ?? []) {
          const text = fact.text.trim();
          if (!text) continue;
          const held = byText.get(sameFact(text));
          if (held) {
            // The line is already there. Only its carried state can be news;
            // `alwaysLoad` is null when the model is leaving it alone.
            if (
              fact.alwaysLoad != null &&
              fact.alwaysLoad !== held.alwaysLoad
            ) {
              changes.push({
                op: fact.alwaysLoad ? "carry" : "uncarry",
                path,
                text,
              });
            }
            continue;
          }
          // A `replaces` pointing at nothing is stored as a new fact, not a
          // revision (memory.query writeNotes), so the log says the same.
          changes.push({
            op:
              fact.replaces != null && ids.has(fact.replaces)
                ? "replace"
                : "add",
            path,
            text,
          });
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
        if (fact)
          await log([{ op: "forget", path: fact.path, text: fact.text }]);
        return output;
      },
    }),
  };
}
