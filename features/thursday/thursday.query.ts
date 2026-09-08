import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
} from "drizzle-orm";
import { database } from "@/database/db";
import { callMessageTable, callTable } from "@/database/tables";
import { estimateTokens } from "@/lib/tokens";
import {
  CALL_HISTORY_PAGE,
  type CallRecord,
  type CallTurn,
} from "./thursday.schema";

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

  return calls.map((call) => ({
    ...call,
    turns: turns.get(call.id) ?? [],
  }));
}

// What the memory tidy pass (features/memory/memory.tidy) reads and stamps.

/** The whole conversation of one call in spoken order, without tool turns. */
export async function listCallTranscript(callId: string) {
  const [call] = await database
    .select({ startedAt: callTable.startedAt, endedAt: callTable.endedAt })
    .from(callTable)
    .where(eq(callTable.id, callId));
  if (!call) return null;
  const turns = await database
    .select({ role: callMessageTable.role, text: callMessageTable.text })
    .from(callMessageTable)
    .where(
      and(
        eq(callMessageTable.callId, callId),
        inArray(callMessageTable.role, ["user", "assistant"]),
      ),
    )
    .orderBy(asc(callMessageTable.seq));
  return {
    ...call,
    turns: turns.map((row) => ({
      role: row.role as "user" | "assistant",
      text: row.text,
    })),
  };
}

/**
 * Ended calls the tidy pass has not read, oldest first, sized in transcript
 * tokens. Measured on the text, not a row count: a greeting and an hour's
 * talk are both one call. A call with no user turn is not owed: nothing was said.
 */
export async function listUntidiedCalls(): Promise<
  { id: string; startedAt: Date; endedAt: Date; tokens: number }[]
> {
  const rows = await database
    .select({
      id: callTable.id,
      startedAt: callTable.startedAt,
      endedAt: callTable.endedAt,
      role: callMessageTable.role,
      text: callMessageTable.text,
    })
    .from(callTable)
    .innerJoin(callMessageTable, eq(callMessageTable.callId, callTable.id))
    .where(
      and(
        isNotNull(callTable.endedAt),
        isNull(callTable.tidiedAt),
        inArray(callMessageTable.role, ["user", "assistant"]),
      ),
    )
    .orderBy(asc(callTable.startedAt));

  const calls = new Map<
    string,
    {
      id: string;
      startedAt: Date;
      endedAt: Date;
      tokens: number;
      spoke: boolean;
    }
  >();
  for (const row of rows) {
    if (!row.endedAt) continue;
    const call = calls.get(row.id) ?? {
      id: row.id,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      tokens: 0,
      spoke: false,
    };
    call.tokens += estimateTokens(row.text);
    if (row.role === "user") call.spoke = true;
    calls.set(row.id, call);
  }
  return [...calls.values()]
    .filter((call) => call.spoke)
    .map(({ spoke: _, ...call }) => call);
}

export async function markCallTidied(id: string) {
  await database
    .update(callTable)
    .set({ tidiedAt: new Date() })
    .where(eq(callTable.id, id));
}

/** Stamps every ended call as read, so a pass switched on starts from now. */
export async function stampCallsTidied() {
  await database
    .update(callTable)
    .set({ tidiedAt: new Date() })
    .where(and(isNotNull(callTable.endedAt), isNull(callTable.tidiedAt)));
}
