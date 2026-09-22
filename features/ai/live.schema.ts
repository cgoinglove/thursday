import { z } from "zod";
import { COMMON_VALIDATE } from "@/lib/limits";
import { LIVE_BACKEND_MODEL } from "@/lib/live/live.schema";
import { effortSchema, TEXT_MODEL_PROVIDERS } from "./model.schema";
import { DEFAULT_PERSONA } from "./prompts/persona";

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

/**
 * Regional influence and presentation, as OpenAI documents them for the voices
 * GPT-Live adds. The rest — marin, cedar and the voices shared with Realtime —
 * have no documented character, and an invented one would read as fact.
 */
export const LIVE_VOICE_NOTE: Partial<
  Record<(typeof LIVE_VOICES)[number], string>
> = {
  gleam: "North American · feminine",
  meridian: "North American · masculine",
  quartz: "Australian · feminine",
  ripple: "Australian · masculine",
  vesper: "British · masculine",
  willow: "Irish · feminine",
  stone: "Irish · masculine",
  bossa: "Portuguese · feminine",
  tempo: "Portuguese · masculine",
  beacon: "Filipino · masculine",
  delta: "Southern U.S. · feminine",
  cinder: "Southern U.S. · masculine",
};

/** A recorded line in this voice. Only the listed voices have one. */
export const voiceSamplePath = (voice: string) => `/voices/${voice}.ogg`;

export const LIVE_BACKEND_MODELS = TEXT_MODEL_PROVIDERS.openai.suggestModels;
const instruction = z.string().max(COMMON_VALIDATE.prompt.max).default("");

export const LiveSettingsSchema = z.object({
  voice: z.string().trim().min(1).max(128).default("marin"),
  /**
   * Which character she is on a call (prompts/persona). A temperament, not a voice:
   * which of the 22 says it is the setting above, and changing one leaves the other.
   */
  persona: z.string().trim().min(1).max(64).default(DEFAULT_PERSONA),
  voicePrompt: instruction,
  backendModel: z.string().trim().min(1).max(128).default(LIVE_BACKEND_MODEL),
  backendPrompt: instruction,
  /**
   * A call waits out loud, so the backend reasons as little as the work allows.
   * One step of the app's own ladder (model.schema `EFFORTS`); null omits the
   * parameter, for a model that only runs on its own default.
   */
  reasoningEffort: effortSchema.nullable().default("low"),
  /**
   * On, so a question about today — weather, a price, a score — is answered on the line
   * instead of becoming a bot's job. A stored choice, so the default reaches only a
   * browser that has none.
   */
  webSearch: z.boolean().default(true),
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
    persona: stored.persona,
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
