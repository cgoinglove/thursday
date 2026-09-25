import { type ToolSet, tool } from "ai";
import z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { ownLineOf, writeOwnLine } from "@/features/bot/bot.query";
import { COMMON_VALIDATE } from "@/lib/limits";

/**
 * A bot's own line: a few words the roster reads after the description the user wrote (bot.schema
 * rosterLine), where Thursday and every other bot pick who gets a job. The description stays the
 * user's; a bot whose work has changed for good — a skill of its own, what the user told it it is
 * for, the jobs that keep coming to it — says so here, so it is the one picked for them. A line
 * rewritten after every job would move the roster under every call, so the tool says to use it
 * rarely and why. The line it wrote before is named in the description, since the prompt shows
 * both halves as one. Left out of the set for a bot the user locked (botTable descriptionLocked)
 * and for the fallback that has no row.
 */
export async function createSelfTools(bot: string): Promise<ToolSet> {
  const own = await ownLineOf(bot);
  if (!own) return {};
  const yours = own.line
    ? ` It replaces the line you wrote before: "${own.line}".`
    : "";
  return {
    [TOOL_NAMES.describe_self]: tool({
      description: `Write your own line: a few words the roster reads after the description the user gave you, where Thursday and the other bots pick who gets a job.${yours} Use it rarely — only when what you do has changed for good: the user told you what you are for, you now hold a skill of your own the description does not name, or the same kind of job keeps coming to you and it misses it. Never for one job, and never to describe a job.`,
      inputSchema: z.object({
        line: z
          .string()
          .trim()
          .min(1)
          .max(COMMON_VALIDATE.shortDescription.max)
          .describe(
            "The whole line, in the words people ask with: what you do that the description does not say. Leave out any subject another bot's line in the roster already names, or a job has two bots to go to.",
          ),
        reason: z
          .string()
          .trim()
          .min(1)
          .describe(
            "What changed for good, in a sentence: why the roster should read this now.",
          ),
      }),
      execute: async ({ line, reason }) => {
        const written = await writeOwnLine(bot, line, reason);
        if (!written)
          return "Nothing was written: the user keeps your line as it is now.";
        if (written.was === line)
          return "That is your line already; nothing changed.";
        return {
          was: written.was,
          now: line,
          reason,
          note: "Thursday and the other bots read it from their next turn. Say in your answer that you wrote it, and why.",
        };
      },
    }),
  };
}
