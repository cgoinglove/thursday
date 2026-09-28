import { z } from "zod";
import { COMMON_VALIDATE } from "@/config";
import { LIVE_BACKEND_MODEL } from "@/lib/live/live.schema";
import {
  effortSchema,
  planCallsOf,
  TEXT_MODEL_PROVIDERS,
} from "./model.schema";
import { DEFAULT_PERSONA, RETIRED_PERSONAS } from "./prompts/persona";

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

/**
 * The voices GPT-Live speaks in on a ChatGPT plan (LIVE_PLAN_MODEL), none of them the key's:
 * codex-rs protocol.rs `RealtimeVoicesList::builtin`, `v1`, which the frameless model takes too
 * (core realtime_conversation.rs `validate_realtime_voice`), with `cove` its default. A voice
 * of the key's is refused there, as one of these is on a key.
 */
export const LIVE_PLAN_VOICES = [
  "cove",
  "juniper",
  "maple",
  "spruce",
  "ember",
  "vale",
  "breeze",
  "arbor",
  "sol",
] as const;

/**
 * What a spoken call can open on: the GPT subscription's own voice (LIVE_PLAN_MODEL), or GPT-Live
 * on the OpenAI key. Named as the text providers are, so the rule a call in writing follows
 * reads the same keys (thursday.schema `textCallRunsOn`).
 */
export const LIVE_LINES = ["chatgpt", "openai"] as const;
export type LiveLine = (typeof LIVE_LINES)[number];

/**
 * Whether a line can open a call: its key is set, and on the GPT subscription the plan is one
 * that has calls (model.schema planCallsOf) — a Free sign-in runs bots and calls in writing, not
 * a spoken call.
 */
export function liveLineReady(
  line: LiveLine,
  isSet: (key: string) => boolean,
  /** The plan the sign-in is on, as the token names it; null when it does not say. */
  plan: string | null,
): boolean {
  if (!isSet(TEXT_MODEL_PROVIDERS[line].apiKeyName)) return false;
  return line !== "chatgpt" || planCallsOf({ plan });
}

/**
 * The line a spoken call opens on: the one picked while it is set up, else the rule — the GPT
 * subscription when one is signed in on a plan with calls, else the OpenAI key; null when neither
 * is. The same answer on the server (the keys themselves) and on the screen (their status).
 */
export function liveLineOf(
  picked: LiveLine | null,
  isSet: (key: string) => boolean,
  plan: string | null,
): LiveLine | null {
  const ready = (line: LiveLine) => liveLineReady(line, isSet, plan);
  if (picked && ready(picked)) return picked;
  return LIVE_LINES.find(ready) ?? null;
}

export const LIVE_BACKEND_MODELS = TEXT_MODEL_PROVIDERS.openai.suggestModels;
const instruction = z.string().max(COMMON_VALIDATE.prompt.max).default("");

export const LiveSettingsSchema = z.object({
  voice: z.string().trim().min(1).max(128).default("marin"),
  /** Her voice on the plan's line, which speaks in voices of its own (LIVE_PLAN_VOICES). */
  planVoice: z.string().trim().min(1).max(128).default("cove"),
  /**
   * Which line a spoken call opens on, when the user picked one. Null follows the rule a call
   * in writing does: the GPT subscription when one is signed in, else the OpenAI key, because
   * the plan is paid for either way and the key bills by the minute.
   */
  runsOn: z.enum(LIVE_LINES).nullable().default(null),
  /**
   * Which character she is on a call (prompts/persona). A temperament, not a voice:
   * which of the 22 says it is the setting above, and changing one leaves the other.
   */
  persona: z.string().trim().min(1).max(64).default(DEFAULT_PERSONA),
  stylePrompt: instruction,
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
   * instead of becoming a bot's job. Kept only when it differs from this default
   * (thursday.query), so a change of default reaches every install that left it alone.
   */
  webSearch: z.boolean().default(true),
  /**
   * Off unless switched on: a skill is a page of instructions, and reading one
   * mid-sentence spends the call's context on it. Read where the tool set is built
   * (ai/load-tools) and where the prompt lists what she can read (prompts/thursday.prompt),
   * which is why it is the server's and not a browser's.
   */
  readSkills: z.boolean().default(false),
});
export type LiveSettings = z.infer<typeof LiveSettingsSchema>;
export const LIVE_DEFAULTS = LiveSettingsSchema.parse({});

/**
 * The backend a browser's copy of the settings names when nobody picked one: a
 * browser kept every field, the default of its day included. Read as unpicked, so
 * that copy follows the app's default instead of holding the one it was made with.
 */
const BROWSER_COPY_BACKEND = "gpt-5.6-luna";

/**
 * Settings stored before Live-only, or hand-edited, into valid ones. An OpenAI
 * voice and backend model carry over; a Grok voice does not, since its names
 * mean nothing to Live. The one shared instruction goes into both new fields so
 * nothing the user wrote is lost, and `voicePrompt` is what `stylePrompt` was called
 * while only the voice read it. Each field recovers on its own: one bad value
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
  const backendModel = stored.backendModel ?? openai?.backendModel;

  const candidate: Record<keyof LiveSettings, unknown> = {
    voice: stored.voice ?? openai?.voice,
    planVoice: stored.planVoice,
    runsOn: stored.runsOn,
    // A retired character is read as its successor, never dropped to the default
    persona:
      typeof stored.persona === "string"
        ? (RETIRED_PERSONAS[stored.persona] ?? stored.persona)
        : stored.persona,
    stylePrompt: stored.stylePrompt ?? stored.voicePrompt ?? systemPrompt,
    backendModel:
      backendModel === BROWSER_COPY_BACKEND ? undefined : backendModel,
    backendPrompt: stored.backendPrompt ?? systemPrompt,
    reasoningEffort: stored.reasoningEffort,
    webSearch: stored.webSearch,
    readSkills: stored.readSkills,
  };
  const live = Object.fromEntries(
    (Object.keys(candidate) as (keyof LiveSettings)[]).map((key) => {
      const parsed = LiveSettingsSchema.shape[key].safeParse(candidate[key]);
      return [key, parsed.success ? parsed.data : LIVE_DEFAULTS[key]];
    }),
  );
  return { ...rest, ...live };
}
