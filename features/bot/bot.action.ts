"use server";

import { z } from "zod";
import { BOT_ROSTER } from "@/config";
import { textModelProviderSchema } from "@/features/ai/model.schema";
import { removeBotFolder } from "@/features/workspace/workspace";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import {
  clearOwnLine,
  countBots,
  createBot,
  deleteBot,
  findJobBot,
  updateBot,
  writeBotMemoryOn,
} from "./bot.query";
import {
  answerThread,
  askCompact,
  cancelThread,
  removeFinishedThreads,
  removeThread,
  startThread,
} from "./bot.runner";
import { BotFormSchema, botIconSchema } from "./bot.schema";
import { BOT_SEEDS, findBotSeed, rollSeedIcons } from "./bot.seed";
import { acceptRoomRelays, withdrawDelivery } from "./room.query";
import { markSeen, resolveThread } from "./thread.query";

export const createBotAction = serverAction(async (input: unknown) => {
  const form = BotFormSchema.parse(input);
  const bot = await createBot(form);
  if (!bot) publicError(`"${form.name}" already exists`);
  return { name: bot.name };
});

export const updateBotAction = serverAction(
  async (name: string, patch: unknown) => {
    const parsed = BotFormSchema.partial().parse(patch);
    if (!(await updateBot(name, parsed))) publicError("Bot not found");
  },
);

/** The user clears the line a bot wrote after its description (self.tool). */
export const clearOwnLineAction = serverAction(async (name: string) => {
  if (!(await clearOwnLine(name))) publicError("Bot not found");
});

/** One seed bot to create; the model fields are optional and only count as a pair. */
const SeedPickSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: textModelProviderSchema.nullish(),
  model: z.string().trim().min(1).max(80).nullish(),
  /** The face the intro already showed for this bot. Rolled here when the caller had no screen. */
  icon: botIconSchema.optional(),
});

/**
 * Creates seed bots (bot.seed). A taken name is skipped, not an error, and seeds past
 * BOT_ROSTER.max are left out in list order: a key saved on the call screen offers every
 * seed to a roster that may already be nearly full.
 * No model is resolved here: a half pick (provider or id alone) is emptied by
 * `createBot` and the bot runs on the app default at run time.
 */
export const createSeedBotsAction = serverAction(async (picks: unknown) => {
  const wanted = SeedPickSchema.array().max(20).parse(picks);
  const room = BOT_ROSTER.max - (await countBots());

  // Seeds carry no face of their own (bot.seed); one roll covers the whole batch
  // so bots made together never come out looking alike. Read by the seed's own
  // place in the list rather than the caller's order, because one face in it is
  // fixed (Jarvis) and a shorter pick list would hand it to another bot
  const rolled = rollSeedIcons();

  const created: string[] = [];
  for (const pick of wanted) {
    if (created.length >= room) break;
    const seed = findBotSeed(pick.name);
    if (!seed) continue;
    const bot = await createBot({
      name: seed.name,
      description: seed.description,
      systemPrompt: seed.systemPrompt,
      icon: pick.icon ?? rolled[BOT_SEEDS.indexOf(seed)],
      provider: pick.provider,
      model: pick.model,
      toolIds: [],
    });
    if (bot) created.push(bot.name);
  }
  return { created };
});

export const deleteBotAction = serverAction(async (name: string) => {
  if (!(await deleteBot(name))) publicError("Bot not found");
  // The row is not the whole bot: what it kept is on disk under its name
  await removeBotFolder(name);
});

/** Switched off, no bot is shown its own memory. What is already written stays on disk. */
export const setBotMemoryOnAction = serverAction(async (on: unknown) => {
  await writeBotMemoryOn(on === true);
});

// Threads are opened by the `delegate` tool during a call, or here when the user
// hands one over from the screen. Each returns at once, the run itself continues
// as promises held by bot.runner.

/** Words a label keeps; the rest of the message is the request, which the bot reads in full. */
const LABEL_WORDS = 4;

/** Two or three words naming the job, the same shape `delegate` asks the model for. */
function labelFor(request: string): string {
  const words = request.replace(/\s+/g, " ").trim().split(" ");
  const head = words.slice(0, LABEL_WORDS).join(" ");
  return (words.length > LABEL_WORDS ? `${head}…` : head).slice(0, 60);
}

/** Takes back words the user stepped in with, before the bot reads them (room.query withdrawDelivery). */
export const withdrawStepInAction = serverAction(
  async (threadId: unknown, key: unknown) => {
    const gone = await withdrawDelivery(
      z.string().min(1).parse(threadId),
      z.string().min(1).parse(key),
    );
    if (!gone) publicError("It has already read that.");
  },
);

/**
 * Hands a bot a job from the screen, with no call in the room. The typed message
 * is the whole request — there is no conversation to draw the rest from, which is
 * why the box asks for a sentence rather than a word.
 */
export const startThreadAction = serverAction(
  async (bot: string, request: string) => {
    const said = request.trim();
    if (!said) publicError("Nothing to hand over.");
    // Resolved as a delegated job is, so an install with no bots still has its worker
    const worker = await findJobBot(bot);
    if (!worker || worker.disabled)
      publicError(`No enabled bot called "${bot}".`);
    const label = labelFor(said);
    const id = await startThread({
      bot: worker.name,
      request: said,
      label,
      from: "user",
    });
    return { id, label, bot: worker.name };
  },
);

export const answerThreadAction = serverAction(
  async (ref: string, answer: string, recipient?: string, replyTo?: string) => {
    const thread = await resolveThread(ref);
    if (!thread) publicError(`No job called "${ref}".`);
    if (!answer.trim()) publicError("Nothing to tell it.");
    await answerThread(thread.id, answer.trim(), "user", recipient, replyTo);
    return { id: thread.id, label: thread.label, status: "running" as const };
  },
);

/** The user asks a bot's desk in a thread to summarize itself at its next step (bot.runner askCompact). */
export const compactThreadAction = serverAction(
  async (id: unknown, bot: unknown) => {
    askCompact(z.string().min(1).parse(id), z.string().min(1).parse(bot));
  },
);

export const cancelThreadAction = serverAction(async (ref: string) => {
  const thread = await resolveThread(ref);
  if (!thread) publicError(`No job called "${ref}".`);
  await cancelThread(thread.id);
  return { id: thread.id, label: thread.label, status: "cancelled" as const };
});

/** Marks threads as read by the user: opened on screen. Their relays are settled with them (thread.query markSeen). */
export const markSeenAction = serverAction(async (ids: string[]) => {
  await markSeen(ids.filter((id) => typeof id === "string" && id));
});

export const deleteThreadAction = serverAction(async (id: string) => {
  if (!(await removeThread(id))) publicError("Thread not found");
});

/** Empties the log of what is over. Running and waiting jobs are not touched. */
export const clearFinishedThreadsAction = serverAction(async () => {
  return { removed: await removeFinishedThreads() };
});

export const acceptThreadRelaysAction = serverAction(async (ids: unknown) => {
  await acceptRoomRelays(z.number().int().positive().array().parse(ids));
});
