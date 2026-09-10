import type { ModelMessage } from "ai";
import { after } from "next/server";
import { appEventStream, appEvents } from "@/app/api/events/app-event.server";
import { PATHS } from "@/config";
import { modelErrorToString } from "@/features/ai/model";
import {
  buildTaskOpening,
  OPENING_TURNS,
} from "@/features/ai/prompts/bot.prompt";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  isAnyCallLive,
  listCallTurns,
} from "@/features/thursday/thursday.query";
import { pathsIn } from "@/features/workspace/file-kind";
import {
  closeHiddenBrowser,
  closeJobShell,
  pruneJobFiles,
  removeJobScratch,
} from "@/features/workspace/workspace";
import { desktopNotify } from "@/lib/desktop-notify";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { createKeyedLock } from "@/lib/queue";
import { resumeThread, runBot, type TaskEvent } from "./bot.run";
import { TASK_CONTINUE, type TaskStatus } from "./bot.schema";
import {
  addTaskUsage,
  deleteFinishedTasks,
  deleteMessages,
  deleteTask,
  findTask,
  insertTask,
  lastSeq,
  listRunningTaskIds,
  listThread,
  type TaskMessageInput,
  updateTask,
  upsertMessage,
} from "./task.query";

/**
 * Runs a job under `after()` so it outlives the request, writing every event
 * to the task's thread (task_message). A run always starts from the thread;
 * `answerTask` is the one way to add to it, serialized per job by `taskLock`.
 */

type Run = {
  stop: AbortController;
  /** Resolves when the run ends, however it ends. Interrupters wait on it. */
  done: Promise<void>;
  /**
   * Queues words for a run still going (bot.run `notes`). False once the loop
   * has ended; then they go on the thread the ordinary way (answerTask).
   */
  note: (text: string) => boolean;
};

type Pinned = {
  __botRuns?: Map<string, Run>;
  __botTaskLock?: ReturnType<typeof createKeyedLock>;
};

/** Pinned to globalThis: next dev reloads this module under a running run, and the abort controller and lock must be the originals. */
const running: Map<string, Run> = ((globalThis as Pinned).__botRuns ??=
  new Map());

/**
 * One lane per job. Stop, append, relaunch must not interleave: two answers a
 * moment apart would abort the same run and claim the same `lastSeq + 1`.
 */
const taskLock = ((globalThis as Pinned).__botTaskLock ??= createKeyedLock());

/** Opens a job. The opening message — who is who, the job, the call it came from (bot.prompt buildTaskOpening) — is the thread's first row. */
export async function startTask(input: {
  bot: string;
  request: string;
  label: string;
  callId?: string | null;
}) {
  const conversation = input.callId
    ? await listCallTurns(input.callId, OPENING_TURNS)
    : [];
  const opening = buildTaskOpening({
    bot: input.bot,
    request: input.request,
    conversation,
  });
  const task = await insertTask({ ...input, opening });
  launch(task.id, {
    bot: input.bot,
    messages: [{ role: "user", content: opening }],
  });
  return task.id;
}

/**
 * A person saying something to a job, one path for three cases: an answer to
 * a job stopped on `ask_thursday`, a note to a running one (queued and read
 * before its next step; the step in flight finishes), or a follow-up to a
 * finished one. Only when the run has already ended does the running case
 * fall through to stop, append, relaunch.
 */
export async function answerTask(id: string, answer: string) {
  return taskLock(id, async () => {
    const task = await findTask(id);
    if (!task) publicError("No such job.");

    const live = running.get(id);
    if (live && task.status === "running" && live.note(answer)) {
      logger.debug(`task ${id}: interjection queued`);
      return;
    }
    if (live) {
      live.stop.abort();
      await live.done;
    }

    const { reply, as } = joinThread(task, answer);
    logger.debug(`task ${id}: ${as}`);

    const thread = await listThread(id);
    await upsertMessage(id, (await lastSeq(id)) + 1, {
      bot: null,
      parent: null,
      ...reply,
    });

    await updateTask(id, {
      status: "running",
      outcome: null,
      pending: null,
      seen: false,
      endedAt: null,
    });
    // Resumed on the rows as they were stored (bot.run resumeThread)
    launch(id, { bot: task.bot, messages: resumeThread([...thread, reply]) });
  });
}

/**
 * How a person's words enter the thread. A job stopped on `ask_thursday` gets
 * them as that call's tool result (a call with no result would break the
 * thread); otherwise they are a fresh user turn. A job asking whether to
 * continue has no call to answer, so it is a turn as well.
 */
function joinThread(
  task: { status: TaskStatus; pending: { toolCallId: string | null } | null },
  answer: string,
): { reply: ModelMessage; as: "answer" | "interruption" | "follow-up" } {
  const pending = task.status === "waiting" ? task.pending : null;
  if (pending?.toolCallId) {
    return {
      as: "answer",
      reply: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: pending.toolCallId,
            toolName: TOOL_NAMES.ask_thursday,
            output: { type: "text", value: answer },
          },
        ],
      },
    };
  }
  return {
    as:
      task.status === "running"
        ? "interruption"
        : task.status === "waiting"
          ? "answer"
          : "follow-up",
    reply: { role: "user", content: answer },
  };
}

export async function cancelTask(id: string) {
  return taskLock(id, async () => {
    const task = await findTask(id);
    if (!task) publicError("No such job.");
    // A job that already ended has an answer in `outcome`; cancelling would
    // write "Cancelled." over the thing it was run for.
    if (task.endedAt) publicError("That job has already ended.");
    running.get(id)?.stop.abort();
    await updateTask(id, {
      status: "failed",
      outcome: "Cancelled.",
      pending: null,
      // Nobody needs to be told what they just did themselves
      seen: true,
      endedAt: new Date(),
    });
    // Cancel is a real end, so the browser session closes here; the abort in
    // answerTask is followed by a relaunch and must not close it.
    void closeJobShell(id);
  });
}

/** Deletes the job, stopping it first if it is still running. */
export async function removeTask(id: string) {
  return taskLock(id, async () => {
    const task = await findTask(id);
    running.get(id)?.stop.abort();
    running.delete(id);
    void closeJobShell(id);
    const gone = await deleteTask(id);
    // The working folder's lifetime is the row's: with the job gone, what it was
    // working with is nobody's (workspace.ts jobScratch).
    if (gone && task) await removeJobScratch(id, task.label);
    return gone;
  });
}

/**
 * Clearing finished jobs from the screen, and their working folders with them.
 * Lives here rather than in the query because a row and a folder go together
 * and only one of the two is the database's.
 */
export async function removeFinishedTasks(): Promise<number> {
  const removed = await deleteFinishedTasks();
  for (const task of removed) await removeJobScratch(task.id, task.label);
  return removed.length;
}

/**
 * At boot (instrumentation): rows the last process left as running become
 * `waiting` with the one continue option, not failed. The answer resumes the
 * stored thread (answerTask). Nothing else needs to reconcile — a run that ends
 * badly records it itself (drive), and the write that does so is durable
 * (database/db.ts oneAtATime).
 */
export async function sweepTasks() {
  for (const id of await listRunningTaskIds()) {
    if (!running.has(id)) {
      await abandon(id, "The server restarted while this was running");
    }
  }
}

/**
 * Puts a run that is no longer running back where the user can pick it up: the
 * same shape a step limit leaves (`waiting` with the one continue option), so
 * the screen and Thursday need no third state for it. The thread stays whole,
 * and answering resumes from it.
 */
async function abandon(id: string, why: string) {
  await updateTask(id, {
    status: "waiting",
    outcome: `${why}. Everything it had done is still here. Pick it back up?`,
    pending: { toolCallId: null, options: [TASK_CONTINUE] },
    seen: false,
    endedAt: null,
  });
}

/**
 * The browser closed (app-event.server presence): every run stops where it is
 * and waits with the one continue option, the way a restart leaves it
 * (sweepTasks). The thread stays; answering resumes it.
 */
export async function pauseTasks(reason: string) {
  for (const [id, run] of [...running]) {
    await taskLock(id, async () => {
      run.stop.abort();
      await run.done;
      const task = await findTask(id);
      if (!task || task.status !== "running") return;
      await updateTask(id, {
        status: "waiting",
        outcome: `${reason} Everything it had done is still here. Pick it back up?`,
        pending: { toolCallId: null, options: [TASK_CONTINUE] },
        seen: false,
        endedAt: null,
      });
      // The window stays open: this row is on the screen and answering resumes
      // into the page it left off at — including a sign-in the user is mid-way
      // through, which is the one thing only that window can finish.
    });
  }
}

function launch(id: string, input: { bot: string; messages: ModelMessage[] }) {
  const stop = new AbortController();
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  // Notes said to the job while it runs. The run drains them before each step;
  // what is left when the loop ends is handed on by `drive`.
  const notes: string[] = [];
  const run: Run = {
    stop,
    done,
    note: (text) => {
      if (!running.has(id)) return false;
      notes.push(text);
      return true;
    },
  };
  running.set(id, run);
  // The response goes out first, and the run carries on behind it
  after(() =>
    drive(id, input, stop.signal, notes)
      .catch((cause) => {
        logger.error(`task ${id}`, cause);
      })
      .finally(finish),
  );
}

/**
 * Writes the thread one step at a time: rows go in while the step streams and
 * are rewritten from the step's own messages when it ends. Slots (`seq`) are
 * claimed synchronously because a borrowed bot writes into the same thread
 * from inside a tool call.
 */
class ThreadWriter {
  private seq: number;
  /** One step in flight per writer: the job's bot and each bot it borrowed. */
  private steps = new Map<
    string,
    { assistant: number | null; tool: number | null; parts: StepParts }
  >();

  constructor(
    private taskId: string,
    seq: number,
  ) {
    this.seq = seq;
  }

  /**
   * A line from the app rather than from anyone in the room. A user row so a
   * resumed run reads it as something it was told, and `note` so the screen
   * draws it as a note and `rosterOf` does not take it for a person speaking.
   */
  async note(text: string) {
    await upsertMessage(this.taskId, ++this.seq, {
      bot: null,
      parent: null,
      role: "user",
      content: text,
      note: true,
    });
  }

  private step(event: TaskEvent) {
    const key = `${event.bot} ${event.parent ?? ""}`;
    let step = this.steps.get(key);
    if (!step) {
      step = {
        assistant: null,
        tool: null,
        parts: { assistant: [], tool: [] },
      };
      this.steps.set(key, step);
    }
    return step;
  }

  private write(
    seq: number,
    event: TaskEvent,
    message: ModelMessage,
    extra: { compact?: boolean; note?: boolean } = {},
  ) {
    const input: TaskMessageInput = {
      bot: event.bot,
      parent: event.parent,
      role: message.role,
      content: message.content,
      compact: extra.compact ?? false,
      note: extra.note ?? false,
    };
    return upsertMessage(this.taskId, seq, input);
  }

  async on(event: TaskEvent) {
    const step = this.step(event);
    switch (event.type) {
      case "text":
        step.assistant ??= ++this.seq;
        step.parts.assistant.push({ type: "text", text: event.text });
        return this.write(step.assistant, event, {
          role: "assistant",
          content: step.parts.assistant,
        });

      case "tool":
        step.assistant ??= ++this.seq;
        step.parts.assistant.push({
          type: "tool-call",
          toolCallId: event.id,
          toolName: event.name,
          input: event.input,
        });
        return this.write(step.assistant, event, {
          role: "assistant",
          content: step.parts.assistant,
        });

      case "tool-result":
        step.assistant ??= ++this.seq;
        step.tool ??= ++this.seq;
        step.parts.tool.push({
          type: "tool-result",
          toolCallId: event.id,
          toolName: event.name,
          output:
            typeof event.output === "string"
              ? { type: "text", value: event.output }
              : { type: "json", value: event.output as never },
        });
        return this.write(step.tool, event, {
          role: "tool",
          content: step.parts.tool,
        });

      case "step": {
        // The slots the step streamed into, then fresh ones for anything more
        const slots = [step.assistant, step.tool];
        this.steps.delete(`${event.bot} ${event.parent ?? ""}`);
        const written = new Set<number>();
        for (const [index, message] of event.messages.entries()) {
          const seq = slots[index] ?? ++this.seq;
          written.add(seq);
          await this.write(seq, event, message);
        }
        // A slot claimed while streaming that the step did not fill: a
        // provider-executed tool (web search) answers inside the assistant
        // message, leaving a tool row with no call in front of it.
        const stale = slots.filter(
          (seq): seq is number => seq !== null && !written.has(seq),
        );
        if (stale.length) await deleteMessages(this.taskId, stale);
        return;
      }

      case "compact":
        // The row a resume restarts from (task.query listThread); earlier rows
        // stay for the screen.
        return this.write(
          ++this.seq,
          event,
          { role: "user", content: event.text },
          { compact: true, note: true },
        );

      case "interjection":
        // Between the two steps, where the model read it.
        return this.write(++this.seq, event, {
          role: "user",
          content: event.text,
        });

      default:
        return;
    }
  }
}

type StepParts = {
  assistant: Extract<ModelMessage, { role: "assistant" }>["content"] &
    unknown[];
  tool: Extract<ModelMessage, { role: "tool" }>["content"];
};

async function drive(
  id: string,
  input: { bot: string; messages: ModelMessage[] },
  signal: AbortSignal,
  notes: string[],
) {
  const thread = new ThreadWriter(id, await lastSeq(id));

  let ending: {
    status: TaskStatus;
    outcome: string;
    pending: { toolCallId: string | null; options: string[] } | null;
  } | null = null;
  /** What broke, as the provider said it; the thread carries it too (below). */
  let broken: string | null = null;

  try {
    await runBot(input, {
      signal,
      taskId: id,
      notes: () => notes.splice(0),
      emit: async (event) => {
        await thread.on(event);
        // A borrowed bot's steps count toward the job's usage; the window fill
        // is only the job's own bot's.
        if (event.type === "step") {
          await addTaskUsage(
            id,
            event.usage,
            event.parent
              ? null
              : { tokens: event.usage.input, budget: event.budget },
          );
        }
        // Compaction and answering a borrowed bot (bot.run answerBack) cost the job too.
        if (event.type === "compact" || event.type === "answered") {
          await addTaskUsage(id, event.usage);
        }
        // Only the job's own bot ends it; a borrowed bot's ending is a tool result.
        if (event.parent) return;
        if (event.type === "waiting") {
          ending = {
            status: "waiting",
            outcome: event.question,
            pending: { toolCallId: event.id, options: event.options },
          };
        } else if (event.type === "answer") {
          // An answer ends the job; one the app stopped (bot.run `stopped`) waits
          // with the continue option. The outcome is the answer text verbatim;
          // the same text is the thread line (bot.query linesOf).
          ending = event.stopped
            ? {
                status: "waiting",
                outcome: event.text,
                pending: { toolCallId: null, options: [TASK_CONTINUE] },
              }
            : { status: "done", outcome: event.text, pending: null };
        } else if (event.type === "error") {
          broken = event.message;
          ending = {
            status: "failed",
            outcome: broke(event.message),
            pending: null,
          };
        }
      },
    });
  } catch (cause) {
    broken = modelErrorToString(cause);
    ending = {
      status: "failed",
      outcome: broke(broken),
      pending: null,
    };
  } finally {
    running.delete(id);
  }

  // Whoever aborted writes the row: cancel marks failed, answerTask relaunches.
  if (signal.aborted) return;

  const final = ending ?? {
    status: "failed" as const,
    outcome: "Stopped without handing anything back.",
    pending: null,
  };
  // A thread that simply stops cannot be read: the room shows a tool call with
  // no answer, and a resumed run has no idea why. The task row says it too, but
  // the row is a status and this is the story. Never at the cost of the status
  // write, which is what tells anyone the job ended at all.
  if (final.status === "failed") {
    await thread
      .note(`The run stopped here: ${broken ?? final.outcome}`)
      .catch((cause) => logger.warn(`task ${id}: break not written`, cause));
  }

  // The one write that must land: everything else in this run has already
  // happened, and this is what tells the screen and Thursday it ended at all.
  // Writes are serialised, so contention no longer throws here (database/db.ts);
  // what is left is a database that cannot be written to, which a retry would
  // not help either. Said plainly rather than thrown into `after`, where it
  // would read as an unexplained request failure — and the row stays `running`,
  // which the next boot reconciles (sweepTasks).
  try {
    await updateTask(id, {
      ...final,
      seen: false,
      endedAt: final.status === "waiting" ? null : new Date(),
    });
  } catch (cause) {
    logger.error(`task ${id}: could not record how it ended`, cause);
    return;
  }

  // A waiting job keeps its browser: answering resumes into the page it left
  // off at. An ended one closes only what nobody can see (closeHiddenBrowser).
  if (final.status === "waiting") void pruneJobFiles();
  else void closeHiddenBrowser(id);

  const task = await findTask(id);
  if (!task) return;

  // Notes that arrived after the last step began were never read; they go on
  // as a turn and the job resumes from what it just handed back.
  if (notes.length) {
    const said = notes.splice(0).join("\n\n");
    logger.debug(`task ${id}: interjection after the run ended — resuming`);
    void answerTask(id, said).catch((cause) => {
      logger.error(`task ${id}: late interjection`, cause);
    });
    return;
  }

  await announce(task.label, final);

  // A finished job naming a document opens it on the screen (workspace artifact-view).
  if (final.status === "done") {
    const path = artifactIn(final.outcome);
    if (path) {
      appEvents.emit({ type: "artifact", taskId: id, label: task.label, path });
    }
  }
}

/** The document an answer names: the artifacts folder first, otherwise the first drawable file. */
function artifactIn(outcome: string): string | null {
  const paths = pathsIn(outcome);
  return (
    paths.find((path) => path.startsWith(`${PATHS.artifacts}/`)) ??
    paths[0] ??
    null
  );
}

/**
 * A failure the user can act on: the provider message stays as the clue, plus
 * the way out (answering resumes from a condensed thread).
 */
function broke(message: string): string {
  return `The run broke: ${message}\n\nEverything it had done is still here — answer to pick it back up.`;
}

/**
 * Desktop notification unless a call is live (the browser relays the job to
 * the call itself). `watchers === 0` is checked first: a crashed browser can
 * leave a live call row behind until boot clears it (thursday.query sweepCalls).
 */
async function announce(
  label: string,
  ending: { status: TaskStatus; outcome: string },
) {
  const nobodyWatching = appEventStream.watchers === 0;
  if (!nobodyWatching && (await isAnyCallLive())) return;

  const title = ending.status === "waiting" ? `${label} — needs you` : label;
  desktopNotify(title, ending.outcome);
}
