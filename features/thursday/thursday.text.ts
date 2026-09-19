import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { ZodError, z } from "zod";
import { TEXT_CALL } from "@/config";
import { LIVE_PROVIDER } from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import { getTextModel, modelErrorToString } from "@/features/ai/model";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { EXA_API_KEY } from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { acceptedReasoning } from "@/lib/live/live.server";
import { logger } from "@/lib/logger";
import { isPublicError, publicError } from "@/lib/public-error";
import { nextTurnSeq, saveThought, saveTurns } from "./thursday.query";
import {
  TEXT_CALL_PROVIDERS,
  type TextCallProvider,
  ThursdaySettingsSchema,
  textCallRunsOn,
} from "./thursday.schema";

/**
 * A call in writing: the call's backend alone, with no Live session around it. Same
 * prompt but for its last chapter, same memory, same tools, and the same rows — it is kept
 * as a call, so the next call reads it back under Earlier calls like any other. The page
 * holds the conversation and sends it whole with every turn (what a tool answered is not
 * kept in the rows, so they cannot rebuild it); the server saves each turn as it happens.
 * One request, one streamed answer.
 */

/** Which sign-in a call in writing runs on, from what is set. Null when neither is. */
export async function readTextCallProvider(): Promise<TextCallProvider | null> {
  const set = await Promise.all(
    TEXT_CALL_PROVIDERS.map(async (provider) =>
      (await readConfig(provider.apiKeyName)) ? provider.apiKeyName : null,
    ),
  );
  return textCallRunsOn((key) => set.includes(key));
}

const BodySchema = z.object({
  callId: z.string().min(1),
  settings: ThursdaySettingsSchema,
  /** What stood open as the call opened (ai/prompts/call-standing), as the page was handed it. */
  standing: z.string().nullish(),
  messages: z.array(z.unknown()).min(1),
});

export async function streamTextCall(
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let run: Awaited<ReturnType<typeof prepare>>;
  try {
    run = await prepare(body);
  } catch (cause) {
    // Nothing has streamed yet, so this text is what the page shows as the error
    const { status, message } = startError(cause);
    return new Response(message, { status });
  }

  const { callId } = run;
  let seq = run.seq;
  const result = streamText({
    model: run.model,
    instructions: run.system,
    messages: run.messages,
    allowSystemInMessages: true,
    tools: run.tools,
    providerOptions: run.providerOptions,
    stopWhen: stepCountIs(TEXT_CALL.maxSteps),
    abortSignal: signal,
    // Saved as each step ends, in the order she made them: a tool turn keeps its name and
    // arguments as a spoken call's does, her words are a turn, a summary is a thought
    onStepEnd: async (step) => {
      for (const part of step.content) {
        if (part.type === "tool-call") {
          const answered = step.content.find(
            (other) =>
              other.type === "tool-result" &&
              other.toolCallId === part.toolCallId,
          );
          await saveTurns(callId, [
            {
              id: part.toolCallId,
              role: "tool",
              tool: part.toolName,
              text:
                part.toolName === TOOL_NAMES.web_search
                  ? searchTurn(
                      part.input,
                      answered?.type === "tool-result" ? answered.output : null,
                    )
                  : JSON.stringify(part.input ?? {}),
              seq: seq++,
            },
          ]);
        } else if (part.type === "text" && part.text.trim()) {
          await saveTurns(callId, [
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: part.text.trim(),
              seq: seq++,
            },
          ]);
        } else if (part.type === "reasoning" && part.text.trim()) {
          await saveThought(callId, {
            id: crypto.randomUUID(),
            text: part.text.trim(),
            seq,
          });
        }
      }
    },
  });
  // A provider's refusal is the user's to act on, so it is never masked
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: run.tools,
      onError: modelErrorToString,
    }),
  });
}

async function prepare(body: unknown) {
  const { callId, settings, standing, messages } = BodySchema.parse(body);
  const provider = await readTextCallProvider();
  if (!provider) publicError(NOTHING_TO_RUN_ON);

  const [model, system, held, ui, exaKey, openaiKey, seq] = await Promise.all([
    getTextModel({ provider, model: settings.backendModel }),
    loadThursdayPrompt(settings.backendPrompt, true),
    loadTools({
      target: "thursday",
      callId,
      webSearch: settings.webSearch,
      written: true,
    }),
    validateUIMessages({ messages }),
    readConfig(EXA_API_KEY),
    readConfig(LIVE_PROVIDER.apiKeyName),
    nextTurnSeq(callId),
  ]);

  // The words just sent are a turn the moment they arrive, answered or not
  const said = ui.at(-1);
  if (said?.role !== "user") publicError("The last message is not yours.");
  await saveTurns(callId, [
    { id: said.id, role: "user", text: wordsOf(said), seq },
  ]);

  // One search, never two, as on a spoken call (thursday.action): Exa's is among the
  // tools while its key is set, else the model's own where its provider has one
  const hosted = model.searchTools && Object.values(model.searchTools)[0];
  const tools: ToolSet = {
    ...held,
    // under the search's one name, so the line, the row and the log read it as the search
    ...(settings.webSearch && !exaKey && hosted
      ? { [TOOL_NAMES.web_search]: hosted }
      : {}),
  };

  // The reasoning the call asks for. Whether the model takes it can only be asked with an
  // API key (acceptedReasoning); without one it goes as chosen, and a refusal is shown
  const reasoning = openaiKey
    ? await acceptedReasoning({
        apiKey: openaiKey,
        model: settings.backendModel,
        effort: settings.reasoningEffort,
      })
    : settings.reasoningEffort === "none"
      ? { effort: "none" }
      : { effort: settings.reasoningEffort ?? undefined, summary: "auto" };

  const head: ModelMessage[] = standing
    ? [{ role: "system", content: standing }]
    : [];
  return {
    callId,
    seq: seq + 1,
    model: model.model,
    system,
    tools,
    messages: [
      ...head,
      // A tool an earlier answer broke off in has no result to send: the model would
      // be refused the whole conversation for it
      ...(await convertToModelMessages(ui, {
        ignoreIncompleteToolCalls: true,
      })),
    ],
    providerOptions: {
      openai: {
        ...(reasoning?.effort ? { reasoningEffort: reasoning.effort } : {}),
        ...(reasoning && "summary" in reasoning && reasoning.summary
          ? { reasoningSummary: reasoning.summary }
          : {}),
      },
    },
  };
}

export const NOTHING_TO_RUN_ON =
  "Writing to Thursday needs a GPT subscription sign-in or an OpenAI key — Settings › Models & keys.";

/**
 * A search as a spoken call keeps it (tool-line searchOf): what was looked for and the pages
 * read. Exa is asked with `query` and answers `sources`; a provider's own search names the
 * query in what it answers.
 */
function searchTurn(input: unknown, output: unknown): string {
  const asked = (input ?? {}) as { query?: unknown };
  const found = (output ?? {}) as {
    action?: { query?: unknown };
    sources?: unknown;
  };
  const query = [asked.query, found.action?.query].find(
    (one): one is string => typeof one === "string" && Boolean(one.trim()),
  );
  const sources = Array.isArray(found.sources)
    ? found.sources.flatMap((source) =>
        source && typeof source === "object" && "url" in source
          ? typeof source.url === "string"
            ? [
                {
                  url: source.url,
                  ...("title" in source && typeof source.title === "string"
                    ? { title: source.title }
                    : {}),
                },
              ]
            : []
          : [],
      )
    : [];
  return JSON.stringify({ query: query ?? null, sources });
}

const wordsOf = (message: UIMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("\n")
    .trim();

/** The route boundary's policy (protocol/to-result), for a response that is not a Result. */
function startError(cause: unknown): { status: number; message: string } {
  if (isPublicError(cause)) return { status: 400, message: cause.message };
  if (cause instanceof ZodError) {
    return {
      status: 400,
      message: cause.issues[0]?.message ?? "That request does not fit",
    };
  }
  logger.error(cause);
  return { status: 500, message: "Could not reach her" };
}
