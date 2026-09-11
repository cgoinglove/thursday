import type { ModelMessage } from "ai";
import {
  appEventStream,
  appEvents,
  presence,
} from "@/app/api/events/app-event.server";
import { BOT_RUN, PATHS, WORKSPACE_KEEP } from "@/config";
import {
  type ModelFailure,
  modelErrorToString,
  modelFailureOf,
} from "@/features/ai/model";
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
  jobScratch,
  listScratchFolders,
  pruneJobFiles,
  removeJobScratch,
  removeUnchangedFolders,
} from "@/features/workspace/workspace";
import { desktopNotify } from "@/lib/desktop-notify";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { createKeyedLock } from "@/lib/queue";
import {
  createBotDesks,
  resumeThread,
  runBot,
  type TaskEvent,
} from "./bot.run";
import {
  TASK_CONTINUE,
  type TaskPending,
  type TaskSpeaker,
  type TaskStatus,
  tagSpeaker,
} from "./bot.schema";
import {
  addTaskUsage,
  countStopsSinceSpoken,
  deleteMessages,
  deleteTask,
  findTask,
  insertTask,
  lastSeq,
  listAutoStoppedTasks,
  listBorrowedTails,
  listRunningTaskIds,
  listTaskFolders,
  listThread,
  stopNote,
  type TaskMessageInput,
  updateTask,
  upsertMessage,
} from "./task.query";

/**
 * Runs a job so it outlives the request, writing every event to the task's
 * thread (task_message). A run always starts from the thread. `answerTask` is
 * the one way a person adds to it, serialized per job by `taskLock`, and
 * `resumeTask` the one way the app picks a job back up by itself.
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
  __botResumes?: Map<string, ReturnType<typeof setTimeout>>;
  __botPausing?: { current: Promise<void> };
};

/** Pinned to globalThis: next dev reloads this module under a running run, and the abort controller and lock must be the originals. */
const running: Map<string, Run> = ((globalThis as Pinned).__botRuns ??=
  new Map());

/**
 * One lane per job. Stop, append, relaunch must not interleave: two answers a
 * moment apart would abort the same run and claim the same `lastSeq + 1`.
 */
const taskLock = ((globalThis as Pinned).__botTaskLock ??= createKeyedLock());

/** When each parked job picks itself back up (scheduleResume); one timer per job. */
const resumes: Map<string, ReturnType<typeof setTimeout>> = ((
  globalThis as Pinned
).__botResumes ??= new Map());

/** The pause under way, if any; a returning browser waits for it (resumeStoppedTasks). */
const pausing = ((globalThis as Pinned).__botPausing ??= {
  current: Promise.resolve(),
});

/** Opens a job. The opening message — who is on it, the job, the call it came from (bot.prompt buildTaskOpening) — is the thread's first row. */
export async function startTask(input: {
  bot: string;
  request: string;
  label: string;
  callId?: string | null;
  /** Who handed it over: Thursday during a call, or the user on screen. */
  from: TaskSpeaker;
}) {
  const { from, ...row } = input;
  const conversation = row.callId
    ? await listCallTurns(row.callId, OPENING_TURNS)
    : [];
  const opening = buildTaskOpening({
    bot: row.bot,
    request: row.request,
    conversation,
    from,
  });
  const task = await insertTask({ ...row, opening });
  launch(task.id, {
    bot: row.bot,
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
 *
 * @param from Who said it. The words go on the thread tagged with it (bot.schema
 * tagSpeaker): Thursday passing something on from a call and the user typing on
 * screen reach the bot down this one pipe, and a go-ahead means something
 * different from each. Unset for words that already carry their tags — the notes
 * a finished run left unread (drive).
 */
export async function answerTask(
  id: string,
  answer: string,
  from?: TaskSpeaker,
) {
  const said = from ? tagSpeaker(from, answer) : answer;
  return taskLock(id, async () => {
    const task = await findTask(id);
    if (!task) publicError("No such job.");

    const live = running.get(id);
    if (live && task.status === "running" && live.note(said)) {
      logger.debug(`task ${id}: interjection queued`);
      return;
    }
    if (live) {
      live.stop.abort();
      await live.done;
    }
    // A person picked it up; whatever the app meant to do by itself is moot
    forgetResume(id);

    const thread = await listThread(id);
    const { reply, as } = joinThread(task, said, thread);
    logger.debug(`task ${id}: ${as}`);

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
    launch(id, {
      bot: task.bot,
      messages: resumeThread([...thread, reply], await listBorrowedTails(id)),
    });
  });
}

/**
 * The `ask_thursday` calls still open in the step a job stopped on: a model can
 * ask twice at once, and the one answer goes to each rather than leaving the
 * second to read as a call cut off (bot.run resumeThread). A call that already
 * has a result — arguments the tool refused — is not open, and the words go in
 * as a turn instead: a second result for one call is refused outright.
 */
function openAsks(thread: ModelMessage[], stoppedOn: string): string[] {
  const answered = new Set(
    thread.flatMap((message) =>
      message.role === "tool"
        ? message.content.flatMap((part) =>
            part.type === "tool-result" ? [part.toolCallId] : [],
          )
        : [],
    ),
  );
  const step = thread.findLast(
    (message) =>
      message.role === "assistant" &&
      typeof message.content !== "string" &&
      message.content.some(
        (part) => part.type === "tool-call" && part.toolCallId === stoppedOn,
      ),
  );
  const asks =
    step?.role === "assistant" && typeof step.content !== "string"
      ? step.content.flatMap((part) =>
          part.type === "tool-call" && part.toolName === TOOL_NAMES.ask_thursday
            ? [part.toolCallId]
            : [],
        )
      : [stoppedOn];
  return asks.filter((toolCallId) => !answered.has(toolCallId));
}

/**
 * How a person's words enter the thread. A job stopped on `ask_thursday` gets
 * them as that call's tool result (a call with no result would break the
 * thread); otherwise they are a fresh user turn. A job asking whether to
 * continue has no call to answer, so it is a turn as well.
 */
function joinThread(
  task: { status: TaskStatus; pending: TaskPending | null },
  answer: string,
  thread: ModelMessage[],
): { reply: ModelMessage; as: "answer" | "interruption" | "follow-up" } {
  const pending = task.status === "waiting" ? task.pending : null;
  const asks = pending?.toolCallId ? openAsks(thread, pending.toolCallId) : [];
  if (asks.length) {
    return {
      as: "answer",
      reply: {
        role: "tool",
        content: asks.map((toolCallId) => ({
          type: "tool-result" as const,
          toolCallId,
          toolName: TOOL_NAMES.ask_thursday,
          output: { type: "text" as const, value: answer },
        })),
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
    forgetResume(id);
    const live = running.get(id);
    live?.stop.abort();
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
    await live?.done;
    await closeJobShell(id);
  });
}

/** Deletes the job, stopping it first if it is still running. */
export async function removeTask(id: string) {
  return taskLock(id, () => removeLockedTask(id));
}

/** The caller holds taskLock, so a follow-up cannot race deletion or browser cleanup. */
async function removeLockedTask(id: string) {
  const task = await findTask(id);
  forgetResume(id);
  const live = running.get(id);
  live?.stop.abort();
  await live?.done;
  await closeJobShell(id);
  const gone = await deleteTask(id);
  if (gone && task) await removeJobScratch(id, task.label);
  return gone;
}

/**
 * Clearing finished jobs from the screen, and their working folders with them.
 * Lives here rather than in the query because a row and a folder go together
 * and only one of the two is the database's.
 */
export async function removeFinishedTasks(): Promise<number> {
  let removed = 0;
  for (const task of await listTaskFolders()) {
    if (task.status !== "done" && task.status !== "failed") continue;
    await taskLock(task.id, async () => {
      const current = await findTask(task.id);
      if (current?.status !== "done" && current?.status !== "failed") return;
      if (await removeLockedTask(task.id)) removed += 1;
    });
  }
  return removed;
}

/**
 * Clears what jobs left behind by age (config WORKSPACE_KEEP), at boot and on a
 * timer (instrumentation): a job's folder once the job ended that long ago — a job
 * running or waiting keeps its own however old — a scratch folder no job owns once
 * it has not changed that long, and spilled output and browser snapshots that old
 * (pruneJobFiles). A job's folder goes under the job's lock, so a word that picks
 * the job back up in that moment never finds its material gone. Returns the
 * folders that went.
 */
export async function sweepJobFiles(): Promise<string[]> {
  const cutoff = Date.now() - WORKSPACE_KEEP.forMs;
  const stale = (task: {
    status: TaskStatus;
    endedAt: Date | null;
    updatedAt: Date;
  }) =>
    (task.status === "done" || task.status === "failed") &&
    (task.endedAt ?? task.updatedAt).getTime() < cutoff;

  // Folders on disk; each one a job owns is taken out as its job is read
  const unowned = new Set(await listScratchFolders());
  const removed: string[] = [];
  for (const task of await listTaskFolders()) {
    const folder = jobScratch(task.id, task.label);
    if (!unowned.delete(folder) || !stale(task)) continue;
    await taskLock(task.id, async () => {
      const now = await findTask(task.id);
      if (!now || !stale(now)) return;
      await closeHiddenBrowser(task.id);
      await removeJobScratch(task.id, task.label);
      removed.push(folder);
    });
  }
  removed.push(...(await removeUnchangedFolders([...unowned])));
  await pruneJobFiles();
  if (removed.length) {
    logger.info(
      `cleared ${removed.length} old job folder(s): ${removed.join(", ")}`,
    );
  }
  return removed;
}

/**
 * At boot (instrumentation): rows the last process left as running are not
 * running now. Each is parked the way every stop the app causes is (parkTask),
 * so it picks itself back up once a browser is on the app. Nothing else needs
 * to reconcile — a run that ends badly records it itself (drive), and the write
 * that does so is durable (database/db.ts oneAtATime).
 */
export async function sweepTasks() {
  for (const id of await listRunningTaskIds()) {
    if (!running.has(id)) {
      await parkTask(id, {
        why: "The server restarted while this was running.",
      });
    }
  }
}

/**
 * The browser closed, or the server is going down (instrumentation): every run
 * stops where it is and is parked (parkTask). All at once — a run slow to let go
 * must not keep the others running. The thread stays, and so does the window: a
 * resume carries on in the page it left off at, including a sign-in the user is
 * mid-way through, which only that window can finish.
 */
export async function pauseTasks(reason: string) {
  const work = Promise.all(
    [...running].map(([id, run]) =>
      taskLock(id, async () => {
        run.stop.abort();
        await run.done;
        const task = await findTask(id);
        if (!task || task.status !== "running") return;
        await parkTask(id, { why: reason });
      }).catch((cause) => logger.error(`task ${id}: pause`, cause)),
    ),
  ).then(() => {});
  pausing.current = work;
  await work;
}

/**
 * A browser is on the app again (instrumentation `presence.onBack`): every job
 * the app parked picks itself back up — now, or when the wait a failed model
 * call set runs out. A pause still under way is waited for first, so a quick
 * reload does not miss what it parks.
 */
export async function resumeStoppedTasks() {
  await pausing.current;
  for (const task of await listAutoStoppedTasks()) {
    scheduleResume(task.id, task.retryAt - Date.now());
  }
}

/** One timer per job: a newer stop replaces what an older one set. */
function scheduleResume(id: string, inMs: number) {
  forgetResume(id);
  resumes.set(
    id,
    setTimeout(
      () => {
        resumes.delete(id);
        void resumeTask(id).catch((cause) =>
          logger.error(`task ${id}: resume`, cause),
        );
      },
      Math.max(0, inMs),
    ),
  );
}

function forgetResume(id: string) {
  clearTimeout(resumes.get(id));
  resumes.delete(id);
}

/**
 * Picks a parked job back up. Only with a browser on the app — nothing runs
 * without one, and its return tries again — and only if it is still parked: a
 * person may have answered, cancelled or deleted it since. No turn is added,
 * because nobody said anything; the note parkTask left is what the run reads last.
 */
async function resumeTask(id: string) {
  if (!presence.watching) return;
  await taskLock(id, async () => {
    const task = await findTask(id);
    if (!task || task.status !== "waiting" || !task.pending?.auto) return;
    if (running.has(id)) return;
    logger.debug(`task ${id}: picking back up`);
    const thread = await listThread(id);
    await updateTask(id, {
      status: "running",
      outcome: null,
      pending: null,
      seen: false,
      endedAt: null,
    });
    launch(id, {
      bot: task.bot,
      messages: resumeThread(thread, await listBorrowedTails(id)),
    });
  });
}

/**
 * Stops a job the app stopped, rather than the bot or a person: a restart, a
 * closed browser, a model call a retry or a compaction can fix. It waits with
 * the one continue option like any stop, with a line in its thread saying why —
 * the resumed run reads it — and picks itself back up (scheduleResume). Unless
 * the app has already stopped it `BOT_RUN.autoResumes` times since a person last
 * spoke to it: that is what a job that keeps taking the server down looks like,
 * and it waits for a person instead.
 */
async function parkTask(
  id: string,
  stop: {
    why: string;
    /** A failed model call: wait before trying again (config BOT_RUN.retryAfterMs). */
    retry?: boolean;
    /** Where the job compacts from now on (bot.run `budget`). */
    budget?: number;
  },
) {
  const stops = await countStopsSinceSpoken(id);
  const auto = stops < BOT_RUN.autoResumes;
  const waits = BOT_RUN.retryAfterMs;
  const inMs =
    auto && stop.retry ? waits[Math.min(stops, waits.length - 1)] : 0;

  await writeNote(id, stopNote(stop.why)).catch((cause) =>
    logger.warn(`task ${id}: stop not written`, cause),
  );
  await writeEnding(id, {
    status: "waiting",
    outcome: auto
      ? `${stop.why} ${inMs ? `It tries again in ${spell(inMs)}.` : "It picks back up by itself."}`
      : `${stop.why} It has stopped ${stops + 1} times in a row, so it waits for you. Everything it had done is still here.`,
    pending: {
      toolCallId: null,
      options: [TASK_CONTINUE],
      ...(auto ? { auto: true, retryAt: Date.now() + inMs } : {}),
    },
    ...(stop.budget ? { contextBudget: stop.budget } : {}),
    seen: false,
    endedAt: null,
  });
  if (auto) scheduleResume(id, inMs);
}

const spell = (ms: number) =>
  ms < 60_000
    ? `${Math.round(ms / 1000)} seconds`
    : `${Math.round(ms / 60_000)} minutes`;

/** A line from the app in a thread no run is writing (ThreadWriter.note is the one for a run that is). */
async function writeNote(id: string, text: string) {
  await upsertMessage(id, (await lastSeq(id)) + 1, {
    bot: null,
    parent: null,
    role: "user",
    content: text,
    note: true,
  });
}

/**
 * The write that tells anyone a run ended at all. Tried again: everything else
 * in the run has happened, and a miss leaves the row `running` until the next
 * boot. Writes are serialised, so what is left is a database that briefly
 * cannot be written to (database/db.ts).
 */
async function writeEnding(
  id: string,
  patch: Parameters<typeof updateTask>[1],
) {
  for (const wait of [1_000, 3_000, null]) {
    try {
      await updateTask(id, patch);
      return;
    } catch (cause) {
      if (wait === null) throw cause;
      logger.warn(`task ${id}: ending not written, trying again`, cause);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
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
  // Held by the server, not by a request: a run also starts from a returning
  // browser and a retry timer, where `after()` throws (no request) or waits for
  // the event stream to close
  void drive(id, input, stop.signal, notes)
    .catch((cause) => {
      logger.error(`task ${id}`, cause);
    })
    .finally(finish);
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

  /** Set once the run is over: a borrowed run still unwinding must not write into a thread a resume has taken. */
  private closed = false;

  constructor(
    private taskId: string,
    seq: number,
  ) {
    this.seq = seq;
  }

  close() {
    this.closed = true;
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
    if (this.closed) return;
    const step = this.step(event);
    switch (event.type) {
      case "request":
        return this.write(++this.seq, event, {
          role: "user",
          content: event.content,
        });

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
          output: event.error
            ? { type: "error-text", value: String(event.output) }
            : typeof event.output === "string"
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
  const desks = createBotDesks();

  let ending: {
    status: TaskStatus;
    outcome: string;
    pending: TaskPending | null;
  } | null = null;
  /**
   * What broke, as the provider said it — the thread carries it too (below) —
   * and whose it is to fix (model.ts modelFailureOf).
   */
  let broken: {
    message: string;
    failure: ModelFailure;
    budget?: number;
  } | null = null;

  try {
    await runBot(input, {
      signal,
      taskId: id,
      desks,
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
          broken = {
            message: event.message,
            failure: event.failure,
            budget: event.budget,
          };
          ending = {
            status: "failed",
            outcome: broke(event.message),
            pending: null,
          };
        }
      },
    });
  } catch (cause) {
    broken = {
      message: modelErrorToString(cause),
      failure: modelFailureOf(cause),
    };
    ending = {
      status: "failed",
      outcome: broke(broken.message),
      pending: null,
    };
  } finally {
    // A resumed segment cannot overtake a participant still unwinding its tools.
    await desks.settle();
    thread.close();
    running.delete(id);
  }

  // Whoever aborted writes the row: cancel marks failed, answerTask relaunches,
  // a pause parks.
  if (signal.aborted) return;

  const final = ending ?? {
    status: "failed" as const,
    outcome: "Stopped without handing anything back.",
    pending: null,
  };
  // A break a moment or a compaction can fix is the app's to pick back up, not
  // a failure for a person to find (parkTask)
  const park = broken && broken.failure !== "fatal" ? broken : null;

  try {
    if (park) {
      await parkTask(id, {
        why:
          park.failure === "overflow"
            ? `The model refused the context as too long (${park.message}); it is compacted before going on.`
            : `The model call failed (${park.message}).`,
        retry: park.failure === "transient",
        budget: park.budget,
      });
    } else {
      // A thread that simply stops cannot be read: the room shows a tool call
      // with no answer, and a resumed run has no idea why. The task row says it
      // too, but the row is a status and this is the story. Never at the cost of
      // the status write, which is what tells anyone the job ended at all.
      if (final.status === "failed") {
        await thread
          .note(`The run stopped here: ${broken?.message ?? final.outcome}`)
          .catch((cause) =>
            logger.warn(`task ${id}: break not written`, cause),
          );
      }
      await writeEnding(id, {
        ...final,
        seen: false,
        endedAt: final.status === "waiting" ? null : new Date(),
      });
    }
  } catch (cause) {
    // Said plainly rather than thrown into a promise nobody awaits; the row
    // stays `running`, which the next boot reconciles (sweepTasks)
    logger.error(`task ${id}: could not record how it ended`, cause);
    return;
  }

  // Follow-ups can reopen a completed job. Its participants keep their browsers
  // until cancellation, deletion, or the workspace retention sweep.
  void pruneJobFiles();

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

  // A parked job picks itself back up; nobody needs telling yet
  if (park) return;

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
