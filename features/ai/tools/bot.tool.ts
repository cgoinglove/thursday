import { stat } from "node:fs/promises";
import { tool } from "ai";
import * as z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { pathsIn } from "@/features/workspace/file-kind";
import { insideWorkspace } from "@/features/workspace/workspace";

/**
 * Specs for the tools that move work between the voice session and bots. Only what the model
 * sees lives here; execution belongs to whoever runs the tool (load-tools, bot.run), and the
 * screen draws a call off its spec (task.query). `report` has its own execute because what it
 * checks is a file on disk.
 */

export const delegateSpec = {
  name: TOOL_NAMES.delegate,
  description:
    "Hand a job to a bot. Returns immediately; the job runs in the background and its result is put in front of you later.",
  parameters: z.object({
    bot: z.string().describe("A name from the bot list."),
    request: z
      .string()
      .describe(
        "The whole job. The bot cannot hear the call, so everything it needs goes here — names, paths, what the user actually asked for — in their own language and their own words: it is the only language the bot has, and whatever it writes comes back to them. **Their request, never your reading of it**: a condition, a caution or a smaller goal they did not say is how a job comes back as the wrong thing. When their words leave a real choice open, ask them on the call and put the answer here.",
      ),
    // Required: two jobs are often open at once and this prefixes every line of both on screen
    label: z
      .string()
      .describe(
        "Two or three words naming the job, in the user's language. Used on screen and said out loud.",
      ),
  }),
};

/**
 * `context` carries what the asking bot found, since its thread is not handed over (bot.run).
 * `request` is a brief, not a line: the borrowed bot sees nothing else.
 */
export const askBotSpec = {
  name: TOOL_NAMES.ask_bot,
  description:
    "Hand one part of the job you are holding to another bot and wait for what they bring back. The job stays yours.",
  parameters: z.object({
    bot: z.string().describe("A name from the bot list."),
    request: z
      .string()
      .describe(
        "The part they take, as a brief: the outcome you want, the shape to hand it back in (a path, a number, a list), and every name, path, number and limit that bears on it. They see nothing but this and `context` — not the call, not your thread — so write it long rather than short; a brief that leaves them guessing costs a whole run.",
      ),
    context: z
      .string()
      .describe(
        "The job you were given, quoted, and whatever you have found that bears on this part — exact values, and the paths of files you wrote for them to read. They cannot see your work, your tool output, or the call.",
      ),
  }),
};

/**
 * The borrowed bot's one way up. The borrowing bot answers in one model call over its own
 * context, without tools (bot.run answerBack); nothing stops. No options, since nobody reads
 * these aloud; the count is structural (bot.run MAX_ASK_BACK).
 */
export const askBackSpec = {
  name: TOOL_NAMES.ask_back,
  description:
    "Ask the bot that handed you this part. They answer from what they have — the original request, the call it came from, what they found before asking you.",
  parameters: z.object({
    question: z
      .string()
      .describe(
        "One whole question — what you need and why. They cannot take it to the user for you, so ask what they would know.",
      ),
  }),
};

/**
 * A bot stopping in front of something it cannot get on its own. No `execute` on purpose:
 * the loop halts on a tool without one (ai-sdk), the run is stored as `waiting`, and the
 * answer returns as this call's result on resume (bot.runner). Only the bot holding the job
 * may ask. Options are the one structure that works both on screen and read aloud; there is
 * no input type.
 */
export const askThursdaySpec = {
  name: TOOL_NAMES.ask_thursday,
  description:
    "Ask Thursday, who handed you this job. The job stops until an answer comes back.",
  parameters: z.object({
    question: z
      .string()
      .describe(
        "One whole question — what you need and why. One or two sentences, in the user's language: she may read it to them out loud, options and all.",
      ),
    // A string is accepted as well as an array: a provider may serialize the array as one
    // joined string, and a schema rejection only loops. The reader takes arrays only (task.query optionsOf)
    options: z
      .union([z.string().array(), z.string()])
      .nullish()
      .describe(
        'Only when there really are choices — two or three, each short, as an array: ["Signed in", "Not yet"]. Null for an open question.',
      ),
  }),
};

/**
 * The one way a run ends on its own terms; the loop is stopped by it (`hasToolCall`, bot.run).
 * `complete` cannot be inferred: a run out of steps and a finished run look the same from outside.
 * `notes` is what the bot wants changed about its own instructions, in its own words — never
 * the text itself. A bot that rewrites the whole thing here edits it around the job it was on
 * and drops what that job was not about; a pass of its own writes it (features/bot/bot.notes).
 */
export const reportSpec = (notes: boolean) => ({
  name: TOOL_NAMES.report,
  description:
    "Hand back what the job produced. Calling this ends the job — nothing after it runs.",
  parameters: z.object({
    result: z
      .string()
      .describe(
        "The result itself, in a few lines — what you found or did, not a replay of how. Thursday reads this out loud, so write what a person needs to hear. If you could not do it, say what stopped you.",
      ),
    complete: z
      .boolean()
      .describe(
        "True when the whole request is done. False when work is left over — the user is then asked whether to keep going, and `result` is what they decide on.",
      ),
    ...(notes
      ? {
          notes: reportNotes,
        }
      : {}),
  }),
});

/** Only attached while Settings > Bots keeps them (bot.schema BOT_NOTES_KEY). */
const reportNotes = z
  .string()
  .nullish()
  .describe(
    'How your own instructions should change after this job — what to do to them, not the text itself: someone else writes it in, and the next job you run here reads the result. Say it the way you would ask a person: "add that a browser here needs --no-sandbox or it exits", "the line saying the tests run with npm is wrong, it is pnpm", "drop the part about the old api folder, it is gone". Null when nothing came up that they do not already say.',
  );

/** The voice session's handle on a job already handed over. Run by the server, like `delegate` (load-tools). */
export const taskSpec = {
  name: TOOL_NAMES.task,
  description:
    "Check a job you handed over, answer what it is asking, or cancel it.",
  parameters: z.object({
    action: z.enum(["status", "answer", "cancel"]),
    task: z
      .string()
      .nullish()
      .describe(
        "The job, by its label or by the handle a past call's transcript carries. With `status`: null for every job in one line each — that is the list — or name one to get its report in full.",
      ),
    answer: z
      .string()
      .nullish()
      .describe(
        "With `answer`: what to tell the bot — the answer to its question, a course correction for a job still running, or what to do next on one that finished.",
      ),
  }),
};

/** Deliberately no `execute` — the loop halts here. See askThursdaySpec. */
export const askThursdayTool = tool({
  description: askThursdaySpec.description,
  inputSchema: askThursdaySpec.parameters,
});

/**
 * `report` does have an execute, and it only acknowledges. The loop is stopped
 * by `hasToolCall` after the step, not by the absence of an execute — that way
 * the call and its result are both written to the thread, and a resumed run
 * reads a finished exchange rather than a call left hanging.
 */
export const createReportTool = (notes: boolean) => {
  const spec = reportSpec(notes);
  return tool({
    description: spec.description,
    inputSchema: spec.parameters,
    execute: async ({ result, complete }) => {
      const missing = await missingFiles(result);
      if (missing.length) {
        return `${NOT_HANDED_BACK} these files do not exist — ${missing.join(", ")}. Write them first, or take the paths out of the result.`;
      }
      return complete
        ? "Handed back. The job is closed; nothing further runs."
        : "Handed back as unfinished. The user decides whether to continue.";
    },
  });
};

/**
 * A report naming a workspace file that does not exist is refused: the path becomes a link
 * and opens by itself (bot.runner artifactIn). Paths outside the workspace are not checked.
 */
const NOT_HANDED_BACK = "Not handed back:";

export const reportAccepted = (output: unknown): boolean =>
  typeof output !== "string" || !output.startsWith(NOT_HANDED_BACK);

async function missingFiles(result: string): Promise<string[]> {
  const missing: string[] = [];
  for (const rel of pathsIn(result)) {
    const full = await insideWorkspace(rel);
    if (!full) continue;
    const exists = await stat(full).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!exists) missing.push(rel);
  }
  return missing;
}
