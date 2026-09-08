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

export async function issueClientSecret({
  provider,
  apiKey,
  model,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: IssueClientSecretOptions): Promise<RealtimeCredential> {
  const { url, body } = ENDPOINT[provider]({ model, ttlSeconds });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // Prefer the provider's message; the status code alone does not separate an expired key from no credit.
    throw new Error(
      payload?.error?.message ??
        `Could not start a session (${response.status})`,
    );
  }

  const parsed = RealtimeCredentialSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("The session token came back in a shape we do not know.");
  }

  return { value: parsed.data.value, expiresAt: parsed.data.expires_at };
}
