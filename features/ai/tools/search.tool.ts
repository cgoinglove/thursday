import { generateText, type ToolSet, tool } from "ai";
import z from "zod";
import type { TextModel } from "@/features/ai/model";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { Sandbox } from "@/lib/sandbox";

/**
 * Web search as one tool with one name. The provider-native search runs one call down on a
 * search-capable model (`resolveSearchModel`), never in the bot's own request: a provider tool
 * cannot be handed to another provider's model, names and result shapes differ per provider,
 * and Google cannot send its search tool alongside function tools in one request.
 */

/** System prompt for the model one call down; it sees nothing but the question. */
const SEARCHER = `Answer the question from the web. Lead with the answer, then
what supports it. Say plainly what you could not find or confirm — do not fill
the gap with a guess. Every number carries the date you saw it. Be brief: this
is read by another model, not by a person.`;

/** How many sources are worth carrying back. Past this it is noise. */
const SOURCE_LIMIT = 8;

/** Absent when no provider that searches has a key (features/ai/model); the bot goes to the browser instead. */
export const createSearchTool = (
  search: TextModel | null,
  sandbox: Sandbox,
): ToolSet => {
  if (!search?.searchTools) return {};
  const { model, searchTools } = search;

  return {
    [TOOL_NAMES.web_search]: tool({
      description:
        "Search the web and get back an answer with its sources. For a fact, a price, a date, what a page says. Not for a page that has to be clicked, filled, or signed into — that is the browser.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "What you want to know, as one full question. Put the place and the time in when they matter — the searcher sees nothing but this line.",
          ),
      }),
      execute: async ({ query }, { abortSignal }) => {
        const { text, sources } = await generateText({
          model,
          tools: searchTools,
          system: SEARCHER,
          prompt: query,
          abortSignal,
        });

        const urls = [
          ...new Set(
            sources.flatMap((source) =>
              source.sourceType === "url"
                ? [
                    source.title
                      ? `${source.title} — ${source.url}`
                      : source.url,
                  ]
                : [],
            ),
          ),
        ].slice(0, SOURCE_LIMIT);

        return sandbox.fold(
          [text.trim(), urls.length ? `Sources:\n${urls.join("\n")}` : ""]
            .filter(Boolean)
            .join("\n\n"),
          "web-search",
        );
      },
    }),
  };
};
