import { desc, eq, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { database } from "@/database/db";
import { memoryTidyRunTable } from "@/database/tables";
import { parseTextModel, type TextModelRef } from "@/features/ai/model.schema";
import type { TokenUsage } from "@/features/bot/bot.schema";
import { readConfig, writeConfig } from "@/features/config/config.query";
import {
  MEMORY_TIDY_KEYS,
  MEMORY_TIDY_LEVEL_DEFAULT,
  type MemoryTidyChange,
  type MemoryTidyLevel,
  MemoryTidyLevelSchema,
  type MemoryTidyRun,
  type MemoryTidyStatus,
} from "./memory.schema";

// Rows of the tidy pass (memory.tidy) and its two settings. Every write here
// signals `memory-tidy`, so the screen and the runner notify the same way.

const changed = () => appEvents.emit({ type: "memory-tidy" });

/** The level as set, or the default when nothing was ever picked. */
export async function readTidyLevel(): Promise<MemoryTidyLevel> {
  const parsed = MemoryTidyLevelSchema.safeParse(
    await readConfig(MEMORY_TIDY_KEYS.level),
  );
  return parsed.success ? parsed.data : MEMORY_TIDY_LEVEL_DEFAULT;
}

export async function writeTidyLevel(level: MemoryTidyLevel) {
  await writeConfig(MEMORY_TIDY_KEYS.level, level);
  changed();
}

/** The picked model, or null for the app default. A pick whose key is gone still reads as a pick; the run falls back. */
export async function readTidyModel(): Promise<TextModelRef | null> {
  return parseTextModel(await readConfig(MEMORY_TIDY_KEYS.model));
}

/** Empty clears the pick. */
export async function writeTidyModel(ref: TextModelRef | null) {
  await writeConfig(
    MEMORY_TIDY_KEYS.model,
    ref ? `${ref.provider}/${ref.model}` : "",
  );
  changed();
}

export async function insertTidyRun(input: {
  provider: string;
  model: string;
  callIds: string[];
}): Promise<MemoryTidyRun> {
  const [run] = await database
    .insert(memoryTidyRunTable)
    .values({ id: crypto.randomUUID(), status: "running", ...input })
    .returning();
  changed();
  return run;
}

export async function updateTidyRun(
  id: string,
  patch: Partial<{
    status: MemoryTidyStatus;
    done: number;
    error: string | null;
    endedAt: Date | null;
  }>,
) {
  await database
    .update(memoryTidyRunTable)
    .set(patch)
    .where(eq(memoryTidyRunTable.id, id));
  changed();
}

/** Appends to the log; read-modify-write is safe because one pass runs at a time (memory.tidy). */
export async function appendTidyChanges(id: string, more: MemoryTidyChange[]) {
  if (!more.length) return;
  const [row] = await database
    .select({ changes: memoryTidyRunTable.changes })
    .from(memoryTidyRunTable)
    .where(eq(memoryTidyRunTable.id, id));
  if (!row) return;
  await database
    .update(memoryTidyRunTable)
    .set({ changes: [...row.changes, ...more] })
    .where(eq(memoryTidyRunTable.id, id));
  changed();
}

export async function addTidyUsage(id: string, usage: TokenUsage) {
  await database
    .update(memoryTidyRunTable)
    .set({
      inputTokens: sql`${memoryTidyRunTable.inputTokens} + ${usage.input}`,
      outputTokens: sql`${memoryTidyRunTable.outputTokens} + ${usage.output}`,
    })
    .where(eq(memoryTidyRunTable.id, id));
}

export async function findRunningTidyRun(): Promise<MemoryTidyRun | null> {
  const [run] = await database
    .select()
    .from(memoryTidyRunTable)
    .where(eq(memoryTidyRunTable.status, "running"))
    .orderBy(desc(memoryTidyRunTable.startedAt))
    .limit(1);
  return run ?? null;
}

/** The newest pass that is not running. */
export async function findLastTidyRun(): Promise<MemoryTidyRun | null> {
  const [run] = await database
    .select()
    .from(memoryTidyRunTable)
    .where(sql`${memoryTidyRunTable.status} != 'running'`)
    .orderBy(desc(memoryTidyRunTable.startedAt))
    .limit(1);
  return run ?? null;
}

/** Rows a previous process left running are not running now. */
export async function stopStaleTidyRuns(reason: string) {
  await database
    .update(memoryTidyRunTable)
    .set({ status: "stopped", error: reason, endedAt: new Date() })
    .where(eq(memoryTidyRunTable.status, "running"));
}
