import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { CALL_HISTORY_PAGE } from "@/config";
import { database } from "@/database/db";
import { callMessageTable, callTable } from "@/database/tables";
import { listCallJobs } from "@/features/bot/task.query";
import { readConfig, writeConfig } from "@/features/config/config.query";
import type { SpeachModelProviderId } from "@/lib/realtime/realtime.schema";
import {
  type CallRecord,
  type CallTranscript,
  type CallTurn,
  isSkillsOn,
  isTranscriptOn,
  THURSDAY_KEYS,
  TranscriptionModelsSchema,
} from "./thursday.schema";

/**
 * Whether the call is handed `load_skill` (Settings › Thursday). Off unless
 * switched on: reading a skill mid-call spends the session's context on a page
 * of instructions. Read where the tool set is built (ai/load-tools) and where
 * the prompt lists what she can read (ai/prompts/thursday.prompt).
 */
export async function readCallSkillsOn(): Promise<boolean> {
  return isSkillsOn(await readConfig(THURSDAY_KEYS.skills));
}

export async function writeCallSkillsOn(on: boolean) {
  await writeConfig(THURSDAY_KEYS.skills, on ? "on" : "off");
}

/**
 * Whether the user's side of a call is written down (Settings › Thursday ›
 * Transcript). Read where a call opens, where its prompt and tools are built,
 * and where a job it hands over is opened.
 */
export async function readCallTranscriptOn(): Promise<boolean> {
  return isTranscriptOn(await readConfig(THURSDAY_KEYS.transcript));
}

export async function readCallTranscript(): Promise<CallTranscript> {
  const [on, models] = await Promise.all([
    readCallTranscriptOn(),
    readConfig(THURSDAY_KEYS.transcriptionModel),
  ]);
  return { on, models: parseTranscriptionModels(models) };
}

export async function writeCallTranscriptOn(on: boolean) {
  await writeConfig(THURSDAY_KEYS.transcript, on ? "on" : "off");
}

/** Null goes back to the provider's first model. */
export async function writeTranscriptionModel(
  provider: SpeachModelProviderId,
  model: string | null,
) {
  const { models } = await readCallTranscript();
  await writeConfig(
    THURSDAY_KEYS.transcriptionModel,
    JSON.stringify({ ...models, [provider]: model ?? undefined }),
  );
}

/** The key can also come from env, where anything may be written: a bad value is no picks. */
function parseTranscriptionModels(
  value: string | undefined,
): CallTranscript["models"] {
  if (!value) return {};
  try {
    return TranscriptionModelsSchema.parse(JSON.parse(value));
  } catch {
    return {};
  }
}

export async function insertCall(input: { provider: string; model: string }) {
  const [call] = await database
    .insert(callTable)
    .values({ id: crypto.randomUUID(), ...input })
    .returning({ id: callTable.id });
  return call.id;
}

/** Ends the call; false if it already ended, so end-of-call work runs once. */
export async function endCall(id: string): Promise<boolean> {
  const ended = await database
    .update(callTable)
    .set({ endedAt: new Date() })
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
      .values({ callId, ...turn })
      .onConflictDoUpdate({
        target: [callMessageTable.callId, callMessageTable.id],
        set: { text: turn.text, role: turn.role, tool: turn.tool ?? null },
      });
  }
}

export type CallGroup = {
  callId: string;
  startedAt: Date;
  turns: {
    role: "user" | "assistant" | "tool";
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

/** The last spoken turns of one call in order, without tool turns. */
export async function listCallTurns(
  callId: string,
  limit: number,
): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const rows = await database
    .select({ role: callMessageTable.role, text: callMessageTable.text })
    .from(callMessageTable)
    .where(
      and(
        eq(callMessageTable.callId, callId),
        inArray(callMessageTable.role, ["user", "assistant"]),
      ),
    )
    .orderBy(desc(callMessageTable.seq))
    .limit(limit);
  return rows
    .reverse()
    .map((row) => ({ role: row.role as "user" | "assistant", text: row.text }));
}

/**
 * One page of a call, every turn in order, tool turns included; null when the
 * call is gone. Tool turns keep their name and nothing else is read by the
 * caller (ai/tools/memory.tool), but the row carries it all.
 */
export async function readCallConversation(
  callId: string,
  page: number,
  size: number,
): Promise<{
  startedAt: Date;
  total: number;
  turns: {
    role: "user" | "assistant" | "tool";
    tool: string | null;
    text: string;
  }[];
} | null> {
  const [call] = await database
    .select({ startedAt: callTable.startedAt })
    .from(callTable)
    .where(eq(callTable.id, callId));
  if (!call) return null;

  const [counted] = await database
    .select({ total: sql<number>`count(*)` })
    .from(callMessageTable)
    .where(eq(callMessageTable.callId, callId));
  const turns = await database
    .select({
      role: callMessageTable.role,
      tool: callMessageTable.tool,
      text: callMessageTable.text,
    })
    .from(callMessageTable)
    .where(eq(callMessageTable.callId, callId))
    .orderBy(asc(callMessageTable.seq))
    .limit(size)
    .offset((page - 1) * size);
  return {
    startedAt: call.startedAt,
    total: Number(counted?.total ?? 0),
    turns,
  };
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

/**
 * Deletes an ended call and its turns (call_message cascades). A live call is
 * refused: its tab keeps writing turns against the row. Tasks keep a dangling
 * `callId`, which reads as "not on the line".
 */
export async function deleteCall(id: string): Promise<boolean> {
  const removed = await database
    .delete(callTable)
    .where(and(eq(callTable.id, id), isNotNull(callTable.endedAt)))
    .returning({ id: callTable.id });
  return removed.length > 0;
}

/** Closes calls the previous process left open. Runs once at boot. */
export async function sweepCalls() {
  await database
    .update(callTable)
    .set({ endedAt: new Date() })
    .where(isNull(callTable.endedAt));
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
      startedAt: callTable.startedAt,
      endedAt: callTable.endedAt,
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
export async function deleteEndedCalls(): Promise<number> {
  const removed = await database
    .delete(callTable)
    .where(isNotNull(callTable.endedAt))
    .returning({ id: callTable.id });
  return removed.length;
}
