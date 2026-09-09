"use server";

import { z } from "zod";
import { textModelProviderSchema } from "@/features/ai/model.schema";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import {
  clearBotNote,
  createBot,
  deleteBot,
  findBot,
  updateBot,
  writeBotNotesOn,
} from "./bot.query";
import {
  answerTask,
  cancelTask,
  removeFinishedTasks,
  removeTask,
  startTask,
} from "./bot.runner";
import { BotFormSchema, botIconSchema } from "./bot.schema";
import { findBotSeed, rollSeedColors } from "./bot.seed";
import { markReported, resolveTask } from "./task.query";

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

/** One seed bot to create; the model fields are optional and only count as a pair. */
const SeedPickSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: textModelProviderSchema.nullish(),
  model: z.string().trim().min(1).max(80).nullish(),
  /** The colour the intro already showed for this bot. Rolled here when the caller had no screen. */
  color: botIconSchema.shape.color,
});

/**
 * Creates seed bots (bot.seed). A taken name is skipped, not an error.
 * No model is resolved here: a half pick (provider or id alone) is emptied by
 * `createBot` and the bot runs on the app default at run time.
 */
export const createSeedBotsAction = serverAction(async (picks: unknown) => {
  const wanted = SeedPickSchema.array().max(20).parse(picks);

  // Seeds carry no colour of their own (bot.seed); one roll covers the whole
  // batch so bots made together never come out the same colour
  const rolled = rollSeedColors();

  const created: string[] = [];
  for (const [at, pick] of wanted.entries()) {
    const seed = findBotSeed(pick.name);
    if (!seed) continue;
    const bot = await createBot({
      name: seed.name,
      description: seed.description,
      systemPrompt: seed.systemPrompt,
      icon: { ...seed.icon, color: pick.color ?? rolled[at % rolled.length] },
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
});

/**
 * Throws away what a bot wrote about itself. The only human touch on notes:
 * they are never edited here, because a line the user typed would come back
 * rewritten by the bot's next report.
 */
export const clearBotNoteAction = serverAction(async (name: string) => {
  await clearBotNote(name);
});

/** Switched off, no bot writes to its own instructions and none is shown one. What is already written stays. */
export const setBotNotesOnAction = serverAction(async (on: unknown) => {
  await writeBotNotesOn(on === true);
});

// Tasks are opened by the `delegate` tool during a call, or here when the user
// hands one over from the screen. Each returns at once, the run itself continues
// in bot.runner behind `after()`.

/** Words a label keeps; the rest of the message is the request, which the bot reads in full. */
const LABEL_WORDS = 4;

/** Two or three words naming the job, the same shape `delegate` asks the model for. */
function labelFor(request: string): string {
  const words = request.replace(/\s+/g, " ").trim().split(" ");
  const head = words.slice(0, LABEL_WORDS).join(" ");
  return (words.length > LABEL_WORDS ? `${head}…` : head).slice(0, 60);
}

/**
 * Hands a bot a job from the screen, with no call in the room. The typed message
 * is the whole request — there is no conversation to draw the rest from, which is
 * why the box asks for a sentence rather than a word.
 */
export const startTaskAction = serverAction(
  async (bot: string, request: string) => {
    const said = request.trim();
    if (!said) publicError("Nothing to hand over.");
    const worker = await findBot(bot);
    if (!worker) publicError(`No bot called "${bot}".`);
    const label = labelFor(said);
    const id = await startTask({ bot: worker.name, request: said, label });
    return { id, label, bot: worker.name };
  },
);

export const answerTaskAction = serverAction(
  async (ref: string, answer: string) => {
    const task = await resolveTask(ref);
    if (!task) publicError(`No job called "${ref}".`);
    if (!answer.trim()) publicError("Nothing to tell it.");
    await answerTask(task.id, answer.trim());
    return { id: task.id, label: task.label, status: "running" as const };
  },
);

export const cancelTaskAction = serverAction(async (ref: string) => {
  const task = await resolveTask(ref);
  if (!task) publicError(`No job called "${ref}".`);
  await cancelTask(task.id);
  return { id: task.id, label: task.label, status: "cancelled" as const };
});

/** Marks tasks as relayed to the call, clearing their inbox dot. Batched because a call opening relays everything pending at once. */
export const markReportedAction = serverAction(async (ids: string[]) => {
  await markReported(ids.filter((id) => typeof id === "string" && id));
});

export const deleteTaskAction = serverAction(async (id: string) => {
  if (!(await removeTask(id))) publicError("Task not found");
});

/** Empties the log of what is over. Running and waiting jobs are not touched. */
export const clearFinishedTasksAction = serverAction(async () => {
  return { removed: await removeFinishedTasks() };
});
