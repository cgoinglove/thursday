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
 * `report` (ai/tools/bot.tool `notes`), and this rewrites the block from that. Two models
 * because they are two jobs: a bot that has just finished work edits around the work, while
 * a model handed one document and three change requests does what it was handed. Same model
 * the job ran on, no system prompt, one tool, forced.
 *
 * Serialized per bot, which is the whole of the concurrency story: two jobs of one bot
 * finishing together queue, and the second reads the block the first wrote.
 */

/** One bot at a time. Without it two passes read the same block and one of them is lost. */
const lane = createKeyedLock();

/** One call is the whole job; the rest is headroom for a rejected argument list. */
const MAX_STEPS = 3;

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
          stepCountIs(MAX_STEPS),
          hasToolCall(TOOL_NAMES.update_notes),
        ],
      });
    } catch (cause) {
      // Never the job's problem: its report is already handed back.
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
  return `You maintain one worker's prompt. A change to it has come in.

The worker is an agent with a shell on this machine. The prompt is its own — written to itself, read at the start of every job it runs, read by nobody else. It holds what working on this machine has taught it: the command that actually works here, the flag without which it fails, the tool this platform does not have, a dead end not worth walking again.

**A request may propose work — "it should be rewritten", "someone ought to fix it".** A proposal is not a fact, and the prompt records only what is true of the machine right now: write what the worker found, never the intention as though it were done.

Three things are not notes, however true they were today. **What is in a folder right now** — a listing is cheaper to read again than to trust, and it is wrong the day something is added. **What a job produced**, and anything about the person the work is for. **A way around the worker's own tools** — the report, the file writer, the step limit belong to the app it runs in, they change with it, and a line about satisfying one teaches it to work on the tool instead of the job. What the machine is, and how work goes on it, is the whole subject.

${current ? "The prompt as it stands:" : "There is no prompt yet — the fence below is empty because the worker has written nothing, not because the prompt says so. Whatever you hand back is the first version of it."}

\`\`\`
${current ?? ""}
\`\`\`

The worker asks for this change:

${want.trim()}

Update the prompt from that. Keep everything it already says that the request does not touch, in the words it already uses. Where the request leaves the choice open — fix this or drop it — fix it: the worker still has to do the thing, it just does it differently now, and a line deleted takes the question with it. Hand back the whole prompt as it should now read — only what belongs inside the fence, never a word about it — and nothing at all when nothing in the change requests belongs in a prompt. At most ${BOT_NOTES.chars} characters, which is a ceiling and not a target.`;
}
