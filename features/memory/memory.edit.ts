import {
  asSchema,
  generateText,
  type ModelMessage,
  modelMessageSchema,
  stepCountIs,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { MEMORY_EDIT } from "@/config";
import { loadTools } from "@/features/ai/load-tools";
import { getTextModel, modelErrorToString } from "@/features/ai/model";
import { textModelRefSchema } from "@/features/ai/model.schema";
import { loadMemoryEditPrompt } from "@/features/ai/prompts/memory-edit.prompt";
import { createMemoryTools } from "@/features/ai/tools/memory.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { publicError } from "@/lib/public-error";
import type { MemoryEditStep } from "./memory.schema";

/**
 * Editing memory from its own screen, one model step per request. The model gets
 * memory's two writes without their execute (ai/load-tools), so a step ends at
 * the calls it makes and the screen shows each as a card. The thread lives in the
 * page and comes back with every step, so nothing is kept here between requests.
 * A card is applied the moment it is saved, on its own (applyMemoryEditCall);
 * the next step reads the thread with those answers in it.
 */

const StepSchema = z.object({
  model: textModelRefSchema,
  messages: z.array(z.unknown()).min(1),
});

export async function stepMemoryEdit(
  body: unknown,
  signal: AbortSignal,
): Promise<MemoryEditStep> {
  const { model: ref, messages: raw } = StepSchema.parse(body);
  const messages: ModelMessage[] = modelMessageSchema.array().parse(raw);

  // A step is one assistant turn, counted off the thread the page sends back
  const taken = messages.filter(
    (message) => message.role === "assistant",
  ).length;
  if (taken >= MEMORY_EDIT.steps) {
    return {
      messages: [],
      calls: [],
      text: `Stopped after ${MEMORY_EDIT.steps} steps.`,
    };
  }

  const model = await getTextModel(ref);
  try {
    const result = await generateText({
      model: model.model,
      system: await loadMemoryEditPrompt(),
      messages,
      tools: await loadTools({ target: "memory-edit" }),
      stopWhen: stepCountIs(1),
      abortSignal: signal,
    });
    return {
      messages: result.response.messages,
      calls: result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
      text: result.text.trim(),
    };
  } catch (cause) {
    publicError(modelErrorToString(cause));
  }
}

const CallSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.enum([TOOL_NAMES.memory_remember, TOOL_NAMES.memory_forget]),
  input: z.unknown(),
});

/** Runs one saved card the way the call runs it: the same tool and its checks, in the user's hand. */
export async function applyMemoryEditCall(body: unknown): Promise<unknown> {
  const { toolCallId, toolName, input } = CallSchema.parse(body);
  const tools: ToolSet = createMemoryTools("user");
  const tool = tools[toolName];

  const parsed = await asSchema(tool.inputSchema).validate?.(input);
  if (parsed && !parsed.success) {
    publicError(`That change no longer fits: ${parsed.error.message}`);
  }
  return tool.execute?.(parsed?.value ?? input, {
    toolCallId,
    messages: [],
    context: undefined,
  });
}
