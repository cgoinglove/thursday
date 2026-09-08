import { z } from "zod";

/** Providers with a driver in this folder; the model catalog derives its enum from this. */
export const REALTIME_PROVIDERS = ["openai", "xai"] as const;

export type SpeachModelProviderId = (typeof REALTIME_PROVIDERS)[number];

/** Flat tool declaration as the realtime wire takes it. */
export type ToolManifest = {
  name: string;
  description: string;
  parameters: ObjectSchema;
};

/** Ephemeral credential the browser connects with. */
export type RealtimeCredential = {
  /** Verbatim client secret (`ek_...` / `xai-client-secret-...`). */
  value: string;
  /** Unix seconds. */
  expiresAt: number;
};

export type IssueClientSecretOptions = {
  provider: SpeachModelProviderId;
  /** The account key, which exists only on the server. */
  apiKey: string;
  /** The realtime model the session runs on. */
  model: string;
  /** Lifetime in seconds; passed only to providers that take it. */
  ttlSeconds?: number;
};

/** Parsed so a misshapen mint response fails here, not as a connection error later. */
export const RealtimeCredentialSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number(),
});
