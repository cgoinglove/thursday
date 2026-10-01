import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { and, desc, eq, inArray, max, or, sql } from "drizzle-orm";
import type * as z from "zod";
import { appEvents } from "@/app/api/events/app-event.server";
import { BOT_RUN, PROMPT_LINE } from "@/config";
import { database } from "@/database/db";
import {
  threadDeliveryTable as delivery,
  threadMessageTable as message,
  threadRelayTable as relay,
  threadTable as thread,
  threadWorkTable as work,
} from "@/database/tables";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { publicError } from "@/lib/public-error";
import { clip } from "@/lib/utils";
import { THREAD_CONTINUE, tagSpeaker } from "./bot.schema";
import {
  RESUME_CHECK,
  ROOM_THURSDAY,
  ROOM_USER,
  RoomMessageSchema,
} from "./room.schema";
import type { ThreadMessageInput } from "./thread.query";

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
export type RoomWork = typeof work.$inferSelect;
const changed = () => appEvents.emit({ type: "threads" });
const terminal = (state: RoomWork["state"]) =>
  state === "done" || state === "cancelled";
/**
 * The id of what one `send_message` call opened — its exchange, delivery and relay, and a
 * question's id — from the call that sent it, so a thread line of that call names it too.
 */
export const messageKey = (threadId: string, bot: string, callId: string) =>
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
  const receipts = new Map<string, Receipt>();
  if (!keys.length) return receipts;
  const [rows, sent] = await Promise.all([
    database.select().from(work).where(eq(work.threadId, threadId)),
    database
      .select({ key: delivery.key, workId: delivery.workId })
      .from(delivery)
      .where(and(eq(delivery.threadId, threadId), inArray(delivery.key, keys))),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const into = new Map(sent.map((row) => [row.key, row.workId]));
  for (const [index, id] of calls.entries()) {
    const row = byId.get(into.get(keys[index]) ?? keys[index]);
    if (row) receipts.set(id, receiptFor(row, keys[index]));
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

/**
 * The bots a hand-off names in `after`, as the room spells them. Each must have had work from the
 * sender, or there is nothing to wait for; a model that names one is told what to do instead.
 */
function awaited(all: RoomWork[], caller: string, to: string, names: string[]) {
  const bots = new Map(
    all
      .filter((row) => row.caller === caller && row.bot !== ROOM_THURSDAY)
      .map((row) => [row.bot.toLowerCase(), row.bot]),
  );
  const after: string[] = [];
  for (const name of names) {
    if (name.toLowerCase() === to.toLowerCase())
      publicError(
        `${to} cannot wait on its own answer; leave it out of after.`,
      );
    const bot = bots.get(name.toLowerCase());
    if (!bot)
      publicError(
        `${name} has no work from you to wait on: hand ${name} its part first, or leave it out of after.`,
      );
    if (!after.includes(bot)) after.push(bot);
  }
  return after;
}

/** Whether a bot still has open work from this caller. */
const isOut = (all: RoomWork[], caller: string, bot: string) =>
  all.some(
    (row) => row.caller === caller && row.bot === bot && !terminal(row.state),
  );

/** A hand-off that has not started because it waits on other bots' answers (`after`). */
const isHeld = (row: RoomWork) =>
  row.state === "waiting" && row.waitsFor.length > 0;

/** The bots whose words wait unread in this turn's inbox. */
async function unreadFrom(tx: Tx, run: RoomWork) {
  const rows = await tx
    .select({ speaker: delivery.speaker })
    .from(delivery)
    .where(and(eq(delivery.workId, run.id), eq(delivery.consumed, false)));
  return new Set(rows.map((row) => row.speaker));
}

/** "Beta's answer", or "the answers of Beta and Delta". */
const answersNamed = (bots: string[]) =>
  bots.length > 1
    ? `the answers of ${bots.join(" and ")}`
    : `${bots[0]}'s answer`;

/** Each awaited bot's latest answer to this caller, as a hand-off carries it. */
function answersOf(all: RoomWork[], caller: string, bots: string[]) {
  return bots.map((bot) => {
    const last = all
      .filter((row) => row.caller === caller && row.bot === bot)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .at(-1);
    return last?.state === "done" && last.result
      ? `## ${bot}'s answer\n\n${last.result}`
      : `## ${bot}\n\n${bot} stopped without an answer.`;
  });
}

/** Words that go out now, with the answers of the bots they named in `after`. */
const withAnswers = (
  all: RoomWork[],
  caller: string,
  text: string,
  after: string[],
) => [text, ...answersOf(all, caller, after)].join("\n\n");

type Receipt = { messageId: string; to: string; note?: string };

/**
 * What the coordinator reads right after a send, where it changes what comes next: left
 * unsaid, it went on researching what it had handed out, sent work that needed an answer before
 * the answer existed, and put off what only the user knew. A send replayed after its receipt
 * was lost reads the same (listRoomReceipts).
 */
function receiptFor(row: RoomWork, key: string): Receipt {
  const receipt = { messageId: key, to: row.bot };
  if (row.bot === ROOM_THURSDAY) return receipt;
  if (isHeld(row))
    return {
      ...receipt,
      note: `Held: it goes to ${row.bot} with ${answersNamed(row.waitsFor)} attached, when you end the turn in which you have read ${row.waitsFor.length > 1 ? "them" : "it"}. There is nothing to do for it until then.`,
    };
  if (row.id !== key)
    return {
      ...receipt,
      note: `${row.bot} is already working for you and reads this before its next step. Its one answer covers both.`,
    };
  return {
    ...receipt,
    note: `${row.bot} has it now, and their answer starts your next turn: until then, do not research, build, guess or report their part yourself, or watch their folder. Work that needs their answer goes out now with \`after: ["${row.bot}"]\`, and the app hands it on with that answer attached. A fact only the user has is asked for now, not after. Otherwise end your turn; the thread stays open.`,
  };
}

/**
 * Hand-offs held for other bots (`after`) go out with those bots' answers when the bot that
 * handed them out ends a turn with every one of those answers read, and is not waiting on the
 * user: an answer can be a question back, and the turn that reads it decides whether the work
 * can go (sending that bot more, or asking the user, keeps it held). Held in the row, so a
 * restart keeps it. A bot the user started early is still owed the answers it waited for.
 */
async function releaseWaiting(tx: Tx, run: RoomWork) {
  const all = await tx
    .select()
    .from(work)
    .where(eq(work.threadId, run.threadId))
    .orderBy(sql`${work}.rowid`);
  const owed = all.filter(
    (row) =>
      row.caller === run.bot &&
      row.waitsFor.length > 0 &&
      row.state !== "cancelled",
  );
  if (!owed.length || (await isAsking(tx, run.threadId, run.bot))) return;
  const unread = await unreadFrom(tx, run);
  for (const row of owed) {
    if (row.waitsFor.some((bot) => isOut(all, run.bot, bot) || unread.has(bot)))
      continue;
    await deliver(tx, {
      key: `after:${row.id}`,
      threadId: run.threadId,
      workId: row.id,
      speaker: run.bot,
      text: answersOf(all, run.bot, row.waitsFor).join("\n\n"),
    });
    await tx.update(work).set({ waitsFor: [] }).where(eq(work.id, row.id));
  }
}

/** A new exchange must fit the room: its bots and its open messages are capped. */
function admit(all: RoomWork[], to: string) {
  const bots = new Set(
    all.map((row) => row.bot).filter((bot) => bot !== ROOM_THURSDAY),
  );
  if (
    to !== ROOM_THURSDAY &&
    !bots.has(to) &&
    bots.size >= BOT_RUN.participants
  )
    publicError("This thread has reached its participant limit.");
  if (
    all.filter((row) => !terminal(row.state)).length >= BOT_RUN.queuedMessages
  )
    publicError("This thread has reached its pending message limit.");
}

async function touch(tx: Tx, threadId: string) {
  await tx
    .update(thread)
    .set({ wrapped: false, updatedAt: new Date() })
    .where(eq(thread.id, threadId));
}

/** The coordinator's one way out (bot.run): work to a bot, or a question to the user. */
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
  // The user sees who is working without being told; a message to Thursday that asks nothing
  // was the room's most common wasted turn, and asking a model not to send it made it send more.
  // The refusal says what to do instead: told to send "only a question", a coordinator on 6
  // Luna sent its progress note again as one, and the job waited 135 s on a question that
  // asked nothing (UX test, 1 Oct)
  if (input.to === ROOM_THURSDAY && input.kind !== "question")
    publicError(
      "Thursday takes only a question that needs the user's answer: they already see who is working, and your result reaches them as the last words of your turn. Do not send this as a question; end your turn, and a bot's answer starts your next one.",
    );
  if (input.to === ROOM_THURSDAY && input.after?.length)
    publicError("`after` is for work handed to a bot, not for a question.");
  if (input.to === run.bot)
    publicError("Continue your own work directly; choose another recipient.");
  const result = await database.transaction(async (tx): Promise<Receipt> => {
    await current(tx, run);
    const key = messageKey(run.threadId, run.bot, input.id);
    const all = await tx
      .select()
      .from(work)
      .where(eq(work.threadId, run.threadId));
    const [sent] = await tx
      .select({ workId: delivery.workId })
      .from(delivery)
      .where(eq(delivery.key, key));
    const replayed = all.find((row) => row.id === (sent?.workId ?? key));
    if (replayed) return receiptFor(replayed, key);
    if (input.to === ROOM_THURSDAY) {
      admit(all, input.to);
      await tx.insert(work).values({
        id: key,
        threadId: run.threadId,
        bot: ROOM_THURSDAY,
        caller: run.bot,
        parentId: run.id,
        state: "external",
        result: input.text,
        options: [...new Set(input.options ?? [])],
      });
      await tx.insert(relay).values({
        key,
        threadId: run.threadId,
        bot: run.bot,
        text: input.text,
        kind: "question",
        messageId: key,
      });
      await touch(tx, run.threadId);
      return { messageId: key, to: ROOM_THURSDAY };
    }
    const after = awaited(all, run.bot, input.to, input.after ?? []);
    const unread = await unreadFrom(tx, run);
    // An answer still out, or back but unread, holds the work: it may be a question back
    const pending = after.filter(
      (bot) => isOut(all, run.bot, bot) || unread.has(bot),
    );
    const calls = all.filter(
      (row) =>
        row.bot === input.to && row.caller === run.bot && !terminal(row.state),
    );
    const held = calls.find(isHeld);
    const started =
      calls.find((row) => row.state === "running") ??
      calls.find((row) => !isHeld(row));
    // More words for a hand-off still held wait with it, and what they wait on joins its list
    if (held && (pending.length || !started)) {
      await tx.insert(delivery).values({
        key,
        threadId: run.threadId,
        workId: held.id,
        speaker: run.bot,
        text: input.text,
      });
      const waitsFor = [...new Set([...held.waitsFor, ...after])];
      await tx.update(work).set({ waitsFor }).where(eq(work.id, held.id));
      await touch(tx, run.threadId);
      return receiptFor({ ...held, waitsFor }, key);
    }
    // Words to a bot already on a call from this one join that call, as the user's own do
    // (tellRoom): read before its next step, and answered once, by the one ending.
    if (started && !pending.length) {
      await deliver(tx, {
        key,
        threadId: run.threadId,
        workId: started.id,
        speaker: run.bot,
        text: withAnswers(all, run.bot, input.text, after),
      });
      await touch(tx, run.threadId);
      return receiptFor(started, key);
    }
    // A new exchange; one that waits on answers still out is held, even beside a call in progress
    admit(all, input.to);
    const [opened] = await tx
      .insert(work)
      .values({
        id: key,
        threadId: run.threadId,
        bot: input.to,
        caller: run.bot,
        parentId: run.id,
        state: pending.length ? "waiting" : "queued",
        waitsFor: pending.length ? after : [],
      })
      .returning();
    // Held words wait unread, and the answers go with them when it is released (releaseWaiting)
    if (pending.length)
      await tx.insert(delivery).values({
        key,
        threadId: run.threadId,
        workId: key,
        speaker: run.bot,
        text: input.text,
      });
    else
      await deliver(tx, {
        key,
        threadId: run.threadId,
        workId: key,
        speaker: run.bot,
        text: withAnswers(all, run.bot, input.text, after),
      });
    await touch(tx, run.threadId);
    return receiptFor(opened, key);
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

/**
 * A bot's first row in a thread it is brought into: who brought it and the job as they handed
 * it over (bot.prompt buildJoinOpening), in place of the thread's first request, which is stale
 * once the user has asked for more. Like the opening, it outlives every compaction.
 */
export async function joinRoom(
  run: RoomWork,
  build: (
    job: { from: string; text: string } | null,
  ) => ModelMessage["content"],
) {
  await database.transaction(async (tx) => {
    await current(tx, run);
    const [job] = await tx
      .select()
      .from(delivery)
      .where(
        and(
          eq(delivery.workId, run.id),
          eq(delivery.consumed, false),
          eq(delivery.visible, false),
          eq(delivery.speaker, run.caller),
        ),
      )
      .orderBy(delivery.id)
      .limit(1);
    await append(tx, run.threadId, {
      bot: run.bot,
      parent: run.id,
      role: "user",
      content: build(job ? { from: job.speaker, text: job.text } : null),
      hidden: true,
    });
    if (job)
      await tx
        .update(delivery)
        .set({ consumed: true })
        .where(eq(delivery.id, job.id));
  });
  changed();
}

/** How one handed-out exchange stands, in the coordinator's words. */
function standing(all: RoomWork[], row: RoomWork, released: boolean) {
  const out = row.waitsFor.filter((bot) => isOut(all, row.caller, bot));
  const when = out.length
    ? `once ${out.join(" and ")} ${out.length > 1 ? "are" : "is"} back`
    : "when you end this turn";
  if (isHeld(row))
    return out.length
      ? `waits for ${out.join(" and ")}`
      : `goes out with ${answersNamed(row.waitsFor)} ${when}`;
  const now =
    row.state === "running"
      ? "working"
      : row.state === "queued"
        ? "about to start"
        : row.state === "paused"
          ? "paused"
          : row.state === "done"
            ? "done for now"
            : "waiting";
  // Said, or the coordinator hands on again what the app already attached
  const had = released ? ", with the answers it waited for" : "";
  const owed = row.waitsFor.length
    ? `; ${answersNamed(row.waitsFor)} follows ${when}`
    : "";
  return `${now}${had}${owed}`;
}

/**
 * What the coordinator handed out that is not back yet, read at the start of each of its turns:
 * without it, a coordinator woken by one answer asked again for work already on its way. Work the
 * user gave a bot directly answers to the coordinator too, but is listed as the user's. Null when
 * nothing has gone out.
 */
export async function roomBoard(run: RoomWork) {
  const all = await database
    .select()
    .from(work)
    .where(eq(work.threadId, run.threadId))
    .orderBy(work.createdAt);
  const shown = all.filter(
    (row) => row.parentId === run.id && row.bot !== ROOM_THURSDAY,
  );
  if (!shown.length) return null;
  // A bot the user started early is still owed the answers it waited for
  const open = shown.filter(
    (row) =>
      !terminal(row.state) || (row.state === "done" && row.waitsFor.length > 0),
  );
  if (!open.length) return "Everything you handed out is back.";
  const first = new Map<string, { text: string; visible: boolean }>();
  const released = new Set<string>();
  for (const row of await database
    .select({
      workId: delivery.workId,
      key: delivery.key,
      text: delivery.text,
      visible: delivery.visible,
    })
    .from(delivery)
    .where(
      inArray(
        delivery.workId,
        open.map((row) => row.id),
      ),
    )
    .orderBy(delivery.id)) {
    if (!first.has(row.workId)) first.set(row.workId, row);
    if (row.key === `after:${row.workId}`) released.add(row.workId);
  }
  const now = Date.now();
  const line = (row: RoomWork) => {
    const minutes = Math.max(
      0,
      Math.round((now - row.createdAt.getTime()) / 60_000),
    );
    const asked = (first.get(row.id)?.text ?? "").split("\n")[0].trim();
    return `- ${row.bot}, ${standing(all, row, released.has(row.id))} (${minutes} min): "${clip(asked, PROMPT_LINE.boardAsk)}"`;
  };
  const handed = open.filter((row) => !first.get(row.id)?.visible);
  const direct = open.filter((row) => first.get(row.id)?.visible);
  return [
    handed.length
      ? `What you handed out that is not back yet:\n${handed.map(line).join("\n")}`
      : "Everything you handed out is back.",
    ...(direct.length
      ? [
          `The user wrote to these bots directly; their answers come to you:\n${direct.map(line).join("\n")}`,
        ]
      : []),
  ].join("\n\n");
}

function deliveryText(row: typeof delivery.$inferSelect) {
  return row.visible
    ? tagSpeaker(row.speaker === ROOM_USER ? "user" : "thursday", row.text)
    : `${row.speaker}:\n\n${row.text}`;
}

/** A normal loop end settles a conversation only after its downstream work returns. */
export async function finishRoomWork(run: RoomWork, text: string) {
  await database.transaction(async (tx) => {
    await current(tx, run);
    // Before this turn's own state: what it releases is work it is still waiting on
    await releaseWaiting(tx, run);
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
      // An earlier return of this bot's still unread is the answer; a silent
      // ending adds nothing to it, and that return already wakes the caller
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
      const why =
        room.turns >= BOT_RUN.turns
          ? "The room reached its automatic turn limit. Continue from the saved conversation."
          : "Work is paused. Continue from the saved conversation.";
      if (room.routineId) {
        await endStopped(tx, threadId, all, why);
        return;
      }
      await tx
        .update(thread)
        .set({
          status: "waiting",
          outcome: why,
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

/**
 * Ends a routine's run where the app would park any other job on Continue. Nobody handed that
 * run over, so nobody is there to press it, and a run left open holds its routine's next start
 * (routine.clock): one failure kept the routine from ever starting again. What is still open in
 * the room closes with it, as a person's stop closes it (`cancelRoom`); the thread ends stopped
 * and unread with `why` as its outcome, and one relay carries that to the call and a phone. The
 * routine's next run stands in for it (routine.clock `open`), so a routine that fails every
 * time is one ending to read, not one per run. A question a bot asks still waits.
 */
async function endStopped(
  tx: Tx,
  threadId: string,
  all: RoomWork[],
  why: string,
) {
  for (const row of all.filter((row) => !terminal(row.state)))
    await tx
      .update(work)
      .set({ state: "cancelled", generation: row.generation + 1 })
      .where(eq(work.id, row.id));
  // What it said before is settled by how it ended
  await tx
    .update(relay)
    .set({ accepted: true })
    .where(eq(relay.threadId, threadId));
  await tx
    .update(thread)
    .set({
      status: "cancelled",
      outcome: why,
      pending: null,
      seen: false,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(thread.id, threadId));
  await tx.insert(relay).values({
    key: crypto.randomUUID(),
    threadId,
    bot: all.find((row) => !row.parentId)?.bot ?? "Bot",
    text: why,
    kind: "interrupted",
  });
}

/**
 * `refused`: the provider that turned down the key or sign-in the run was on, when that is why.
 * A routine's run is not parked: it ends there (`endStopped`).
 */
export async function pauseRoom(
  threadId: string,
  why: string,
  refused?: TextModelProviderId,
) {
  await database.transaction(async (tx) => {
    const all = await tx.select().from(work).where(eq(work.threadId, threadId));
    const [room] = await tx
      .select({ routineId: thread.routineId })
      .from(thread)
      .where(eq(thread.id, threadId));
    const ends = Boolean(room?.routineId);
    for (const row of all.filter(
      (row) => row.state === "running" || row.state === "queued",
    )) {
      if (!ends)
        await tx
          .update(work)
          .set({ state: "paused", generation: row.generation + 1 })
          .where(eq(work.id, row.id));
      // Kept for a run that ends too: a follow-up that picks it back up reads why it stopped
      await append(tx, threadId, breakNote(row, why));
    }
    if (ends) {
      await endStopped(tx, threadId, all, why);
      return;
    }
    await tx
      .update(thread)
      .set({
        status: "waiting",
        outcome: why,
        pending: {
          options: [THREAD_CONTINUE],
          ...(refused ? { refused } : {}),
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
    });
  });
  changed();
}

export async function resumeRoom(threadId: string) {
  await database.transaction(async (tx) => {
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
 * The questions words from the user side answer: those the named bot is waiting on, or with no
 * bot named those open. One bot's questions are answered together, since a call or a phone can
 * name only the bot (thread_answer) and the user's reply often covers both; questions from
 * several bots with none named are the sender's to settle, so they are refused with the list.
 */
function questionsFor(open: RoomWork[], recipient?: string) {
  const asked = recipient
    ? open.filter((row) => row.caller === recipient)
    : open;
  if (new Set(asked.map((row) => row.caller)).size <= 1) return asked;
  publicError(
    `Several bots are waiting for an answer: ${asked
      .map(
        (row) =>
          `${row.caller} (replyTo ${row.id}): “${(row.result ?? "").slice(0, 160)}”`,
      )
      .join("; ")}. Answer one of them by naming its bot or by its replyTo.`,
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
    const questions = replyTo
      ? [
          open.find((row) => row.id === replyTo) ??
            publicError("That question is no longer waiting for an answer."),
        ]
      : answering
        ? questionsFor(open, recipient)
        : [];
    const question = questions[0];
    const bot = question?.caller ?? recipient ?? room.bot;
    let target = question
      ? all.find((row) => row.id === question.parentId)
      : (all.find((row) => row.bot === bot && row.state === "running") ??
        all.find(
          (row) =>
            row.bot === bot && !terminal(row.state) && row.state !== "external",
        ));
    // Words to a bot held for other answers (`after`) start it now, as words to anyone do
    // (deliver): the user's word outranks the hold, and the answers still follow (releaseWaiting)
    for (const one of questions) {
      await tx
        .update(work)
        .set({ state: "done", result: text })
        .where(eq(work.id, one.id));
      await tx
        .update(relay)
        .set({ accepted: true })
        .where(eq(relay.messageId, one.id));
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
        text:
          questions.length > 1
            ? `The next message answers your questions to the user: ${questions.map((one) => `“${one.result ?? ""}”`).join(", ")}`
            : `The next message answers your question to the user: “${question.result ?? ""}”`,
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
        ? {
            bot: question.caller,
            question: questions.map((one) => one.result ?? "").join(" · "),
          }
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

/**
 * The coordinator reports that name a text, the latest first. A thread keeps one per time it
 * ended (`report:<thread>:<generation>`) for as long as it lives, so what a job handed over is
 * found again after the thread was taken up and its outcome cleared. `instr` only narrows:
 * the caller reads each report's paths to keep a whole-path match.
 */
export async function listReportsNaming(text: string) {
  return database
    .select({ threadId: relay.threadId, text: relay.text })
    .from(relay)
    .where(
      and(eq(relay.kind, "report"), sql`instr(${relay.text}, ${text}) > 0`),
    )
    .orderBy(desc(relay.id));
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
