import { z } from "zod";
import { LIVE_CALL } from "@/config";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { LIVE_MODEL, type LiveInput, type ToolManifest } from "./live.schema";

const LiveConnectionSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  transport: z.object({ type: z.literal("webrtc"), sdp: z.string().min(1) }),
});

/** Exchanges an offer on the trusted server. The account key never reaches the browser. */
export async function createLiveCall(options: {
  apiKey: string;
  sdp: string;
  voice: string;
  instructions: string;
  input: LiveInput[];
  backend: {
    model: string;
    instructions: string;
    tools: ToolManifest[];
    /** Omitted when null, so a model without reasoning still runs. */
    reasoningEffort: string | null;
    webSearch: boolean;
  };
}) {
  const response = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(LIVE_CALL.startupMs),
    body: JSON.stringify({
      session: {
        model: LIVE_MODEL,
        instructions: options.instructions,
        input: options.input,
        audio: { output: { voice: options.voice } },
        store: false,
        delegation: {
          type: "responses",
          responses: {
            model: options.backend.model,
            instructions: options.backend.instructions,
            tools: [
              ...options.backend.tools.map((tool) => ({
                type: "function",
                ...tool,
                strict: false,
              })),
              ...(options.backend.webSearch ? [{ type: "web_search" }] : []),
            ],
            tool_choice: "auto",
            parallel_tool_calls: true,
            max_output_tokens: LIVE_CALL.backendOutputTokens,
            ...(options.backend.reasoningEffort
              ? { reasoning: { effort: options.backend.reasoningEffort } }
              : {}),
          },
        },
      },
      transport: { type: "webrtc", sdp: options.sdp },
    }),
  }).catch((cause: unknown) => {
    logger.warn("OpenAI Live unreachable", cause);
    publicError("Could not reach OpenAI Live.");
  });
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    publicError(
      error?.error?.message ||
        body ||
        `OpenAI Live refused the call (${response.status}).`,
    );
  }
  const parsed = LiveConnectionSchema.safeParse(payload);
  if (!parsed.success)
    publicError("OpenAI Live returned an invalid session connection.");
  return parsed.data;
}
