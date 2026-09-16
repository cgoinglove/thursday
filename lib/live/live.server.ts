import { z } from "zod";
import { LIVE_CALL } from "@/config";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { LIVE_MODEL, type LiveInput, type ToolManifest } from "./live.schema";

const LiveConnectionSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  transport: z.object({ type: z.literal("webrtc"), sdp: z.string().min(1) }),
});

/** `model effort` pairs already asked about, and whether the model takes that effort. */
const effortTaken = new Map<string, boolean>();

/**
 * The effort to hand the backend, or null when its model refuses that effort.
 * Live opens the call either way and fails the first delegated response mid-call,
 * so the model is asked before the call: the token-count endpoint checks
 * `reasoning` without running the model. Only that refusal drops the effort and is
 * remembered; any other answer keeps it, since a key or model problem is Live's to report.
 */
export async function acceptedEffort(options: {
  apiKey: string;
  model: string;
  effort: string | null;
}): Promise<string | null> {
  const { apiKey, model, effort } = options;
  if (!effort) return null;
  const pair = `${model} ${effort}`;
  const known = effortTaken.get(pair);
  if (known !== undefined) return known ? effort : null;

  const response = await fetch(
    "https://api.openai.com/v1/responses/input_tokens",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(LIVE_CALL.effortCheckMs),
      body: JSON.stringify({ model, input: ".", reasoning: { effort } }),
    },
  ).catch(() => null);
  if (!response) return effort;
  if (response.ok) {
    effortTaken.set(pair, true);
    return effort;
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: { param?: string | null };
  } | null;
  if (payload?.error?.param !== "reasoning.effort") return effort;
  logger.warn(`${model} takes no reasoning effort ${effort}; calls omit it`);
  effortTaken.set(pair, false);
  return null;
}

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
    /** No effort is sent when null, so a model without reasoning still runs. */
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
            // `strict` is left out, not false: each tool whose schema allows it is
            // decoded to its schema, and the rest fall back to best effort. `true`
            // is refused while any schema has optional fields.
            tools: [
              ...options.backend.tools.map((tool) => ({
                type: "function",
                ...tool,
              })),
              ...(options.backend.webSearch ? [{ type: "web_search" }] : []),
            ],
            tool_choice: "auto",
            parallel_tool_calls: true,
            max_output_tokens: LIVE_CALL.backendOutputTokens,
            // The summary is kept with the call (call_thought), never shown. A model
            // without reasoning takes it and sends none; `none` has nothing to summarise.
            reasoning:
              options.backend.reasoningEffort === "none"
                ? { effort: "none" }
                : {
                    ...(options.backend.reasoningEffort
                      ? { effort: options.backend.reasoningEffort }
                      : {}),
                    summary: "auto",
                  },
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
