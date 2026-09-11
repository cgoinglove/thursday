import { eq, inArray, sql } from "drizzle-orm";
import { database } from "@/database/db";
import {
  botMcpToolTable,
  botTable,
  mcpToolTable,
  taskTable,
} from "@/database/tables";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import { readConfig, writeConfig } from "@/features/config/config.query";
import {
  BOT_MEMORY_KEY,
  type BotForm,
  type BotIcon,
  DEFAULT_BOT,
  isBotMemoryOn,
  type JobBot,
  type PinnedTool,
  pickedModel,
} from "./bot.schema";

// Bots are keyed by name throughout: it is the primary key and what `delegate` receives.

const asJobBot = (row: {
  name: string;
  description: string;
  systemPrompt: string | null;
  icon: BotIcon | null;
  /** Empty runs on the app default model (bot.run resolveModel). */
  provider: TextModelProviderId | null;
  model: string | null;
  disabled: boolean;
  compactAt: number | null;
}): JobBot => ({
  name: row.name,
  description: row.description,
  systemPrompt: row.systemPrompt,
  icon: row.icon,
  provider: row.provider,
  model: row.model,
  disabled: row.disabled,
  compactAt: row.compactAt,
});

/**
 * Who a job can go to: the user's bots, or DEFAULT_BOT when there are none.
 * Switched-off bots are left out here and nowhere else — this one read is what
 * every prompt's roster and `delegate`'s list are built from, so off is off in
 * all of them without a second rule to keep.
 */
export async function listJobBots(): Promise<JobBot[]> {
  const rows = await database
    .select()
    .from(botTable)
    .orderBy(botTable.createdAt);

  // The fallback answers "no bots exist", never "every bot is off": switching
  // them all off is a choice, and conjuring a worker would undo it.
  return rows.length
    ? rows.filter((row) => !row.disabled).map(asJobBot)
    : [DEFAULT_BOT];
}

/**
 * The bot a job names, switched off or not: a job already under way resumes
 * through here, and refusing it would strand a thread the user can still answer.
 * `delegate` is what checks `disabled`, because that is where a bot is picked.
 *
 * Exact name first, then case-insensitive only; no looser matching. A miss
 * returns null so `delegate` can list the roster instead.
 */
export async function findJobBot(name: string): Promise<JobBot | null> {
  const row = await findBot(name);
  if (row) return asJobBot(row);

  // Case is not a different name: the spoken name arrives through a transcript
  const said = name.trim().toLowerCase();
  const [match] = await database
    .select()
    .from(botTable)
    .where(eq(sql`lower(${botTable.name})`, said));
  if (match) return asJobBot(match);

  // The worker that exists when no row does; it has no row to match against
  return DEFAULT_BOT.name.toLowerCase() === said ? DEFAULT_BOT : null;
}

/** Bots with their pinned tools and token totals: a set of queries plus grouping, not a join. */
export async function findAllBots() {
  const [bots, pins, spent] = await Promise.all([
    database.select().from(botTable).orderBy(botTable.createdAt),
    database
      .select({
        botName: botMcpToolTable.botName,
        id: mcpToolTable.id,
        name: mcpToolTable.name,
        serverName: mcpToolTable.serverName,
      })
      .from(botMcpToolTable)
      .innerJoin(mcpToolTable, eq(botMcpToolTable.toolId, mcpToolTable.id)),
    // Grouped by name; tasks point at bots by name (tables.ts task.bot)
    database
      .select({
        bot: taskTable.bot,
        input: sql<number>`coalesce(sum(${taskTable.inputTokens}), 0)`,
        output: sql<number>`coalesce(sum(${taskTable.outputTokens}), 0)`,
        // Raw max over a timestamp column arrives as integer seconds
        lastJobAt: sql<number | null>`max(${taskTable.updatedAt})`,
      })
      .from(taskTable)
      .groupBy(taskTable.bot),
  ]);

  const byBot = new Map<string, PinnedTool[]>();
  for (const { botName, ...tool } of pins) {
    const list = byBot.get(botName) ?? [];
    list.push(tool);
    byBot.set(botName, list);
  }
  const tokensOf = new Map(
    spent.map((row) => [
      row.bot,
      { input: Number(row.input), output: Number(row.output) },
    ]),
  );
  const lastJobOf = new Map(
    spent.flatMap((row) =>
      row.lastJobAt == null
        ? []
        : [[row.bot, new Date(Number(row.lastJobAt) * 1000)] as const],
    ),
  );
  return bots.map((bot) => ({
    ...bot,
    tools: byBot.get(bot.name) ?? [],
    tokens: tokensOf.get(bot.name) ?? { input: 0, output: 0 },
    lastJobAt: lastJobOf.get(bot.name) ?? null,
  }));
}

/** Whether bots keep their own memory at all (bot.schema BOT_MEMORY_KEY). */
export async function readBotMemoryOn(): Promise<boolean> {
  return isBotMemoryOn(await readConfig(BOT_MEMORY_KEY));
}

export async function writeBotMemoryOn(on: boolean): Promise<void> {
  await writeConfig(BOT_MEMORY_KEY, on ? "on" : "off");
}

export async function findBot(name: string) {
  const [bot] = await database
    .select()
    .from(botTable)
    .where(eq(botTable.name, name));
  return bot ?? null;
}

/** Returns null when the name is taken: two bots with one name would be a coin toss at delegate time. */
export async function createBot(form: BotForm) {
  if (await findBot(form.name)) return null;

  const { toolIds, ...values } = pickedModel(form);
  const [bot] = await database.insert(botTable).values(values).returning();
  await setPinnedTools(bot.name, toolIds);
  return bot;
}

export async function updateBot(name: string, patch: Partial<BotForm>) {
  // The two model fields travel together; normalise only when at least one arrived
  // (pickedModel reads a missing field as null and would clear the other)
  const { toolIds, ...values } =
    "provider" in patch || "model" in patch ? pickedModel(patch) : patch;
  // Renaming would orphan pinned tools and every task sent to the old name, so name is never patched
  delete (values as { name?: string }).name;

  const [bot] = Object.keys(values).length
    ? await database
        .update(botTable)
        .set(values)
        .where(eq(botTable.name, name))
        .returning()
    : await database.select().from(botTable).where(eq(botTable.name, name));
  if (!bot) return null;

  if (toolIds) await setPinnedTools(name, toolIds);
  return bot;
}

/** The pinned set is replaced whole; partial edits drift. */
async function setPinnedTools(botName: string, toolIds: number[]) {
  await database
    .delete(botMcpToolTable)
    .where(eq(botMcpToolTable.botName, botName));
  if (toolIds.length === 0) return;

  // Only ids that still exist: one stale picker entry must not fail the whole save
  const alive = await database
    .select({ id: mcpToolTable.id })
    .from(mcpToolTable)
    .where(inArray(mcpToolTable.id, toolIds));
  if (alive.length === 0) return;

  await database
    .insert(botMcpToolTable)
    .values(alive.map(({ id }) => ({ botName, toolId: id })));
}

export async function deleteBot(name: string) {
  const removed = await database
    .delete(botTable)
    .where(eq(botTable.name, name))
    .returning({ name: botTable.name });
  return removed.length > 0;
}
