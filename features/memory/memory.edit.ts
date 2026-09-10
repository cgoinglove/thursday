import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  validateUIMessages,
} from "ai";
import { ZodError, z } from "zod";
import { loadTools } from "@/features/ai/load-tools";
import { getTextModel, modelErrorToString } from "@/features/ai/model";
import { textModelRefSchema } from "@/features/ai/model.schema";
import { loadMemoryEditPrompt } from "@/features/ai/prompts/memory-edit.prompt";
import { logger } from "@/lib/logger";
import { isPublicError } from "@/lib/public-error";

/**
 * Editing memory from its own screen: one request, one streamed run. The model
 * gets memory's two writes, which run as it calls them, and the page draws each
 * call as it arrives. Nothing about the exchange is kept — the page holds the
 * messages and drops them — so what lasts is only what the tools wrote.
 */

/** One line of intent: a run still writing after this many steps is not converging. */
const MAX_STEPS = 20;

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
    const { status, message } = startError(cause);
    return new Response(message, { status });
  }

  const result = streamText({
    model: run.model,
    system: run.system,
    messages: run.messages,
    tools: run.tools,
    // The first step has to write; after it the model stops once nothing is
    // left. Required on every step would leave it no way to stop short of the cap.
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? "required" : "auto",
    }),
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: signal,
  });
  // A provider's refusal is the user's to act on, so it is never masked
  return result.toUIMessageStreamResponse({ onError: modelErrorToString });
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
  return { status: 500, message: "Could not start the edit" };
}
