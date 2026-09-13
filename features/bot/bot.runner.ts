import type { ModelMessage } from "ai";
import { appEvents, presence } from "@/app/api/events/app-event.server";
import { PATHS, WORKSPACE_KEEP } from "@/config";
import { modelErrorToString } from "@/features/ai/model";
import {
  buildTaskOpening,
  OPENING_TURNS,
} from "@/features/ai/prompts/bot.prompt";
import {
  isAnyCallLive,
  listCallTurns,
  readCallTranscriptOn,
} from "@/features/thursday/thursday.query";
import { pathsIn } from "@/features/workspace/file-kind";
import {
  botBrowserSession,
  closeHiddenBrowser,
  closeJobShell,
  filesOnDisk,
  jobScratch,
  listScratchFolders,
  missingWorkspaceFiles,
  pruneJobFiles,
  removeJobScratch,
  removeUnchangedFolders,
} from "@/features/workspace/workspace";
import { desktopNotify } from "@/lib/desktop-notify";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { createKeyedLock } from "@/lib/queue";
import { PromiseChain } from "@/lib/utils";
import { findJobBot } from "./bot.query";
import { resumeThread, runBot, type TaskEvent } from "./bot.run";
import { TASK_CONTINUE, type TaskSpeaker, type TaskStatus } from "./bot.schema";
import {
  appendRoomMessage,
  cancelRoom,
  claimRoomWork,
  consumeRoomInbox,
  ensureRoom,
  finishRoomWork,
  listParticipantThread,
  listRoomReceipts,
  listRoomWork,
  lowerRoomContextBudget,
  pauseRoom,
  type RoomWork,
  resumeRoom,
  roomContextBudget,
  sendRoomMessage,
  settleRoom,
  tellRoom,
} from "./room.query";
import { ROOM_THURSDAY } from "./room.schema";
import {
  addTaskUsage,
  deleteMessages,
  deleteTask,
  findTask,
  insertTask,
  listAutoStoppedTasks,
  listRunningTaskIds,
  listTaskFolders,
  updateTask,
  upsertMessage,
} from "./task.query";

type Run = { taskId: string; stop: AbortController; done: Promise<void> };
type Pinned = {
  __roomRuns?: Map<string, Run>;
  __roomTaskLock?: ReturnType<typeof createKeyedLock>;
  __roomPausing?: { current: Promise<void> };
};
const running = ((globalThis as Pinned).__roomRuns ??= new Map<string, Run>());
const taskLock = ((globalThis as Pinned).__roomTaskLock ??= createKeyedLock());
const pausing = ((globalThis as Pinned).__roomPausing ??= {
  current: Promise.resolve(),
});

export async function startTask(input: {
  bot: string;
  request: string;
  label: string;
  callId?: string | null;
  from: TaskSpeaker;
}) {
  const found = await findJobBot(input.bot);
  if (!found || found.disabled) publicError("Choose an enabled bot.");
  const { from, ...row } = { ...input, bot: found.name };
  const conversation =
    row.callId && (await readCallTranscriptOn())
      ? await listCallTurns(row.callId, OPENING_TURNS)
      : [];
  const opening = buildTaskOpening({
    bot: row.bot,
    request: row.request,
    conversation,
    from,
  });
  const task = await insertTask({ ...row, opening });
  await ensureRoom(task.id);
  await pump(task.id);
  return task.id;
}

/** A recipient selects a desk; replying to a question also names the exact exchange. */
export async function answerTask(
  id: string,
  answer: string,
  from: TaskSpeaker = "user",
  recipient?: string,
  replyTo?: string,
) {
  await taskLock(id, async () => {
    const task = await findTask(id);
    if (!task) publicError("No such task.");
    await ensureRoom(id);
    if (recipient) {
      const participants = await listRoomWork(id);
      const found = participants.find(
        (row) => row.bot.toLowerCase() === recipient!.trim().toLowerCase(),
      );
      if (!found || found.bot === ROOM_THURSDAY)
        publicError("Choose a participant in this task.");
      recipient = found.bot;
    }
    if (
      answer.trim() === TASK_CONTINUE &&
      task.pending?.options.includes(TASK_CONTINUE)
    ) {
      await resumeRoom(id);
      const all = await listRoomWork(id);
      if (!all.some((row) => row.state === "queued"))
        await tellRoom(
          id,
          "Continue from the saved conversation.",
          from === "user" ? "The user" : ROOM_THURSDAY,
          recipient,
        );
    } else {
      await tellRoom(
        id,
        answer,
        from === "user" ? "The user" : ROOM_THURSDAY,
        recipient,
        replyTo,
      );
    }
  });
  await pump(id);
}

/** Claiming is short and serialized; model execution never holds the room lock. */
async function pump(id: string) {
  await taskLock(id, async () => {
    if (!presence.watching) {
      const task = await findTask(id);
      if (
        task?.status === "running" &&
        ![...running.values()].some((run) => run.taskId === id)
      )
        await pauseRoom(
          id,
          "The app is not open. Work resumes when it returns.",
          true,
        );
      return;
    }
    for (let pass = 0; pass < 2; pass++) {
      let work: RoomWork | null;
      while ((work = await claimRoomWork(id))) launch(work);
      await settleRoom(id);
    }
  });
}

function launch(work: RoomWork) {
  const stop = new AbortController();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  running.set(work.id, { taskId: work.taskId, stop, done });
  void drive(work, stop.signal)
    .catch((cause) => logger.error(`task ${work.taskId}: participant`, cause))
    .finally(() => {
      running.delete(work.id);
      finish();
      void pump(work.taskId).catch((cause) =>
        logger.error(`task ${work.taskId}: scheduling`, cause),
      );
    });
}

async function drive(work: RoomWork, signal: AbortSignal) {
  const writer = new ThreadWriter(work, signal);
  let ending: { text: string; stopped: boolean } | null = null;
  let failure: string | null = null;
  try {
    const task = await findTask(work.taskId);
    if (!task) return;
    const prior = await listParticipantThread(work.taskId, work.bot);
    if (!prior.length)
      await appendRoomMessage(work.taskId, {
        bot: work.bot,
        parent: work.id,
        role: "user",
        content: `Task: ${task.request}\nCoordinator: ${task.bot}. Continue as ${work.bot} in this task.`,
        hidden: true,
      });
    await consumeRoomInbox(work);
    const history = await listParticipantThread(work.taskId, work.bot);
    await runBot(
      {
        bot: work.bot,
        messages: resumeThread(
          history,
          await listRoomReceipts(work.taskId, work.bot, history),
        ),
      },
      {
        signal,
        taskId: work.taskId,
        parent: work.id,
        caller: work.caller,
        owner: task.bot,
        contextBudget: await roomContextBudget(work.taskId, work.bot),
        session: botBrowserSession(work.taskId, work.bot),
        notes: () => consumeRoomInbox(work),
        send: async (input) => {
          signal.throwIfAborted();
          let to = input.to.trim();
          if (to.toLowerCase() === ROOM_THURSDAY.toLowerCase())
            to = ROOM_THURSDAY;
          else {
            const bot = await findJobBot(to);
            if (!bot || bot.disabled)
              publicError(`No enabled bot named "${to}".`);
            to = bot.name;
          }
          const receipt = await sendRoomMessage(work, { ...input, to });
          void pump(work.taskId).catch((cause) =>
            logger.error("room message scheduling", cause),
          );
          return receipt;
        },
        emit: async (event) => {
          if (signal.aborted && event.type !== "tool-result") return;
          await writer.on(event);
          if (event.type === "step")
            await addTaskUsage(
              work.taskId,
              event.usage,
              work.bot === task.bot
                ? { tokens: event.usage.input, budget: event.budget }
                : null,
            );
          if (event.type === "compact")
            await addTaskUsage(work.taskId, event.usage);
          if (event.type === "turn-end") ending = event;
          if (event.type === "error") {
            failure = event.message;
            if (event.budget) await lowerRoomContextBudget(work, event.budget);
            if (event.budget && work.bot === task.bot)
              await updateTask(work.taskId, { contextBudget: event.budget });
          }
        },
      },
    );
  } catch (cause) {
    if (!signal.aborted) failure = modelErrorToString(cause);
  }
  if (signal.aborted) return;
  const final = ending as { text: string; stopped: boolean } | null;
  if (!failure && final?.text && !final.stopped && !work.parentId) {
    const all = await listRoomWork(work.taskId);
    if (
      all.every(
        (row) =>
          row.id === work.id ||
          row.state === "done" ||
          row.state === "cancelled",
      )
    ) {
      const missing = await missingWorkspaceFiles(pathsIn(final.text));
      if (missing.length)
        failure = `The report references files that are not available: ${missing.join(", ")}. Continue to repair the files or correct the report.`;
    }
  }
  if (failure || !final || final.stopped) {
    // Release this run before the room lock drains it; cancellation holds the same lock.
    const why =
      failure ??
      "The turn was interrupted. Continue from the saved conversation.";
    void taskLock(work.taskId, async () => {
      const current = (await listRoomWork(work.taskId)).find(
        (row) => row.id === work.id,
      );
      if (
        current?.state !== "running" ||
        current.generation !== work.generation
      )
        return;
      const drained = stopRuns(work.taskId);
      await pauseRoom(work.taskId, why);
      await drained;
    }).catch((cause) => logger.error(`task ${work.taskId}: pausing`, cause));
    return;
  }
  await finishRoomWork(work, final.text);
  const task = await findTask(work.taskId);
  if (task?.status === "done") {
    if (!(await isAnyCallLive())) desktopNotify(task.label, task.outcome ?? "");
    const paths = await filesOnDisk(pathsIn(task.outcome ?? ""), null);
    const path =
      paths.find((path) => path.startsWith(`${PATHS.artifacts}/`)) ?? paths[0];
    if (path)
      appEvents.emit({
        type: "artifact",
        taskId: task.id,
        label: task.label,
        path,
      });
  }
}

/** Streaming updates share stable row slots; tools may be observed before the stream reports them. */
class ThreadWriter {
  private lane = PromiseChain();
  private assistant: number | null = null;
  private tool: number | null = null;
  private parts: {
    assistant: Exclude<
      Extract<ModelMessage, { role: "assistant" }>["content"],
      string
    >;
    tool: Extract<ModelMessage, { role: "tool" }>["content"];
  } = { assistant: [], tool: [] };
  private calls = new Set<string>();
  private results = new Set<string>();
  constructor(
    private work: RoomWork,
    private signal: AbortSignal,
  ) {}
  private async write(
    seq: number | null,
    value: ModelMessage,
    compact = false,
  ) {
    const row = {
      bot: this.work.bot,
      parent: this.work.id,
      role: value.role,
      content: value.content,
      compact,
      note: compact,
    };
    if (seq === null) return appendRoomMessage(this.work.taskId, row);
    await upsertMessage(this.work.taskId, seq, row);
    return seq;
  }
  on(event: TaskEvent) {
    return this.lane(async () => {
      if (this.signal.aborted && event.type !== "tool-result") return;
      if (event.type === "text") {
        this.parts.assistant.push({ type: "text", text: event.text });
        this.assistant = await this.write(this.assistant, {
          role: "assistant",
          content: this.parts.assistant,
        });
      } else if (event.type === "tool") {
        if (this.calls.has(event.id)) {
          const part = this.parts.assistant.find(
            (part) => part.type === "tool-call" && part.toolCallId === event.id,
          );
          if (part && part.type === "tool-call" && event.providerOptions) {
            part.providerOptions = event.providerOptions;
            this.assistant = await this.write(this.assistant, {
              role: "assistant",
              content: this.parts.assistant,
            });
          }
          return;
        }
        this.calls.add(event.id);
        this.parts.assistant.push({
          type: "tool-call",
          toolCallId: event.id,
          toolName: event.name,
          input: event.input,
          ...(event.providerExecuted ? { providerExecuted: true } : {}),
          ...(event.providerOptions
            ? { providerOptions: event.providerOptions }
            : {}),
        });
        this.assistant = await this.write(this.assistant, {
          role: "assistant",
          content: this.parts.assistant,
        });
      } else if (event.type === "tool-result") {
        if (this.results.has(event.id)) return;
        this.results.add(event.id);
        this.parts.tool.push({
          type: "tool-result",
          toolCallId: event.id,
          toolName: event.name,
          output: event.error
            ? { type: "error-text", value: String(event.output) }
            : typeof event.output === "string"
              ? { type: "text", value: event.output }
              : { type: "json", value: event.output as never },
        });
        this.tool = await this.write(this.tool, {
          role: "tool",
          content: this.parts.tool,
        });
      } else if (event.type === "step") {
        const slots = [this.assistant, this.tool];
        for (const [index, value] of event.messages.entries())
          await this.write(slots[index] ?? null, value);
        const stale = slots
          .slice(event.messages.length)
          .filter((seq): seq is number => seq !== null);
        if (stale.length) await deleteMessages(this.work.taskId, stale);
        this.assistant = this.tool = null;
        this.parts = { assistant: [], tool: [] };
      } else if (event.type === "compact") {
        await this.write(null, { role: "user", content: event.text }, true);
      }
    });
  }
}

async function stopRuns(id: string) {
  const live = [...running.values()].filter((run) => run.taskId === id);
  for (const run of live) run.stop.abort();
  await Promise.all(live.map((run) => run.done));
}

export async function cancelTask(id: string) {
  await taskLock(id, async () => {
    const task = await findTask(id);
    if (!task) publicError("No such task.");
    if (task.endedAt) publicError("That task has already ended.");
    await cancelRoom(id);
    await updateTask(id, {
      status: "failed",
      outcome: "Cancelled.",
      pending: null,
      seen: true,
      endedAt: new Date(),
    });
    await stopRuns(id);
    await closeJobShell(id);
  });
}
export async function removeTask(id: string) {
  return taskLock(id, () => removeLockedTask(id));
}
async function removeLockedTask(id: string) {
  const task = await findTask(id);
  await cancelRoom(id);
  await stopRuns(id);
  await closeJobShell(id);
  const removed = await deleteTask(id);
  if (removed && task) await removeJobScratch(id, task.label);
  return removed;
}

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

/** A server restart is a manual resume boundary: external effects may already have happened. */
export async function sweepTasks() {
  for (const id of await listRunningTaskIds()) {
    await taskLock(id, async () => {
      if ([...running.values()].some((run) => run.taskId === id)) return;
      if ((await findTask(id))?.status !== "running") return;
      await ensureRoom(id);
      await pauseRoom(
        id,
        "The server restarted. Resume from the saved conversation.",
      );
    });
  }
}
export async function pauseTasks(reason: string, auto = false) {
  const pause = (async () => {
    const ids = await listRunningTaskIds();
    await Promise.all(
      ids.map((id) =>
        taskLock(id, async () => {
          if ((await findTask(id))?.status !== "running") return;
          await stopRuns(id);
          await pauseRoom(id, reason, auto);
        }),
      ),
    );
  })();
  pausing.current = pause;
  await pause;
}
export async function resumeStoppedTasks() {
  await pausing.current;
  if (!presence.watching) return;
  for (const task of await listAutoStoppedTasks()) {
    await taskLock(task.id, async () => {
      const current = await findTask(task.id);
      if (current?.status !== "waiting" || !current.pending?.auto) return;
      if (!(await listRoomWork(task.id)).length) {
        await ensureRoom(task.id);
        await pauseRoom(
          task.id,
          "This interrupted task uses an older workflow. Continue from its saved conversation.",
        );
        return;
      }
      await resumeRoom(task.id, false);
    });
    await pump(task.id);
  }
}
