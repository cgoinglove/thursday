import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { and, eq, inArray, max, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { appEvents } from "@/app/api/events/app-event.server";
import { BOT_RUN } from "@/config";
import { database } from "@/database/db";
import {
  threadDeliveryTable as delivery,
  threadMessageTable as message,
  threadRelayTable as relay,
  threadTable as thread,
  threadWorkTable as work,
} from "@/database/tables";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { publicError } from "@/lib/public-error";
import { THREAD_CONTINUE, tagSpeaker } from "./bot.schema";
import { RESUME_CHECK, ROOM_THURSDAY, RoomMessageSchema } from "./room.schema";
import type { ThreadMessageInput } from "./thread.query";

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
export type RoomWork = typeof work.$inferSelect;
const changed = () => appEvents.emit({ type: "threads" });
const terminal = (state: RoomWork["state"]) =>
  state === "done" || state === "cancelled";
const messageKey = (threadId: string, bot: string, callId: string) =>
  `message:${createHash("sha256")
    .update(JSON.stringify([threadId, bot, callId]))
    .digest("hex")}`;

/** Whether a bot has a question to the user still open. Until it is answered the bot runs nothing. */
async function isAsking(tx: Tx, threadId: string, bot: string) {
  const [open] = await tx
    .select({ id: work.id })
    .from(work)
    .where(
      and(
        eq(work.threadId, threadId),
        eq(work.state, "external"),
        eq(work.caller, bot),
      ),
    )
    .limit(1);
  return !!open;
}

/** Recover a committed send whose receipt was lost before the next transcript write. */
export async function listRoomReceipts(
  threadId: string,
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
  const keys = calls.map((id) => messageKey(threadId, bot, id));
  const receipts = new Map<string, { messageId: string; to: string }>();
  if (!keys.length) return receipts;
  const [requests, replies] = await Promise.all([
    database
      .select({ key: work.id, to: work.bot })
      .from(work)
      .where(and(eq(work.threadId, threadId), inArray(work.id, keys))),
    database
      .select({ key: delivery.key, to: work.bot })
      .from(delivery)
      .innerJoin(work, eq(work.id, delivery.workId))
      .where(and(eq(delivery.threadId, threadId), inArray(delivery.key, keys))),
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
  threadId: string,
  row: ThreadMessageInput & { hidden?: boolean },
) {
  const [last] = await tx
    .select({ seq: max(message.seq) })
    .from(message)
    .where(eq(message.threadId, threadId));
  const seq = (last?.seq ?? -1) + 1;
  await tx.insert(message).values({ threadId, seq, ...row });
  return seq;
}

/** What a participant reads where its turn broke off, before it picks up again. */
const breakNote = (run: Pick<RoomWork, "bot" | "id">, why: string) => ({
  bot: run.bot,
  parent: run.id,
  role: "user" as const,
  content: `${why} ${RESUME_CHECK}`,
  note: true,
});

/** A turn tried again after a break (bot.runner) reads why first, as a resumed one does. */
export async function noteRoomBreak(run: RoomWork, why: string) {
  await appendRoomMessage(run.threadId, breakNote(run, why));
}

/** Allocate at the database boundary; independent participant writers never share a counter. */
export async function appendRoomMessage(
  threadId: string,
  row: ThreadMessageInput & { hidden?: boolean },
) {
  const seq = await database.transaction((tx) => append(tx, threadId, row));
  changed();
  return seq;
}

export async function listRoomWork(threadId: string) {
  return database
    .select()
    .from(work)
    .where(eq(work.threadId, threadId))
    .orderBy(work.createdAt, work.id);
}

/** Every continuation at this desk inherits the smallest threshold that its provider accepted. */
export async function roomContextBudget(threadId: string, bot: string) {
  const [row] = await database
    .select({
      budget: sql<number | null>`min(nullif(${work.contextBudget}, 0))`,
    })
    .from(work)
    .where(and(eq(work.threadId, threadId), eq(work.bot, bot)));
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
  const [target] = await tx
    .select({ bot: work.bot })
    .from(work)
    .where(eq(work.id, input.workId));
  // A bot waiting on the user's answer reads nothing before it: its inbox holds (tellRoom wakes it)
  if (target && (await isAsking(tx, input.threadId, target.bot))) return;
  await tx
    .update(work)
    .set({ state: "queued" })
    .where(
      and(eq(work.id, input.workId), inArray(work.state, ["waiting", "done"])),
    );
}

export async function sendRoomMessage(
  run: RoomWork,
  raw: z.input<typeof RoomMessageSchema> & { id: string },
) {
  const input = { ...RoomMessageSchema.parse(raw), id: raw.id };
  if (input.kind === "question" && input.to !== ROOM_THURSDAY)
    publicError(
      "Address user questions to Thursday; use a message to contact another bot.",
    );
  if (input.options?.length && input.kind !== "question")
    publicError("Offer answer choices only with a user question.");
  const result = await database.transaction(async (tx) => {
    await current(tx, run);
    const key = messageKey(run.threadId, run.bot, input.id);
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
        .where(
          and(eq(work.id, input.replyTo), eq(work.threadId, run.threadId)),
        );
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
          threadId: run.threadId,
          workId: target.parentId,
          speaker: run.bot,
          text: input.text,
        });
        return { messageId: key, to: input.to };
      }
      // Thursday has no model continuation to wake; the message enters the user inbox below.
    }
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.threadId, run.threadId));
    const bots = new Set(
      all.map((row) => row.bot).filter((bot) => bot !== ROOM_THURSDAY),
    );
    if (
      input.to !== ROOM_THURSDAY &&
      !bots.has(input.to) &&
      bots.size >= BOT_RUN.participants
    )
      publicError("This thread has reached its participant limit.");
    if (
      all.filter((row) => !terminal(row.state)).length >= BOT_RUN.queuedMessages
    )
      publicError("This thread has reached its pending message limit.");
    const held =
      input.to !== ROOM_THURSDAY &&
      (await isAsking(tx, run.threadId, input.to));
    await tx.insert(work).values({
      id: key,
      threadId: run.threadId,
      bot: input.to,
      caller: run.bot,
      parentId: run.id,
      state:
        input.to === ROOM_THURSDAY
          ? input.kind === "question"
            ? "external"
            : "done"
          : held
            ? "waiting"
            : "queued",
      result: input.to === ROOM_THURSDAY ? input.text : null,
      options: [...new Set(input.options ?? [])],
    });
    if (input.to === ROOM_THURSDAY) {
      await tx.insert(relay).values({
        key,
        threadId: run.threadId,
        bot: run.bot,
        text: input.text,
        kind: input.kind,
        messageId: input.kind === "question" ? key : null,
      });
    } else {
      await deliver(tx, {
        key,
        threadId: run.threadId,
        workId: key,
        speaker: run.bot,
        text: input.text,
      });
    }
    await tx
      .update(thread)
      .set({ wrapped: false, updatedAt: new Date() })
      .where(eq(thread.id, run.threadId));
    return {
      messageId: key,
      to: input.to,
      ...(held
        ? {
            note: `${input.to} is waiting for the user's answer and reads this after it.`,
          }
        : {}),
    };
  });
  changed();
  return result;
}

export async function claimRoomWork(threadId: string) {
  let parked = false;
  const claimed = await database.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(thread)
      .where(eq(thread.id, threadId));
    if (!room || room.status !== "running") return null;
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.threadId, threadId))
      .orderBy(sql`${work}.rowid`);
    // A queued turn of a bot waiting on the user waits with it; the answer queues it again (tellRoom)
    const asking = new Set(
      all.filter((row) => row.state === "external").map((row) => row.caller),
    );
    for (const row of all) {
      if (row.state !== "queued" || !asking.has(row.bot)) continue;
      await tx
        .update(work)
        .set({ state: "waiting" })
        .where(eq(work.id, row.id));
      row.state = "waiting";
      parked = true;
    }
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
        .where(and(eq(work.threadId, threadId), eq(work.state, "queued")));
      return null;
    }
    const [run] = await tx
      .update(work)
      .set({ state: "running", generation: next.generation + 1 })
      .where(eq(work.id, next.id))
      .returning();
    await tx
      .update(thread)
      .set({ turns: room.turns + 1 })
      .where(eq(thread.id, threadId));
    return run;
  });
  if (claimed || parked) changed();
  return claimed;
}

/**
 * Takes back words the user stepped in with, while the bot has not read them.
 * Only from a running turn's inbox: a turn queued for those words alone would
 * wake to nothing. False when they were already read.
 */
export async function withdrawDelivery(threadId: string, key: string) {
  const gone = await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: delivery.id })
      .from(delivery)
      .innerJoin(work, eq(work.id, delivery.workId))
      .where(
        and(
          eq(delivery.key, key),
          eq(delivery.threadId, threadId),
          eq(delivery.visible, true),
          eq(delivery.consumed, false),
          eq(work.state, "running"),
        ),
      );
    if (!row) return false;
    await tx.delete(delivery).where(eq(delivery.id, row.id));
    return true;
  });
  if (gone) changed();
  return gone;
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
      await append(tx, run.threadId, {
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
    // Waiting on the user's answer holds the inbox (deliver); the answer queues it (tellRoom)
    const asking = await isAsking(tx, run.threadId, run.bot);
    const state =
      pending.length && !asking
        ? "queued"
        : pending.length || children.some((row) => !terminal(row.state))
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
      // An explicit reply (send_message replyTo) still unread is the answer; a
      // silent ending adds nothing to it, and the reply already wakes the caller
      const [replied] = text
        ? []
        : await tx
            .select({ id: delivery.id })
            .from(delivery)
            .where(
              and(
                eq(delivery.workId, run.parentId),
                eq(delivery.speaker, run.bot),
                eq(delivery.consumed, false),
              ),
            )
            .limit(1);
      if (parent && parent.state !== "cancelled" && !replied) {
        await deliver(tx, {
          key: `return:${run.id}:${run.generation}`,
          threadId: run.threadId,
          workId: parent.id,
          speaker: run.bot,
          text: text || "This turn ended without a message.",
        });
      }
    }
    const [room] = await tx
      .select()
      .from(thread)
      .where(eq(thread.id, run.threadId));
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.threadId, run.threadId));
    if (
      room &&
      run.bot === room.bot &&
      !run.parentId &&
      all.every((row) => terminal(row.state))
    ) {
      await tx
        .update(thread)
        .set({
          status: text ? "done" : "waiting",
          outcome: text || "The room is idle. Send a message to continue.",
          pending: text ? null : { options: [THREAD_CONTINUE] },
          wrapped: true,
          endedAt: text ? new Date() : null,
          seen: false,
          updatedAt: new Date(),
        })
        .where(eq(thread.id, run.threadId));
      if (text)
        await tx
          .insert(relay)
          .values({
            key: `report:${run.threadId}:${room.generation}`,
            threadId: run.threadId,
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
export async function settleRoom(threadId: string) {
  await database.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(thread)
      .where(eq(thread.id, threadId));
    if (!room || room.status !== "running") return;
    const all = await tx.select().from(work).where(eq(work.threadId, threadId));
    if (all.some((row) => row.state === "queued" || row.state === "running"))
      return;
    const question = all.find((row) => row.state === "external");
    if (question) {
      await tx
        .update(thread)
        .set({
          status: "waiting",
          outcome: question.result,
          pending: {
            options: question.options,
            messageId: question.id,
            bot: question.caller,
          },
          updatedAt: new Date(),
        })
        .where(eq(thread.id, threadId));
      return;
    }
    if (all.some((row) => !terminal(row.state)) || room.wrapped) {
      await tx
        .update(thread)
        .set({
          status: "waiting",
          outcome:
            room.turns >= BOT_RUN.turns
              ? "The room reached its automatic turn limit. Continue from the saved conversation."
              : "Work is paused. Continue from the saved conversation.",
          pending: { options: [THREAD_CONTINUE] },
          updatedAt: new Date(),
        })
        .where(eq(thread.id, threadId));
      return;
    }
    const id = crypto.randomUUID();
    await tx.insert(work).values({
      id,
      threadId,
      bot: room.bot,
      caller: ROOM_THURSDAY,
      state: "queued",
    });
    await deliver(tx, {
      key: id,
      threadId,
      workId: id,
      speaker: "Thread activity",
      text: "The participants have finished their current turns. Bring together the results you received for Thursday, including anything still unresolved.",
    });
    await tx
      .update(thread)
      .set({ wrapped: true })
      .where(eq(thread.id, threadId));
  });
  changed();
}

export async function pauseRoom(threadId: string, why: string, auto = false) {
  await database.transaction(async (tx) => {
    const all = await tx.select().from(work).where(eq(work.threadId, threadId));
    for (const row of all.filter(
      (row) => row.state === "running" || row.state === "queued",
    )) {
      await tx
        .update(work)
        .set({ state: "paused", generation: row.generation + 1 })
        .where(eq(work.id, row.id));
      await append(tx, threadId, breakNote(row, why));
    }
    await tx
      .update(thread)
      .set({
        status: "waiting",
        outcome: why,
        pending: {
          options: [THREAD_CONTINUE],
          ...(auto ? { auto: true } : {}),
        },
        seen: false,
        endedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(thread.id, threadId));
    await tx.insert(relay).values({
      key: crypto.randomUUID(),
      threadId,
      bot: all.find((row) => !row.parentId)?.bot ?? "Bot",
      text: why,
      kind: "interrupted",
      accepted: auto,
    });
  });
  changed();
}

export async function resumeRoom(threadId: string, manual = true) {
  await database.transaction(async (tx) => {
    await tx
      .update(work)
      .set({ state: "queued" })
      .where(and(eq(work.threadId, threadId), eq(work.state, "paused")));
    await tx
      .update(thread)
      .set({
        status: "running",
        ...(manual
          ? { generation: sql`${thread.generation} + 1`, turns: 0 }
          : {}),
        pending: null,
        outcome: null,
        endedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(thread.id, threadId));
    // The stop it picks up from is no longer news
    await tx
      .update(relay)
      .set({ accepted: true })
      .where(and(eq(relay.threadId, threadId), eq(relay.kind, "interrupted")));
  });
  changed();
}

/**
 * The question words from the user side answer: the one the named bot is waiting
 * on, or with no bot named the only one open. Several and none named is the
 * sender's to settle, so it is refused with the list.
 */
function questionFor(open: RoomWork[], recipient?: string) {
  const asked = recipient
    ? open.filter((row) => row.caller === recipient)
    : open;
  if (asked.length <= 1) return asked[0];
  publicError(
    `Several questions are waiting for an answer: ${asked
      .map(
        (row) =>
          `${row.caller} (replyTo ${row.id}): “${(row.result ?? "").slice(0, 160)}”`,
      )
      .join("; ")}. Answer one of them by its replyTo.`,
  );
}

/** Queue every turn a bot held while it waited on the user that has something to read. */
async function wake(tx: Tx, threadId: string, bot: string) {
  const unread = tx
    .select({ workId: delivery.workId })
    .from(delivery)
    .where(and(eq(delivery.threadId, threadId), eq(delivery.consumed, false)));
  await tx
    .update(work)
    .set({ state: "queued" })
    .where(
      and(
        eq(work.threadId, threadId),
        eq(work.bot, bot),
        inArray(work.state, ["waiting", "done"]),
        inArray(work.id, unread),
      ),
    );
}

/** User messages enter the recipient's active continuation, retaining its original return route. */
export async function tellRoom(
  threadId: string,
  text: string,
  speaker: string,
  recipient?: string,
  replyTo?: string,
  /** False for Continue, which never answers a question. */
  answering = true,
) {
  const told = await database.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(thread)
      .where(eq(thread.id, threadId));
    if (!room) publicError("No such thread.");
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.threadId, threadId))
      .orderBy(work.createdAt);
    const open = all.filter((row) => row.state === "external");
    const question = replyTo
      ? (open.find((row) => row.id === replyTo) ??
        publicError("That question is no longer waiting for an answer."))
      : answering
        ? questionFor(open, recipient)
        : undefined;
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
                threadId,
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
            threadId,
            bot,
            caller: parentId ? room.bot : ROOM_THURSDAY,
            parentId,
            state: "queued",
          })
          .returning()
      )[0];
    }
    // The bot is told which question the next words answer; the screen draws only the words (hidden)
    if (question)
      await deliver(tx, {
        key: `answer:${question.id}`,
        threadId,
        workId: target.id,
        speaker: "Thread activity",
        text: `The next message answers your question to the user: “${question.result ?? ""}”`,
      });
    const key = crypto.randomUUID();
    await deliver(tx, {
      key,
      threadId,
      workId: target.id,
      speaker,
      text,
      visible: true,
    });
    // Answered, the bot reads again: every turn it held while waiting is queued in arrival order
    if (question && !(await isAsking(tx, threadId, bot)))
      await wake(tx, threadId, bot);
    await tx
      .update(work)
      .set({ state: "queued" })
      .where(and(eq(work.threadId, threadId), eq(work.state, "paused")));
    await tx
      .update(thread)
      .set({
        status: "running",
        generation: sql`${thread.generation} + 1`,
        turns: 0,
        wrapped: false,
        pending: null,
        outcome: null,
        endedAt: null,
        seen: false,
        updatedAt: new Date(),
      })
      .where(eq(thread.id, threadId));
    // Words that start it again supersede how it last stopped or ended
    await tx
      .update(relay)
      .set({ accepted: true })
      .where(
        and(
          eq(relay.threadId, threadId),
          inArray(relay.kind, ["interrupted", "report"]),
        ),
      );
    return {
      key,
      to: bot,
      answered: question
        ? { bot: question.caller, question: question.result ?? "" }
        : null,
    };
  });
  changed();
  return told;
}

export async function cancelRoom(threadId: string) {
  await database.transaction(async (tx) => {
    await tx
      .update(work)
      .set({ state: "cancelled", generation: sql`${work.generation} + 1` })
      .where(
        and(
          eq(work.threadId, threadId),
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
      .where(eq(relay.threadId, threadId));
  });
  changed();
}

export async function listParticipantTranscript(
  threadId: string,
  bot: string,
): Promise<ModelMessage[]> {
  const [room] = await database
    .select({ bot: thread.bot })
    .from(thread)
    .where(eq(thread.id, threadId));
  // The coordinator's opening (seq 0) is written before any bot speaks
  const rows = await database
    .select()
    .from(message)
    .where(
      and(
        eq(message.threadId, threadId),
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
