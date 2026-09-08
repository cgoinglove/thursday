import { asSchema } from "ai";
import z from "zod";
import { loadTools } from "@/features/ai/load-tools";
import { serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";
import { errorToString } from "@/lib/utils";

/**
 * Executes a tool call from the voice session. The page forwards what the model
 * asked for; bots never come through here (they call `execute` directly).
 * A route rather than a server action because actions run serially per client
 * and one turn may call two tools at once. One POST, one JSON, no streaming;
 * hanging up aborts the fetch and the signal reaches the tool.
 */

const ToolCallSchema = z.object({
  toolCallId: z.string().min(1),
  /** The call this came from; `delegate` attaches the job to it. */
  callId: z.string().nullish(),
  name: z.string().min(1),
  input: z.unknown().optional(),
});

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value;

/** For streaming tools the last chunk is the answer. */
async function drain(output: unknown): Promise<unknown> {
  if (!isAsyncIterable(output)) return output;
  let latest: unknown;
  for await (const part of output) latest = part;
  return latest;
}

export const POST = serverRoute(async (request) => {
  const { toolCallId, callId, name, input } = ToolCallSchema.parse(
    await request.json(),
  );

  // The set the voice runtime may run, not whatever the body names.
  const tools = await loadTools({ target: "thursday", callId });
  const tool = tools[name];
  if (!tool) publicError(`There is no tool called "${name}".`);

  // end_call has no execute by design: the page owns the call and intercepts it.
  if (!tool.execute) publicError(`"${name}" is handled by the page, not here.`);

  const parsed = await asSchema(tool.inputSchema).validate?.(input ?? {});
  if (parsed && !parsed.success) {
    publicError(
      `"${name}" got arguments that do not fit: ${parsed.error.message}`,
    );
  }

  try {
    const output = await tool.execute(parsed?.value ?? input ?? {}, {
      toolCallId,
      messages: [],
      context: undefined,
      abortSignal: request.signal,
    });
    return { output: await drain(output) };
  } catch (cause) {
    // A tool failure is a line the model reads and recovers from, not a masked server error.
    publicError(`"${name}" failed: ${errorToString(cause)}`);
  }
});
