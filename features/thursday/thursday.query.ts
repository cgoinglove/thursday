import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";
import { CALL_HISTORY_PAGE } from "@/config";
import { database } from "@/database/db";
import {
  callMessageTable,
  callTable,
  callThoughtTable,
} from "@/database/tables";
import {
  LIVE_DEFAULTS,
  type LiveSettings,
  LiveSettingsSchema,
  migrateLiveSettings,
} from "@/features/ai/live.schema";
import { listCallJobs } from "@/features/bot/thread.query";
import { readConfig, writeConfig } from "@/features/config/config.query";
import type { LiveClose } from "@/lib/live/live.schema";
import {
  type CallRecord,
  type CallThought,
  type CallTurn,
  THURSDAY_KEYS,
} from "./thursday.schema";

/**
 * The call's settings, for whoever is about to run one: the screen drawing them, a call
 * being opened, or someone writing from a phone. One row of JSON rather than a row a
 * field, so a field added later reaches an install that never wrote one —
 * `migrateLiveSettings` fills what is missing and falls back to the default for anything
 * a hand-edit broke, field by field.
 */
export async function readLiveSettings(): Promise<LiveSettings> {
  const stored = asObject(await readConfig(THURSDAY_KEYS.settings));
  const settings = LiveSettingsSchema.parse(migrateLiveSettings(stored));
  if (stored) return settings;
  return { ...settings, readSkills: await wasReadingSkills() };
}

/**
 * Before the settings moved here this switch was a row of its own, and an install that
 * turned it on keeps it on. No browser ever held it, so a browser's copy never carries it.
 * Read only while no settings row exists: switched off, the switch is the default and is
 * not kept, and the old row would switch it back on. Never written again.
 */
async function wasReadingSkills(): Promise<boolean> {
  return (await readConfig(THURSDAY_KEYS.wasSkills))?.trim() === "on";
}

/**
 * Kept as what differs from the defaults, so a default nobody picked moves with the app
 * when it changes — a release that replaces the backend model reaches every install that
 * left it alone, as the bots' model left on Automatic does. The screen sends every field,
 * so there is nothing to merge.
 */
export async function writeLiveSettings(settings: LiveSettings): Promise<void> {
  const chosen = Object.fromEntries(
    Object.entries(settings).filter(
      ([key, value]) => value !== LIVE_DEFAULTS[key as keyof LiveSettings],
    ),
  );
  await writeConfig(THURSDAY_KEYS.settings, JSON.stringify(chosen));
}

/**
 * A browser's own copy, moved here once. Does nothing when a row exists, so the second
 * tab to load — and every load after — leaves what is already kept, and no settings of
 * one machine's can overwrite another's later on. What comes in is whatever that browser
 * last wrote, which may name its fields as two versions ago did, so it is migrated rather
 * than parsed: parsing alone drops what it cannot name, and a `voicePrompt` written before
 * the style was read in writing is the user's own words.
 */
export async function seedLiveSettings(carried: unknown): Promise<boolean> {
  if (await readConfig(THURSDAY_KEYS.settings)) return false;
  await writeLiveSettings({
    ...LiveSettingsSchema.parse(migrateLiveSettings(carried)),
    readSkills: await wasReadingSkills(),
  });
  return true;
}

/** A stored row as the object it was written from; null for anything else. */
function asObject(row: string | undefined): Record<string, unknown> | null {
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function insertCall(input: {
  provider: string;
  model: string;
  backendModel: string;
}) {
  const [call] = await database
    .insert(callTable)
    .values({ id: crypto.randomUUID(), ...input })
    .returning({ id: callTable.id });
  return call.id;
}

/**
 * Ends the call; false if it already ended, so end-of-call work runs once.
 * `close` is what the provider confirmed on `session.closed`; without it the
 * row keeps null seconds, which reads as "never confirmed", not as zero.
 */
export async function endCall(
  id: string,
  close?: LiveClose | null,
): Promise<boolean> {
  const ended = await database
    .update(callTable)
    .set({
      endedAt: new Date(),
      ...(close
        ? { endedReason: close.reason, seconds: close.seconds ?? null }
        : {}),
    })
    .where(and(eq(callTable.id, id), isNull(callTable.endedAt)))
    .returning({ id: callTable.id });
  return ended.length > 0;
}

/**
 * Upsert on (call, item): the provider can finalize the same item twice
 * (a cancelled answer, then its transcript); the later text wins, `seq` stays.
 */
export async function saveTurns(callId: string, turns: CallTurn[]) {
  for (const turn of turns) {
    await database
      .insert(callMessageTable)
      .values({ callId, ...turn, fragments: turn.fragments ?? null })
      .onConflictDoUpdate({
        target: [callMessageTable.callId, callMessageTable.id],
        set: {
          text: turn.text,
          role: turn.role,
          tool: turn.tool ?? null,
          // A late fragment revises the group; the originals go with it.
          fragments: turn.fragments ?? null,
        },
      });
  }
}

/** Where the next turn goes: a call in writing numbers its turns on the server (thursday.text). */
export async function nextTurnSeq(callId: string): Promise<number> {
  const [last] = await database
    .select({ seq: sql<number | null>`max(${callMessageTable.seq})` })
    .from(callMessageTable)
    .where(eq(callMessageTable.callId, callId));
  return last?.seq == null ? 0 : Number(last.seq) + 1;
}

/** A summary part arrives once, whole; a repeat keeps the first. */
export async function saveThought(callId: string, thought: CallThought) {
  await database
    .insert(callThoughtTable)
    .values({ callId, ...thought })
    .onConflictDoNothing();
}

export type CallGroup = {
  callId: string;
  startedAt: Date;
  turns: {
    role: CallTurn["role"];
    tool: string | null;
    text: string;
    seq: number;
  }[];
};

/**
 * The most recent turns across calls, oldest call first and in spoken order.
 * `limit` counts turns, not calls; the caller trims to its token budget.
 */
export async function listRecentTurns(limit: number): Promise<CallGroup[]> {
  const rows = await database
    .select({
      callId: callMessageTable.callId,
      startedAt: callTable.startedAt,
      role: callMessageTable.role,
      tool: callMessageTable.tool,
      text: callMessageTable.text,
      seq: callMessageTable.seq,
    })
    .from(callMessageTable)
    .innerJoin(callTable, eq(callMessageTable.callId, callTable.id))
    .orderBy(desc(callTable.startedAt), desc(callMessageTable.seq))
    .limit(limit);

  const groups = new Map<string, CallGroup>();
  // Rows arrive newest first, so each group fills newest first and is reversed.
  for (const row of rows) {
    const group = groups.get(row.callId) ?? {
      callId: row.callId,
      startedAt: row.startedAt,
      turns: [],
    };
    group.turns.push({
      role: row.role,
      tool: row.tool,
      text: row.text,
      seq: row.seq,
    });
    groups.set(row.callId, group);
  }
  return [...groups.values()]
    .reverse()
    .map((group) => ({ ...group, turns: group.turns.reverse() }));
}

/** Whether a call was ever placed here: until one is, the first-run intro shows (app/page). */
export async function hasAnyCall() {
  const one = await database
    .select({ id: callTable.id })
    .from(callTable)
    .limit(1);
  return one.length > 0;
}

/**
 * Whether any call is open, not whether a given job's call is. A tab that
 * vanished leaves its row open, so boot runs `sweepCalls` first.
 */
export async function isAnyCallLive() {
  const open = await database
    .select({ id: callTable.id })
    .from(callTable)
    .where(isNull(callTable.endedAt))
    .limit(1);
  return open.length > 0;
}

/** Whether this call is still on: a row the sweep closed under its holder is not (reach). */
export async function isCallOpen(id: string): Promise<boolean> {
  const open = await database
    .select({ id: callTable.id })
    .from(callTable)
    .where(and(eq(callTable.id, id), isNull(callTable.endedAt)))
    .limit(1);
  return open.length > 0;
}

/**
 * Deletes an ended call and its turns (call_message cascades). A live call is
 * refused: its tab keeps writing turns against the row. Threads keep a dangling
 * `callId`, which reads as "not on the line".
 */
export async function deleteCall(id: string): Promise<boolean> {
  const removed = await database
    .delete(callTable)
    .where(and(eq(callTable.id, id), isNotNull(callTable.endedAt)))
    .returning({ id: callTable.id });
  return removed.length > 0;
}

/**
 * Closes the calls nobody holds any more: at boot every call the last process left open,
 * and when the last tab goes, every call but those the server holds itself (`held`: a
 * conversation kept for a phone, reach).
 */
export async function sweepCalls(held: string[] = []) {
  await database
    .update(callTable)
    .set({ endedAt: new Date() })
    .where(
      and(
        isNull(callTable.endedAt),
        held.length ? notInArray(callTable.id, held) : undefined,
      ),
    );
}

/**
 * A page of past calls, newest first, with all their turns. The cursor is a
 * timestamp, not an offset, because the list grows from the top while paging.
 * Empty calls are dropped by the join, not afterwards: a short page means
 * "last page" to the pager.
 */
export async function listCallHistory(options: {
  before: Date | null;
  limit?: number;
}): Promise<CallRecord[]> {
  const limit = options.limit ?? CALL_HISTORY_PAGE;

  const calls = await database
    .select({
      id: callTable.id,
      provider: callTable.provider,
      model: callTable.model,
      backendModel: callTable.backendModel,
      startedAt: callTable.startedAt,
      endedAt: callTable.endedAt,
      endedReason: callTable.endedReason,
      seconds: callTable.seconds,
    })
    .from(callTable)
    .innerJoin(callMessageTable, eq(callMessageTable.callId, callTable.id))
    .where(options.before ? lt(callTable.startedAt, options.before) : undefined)
    .groupBy(callTable.id)
    .orderBy(desc(callTable.startedAt))
    .limit(limit);

  if (calls.length === 0) return [];

  // Ordered by `seq` (spoken order), not `at`: a user turn is transcribed after
  // the answer it caused has started.
  const rows = await database
    .select({
      callId: callMessageTable.callId,
      id: callMessageTable.id,
      role: callMessageTable.role,
      tool: callMessageTable.tool,
      text: callMessageTable.text,
      seq: callMessageTable.seq,
      fragments: callMessageTable.fragments,
      at: callMessageTable.at,
    })
    .from(callMessageTable)
    .where(
      inArray(
        callMessageTable.callId,
        calls.map((call) => call.id),
      ),
    )
    .orderBy(asc(callMessageTable.callId), asc(callMessageTable.seq));

  const turns = new Map<string, CallRecord["turns"]>();
  for (const row of rows) {
    const { callId, ...turn } = row;
    const held = turns.get(callId);
    if (held) held.push(turn);
    else turns.set(callId, [turn]);
  }

  // A job belongs to the call that opened it, and this is how the log still says
  // what became of it once the call is over.
  const jobs = await listCallJobs(calls.map((call) => call.id));

  return calls.map((call) => ({
    ...call,
    turns: turns.get(call.id) ?? [],
    jobs: jobs
      .filter((job) => job.callId === call.id)
      .map((job) => ({
        id: job.id,
        label: job.label,
        status: job.status,
        outcome: job.outcome,
      })),
  }));
}

/**
 * Every call that has ended, and its turns (cascade). A call still on the line
 * stays: its tab is still writing turns against the row (see `deleteCall`).
 */
export async function deleteEndedCalls(endedBefore?: Date): Promise<number> {
  const over = isNotNull(callTable.endedAt);
  const removed = await database
    .delete(callTable)
    .where(endedBefore ? and(over, lt(callTable.endedAt, endedBefore)) : over)
    .returning({ id: callTable.id });
  return removed.length;
}
