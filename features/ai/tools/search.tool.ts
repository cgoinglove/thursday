import { generateText, type ToolSet, tool } from "ai";
import z from "zod";
import { SEARCH } from "@/config";
import type { TextModel } from "@/features/ai/model";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { EXA_API_KEY } from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import type { Sandbox } from "@/lib/sandbox";
import { clip, errorToString } from "@/lib/utils";

/**
 * Web search as one tool with one name, served whichever way this install can.
 *
 * Exa when its key is set: one HTTP call, the pages themselves back. Otherwise the run's own
 * model's native search, one call down on a searcher that sees nothing but the question — a
 * provider tool cannot be handed to another provider's model, names and result shapes differ
 * per provider, and Google cannot send its search tool alongside function tools in one request.
 *
 * A run whose model has no search of its own (the gateway) and no Exa key gets no search tool:
 * it goes to the browser. Borrowing whichever provider had a key meant a second model call on a
 * model nobody picked, which is where the minute-long searches came from — search is one lookup
 * or it is a job, and a job is what the browser already is.
 */

/** System prompt for the model one call down; it sees nothing but the question. */
const SEARCHER = `Answer the question from the web. Lead with the answer, then
what supports it. Say plainly what you could not find or confirm — do not fill
the gap with a guess. Every number carries the date you saw it. Be brief: this
is read by another model, not by a person.`;

const DESCRIPTION =
  "Search the web and get back what the pages say, with their links. For a fact, a price, a date, what a page says. Not for a page that has to be clicked, filled, or signed into — that is the browser.";

const QUERY = z
  .string()
  .describe(
    "What you want to know, as one full question. Put the place and the time in when they matter — the searcher sees nothing but this line.",
  );

/** Exa's own endpoint. One POST: the whole point of this path is that it is not a model call. */
const EXA_URL = "https://api.exa.ai/search";

/** One hit as Exa sends it; only the fields that are read back are named. */
type ExaHit = {
  title?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  text?: string | null;
};

/** What a search found: the text a model reads, and the pages apart for a screen to show. */
type Found = { text: string; sources: { url: string; title?: string }[] };

async function exaSearch(
  apiKey: string,
  query: string,
  signal: AbortSignal,
): Promise<Found> {
  const response = await fetch(EXA_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: SEARCH.sources,
      contents: {
        text: { maxCharacters: SEARCH.excerptChars },
        // A page Exa has not cached is fetched now, but one slow site does not hold the search
        livecrawl: "fallback",
        livecrawlTimeout: 5_000,
      },
    }),
  });
  // Exa's own words: only it can say whether the key is wrong, spent or rate-limited
  if (!response.ok)
    return {
      text: `Exa answered ${response.status}: ${clip((await response.text()).trim(), 200)}`,
      sources: [],
    };

  const body = (await response.json()) as { results?: ExaHit[] };
  const hits = body.results ?? [];
  if (!hits.length)
    return {
      text: "Nothing came back for that. Try other words, or open the page itself.",
      sources: [],
    };

  const sources = hits.flatMap((hit) =>
    hit.url?.trim()
      ? [
          {
            url: hit.url.trim(),
            ...(hit.title?.trim() ? { title: hit.title.trim() } : {}),
          },
        ]
      : [],
  );
  const text = hits
    .map((hit) => {
      const head = [hit.title?.trim(), hit.url?.trim()]
        .filter(Boolean)
        .join(" — ");
      const date = hit.publishedDate?.slice(0, 10);
      return [date ? `${head} · ${date}` : head, hit.text?.trim()]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return { text, sources };
}

async function askSearcher(
  searcher: { model: TextModel["model"]; tools: ToolSet },
  query: string,
  signal: AbortSignal,
): Promise<string> {
  const { text, sources } = await generateText({
    model: searcher.model,
    tools: searcher.tools,
    instructions: SEARCHER,
    prompt: query,
    abortSignal: signal,
  });

  const urls = [
    ...new Set(
      sources.flatMap((source) =>
        source.sourceType === "url"
          ? [source.title ? `${source.title} — ${source.url}` : source.url]
          : [],
      ),
    ),
  ].slice(0, SEARCH.sources);

  return [text.trim(), urls.length ? `Sources:\n${urls.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

/** Absent when there is neither an Exa key nor a run model that searches; the bot goes to the browser instead. */
export const createSearchTool = async (
  run: TextModel | null | undefined,
  sandbox: Sandbox,
): Promise<ToolSet> => {
  const exaKey = await readConfig(EXA_API_KEY);
  // This run's own model, never a borrowed one. A const so the closure below keeps the narrowing
  const native = run?.searchTools
    ? { model: run.model, tools: run.searchTools }
    : null;

  const search = exaKey
    ? (query: string, signal: AbortSignal) =>
        exaSearch(exaKey, query, signal).then((found) => found.text)
    : native
      ? (query: string, signal: AbortSignal) =>
          askSearcher(native, query, signal)
      : null;
  if (!search) return {};

  return {
    [TOOL_NAMES.web_search]: tool({
      description: DESCRIPTION,
      inputSchema: z.object({ query: QUERY }),
      execute: async ({ query }, { abortSignal }) => {
        const deadline = AbortSignal.timeout(SEARCH.timeoutMs);
        const signal = abortSignal
          ? AbortSignal.any([abortSignal, deadline])
          : deadline;

        const answer = await search(query, signal).catch((cause: unknown) => {
          // The job itself was cancelled: that is not a result to hand back
          if (abortSignal?.aborted) throw cause;
          if (deadline.aborted)
            return `The search did not come back in ${SEARCH.timeoutMs / 1000}s. Ask something narrower, or open the page in the browser.`;
          return `Search failed: ${errorToString(cause)}. The browser is the other way in.`;
        });

        return sandbox.fold(answer, "web-search");
      },
    }),
  };
};

/** The call's line: the same as a bot's, less the browser it does not hold. */
const CALL_DESCRIPTION =
  "Search the web and get back what the pages say, with their links. For a fact, a price, a date, what a page says.";

/**
 * The call's search while an Exa key is set: the same Exa search a bot runs, answering with
 * the text and, apart, the pages it came from, so the call screen can show them. Without a
 * key there is no tool here: the call searches with its backend's own hosted search instead
 * (thursday.action), which is the native search of the one provider a call runs on.
 */
export const createCallSearchTool = async (
  sandbox: Sandbox,
): Promise<ToolSet> => {
  const exaKey = await readConfig(EXA_API_KEY);
  if (!exaKey) return {};

  return {
    [TOOL_NAMES.web_search]: tool({
      description: CALL_DESCRIPTION,
      inputSchema: z.object({ query: QUERY }),
      execute: async ({ query }, { abortSignal }) => {
        const deadline = AbortSignal.timeout(SEARCH.timeoutMs);
        const signal = abortSignal
          ? AbortSignal.any([abortSignal, deadline])
          : deadline;

        const found = await exaSearch(exaKey, query, signal).catch(
          (cause: unknown): Found => {
            // The call itself ended: that is not a result to hand back
            if (abortSignal?.aborted) throw cause;
            return {
              text: deadline.aborted
                ? `The search did not come back in ${SEARCH.timeoutMs / 1000}s. Ask something narrower, or hand it to a bot.`
                : `Search failed: ${errorToString(cause)}. A bot can open the page instead.`,
              sources: [],
            };
          },
        );
        return {
          results: sandbox.fold(found.text, "web-search"),
          sources: found.sources,
        };
      },
    }),
  };
};
