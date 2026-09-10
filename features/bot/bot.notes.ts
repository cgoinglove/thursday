import {
  generateText,
  hasToolCall,
  type LanguageModel,
  stepCountIs,
  tool,
} from "ai";
import * as z from "zod";
import { BOT_NOTES } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { logger } from "@/lib/logger";
import { createKeyedLock } from "@/lib/queue";
import { readBotNote, writeBotNote } from "./bot.query";

/**
 * Keeping a bot's own notes — the block of instructions it writes to itself, carried into
 * every job of its own (ai/prompts/bot.prompt).
 *
 * The bot never writes the block. It says what it wants changed, in its own words, on
 * `answer` (ai/tools/bot.tool `notes`), and this rewrites the block from that. Two models
 * because they are two jobs: a bot that has just finished work edits around the work, while
 * a model handed one document and three change requests does what it was handed. Same model
 * the job ran on, no system prompt, one tool, forced.
 *
 * Serialized per bot, which is the whole of the concurrency story: two jobs of one bot
 * finishing together queue, and the second reads the block the first wrote.
 */

/** One bot at a time. Without it two passes read the same block and one of them is lost. */
const lane = createKeyedLock();

/** No request, no pass: a job that taught nothing must not cost a model call. */
export const hasNotesRequest = (want: string | null): boolean =>
  Boolean(want?.trim());

export type KeepNotesInput = {
  /** The bot whose notes these are; DEFAULT_BOT keeps them like any other. */
  bot: string;
  /** The model the job itself ran on (bot.run resolveModel). */
  model: LanguageModel;
  /** What the bot asked for, in its own words (ai/tools/bot.tool `notes`). */
  want: string;
  signal?: AbortSignal;
};

/**
 * Applies one job's request. Resolves to the block as it now stands — and to what it was
 * when the pass could not run: notes are never worth failing a job that already reported.
 */
export async function keepNotes(input: KeepNotesInput): Promise<string | null> {
  return lane(input.bot, async () => {
    const current = await readBotNote(input.bot);
    let kept = current;

    try {
      await generateText({
        model: input.model,
        messages: [{ role: "user", content: briefing(current, input.want) }],
        abortSignal: input.signal,
        tools: {
          [TOOL_NAMES.update_notes]: tool({
            description: "Hand back the updated prompt.",
            inputSchema: z.object({
              prompt: z
                .string()
                .max(BOT_NOTES.chars)
                .describe(
                  `The whole prompt as it should now read, at most ${BOT_NOTES.chars} characters.`,
                ),
            }),
            execute: async ({ prompt }) => {
              await writeBotNote(input.bot, prompt);
              kept = prompt.trim() || null;
              return "Saved.";
            },
          }),
        },
        toolChoice: "required",
        stopWhen: [
          stepCountIs(BOT_NOTES.steps),
          hasToolCall(TOOL_NAMES.update_notes),
        ],
      });
    } catch (cause) {
      // Never the job's problem: its answer is already handed back.
      logger.warn(`notes pass for ${input.bot} failed: ${cause}`);
    }
    return kept;
  });
}

/**
 * The whole instruction, as one user turn. No system prompt: there is one document, three
 * change requests, and one thing to do with them. A persona above that only invites the
 * model to have views about the worker instead of editing the text it was handed.
 */
function briefing(current: string | null, want: string): string {
  return `You keep one worker's notes. It is an agent with a shell on this machine; the notes are its own, read at the start of every job it runs and by nobody else. They hold what this machine has taught it — the command that works here, the flag without which something fails, the tool this platform does not have. Write what the worker found, never what it proposed.

Four things do not belong, however true today: what is in a folder right now, what a job produced, anything about the person the work is for, and how to satisfy the worker's own tools (\`answer\`, \`write_file\`, \`bash\` — those belong to the app it runs inside and change with it). A program *on the machine* is the opposite and does belong.

Nor does how the worker should behave. Whoever owns it writes that separately and it outranks these, so a note about manner or language is either already said or about to be overruled.

The change is applied to what is already there, not written over it. Say the notes read \`Tests here run with npm.\` and then \`Chromium needs --no-sandbox or it exits.\` The worker asks for the npm line to be corrected to pnpm: both lines come back, the first now reading \`Tests here run with pnpm.\` and the second word for word as it was. Added, corrected or dropped is one line moving; everything the request did not name is untouched.

${current ? "The notes as they stand:" : "There are no notes yet — the fence below is empty because nothing has been written, not because the notes say so."}

\`\`\`
${current ?? ""}
\`\`\`

The worker asks for this change:

${want.trim()}

Hand back the whole thing as it should now read, keeping what the request does not touch. Only what belongs inside the fence, never a word about it, and nothing at all when the request holds nothing that belongs. At most ${BOT_NOTES.chars} characters, which is a ceiling and not a target.`;
}
