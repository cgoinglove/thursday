import { setTimeout as wait } from "node:timers/promises";
import type { ModelMessage } from "ai";
import { appEvents, presence } from "@/app/api/events/app-event.server";
import { BOT_RUN, WORKSPACE_KEEP } from "@/config";
import { isProviderRefusal, modelErrorToString } from "@/features/ai/model";
import { buildThreadOpening } from "@/features/ai/prompts/bot.prompt";
import { isAnyCallLive } from "@/features/thursday/thursday.query";
import { opensOnFinish, pathsIn } from "@/features/workspace/file-kind";
import {
  botBrowserSession,
  closeHiddenBrowser,
  closeJobShell,
  filesOnDisk,
  jobScratch,
  listScratchFolders,
  pruneJobFiles,
  removeJobScratch,
  removeUnchangedFolders,
} from "@/features/workspace/workspace";
import { desktopNotify } from "@/lib/desktop-notify";
import { logger } from "@/lib/logger";
import { isPublicError, publicError } from "@/lib/public-error";
import { createKeyedLock } from "@/lib/queue";
import { PromiseChain } from "@/lib/utils";
import { findJobBot } from "./bot.query";
import { resumeTranscript, runBot, type ThreadEvent } from "./bot.run";
import {
  isAppStop,
  THREAD_CONTINUE,
  type ThreadSpeaker,
  type ThreadStatus,
} from "./bot.schema";
import {
  appendRoomMessage,
  cancelRoom,
  claimRoomWork,
  consumeRoomInbox,
  finishRoomWork,
  listParticipantTranscript,
  listRoomReceipts,
  listRoomWork,
  lowerRoomContextBudget,
  noteRoomBreak,
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
  addThreadUsage,
  deleteMessages,
  deleteThread,
  findThread,
  insertThread,
  listAutoStoppedThreads,
  listRunningThreadIds,
  listThreadFolders,
  updateThread,
  upsertMessage,
} from "./thread.query";

type Run = { threadId: string; stop: AbortController; done: Promise<void> };
type Pinned = {
  __roomRuns?: Map<string, Run>;
  __roomThreadLock?: ReturnType<typeof createKeyedLock>;
  __roomPausing?: { current: Promise<void> };
};
const running = ((globalThis as Pinned).__roomRuns ??= new Map<string, Run>());
const threadLock = ((globalThis as Pinned).__roomThreadLock ??=
  createKeyedLock());
const pausing = ((globalThis as Pinned).__roomPausing ??= {
  current: Promise.resolve(),
});

export async function startThread(input: {
  bot: string;
  request: string;
  label: string;
  callId?: string | null;
  from: ThreadSpeaker;
}) {
  const found = await findJobBot(input.bot);
  if (!found || found.disabled) publicError("Choose an enabled bot.");
  const { from, ...row } = { ...input, bot: found.name };
  const opening = buildThreadOpening({
    bot: row.bot,
    request: row.request,
    from,
  });
  const thread = await insertThread({ ...row, opening });
  await pump(thread.id);
  return thread.id;
}

/** A recipient selects a desk; replying to a question also names the exact exchange. */
export async function answerThread(
  id: string,
  answer: string,
  from: ThreadSpeaker = "user",
  recipient?: string,
  replyTo?: string,
): Promise<Awaited<ReturnType<typeof tellRoom>> | null> {
  let told: Awaited<ReturnType<typeof tellRoom>> | null = null;
  await threadLock(id, async () => {
    const thread = await findThread(id);
    if (!thread) publicError("No such thread.");
    if (recipient) {
      const participants = await listRoomWork(id);
      const found = participants.find(
        (row) => row.bot.toLowerCase() === recipient!.trim().toLowerCase(),
      );
      if (!found || found.bot === ROOM_THURSDAY)
        publicError("Choose a participant in this thread.");
      recipient = found.bot;
    }
    // Continue picks up a stop the app made; to a bot's question it is an answer like any other
    if (answer.trim() === THREAD_CONTINUE && isAppStop(thread.pending)) {
      await resumeRoom(id);
      const all = await listRoomWork(id);
      if (!all.some((row) => row.state === "queued"))
        told = await tellRoom(
          id,
          "Continue from the saved conversation.",
          from === "user" ? "The user" : ROOM_THURSDAY,
          recipient,
          undefined,
          false,
        );
    } else {
      told = await tellRoom(
        id,
        answer,
        from === "user" ? "The user" : ROOM_THURSDAY,
        recipient,
        replyTo,
      );
    }
  });
  await pump(id);
  return told;
}

/** Claiming is short and serialized; model execution never holds the room lock. */
async function pump(id: string) {
  await threadLock(id, async () => {
    if (!presence.watching) {
      const thread = await findThread(id);
      if (
        thread?.status === "running" &&
        ![...running.values()].some((run) => run.threadId === id)
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
  running.set(work.id, { threadId: work.threadId, stop, done });
  void drive(work, stop.signal)
    .catch((cause) =>
      logger.error(`thread ${work.threadId}: participant`, cause),
    )
    .finally(() => {
      running.delete(work.id);
      finish();
      void pump(work.threadId).catch((cause) =>
        logger.error(`thread ${work.threadId}: scheduling`, cause),
      );
    });
}

async function drive(work: RoomWork, signal: AbortSignal) {
  let turn = await attempt(work, signal);
  // A break gets one more try from the stored transcript; a refusal, the content
  // filter and the step limit wait for a person, and so does a second break
  if (turn?.failure?.retry && !signal.aborted) {
    await noteRoomBreak(work, turn.failure.message);
    // Only an abort rejects the wait, and the check below reads it
    await wait(BOT_RUN.retryMs, undefined, { signal }).catch(() => {});
    if (!signal.aborted) turn = await attempt(work, signal);
  }
  if (!turn || signal.aborted) return;
  const failure = turn.failure?.message;
  const final = turn.ending;
  if (failure || !final || final.stopped) {
    // Release this run before the room lock drains it; cancellation holds the same lock.
    const why =
      failure ??
      "The turn was interrupted. Continue from the saved conversation.";
    void threadLock(work.threadId, async () => {
      const current = (await listRoomWork(work.threadId)).find(
        (row) => row.id === work.id,
      );
      if (
        current?.state !== "running" ||
        current.generation !== work.generation
      )
        return;
      const drained = stopRuns(work.threadId);
      await pauseRoom(work.threadId, why);
      await drained;
    }).catch((cause) =>
      logger.error(`thread ${work.threadId}: pausing`, cause),
    );
    return;
  }
  await finishRoomWork(work, final.text);
  const thread = await findThread(work.threadId);
  if (thread?.status === "done") {
    if (!(await isAnyCallLive()))
      desktopNotify(thread.label, thread.outcome ?? "");
    const path = (await filesOnDisk(pathsIn(thread.outcome ?? ""), null)).find(
      opensOnFinish,
    );
    if (path)
      appEvents.emit({
        type: "artifact",
        threadId: thread.id,
        label: thread.label,
        path,
      });
  }
}

/** One run of a participant's turn from its stored transcript: how it ended, or why it broke. Null when the thread is gone. */
async function attempt(work: RoomWork, signal: AbortSignal) {
  const writer = new TranscriptWriter(work, signal);
  let ending: { text: string; stopped: boolean } | null = null;
  let failure: { message: string; retry: boolean } | null = null;
  try {
    const thread = await findThread(work.threadId);
    if (!thread) return null;
    const prior = await listParticipantTranscript(work.threadId, work.bot);
    if (!prior.length)
      await appendRoomMessage(work.threadId, {
        bot: work.bot,
        parent: work.id,
        role: "user",
        content: `Request: ${thread.request}\nCoordinator: ${thread.bot}. Continue as ${work.bot} in this thread.`,
        hidden: true,
      });
    await consumeRoomInbox(work);
    const history = await listParticipantTranscript(work.threadId, work.bot);
    await runBot(
      {
        bot: work.bot,
        messages: resumeTranscript(
          history,
          await listRoomReceipts(work.threadId, work.bot, history),
        ),
      },
      {
        signal,
        threadId: work.threadId,
        parent: work.id,
        caller: work.caller,
        owner: thread.bot,
        contextBudget: await roomContextBudget(work.threadId, work.bot),
        session: botBrowserSession(work.threadId, work.bot),
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
          void pump(work.threadId).catch((cause) =>
            logger.error("room message scheduling", cause),
          );
          return receipt;
        },
        emit: async (event) => {
          if (signal.aborted && event.type !== "tool-result") return;
          await writer.on(event);
          if (event.type === "step")
            await addThreadUsage(
              work.threadId,
              event.usage,
              work.bot === thread.bot
                ? { tokens: event.usage.input, budget: event.budget }
                : null,
            );
          if (event.type === "compact")
            await addThreadUsage(work.threadId, event.usage);
          if (event.type === "turn-end") ending = event;
          if (event.type === "error") {
            failure = { message: event.message, retry: event.retry };
            if (event.budget) await lowerRoomContextBudget(work, event.budget);
          }
        },
      },
    );
  } catch (cause) {
    if (!signal.aborted) {
      logger.error(`thread ${work.threadId}: ${work.bot} broke`, cause);
      failure = {
        message: modelErrorToString(cause),
        // A public error is the app refusing the turn (no key, no model), not a break
        retry: !isPublicError(cause) && !isProviderRefusal(cause),
      };
    }
  }
  return {
    ending: ending as { text: string; stopped: boolean } | null,
    failure: failure as { message: string; retry: boolean } | null,
  };
}

/** Streaming updates share stable row slots; tools may be observed before the stream reports them. */
class TranscriptWriter {
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
    if (seq === null) return appendRoomMessage(this.work.threadId, row);
    await upsertMessage(this.work.threadId, seq, row);
    return seq;
  }
  on(event: ThreadEvent) {
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
        if (stale.length) await deleteMessages(this.work.threadId, stale);
        this.assistant = this.tool = null;
        this.parts = { assistant: [], tool: [] };
      } else if (event.type === "compact") {
        await this.write(null, { role: "user", content: event.text }, true);
      }
    });
  }
}

async function stopRuns(id: string) {
  const live = [...running.values()].filter((run) => run.threadId === id);
  for (const run of live) run.stop.abort();
  await Promise.all(live.map((run) => run.done));
}

export async function cancelThread(id: string) {
  await threadLock(id, async () => {
    const thread = await findThread(id);
    if (!thread) publicError("No such thread.");
    if (thread.endedAt) publicError("That thread has already ended.");
    await cancelRoom(id);
    await updateThread(id, {
      status: "cancelled",
      outcome: null,
      pending: null,
      seen: true,
      endedAt: new Date(),
    });
    await stopRuns(id);
    await closeJobShell(id);
  });
}
export async function removeThread(id: string) {
  return threadLock(id, () => removeLockedThread(id));
}
async function removeLockedThread(id: string) {
  const thread = await findThread(id);
  await cancelRoom(id);
  await stopRuns(id);
  await closeJobShell(id);
  const removed = await deleteThread(id);
  if (removed && thread) await removeJobScratch(id, thread.label);
  return removed;
}

export async function removeFinishedThreads(): Promise<number> {
  let removed = 0;
  for (const thread of await listThreadFolders()) {
    if (thread.status !== "done" && thread.status !== "cancelled") continue;
    await threadLock(thread.id, async () => {
      const current = await findThread(thread.id);
      if (current?.status !== "done" && current?.status !== "cancelled") return;
      if (await removeLockedThread(thread.id)) removed += 1;
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
  const stale = (thread: {
    status: ThreadStatus;
    endedAt: Date | null;
    updatedAt: Date;
  }) =>
    (thread.status === "done" || thread.status === "cancelled") &&
    (thread.endedAt ?? thread.updatedAt).getTime() < cutoff;

  // Folders on disk; each one a job owns is taken out as its job is read
  const unowned = new Set(await listScratchFolders());
  const removed: string[] = [];
  for (const thread of await listThreadFolders()) {
    const folder = jobScratch(thread.id, thread.label);
    if (!unowned.delete(folder) || !stale(thread)) continue;
    await threadLock(thread.id, async () => {
      const now = await findThread(thread.id);
      if (!now || !stale(now)) return;
      await closeHiddenBrowser(thread.id);
      await removeJobScratch(thread.id, thread.label);
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
export async function sweepThreads() {
  for (const id of await listRunningThreadIds()) {
    await threadLock(id, async () => {
      if ([...running.values()].some((run) => run.threadId === id)) return;
      if ((await findThread(id))?.status !== "running") return;
      await pauseRoom(
        id,
        "The server restarted. Resume from the saved conversation.",
      );
    });
  }
}
export async function pauseThreads(reason: string, auto = false) {
  const pause = (async () => {
    const ids = await listRunningThreadIds();
    await Promise.all(
      ids.map((id) =>
        threadLock(id, async () => {
          if ((await findThread(id))?.status !== "running") return;
          await stopRuns(id);
          await pauseRoom(id, reason, auto);
        }),
      ),
    );
  })();
  pausing.current = pause;
  await pause;
}
export async function resumeStoppedThreads() {
  await pausing.current;
  if (!presence.watching) return;
  for (const id of await listAutoStoppedThreads()) {
    await threadLock(id, async () => {
      const current = await findThread(id);
      if (current?.status !== "waiting" || !current.pending?.auto) return;
      await resumeRoom(id, false);
    });
    await pump(id);
  }
}
