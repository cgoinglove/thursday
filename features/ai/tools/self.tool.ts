import { type ToolSet, tool } from "ai";
import z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  mayDescribeItself,
  rewriteBotDescription,
} from "@/features/bot/bot.query";
import { COMMON_VALIDATE } from "@/lib/limits";

/**
 * A bot's own description, in its own words: the one line Thursday and every other bot read
 * in the roster, and the only thing a job is handed to a bot by. The user writes it first; a
 * bot whose work has changed for good — a skill of its own, what the user told it it is for,
 * the jobs that keep coming to it — can say so there, so it is the one picked for them. A
 * line rewritten after every job would move the roster under every call, so the tool says to
 * use it rarely and why. Left out of the set for a bot the user locked (botTable
 * descriptionLocked) and for the fallback that has no row.
 */
export async function createSelfTools(bot: string): Promise<ToolSet> {
  if (!(await mayDescribeItself(bot))) return {};
  return {
    [TOOL_NAMES.describe_self]: tool({
      description:
        "Rewrite your description: the one line Thursday and the other bots read in the roster, and the only thing Thursday picks a bot for a job by. Use it rarely — only when what you do has changed for good: the user told you what you are for, you now hold a skill of your own the line does not name, or the same kind of job keeps coming to you and the line misses it. Never for one job, and never to describe a job.",
      inputSchema: z.object({
        description: z
          .string()
          .trim()
          .min(1)
          .max(COMMON_VALIDATE.description.max)
          .describe(
            "The whole new line: what you do, in the words people ask with, keeping what is still true of the old one. Leave out any subject another bot's line in the roster already names, or a job has two bots to go to.",
          ),
        reason: z
          .string()
          .trim()
          .min(1)
          .describe(
            "What changed for good, in a sentence: why the old line no longer says what you do.",
          ),
      }),
      execute: async ({ description, reason }) => {
        const was = await rewriteBotDescription(bot, description);
        if (was === null)
          return "Nothing was written: your description is the user's to change now.";
        if (was === description)
          return "That is your description already; nothing changed.";
        return {
          was,
          now: description,
          reason,
          note: "Thursday and the other bots read the new line from their next turn. Say in your answer that you changed it, and why.",
        };
      },
    }),
  };
}
