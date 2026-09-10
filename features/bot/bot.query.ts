import { eq, inArray, sql } from "drizzle-orm";
import { BOT_NOTES } from "@/config";
import { database } from "@/database/db";
import {
  botMcpToolTable,
  botNoteTable,
  botTable,
  mcpToolTable,
  taskTable,
} from "@/database/tables";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import { readConfig, writeConfig } from "@/features/config/config.query";
import {
  BOT_NOTES_KEY,
  type BotForm,
  type BotIcon,
  DEFAULT_BOT,
  isBotNotesOn,
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
  const [bots, pins, spent, notes] = await Promise.all([
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
    database.select().from(botNoteTable),
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
  const noteOf = new Map(notes.map((row) => [row.bot, row]));
  return bots.map((bot) => ({
    ...bot,
    tools: byBot.get(bot.name) ?? [],
    tokens: tokensOf.get(bot.name) ?? { input: 0, output: 0 },
    lastJobAt: lastJobOf.get(bot.name) ?? null,
    note: noteOf.get(bot.name)?.text ?? null,
    noteAt: noteOf.get(bot.name)?.updatedAt ?? null,
  }));
}

// A bot's own notes. Nothing here belongs to a job: the row survives every job
// the bot runs and is read back into its next prompt (ai/prompts/bot.prompt).

/** What this bot has written to itself. Keyed by name, so DEFAULT_BOT has one too. */
export async function readBotNote(bot: string): Promise<string | null> {
  const [row] = await database
    .select({ text: botNoteTable.text })
    .from(botNoteTable)
    .where(eq(botNoteTable.bot, bot));
  return row?.text ?? null;
}

/**
 * The whole block, as the pass rewrote it (bot.notes). Cut rather than refused: the schema
 * already caps it, and a run that gets this far has handed its answer back. Empty clears it.
 */
export async function writeBotNote(bot: string, text: string): Promise<void> {
  const next = text.trim().slice(0, BOT_NOTES.chars).trim();
  if (!next) return clearBotNote(bot);

  const updatedAt = new Date();
  await database
    .insert(botNoteTable)
    .values({ bot, text: next, updatedAt })
    .onConflictDoUpdate({
      target: botNoteTable.bot,
      set: { text: next, updatedAt },
    });
}

/** Whether any bot keeps its own instructions at all (bot.schema BOT_NOTES_KEY). */
export async function readBotNotesOn(): Promise<boolean> {
  return isBotNotesOn(await readConfig(BOT_NOTES_KEY));
}

export async function writeBotNotesOn(on: boolean): Promise<void> {
  await writeConfig(BOT_NOTES_KEY, on ? "on" : "off");
}

/** The one thing the user does to notes: throw them away when a bot has learned something wrong. */
export async function clearBotNote(bot: string): Promise<void> {
  await database.delete(botNoteTable).where(eq(botNoteTable.bot, bot));
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
  // Notes are keyed by name with no foreign key, so nothing cascades for them.
  await clearBotNote(name);
  return removed.length > 0;
}
