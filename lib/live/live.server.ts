import { z } from "zod";
import { LIVE_CALL } from "@/config";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { LIVE_MODEL, type ToolManifest } from "./live.schema";

const LiveConnectionSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  transport: z.object({ type: z.literal("webrtc"), sdp: z.string().min(1) }),
});

/** The backend's `reasoning` settings as Responses takes them. */
type BackendReasoning = { effort?: string; summary?: "auto" };

/** What each model took, by model and chosen effort; only settled answers are kept. */
const reasoningTaken = new Map<string, BackendReasoning | null>();

/**
 * The reasoning settings to hand the backend: the chosen effort, and a summary kept with
 * the call (call_thought), none of either for `none`. Live opens the call with any of
 * them and fails the first delegated response when the model refuses one, so the model
 * is asked before the call: the token-count endpoint checks `reasoning` without running
 * it. A setting refused by name is dropped and the rest asked again, and what was taken
 * is remembered. Any other answer keeps what was chosen: a key or model problem is Live's
 * to report when the call opens. A dropped setting is not shown; the call runs on the
 * model's own.
 */
export async function acceptedReasoning(options: {
  apiKey: string;
  model: string;
  effort: string | null;
}): Promise<BackendReasoning | null> {
  const { apiKey, model, effort } = options;
  const pair = `${model} ${effort ?? "auto"}`;
  const known = reasoningTaken.get(pair);
  if (known !== undefined) return known;

  const wanted: BackendReasoning =
    effort === "none"
      ? { effort }
      : { ...(effort ? { effort } : {}), summary: "auto" };
  for (;;) {
    const response = await fetch(
      "https://api.openai.com/v1/responses/input_tokens",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(LIVE_CALL.reasoningCheckMs),
        body: JSON.stringify({ model, input: ".", reasoning: wanted }),
      },
    ).catch(() => null);
    if (!response) return wanted;
    const taken = Object.keys(wanted).length ? wanted : null;
    if (response.ok) {
      reasoningTaken.set(pair, taken);
      return taken;
    }
    const payload = (await response.json().catch(() => null)) as {
      error?: { param?: string | null };
    } | null;
    const refused = payload?.error?.param?.replace(/^reasoning\./, "");
    if (refused !== "effort" && refused !== "summary") return wanted;
    if (!(refused in wanted)) return wanted;
    logger.warn(`${model} takes no reasoning ${refused}; calls omit it`);
    delete wanted[refused];
    if (!Object.keys(wanted).length) {
      reasoningTaken.set(pair, null);
      return null;
    }
  }
}

/** Exchanges an offer on the trusted server. The account key never reaches the browser. */
export async function createLiveCall(options: {
  apiKey: string;
  sdp: string;
  voice: string;
  instructions: string;
  backend: {
    model: string;
    instructions: string;
    tools: ToolManifest[];
    /** What `acceptedReasoning` found the model takes; omitted when null. */
    reasoning: BackendReasoning | null;
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
            ...(options.backend.reasoning
              ? { reasoning: options.backend.reasoning }
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
