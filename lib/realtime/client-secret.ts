import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import type { SpeachModelProviderId } from "./realtime.schema";
import {
  type IssueClientSecretOptions,
  type RealtimeCredential,
  RealtimeCredentialSchema,
} from "./realtime.schema";

/**
 * Mints the short-lived client secret the browser connects with. Only the
 * model is baked in (xAI accepts nothing more); instructions, voice and tools
 * go through `session.update`.
 */

/** Long enough for a slow connect, short enough to be worthless after. */
const DEFAULT_TTL_SECONDS = 600;

const ENDPOINT: Record<
  SpeachModelProviderId,
  (options: { model: string; ttlSeconds: number }) => {
    url: string;
    body: unknown;
  }
> = {
  openai: ({ model }) => ({
    url: "https://api.openai.com/v1/realtime/client_secrets",
    // OpenAI takes no lifetime; it mints with its own default.
    body: { session: { type: "realtime", model } },
  }),
  xai: ({ model, ttlSeconds }) => ({
    url: "https://api.x.ai/v1/realtime/client_secrets",
    body: { expires_after: { seconds: ttlSeconds }, session: { model } },
  }),
};

/**
 * The provider's own words about a refusal; the three shapes they arrive in.
 * The status code alone does not separate an expired key from no credit, or a
 * model this account cannot reach.
 */
function refusalOf(payload: unknown, status: number): string {
  const body = payload as { error?: unknown; message?: unknown } | null;
  const error = body?.error;
  const said =
    typeof error === "string"
      ? error
      : ((error as { message?: unknown } | undefined)?.message ??
        body?.message);
  return typeof said === "string" && said.trim()
    ? said
    : `Could not start a session (${status})`;
}

export async function issueClientSecret({
  provider,
  apiKey,
  model,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: IssueClientSecretOptions): Promise<RealtimeCredential> {
  const { url, body } = ENDPOINT[provider]({ model, ttlSeconds });

  // Every failure here is public: a call that will not open is the user's to fix
  // (the key, the credit, the model id), and only the provider can say which.
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    logger.warn(`${provider} unreachable`, cause);
    publicError(`Could not reach ${provider}.`);
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) publicError(refusalOf(payload, response.status));

  const parsed = RealtimeCredentialSchema.safeParse(payload);
  if (!parsed.success) {
    publicError("The session token came back in a shape we do not know.");
  }

  return { value: parsed.data.value, expiresAt: parsed.data.expires_at };
}
