import { z } from "zod";
import { COMMON_VALIDATE } from "@/lib/limits";
import { LIVE_BACKEND_MODEL } from "@/lib/live/live.schema";
import { TEXT_MODEL_PROVIDERS } from "./model.schema";

export const LIVE_PROVIDER = {
  id: "openai",
  label: "OpenAI",
  apiKeyName: TEXT_MODEL_PROVIDERS.openai.apiKeyName,
} as const;

/** Suggestions only: custom voices and older backend model IDs remain valid input. */
export const LIVE_VOICES = [
  "marin",
  "cedar",
  "gleam",
  "meridian",
  "quartz",
  "ripple",
  "vesper",
  "willow",
  "stone",
  "bossa",
  "tempo",
  "beacon",
  "delta",
  "cinder",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
] as const;

export const LIVE_BACKEND_MODELS = TEXT_MODEL_PROVIDERS.openai.suggestModels;
export const LIVE_REASONING = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

const instruction = z.string().max(COMMON_VALIDATE.prompt.max).default("");

export const LiveSettingsSchema = z.object({
  voice: z.string().trim().min(1).max(128).default("marin"),
  voicePrompt: instruction,
  backendModel: z.string().trim().min(1).max(128).default(LIVE_BACKEND_MODEL),
  backendPrompt: instruction,
  /** Null omits reasoning so older models can use their own supported defaults. */
  reasoningEffort: z.enum(LIVE_REASONING).nullable().default(null),
  webSearch: z.boolean().default(false),
});
export type LiveSettings = z.infer<typeof LiveSettingsSchema>;
export const LIVE_DEFAULTS = LiveSettingsSchema.parse({});

/**
 * Settings stored before Live-only, or hand-edited, into valid ones. An OpenAI
 * voice and backend model carry over; a Grok voice does not, since its names
 * mean nothing to Live. The one shared instruction goes into both new fields so
 * nothing the user wrote is lost. Each field recovers on its own: one bad value
 * falls back to its default and leaves the rest as they were.
 */
export function migrateLiveSettings(value: unknown): Record<string, unknown> {
  const stored =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const { model, systemPrompt, ...rest } = stored;
  const legacy = z
    .object({
      provider: z.string(),
      voice: z.string().nullish(),
      backendModel: z.string().nullish(),
    })
    .safeParse(model);
  const openai =
    legacy.success && legacy.data.provider === "openai" ? legacy.data : null;

  const candidate: Record<keyof LiveSettings, unknown> = {
    voice: stored.voice ?? openai?.voice,
    voicePrompt: stored.voicePrompt ?? systemPrompt,
    backendModel: stored.backendModel ?? openai?.backendModel,
    backendPrompt: stored.backendPrompt ?? systemPrompt,
    reasoningEffort: stored.reasoningEffort,
    webSearch: stored.webSearch,
  };
  const live = Object.fromEntries(
    (Object.keys(candidate) as (keyof LiveSettings)[]).map((key) => {
      const parsed = LiveSettingsSchema.shape[key].safeParse(candidate[key]);
      return [key, parsed.success ? parsed.data : LIVE_DEFAULTS[key]];
    }),
  );
  return { ...rest, ...live };
}
