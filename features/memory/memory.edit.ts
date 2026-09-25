import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";
import { z } from "zod";
import { MEMORY_EDIT } from "@/config";
import { loadTools } from "@/features/ai/load-tools";
import { getTextModel, modelErrorToString } from "@/features/ai/model";
import { textModelRefSchema } from "@/features/ai/model.schema";
import { loadMemoryEditPrompt } from "@/features/ai/prompts/memory-edit.prompt";
import { startError } from "@/lib/protocol/to-result";

/**
 * Editing memory from its own screen: one request, one streamed run. The model
 * gets memory's own read and writes (load-tools, memory-edit), which run as it
 * calls them, and the page draws each call as it arrives. Nothing about the exchange is kept — the page holds the
 * messages and drops them — so what lasts is only what the tools wrote.
 */

const BodySchema = z.object({
  model: textModelRefSchema,
  messages: z.array(z.unknown()).min(1),
});

export async function streamMemoryEdit(
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let run: Awaited<ReturnType<typeof prepare>>;
  try {
    run = await prepare(body);
  } catch (cause) {
    // Nothing has streamed yet, so this text is what the page shows as the error
    const { status, message } = startError(cause, "Could not start the edit");
    return new Response(message, { status });
  }

  const result = streamText({
    model: run.model,
    instructions: run.system,
    messages: run.messages,
    tools: run.tools,
    // The first step has to write; after it the model stops once nothing is
    // left. Required on every step would leave it no way to stop short of the cap.
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? "required" : "auto",
    }),
    stopWhen: stepCountIs(MEMORY_EDIT.maxSteps),
    abortSignal: signal,
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
  const { model: ref, messages } = BodySchema.parse(body);
  const tools = await loadTools({ target: "memory-edit" });
  const [model, system, ui] = await Promise.all([
    getTextModel(ref),
    loadMemoryEditPrompt(),
    validateUIMessages({ messages }),
  ]);
  return {
    model: model.model,
    system,
    tools,
    messages: await convertToModelMessages(ui),
  };
}
