import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { and, eq, inArray, max, or, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { BOT_RUN } from "@/config";
import { database } from "@/database/db";
import {
  taskDeliveryTable as delivery,
  taskMessageTable as message,
  taskRelayTable as relay,
  taskTable as task,
  taskWorkTable as work,
} from "@/database/tables";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { publicError } from "@/lib/public-error";
import { TASK_CONTINUE, tagSpeaker } from "./bot.schema";
import { ROOM_THURSDAY } from "./room.schema";
import type { TaskMessageInput } from "./task.query";
import { listBotThread } from "./task.query";

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
export type RoomWork = typeof work.$inferSelect;
const changed = () => appEvents.emit({ type: "tasks" });
const terminal = (state: RoomWork["state"]) =>
  state === "done" || state === "cancelled";
const messageKey = (taskId: string, bot: string, callId: string) =>
  `message:${createHash("sha256")
    .update(JSON.stringify([taskId, bot, callId]))
    .digest("hex")}`;

/** Recover a committed send whose receipt was lost before the next transcript write. */
export async function listRoomReceipts(
  taskId: string,
  bot: string,
  history: ModelMessage[],
) {
  const calls = history.flatMap((row) =>
    row.role === "assistant" && Array.isArray(row.content)
      ? row.content.flatMap((part) =>
          part.type === "tool-call" && part.toolName === TOOL_NAMES.send_message
            ? [part.toolCallId]
            : [],
        )
      : [],
  );
  const keys = calls.map((id) => messageKey(taskId, bot, id));
  const receipts = new Map<string, { messageId: string; to: string }>();
  if (!keys.length) return receipts;
  const [requests, replies] = await Promise.all([
    database
      .select({ key: work.id, to: work.bot })
      .from(work)
      .where(and(eq(work.taskId, taskId), inArray(work.id, keys))),
    database
      .select({ key: delivery.key, to: work.bot })
      .from(delivery)
      .innerJoin(work, eq(work.id, delivery.workId))
      .where(and(eq(delivery.taskId, taskId), inArray(delivery.key, keys))),
  ]);
  const byKey = new Map(
    [...requests, ...replies].map((row) => [row.key, row.to]),
  );
  for (const [index, id] of calls.entries()) {
    const to = byKey.get(keys[index]);
    if (to) receipts.set(id, { messageId: keys[index], to });
  }
  return receipts;
}

async function append(
  tx: Tx,
  taskId: string,
  row: TaskMessageInput & { hidden?: boolean },
) {
  const [last] = await tx
    .select({ seq: max(message.seq) })
    .from(message)
    .where(eq(message.taskId, taskId));
  const seq = (last?.seq ?? -1) + 1;
  await tx.insert(message).values({ taskId, seq, ...row });
  return seq;
}

/** Allocate at the database boundary; independent participant writers never share a counter. */
export async function appendRoomMessage(
  taskId: string,
  row: TaskMessageInput & { hidden?: boolean },
) {
  const seq = await database.transaction((tx) => append(tx, taskId, row));
  changed();
  return seq;
}

export async function listRoomWork(taskId: string) {
  return database
    .select()
    .from(work)
    .where(eq(work.taskId, taskId))
    .orderBy(work.createdAt, work.id);
}

/** Every continuation at this desk inherits the smallest threshold that its provider accepted. */
export async function roomContextBudget(taskId: string, bot: string) {
  const [row] = await database
    .select({
      budget: sql<number | null>`min(nullif(${work.contextBudget}, 0))`,
    })
    .from(work)
    .where(and(eq(work.taskId, taskId), eq(work.bot, bot)));
  return row?.budget ?? undefined;
}

export async function lowerRoomContextBudget(run: RoomWork, budget: number) {
  await database.transaction(async (tx) => {
    await current(tx, run);
    await tx
      .update(work)
      .set({ contextBudget: budget })
      .where(eq(work.id, run.id));
  });
  changed();
}

/** Old tasks enter the room engine on first resume. Their existing transcript stays intact. */
export async function ensureRoom(taskId: string) {
  await database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: work.id })
      .from(work)
      .where(eq(work.taskId, taskId))
      .limit(1);
    if (existing.length) return;
    const [row] = await tx.select().from(task).where(eq(task.id, taskId));
    if (!row) publicError("No such task.");
    const rootId = crypto.randomUUID();
    await tx.insert(work).values({
      id: rootId,
      taskId,
      bot: row.bot,
      caller: ROOM_THURSDAY,
      state: "queued",
    });
    const history = await tx
      .select()
      .from(message)
      .where(eq(message.taskId, taskId))
      .orderBy(message.seq);
    const completed = new Set(
      history.flatMap((row) =>
        Array.isArray(row.content)
          ? row.content.flatMap((part) =>
              part.type === "tool-result" ? [part.toolCallId] : [],
            )
          : [],
      ),
    );
    const legacy = history.flatMap((entry) =>
      Array.isArray(entry.content)
        ? entry.content.flatMap((part) => {
            if (
              part.type !== "tool-call" ||
              part.toolName !== TOOL_NAMES.ask_bot ||
              completed.has(part.toolCallId)
            )
              return [];
            const args = part.input as {
              bot?: string;
              request?: string;
              context?: string;
            };
            const name =
              history.find((child) => child.parent === part.toolCallId)?.bot ??
              args.bot;
            return name
              ? [
                  {
                    callId: part.toolCallId,
                    bot: name,
                    caller: entry.bot ?? row.bot,
                    parent: entry.parent,
                    text: [args.request, args.context]
                      .filter(Boolean)
                      .join("\n\n"),
                  },
                ]
              : [];
          })
        : [],
    );
    for (const item of legacy) {
      const id = `legacy:${taskId}:${item.callId}`;
      const parentId = legacy.some((other) => other.callId === item.parent)
        ? `legacy:${taskId}:${item.parent}`
        : rootId;
      await tx.insert(work).values({
        id,
        taskId,
        bot: item.bot,
        caller: item.caller,
        parentId,
        state: legacy.some((other) => other.parent === item.callId)
          ? "waiting"
          : "queued",
      });
      await deliver(tx, {
        key: id,
        taskId,
        workId: id,
        speaker: item.caller,
        text: `Resume this interrupted exchange using your saved work.\n\n${item.text}`,
      });
      if (legacy.some((other) => other.parent === item.callId))
        await tx.update(work).set({ state: "waiting" }).where(eq(work.id, id));
    }
    if (legacy.length)
      await tx
        .update(work)
        .set({ state: "waiting" })
        .where(eq(work.id, rootId));
  });
  changed();
}

async function current(tx: Tx, run: RoomWork) {
  const [row] = await tx
    .select()
    .from(work)
    .where(
      and(
        eq(work.id, run.id),
        eq(work.generation, run.generation),
        eq(work.state, "running"),
      ),
    );
  if (!row) publicError("This turn is no longer running.");
  return row;
}

async function deliver(tx: Tx, input: typeof delivery.$inferInsert) {
  await tx.insert(delivery).values(input).onConflictDoNothing();
  await tx
    .update(work)
    .set({ state: "queued" })
    .where(
      and(eq(work.id, input.workId), inArray(work.state, ["waiting", "done"])),
    );
}

export async function sendRoomMessage(
  run: RoomWork,
  input: { id: string; to: string; text: string; replyTo?: string | null },
) {
  const result = await database.transaction(async (tx) => {
    await current(tx, run);
    const key = messageKey(run.taskId, run.bot, input.id);
    const [existing] = await tx.select().from(work).where(eq(work.id, key));
    if (existing) return { messageId: key, to: existing.bot };
    const [reply] = await tx
      .select({ to: work.bot })
      .from(delivery)
      .innerJoin(work, eq(work.id, delivery.workId))
      .where(eq(delivery.key, key));
    if (reply) return { messageId: key, to: reply.to };
    if (input.to === run.bot)
      publicError("Continue your own work directly; choose another recipient.");
    if (input.replyTo) {
      const [target] = await tx
        .select()
        .from(work)
        .where(and(eq(work.id, input.replyTo), eq(work.taskId, run.taskId)));
      if (
        !target ||
        target.bot !== run.bot ||
        target.caller !== input.to ||
        terminal(target.state)
      )
        publicError(
          "Reply to an open message addressed to you from that recipient.",
        );
      if (target.parentId) {
        await deliver(tx, {
          key,
          taskId: run.taskId,
          workId: target.parentId,
          speaker: run.bot,
          text: input.text,
        });
        return { messageId: key, to: input.to };
      }
      // Thursday has no model continuation to wake; the message enters the user inbox below.
    }
    const all = await tx.select().from(work).where(eq(work.taskId, run.taskId));
    const bots = new Set(
      all.map((row) => row.bot).filter((bot) => bot !== ROOM_THURSDAY),
    );
    if (
      input.to !== ROOM_THURSDAY &&
      !bots.has(input.to) &&
      bots.size >= BOT_RUN.participants
    )
      publicError("This task has reached its participant limit.");
    if (
      all.filter((row) => !terminal(row.state)).length >= BOT_RUN.queuedMessages
    )
      publicError("This task has reached its pending message limit.");
    await tx.insert(work).values({
      id: key,
      taskId: run.taskId,
      bot: input.to,
      caller: run.bot,
      parentId: run.id,
      state: input.to === ROOM_THURSDAY ? "external" : "queued",
      result: input.to === ROOM_THURSDAY ? input.text : null,
    });
    if (input.to === ROOM_THURSDAY) {
      await tx.insert(relay).values({
        key,
        taskId: run.taskId,
        bot: run.bot,
        text: input.text,
        kind: "question",
        messageId: key,
      });
    } else {
      await deliver(tx, {
        key,
        taskId: run.taskId,
        workId: key,
        speaker: run.bot,
        text: input.text,
      });
    }
    await tx
      .update(task)
      .set({ wrapped: false, updatedAt: new Date() })
      .where(eq(task.id, run.taskId));
    return { messageId: key, to: input.to };
  });
  changed();
  return result;
}

export async function claimRoomWork(taskId: string) {
  const claimed = await database.transaction(async (tx) => {
    const [room] = await tx.select().from(task).where(eq(task.id, taskId));
    if (!room || room.status !== "running") return null;
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.taskId, taskId))
      .orderBy(sql`${work}.rowid`);
    const active = all.filter((row) => row.state === "running");
    if (active.length >= BOT_RUN.concurrent) return null;
    const next = all.find(
      (row) =>
        row.state === "queued" &&
        !active.some((other) => other.bot === row.bot),
    );
    if (!next) return null;
    if (room.turns >= BOT_RUN.turns) {
      await tx
        .update(work)
        .set({ state: "paused" })
        .where(and(eq(work.taskId, taskId), eq(work.state, "queued")));
      return null;
    }
    const [run] = await tx
      .update(work)
      .set({ state: "running", generation: next.generation + 1 })
      .where(eq(work.id, next.id))
      .returning();
    await tx
      .update(task)
      .set({ turns: room.turns + 1 })
      .where(eq(task.id, taskId));
    return run;
  });
  if (claimed) changed();
  return claimed;
}

/** Inbox insertion and acknowledgement are one transaction, even when the model stops immediately afterward. */
export async function consumeRoomInbox(run: RoomWork): Promise<string[]> {
  const texts = await database.transaction(async (tx) => {
    await current(tx, run);
    const rows = await tx
      .select()
      .from(delivery)
      .where(and(eq(delivery.workId, run.id), eq(delivery.consumed, false)))
      .orderBy(delivery.id);
    for (const row of rows) {
      const text = deliveryText(row);
      await append(tx, run.taskId, {
        bot: run.bot,
        parent: run.id,
        role: "user",
        content: text,
        hidden: !row.visible,
      });
      await tx
        .update(delivery)
        .set({ consumed: true })
        .where(eq(delivery.id, row.id));
    }
    return rows.map(deliveryText);
  });
  if (texts.length) changed();
  return texts;
}

function deliveryText(row: typeof delivery.$inferSelect) {
  return row.visible
    ? tagSpeaker(row.speaker === "The user" ? "user" : "thursday", row.text)
    : `${row.speaker}:\n\n${row.text}`;
}

/** A normal loop end settles a conversation only after its downstream work returns. */
export async function finishRoomWork(run: RoomWork, text: string) {
  await database.transaction(async (tx) => {
    await current(tx, run);
    const children = await tx
      .select()
      .from(work)
      .where(eq(work.parentId, run.id));
    const pending = await tx
      .select({ id: delivery.id })
      .from(delivery)
      .where(and(eq(delivery.workId, run.id), eq(delivery.consumed, false)))
      .limit(1);
    const state = pending.length
      ? "queued"
      : children.some((row) => !terminal(row.state))
        ? "waiting"
        : "done";
    await tx
      .update(work)
      .set({ state, result: text })
      .where(eq(work.id, run.id));
    if (state !== "done") return;
    if (run.parentId) {
      const [parent] = await tx
        .select()
        .from(work)
        .where(eq(work.id, run.parentId));
      if (parent && parent.state !== "cancelled") {
        await deliver(tx, {
          key: `return:${run.id}:${run.generation}`,
          taskId: run.taskId,
          workId: parent.id,
          speaker: run.bot,
          text: text || "This turn ended without a message.",
        });
      }
    }
    const [room] = await tx.select().from(task).where(eq(task.id, run.taskId));
    const all = await tx.select().from(work).where(eq(work.taskId, run.taskId));
    if (
      room &&
      run.bot === room.bot &&
      !run.parentId &&
      all.every((row) => terminal(row.state))
    ) {
      await tx
        .update(task)
        .set({
          status: text ? "done" : "waiting",
          outcome: text || "The room is idle. Send a message to continue.",
          pending: text ? null : { toolCallId: null, options: [TASK_CONTINUE] },
          wrapped: true,
          endedAt: text ? new Date() : null,
          seen: false,
          updatedAt: new Date(),
        })
        .where(eq(task.id, run.taskId));
      if (text)
        await tx
          .insert(relay)
          .values({
            key: `report:${run.taskId}:${room.generation}`,
            taskId: run.taskId,
            bot: run.bot,
            text,
            kind: "report",
          })
          .onConflictDoNothing();
    }
  });
  changed();
}

/** Called after runnable participants have been claimed; never confuse an idle room with successful work. */
export async function settleRoom(taskId: string) {
  await database.transaction(async (tx) => {
    const [room] = await tx.select().from(task).where(eq(task.id, taskId));
    if (!room || room.status !== "running") return;
    const all = await tx.select().from(work).where(eq(work.taskId, taskId));
    if (all.some((row) => row.state === "queued" || row.state === "running"))
      return;
    const question = all.find((row) => row.state === "external");
    if (question) {
      await tx
        .update(task)
        .set({
          status: "waiting",
          outcome: question.result,
          pending: {
            toolCallId: null,
            options: [],
            messageId: question.id,
            bot: question.caller,
          },
          updatedAt: new Date(),
        })
        .where(eq(task.id, taskId));
      return;
    }
    if (all.some((row) => !terminal(row.state)) || room.wrapped) {
      await tx
        .update(task)
        .set({
          status: "waiting",
          outcome:
            room.turns >= BOT_RUN.turns
              ? "The room reached its automatic turn limit. Continue from the saved conversation."
              : "Work is paused. Continue from the saved conversation.",
          pending: { toolCallId: null, options: [TASK_CONTINUE] },
          updatedAt: new Date(),
        })
        .where(eq(task.id, taskId));
      return;
    }
    const id = crypto.randomUUID();
    await tx.insert(work).values({
      id,
      taskId,
      bot: room.bot,
      caller: ROOM_THURSDAY,
      state: "queued",
    });
    await deliver(tx, {
      key: id,
      taskId,
      workId: id,
      speaker: "Task activity",
      text: "The participants have finished their current turns. Bring together the results you received for Thursday, including anything still unresolved.",
    });
    await tx.update(task).set({ wrapped: true }).where(eq(task.id, taskId));
  });
  changed();
}

export async function pauseRoom(taskId: string, why: string, auto = false) {
  await database.transaction(async (tx) => {
    const all = await tx.select().from(work).where(eq(work.taskId, taskId));
    for (const row of all.filter(
      (row) => row.state === "running" || row.state === "queued",
    )) {
      await tx
        .update(work)
        .set({ state: "paused", generation: row.generation + 1 })
        .where(eq(work.id, row.id));
      await append(tx, taskId, {
        bot: row.bot,
        parent: row.id,
        role: "user",
        content: `${why} Resume from the saved state; inspect any tool whose result is missing before repeating it.`,
        note: true,
      });
    }
    await tx
      .update(task)
      .set({
        status: "waiting",
        outcome: why,
        pending: {
          toolCallId: null,
          options: [TASK_CONTINUE],
          ...(auto ? { auto: true, retryAt: Date.now() } : {}),
        },
        seen: false,
        endedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId));
    await tx.insert(relay).values({
      key: crypto.randomUUID(),
      taskId,
      bot: all.find((row) => !row.parentId)?.bot ?? "Bot",
      text: why,
      kind: "interrupted",
      accepted: auto,
    });
  });
  changed();
}

export async function resumeRoom(taskId: string, manual = true) {
  await database.transaction(async (tx) => {
    await tx
      .update(work)
      .set({ state: "queued" })
      .where(and(eq(work.taskId, taskId), eq(work.state, "paused")));
    await tx
      .update(task)
      .set({
        status: "running",
        ...(manual
          ? { generation: sql`${task.generation} + 1`, turns: 0 }
          : {}),
        pending: null,
        outcome: null,
        endedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId));
  });
  changed();
}

/** User messages enter the recipient's active continuation, retaining its original return route. */
export async function tellRoom(
  taskId: string,
  text: string,
  speaker: string,
  recipient?: string,
  replyTo?: string,
) {
  const id = await database.transaction(async (tx) => {
    const [room] = await tx.select().from(task).where(eq(task.id, taskId));
    if (!room) publicError("No such task.");
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.taskId, taskId))
      .orderBy(work.createdAt);
    const questionId =
      replyTo ?? (!recipient ? room.pending?.messageId : undefined);
    const question = questionId
      ? all.find((row) => row.id === questionId && row.state === "external")
      : undefined;
    if (questionId && !question)
      publicError("That question is no longer waiting for an answer.");
    const bot = question?.caller ?? recipient ?? room.bot;
    let target = question
      ? all.find((row) => row.id === question.parentId)
      : (all.find((row) => row.bot === bot && row.state === "running") ??
        all.find(
          (row) =>
            row.bot === bot && !terminal(row.state) && row.state !== "external",
        ));
    if (question) {
      await tx
        .update(work)
        .set({ state: "done", result: text })
        .where(eq(work.id, question.id));
      await tx
        .update(relay)
        .set({ accepted: true })
        .where(eq(relay.messageId, question.id));
    }
    if (!target) {
      let parentId: string | null = null;
      if (bot !== room.bot) {
        let coordinator = all.findLast(
          (row) =>
            row.bot === room.bot && !row.parentId && row.state !== "cancelled",
        );
        if (!coordinator) {
          coordinator = (
            await tx
              .insert(work)
              .values({
                id: crypto.randomUUID(),
                taskId,
                bot: room.bot,
                caller: ROOM_THURSDAY,
                state: "waiting",
              })
              .returning()
          )[0];
        } else if (coordinator.state === "done") {
          await tx
            .update(work)
            .set({ state: "waiting" })
            .where(eq(work.id, coordinator.id));
        }
        parentId = coordinator.id;
      }
      target = (
        await tx
          .insert(work)
          .values({
            id: crypto.randomUUID(),
            taskId,
            bot,
            caller: parentId ? room.bot : ROOM_THURSDAY,
            parentId,
            state: "queued",
          })
          .returning()
      )[0];
    }
    const key = crypto.randomUUID();
    await deliver(tx, {
      key,
      taskId,
      workId: target.id,
      speaker,
      text,
      visible: true,
    });
    await tx
      .update(work)
      .set({ state: "queued" })
      .where(and(eq(work.taskId, taskId), eq(work.state, "paused")));
    await tx
      .update(task)
      .set({
        status: "running",
        generation: sql`${task.generation} + 1`,
        turns: 0,
        wrapped: false,
        pending: null,
        outcome: null,
        endedAt: null,
        seen: false,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId));
    return key;
  });
  changed();
  return id;
}

export async function cancelRoom(taskId: string) {
  await database.transaction(async (tx) => {
    await tx
      .update(work)
      .set({ state: "cancelled", generation: sql`${work.generation} + 1` })
      .where(
        and(
          eq(work.taskId, taskId),
          inArray(work.state, [
            "queued",
            "running",
            "waiting",
            "external",
            "paused",
          ]),
        ),
      );
    await tx
      .update(relay)
      .set({ accepted: true })
      .where(eq(relay.taskId, taskId));
  });
  changed();
}

export async function listParticipantThread(
  taskId: string,
  bot: string,
): Promise<ModelMessage[]> {
  const [room] = await database
    .select({ bot: task.bot })
    .from(task)
    .where(eq(task.id, taskId));
  if (room && room.bot !== bot) return listBotThread(taskId, bot);
  const rows = await database
    .select()
    .from(message)
    .where(
      and(
        eq(message.taskId, taskId),
        or(
          eq(message.bot, bot),
          room?.bot === bot
            ? sql`${message.bot} is null AND ${message.parent} is null`
            : undefined,
        ),
      ),
    )
    .orderBy(message.seq);
  const compact = rows.findLastIndex((row) => row.compact);
  const kept = compact > 0 ? [rows[0], ...rows.slice(compact)] : rows;
  return kept.map(
    (row) => ({ role: row.role, content: row.content }) as ModelMessage,
  );
}

export async function listRoomRelays() {
  return database
    .select()
    .from(relay)
    .where(eq(relay.accepted, false))
    .orderBy(relay.id);
}
export async function acceptRoomRelays(ids: number[]) {
  if (!ids.length) return;
  await database
    .update(relay)
    .set({ accepted: true })
    .where(inArray(relay.id, ids));
  changed();
}
