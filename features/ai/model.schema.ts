import { z } from "zod";
import { BOT_RUN } from "@/config";
import {
  REALTIME_PROVIDERS,
  type SpeachModelProviderId,
} from "@/lib/realtime/realtime.schema";

/** Providers and model catalogs. Nothing is stored here; a model is named by whatever runs on it. */

export const textModelProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "xai",
  "vercel-ai-gateway",
]);

/** Provider and model name — everything a call needs. */
export const textModelRefSchema = z.object({
  provider: textModelProviderSchema,
  model: z.string().trim().min(1, "Model name is required").max(80),
});

export type TextModelProviderId = z.infer<typeof textModelProviderSchema>;
export type TextModelRef = z.infer<typeof textModelRefSchema>;

/** Who runs the call. The ids are the realtime drivers that exist (lib/realtime/realtime.schema). */
export const speachModelProviderSchema = z.enum(REALTIME_PROVIDERS);

export const speachModelRefSchema = z.object({
  provider: speachModelProviderSchema,
  /** Null means whatever that provider's default voice is. */
  voice: z.string().trim().min(1).max(64).nullish(),
  /** Null means that provider's first model (SPEACH_MODEL_PROVIDERS). Free text so a new model needs no edit here. */
  model: z.string().trim().min(1).max(80).nullish(),
});

export type { SpeachModelProviderId };
export type SpeachModelRef = z.infer<typeof speachModelRefSchema>;

/** Size of a suggested model, not quality. A label rather than a price because prices move. */
export const MODEL_TIERS = ["small", "mid", "large"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** One model worth offering, as the picker reads it. */
export type SuggestModel = {
  id: string;
  label: string;
  tier: ModelTier;
  /**
   * Context window in tokens, from the gateway's catalog for the same model. Only
   * the gateway can be asked at run time (readGatewayCatalog), so a provider used
   * directly reads its window here instead of guessing. Null where the gateway
   * does not carry the model: the run falls back to `BOT_RUN.compactAt`.
   */
  context?: number | null;
};

/**
 * A model's context window where the app can know it: the gateway's catalog row
 * for a gateway model, else the window stamped on a directly used provider's
 * shelf (`SuggestModel.context`). Null when neither says. Pure, so the settings
 * screen and a run (ai/model compactBudget) read the same number.
 */
export function contextWindowOf(
  provider: TextModelProviderId,
  model: string,
  catalog: readonly GatewayModel[] = [],
): number | null {
  if (provider === "vercel-ai-gateway") {
    return catalog.find((row) => row.id === model)?.contextWindow ?? null;
  }
  const shelf = TEXT_MODEL_PROVIDERS[provider].suggestModels;
  return shelf.find((row) => row.id === model)?.context ?? null;
}

/**
 * Where a run on a model with this window summarises itself, in tokens:
 * `BOT_RUN.compactHeadroom` of the window, or `BOT_RUN.compactAt` when the window
 * is unknown. What a bot's settings fill in, and what a run falls back to.
 */
export const compactAtFor = (window: number | null | undefined): number =>
  window && window > 0
    ? Math.round(window * BOT_RUN.compactHeadroom)
    : BOT_RUN.compactAt;

/** Providers that make non-text media. Kept apart from the text providers: the key is the same, but a text provider does not necessarily draw (Anthropic). */
export const mediaModelProviderSchema = z.enum([
  "openai",
  "google",
  "xai",
  "vercel-ai-gateway",
]);
export type MediaModelProviderId = z.infer<typeof mediaModelProviderSchema>;

/** The four things the studio makes or reads (ai/tools/studio.tool). */
export const MEDIA_KINDS = [
  "image",
  "video",
  "speech",
  "transcription",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const mediaModelRefSchema = z.object({
  provider: mediaModelProviderSchema,
  model: z.string().trim().min(1, "Model name is required").max(120),
});
export type MediaModelRef = z.infer<typeof mediaModelRefSchema>;

/**
 * Suggested media models per provider and kind, cheapest first; the head runs when only the
 * provider is known. Suggestions, not a validation list. Ids follow each sdk's own spelling, so
 * the gateway names the same model differently (`spacexai/…`). An empty list means the provider
 * cannot make that kind — for a model the sdk cannot build as well as one that does not exist.
 */
export const MEDIA_MODEL_PROVIDERS: Record<
  MediaModelProviderId,
  {
    label: string;
    apiKeyName: string;
    models: Record<MediaKind, SuggestModel[]>;
  }
> = {
  openai: {
    label: "Open AI",
    apiKeyName: "OPENAI_API_KEY",
    models: {
      image: [
        { id: "gpt-image-1-mini", label: "GPT Image 1 mini", tier: "small" },
        {
          id: "gpt-image-2.5-flare",
          label: "GPT Image 2.5 Flare",
          tier: "mid",
        },
        {
          id: "gpt-image-2.5-sunburst",
          label: "GPT Image 2.5 Sunburst",
          tier: "large",
        },
      ],
      // Sora exists, but the sdk's OpenAI provider has no video model (model.ts buildVideoModel)
      video: [],
      speech: [
        { id: "tts-1", label: "TTS 1", tier: "small" },
        { id: "gpt-4o-mini-tts", label: "4o mini TTS", tier: "mid" },
        { id: "tts-1-hd", label: "TTS 1 HD", tier: "large" },
      ],
      transcription: [
        {
          id: "gpt-4o-mini-transcribe",
          label: "4o mini Transcribe",
          tier: "small",
        },
        { id: "gpt-transcribe", label: "GPT Transcribe", tier: "mid" },
      ],
    },
  },
  google: {
    label: "Gemini",
    apiKeyName: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: {
      image: [
        {
          id: "gemini-3.1-flash-lite-image",
          label: "3.1 Flash Lite Image",
          tier: "small",
        },
        {
          id: "gemini-3.1-flash-image",
          label: "3.1 Flash Image",
          tier: "mid",
        },
        {
          id: "gemini-3-pro-image",
          label: "3 Pro Image",
          tier: "large",
        },
      ],
      video: [
        {
          id: "veo-3.1-lite-generate-preview",
          label: "Veo 3.1 Lite",
          tier: "small",
        },
        {
          id: "veo-3.1-fast-generate-preview",
          label: "Veo 3.1 Fast",
          tier: "mid",
        },
        { id: "veo-3.1-generate-preview", label: "Veo 3.1", tier: "large" },
      ],
      speech: [
        {
          id: "gemini-2.5-flash-preview-tts",
          label: "2.5 Flash TTS",
          tier: "small",
        },
        {
          id: "gemini-3.1-flash-tts-preview",
          label: "3.1 Flash TTS",
          tier: "mid",
        },
        {
          id: "gemini-2.5-pro-preview-tts",
          label: "2.5 Pro TTS",
          tier: "large",
        },
      ],
      transcription: [
        {
          id: "gemini-3.5-transcribe",
          label: "3.5 Transcribe",
          tier: "mid",
        },
      ],
    },
  },
  xai: {
    label: "xAI",
    apiKeyName: "XAI_API_KEY",
    models: {
      image: [
        { id: "grok-imagine-image", label: "Grok Imagine", tier: "small" },
        {
          id: "grok-imagine-image-2.0",
          label: "Grok Imagine 2.0",
          tier: "mid",
        },
      ],
      video: [
        {
          id: "grok-imagine-video",
          label: "Grok Imagine Video",
          tier: "small",
        },
        {
          id: "grok-imagine-video-1.5",
          label: "Grok Imagine Video 1.5",
          tier: "mid",
        },
      ],
      // xAI's sdk takes no id for speech or transcription; these ids are labels only (model.ts buildSpeechModel)
      speech: [{ id: "grok-tts", label: "Grok TTS", tier: "mid" }],
      transcription: [{ id: "grok-stt", label: "Grok STT", tier: "mid" }],
    },
  },
  "vercel-ai-gateway": {
    label: "Vercel AI GateWay",
    apiKeyName: "AI_GATEWAY_API_KEY",
    models: {
      image: [
        {
          id: "bytedance/seedream-5.0-lite",
          label: "Seedream 5.0 Lite",
          tier: "small",
        },
        { id: "bfl/flux-2-klein-9b", label: "FLUX 2 Klein 9B", tier: "small" },
        {
          id: "spacexai/grok-imagine-image-2.0",
          label: "Grok Imagine 2.0",
          tier: "small",
        },
        {
          id: "google/gemini-3.1-flash-image",
          label: "Gemini 3.1 Flash Image",
          tier: "mid",
        },
        { id: "bfl/flux-2-pro", label: "FLUX 2 Pro", tier: "mid" },
        {
          id: "bytedance/seedream-5.0-pro",
          label: "Seedream 5.0 Pro",
          tier: "mid",
        },
        { id: "recraft/recraft-v4.1", label: "Recraft V4.1", tier: "mid" },
        {
          id: "google/gemini-3-pro-image",
          label: "Gemini 3 Pro Image",
          tier: "large",
        },
        {
          id: "openai/gpt-image-2.5-sunburst",
          label: "GPT Image 2.5 Sunburst",
          tier: "large",
        },
      ],
      video: [
        {
          id: "bytedance/seedance-2.0-mini",
          label: "Seedance 2.0 Mini",
          tier: "small",
        },
        {
          id: "google/veo-3.1-lite-generate-001",
          label: "Veo 3.1 Lite",
          tier: "small",
        },
        {
          id: "alibaba/wan-v2.6-t2v",
          label: "Wan 2.6",
          tier: "small",
        },
        {
          id: "google/veo-3.1-fast-generate-001",
          label: "Veo 3.1 Fast",
          tier: "mid",
        },
        { id: "bytedance/seedance-2.5", label: "Seedance 2.5", tier: "mid" },
        {
          id: "spacexai/grok-imagine-video-1.5",
          label: "Grok Imagine Video 1.5",
          tier: "mid",
        },
        { id: "klingai/kling-v3.0-t2v", label: "Kling 3.0", tier: "large" },
        {
          id: "google/veo-3.1-generate-001",
          label: "Veo 3.1",
          tier: "large",
        },
      ],
      speech: [
        { id: "fish-audio/s1", label: "Fish Audio S1", tier: "small" },
        { id: "openai/tts-1", label: "OpenAI TTS 1", tier: "small" },
        { id: "spacexai/grok-tts", label: "Grok TTS", tier: "mid" },
        {
          id: "fish-audio/s2.1-pro",
          label: "Fish Audio S2.1 Pro",
          tier: "mid",
        },
        { id: "openai/tts-1-hd", label: "OpenAI TTS 1 HD", tier: "large" },
      ],
      transcription: [
        { id: "spacexai/grok-stt", label: "Grok STT", tier: "small" },
        {
          id: "fish-audio/transcribe-1",
          label: "Fish Transcribe 1",
          tier: "small",
        },
        {
          id: "openai/gpt-4o-mini-transcribe",
          label: "4o mini Transcribe",
          tier: "small",
        },
        {
          id: "openai/gpt-4o-transcribe",
          label: "4o Transcribe",
          tier: "mid",
        },
        {
          id: "google/gemini-3.5-transcribe",
          label: "Gemini 3.5 Transcribe",
          tier: "mid",
        },
      ],
    },
  },
};

/** The record above in a stable order — the pickers and the fallback walk it. */
export const MEDIA_MODEL_PROVIDER_LIST = (
  Object.keys(MEDIA_MODEL_PROVIDERS) as MediaModelProviderId[]
).map((id) => ({ id, ...MEDIA_MODEL_PROVIDERS[id] }));

/**
 * Whether a provider can make a kind; an empty list means "cannot", not "stale". The picker,
 * the save (config.const acceptsChoice) and the resolver (model.ts resolveMediaRef) all read this.
 */
export const canMakeKind = (provider: string, kind: MediaKind): boolean =>
  (MEDIA_MODEL_PROVIDERS[provider as MediaModelProviderId]?.models[kind]
    ?.length ?? 0) > 0;

/** How a pick is stored and shown: "openai/gpt-image-2". Split on the first slash only; gateway ids carry a slash of their own. */
export const formatMediaModel = (ref: MediaModelRef) =>
  `${ref.provider}/${ref.model}`;

/** `provider/model` for a text model, as the default-model config stores it. */
export function parseTextModel(value: string | undefined): TextModelRef | null {
  const [provider, ...rest] = (value ?? "").trim().split("/");
  const parsed = textModelRefSchema.safeParse({
    provider,
    model: rest.join("/"),
  });
  return parsed.success ? parsed.data : null;
}

export function parseMediaModel(
  value: string | undefined,
): MediaModelRef | null {
  const [provider, ...rest] = (value ?? "").trim().split("/");
  const parsed = mediaModelRefSchema.safeParse({
    provider,
    model: rest.join("/"),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Suggested text models per provider, cheapest first. Suggestions, not a validation list;
 * `defaultModelOf` reads tiers, not positions.
 */
export const TEXT_MODEL_PROVIDERS: Record<
  TextModelProviderId,
  {
    label: string;
    apiKeyName: string;
    suggestModels: SuggestModel[];
  }
> = {
  openai: {
    label: "Open AI",
    apiKeyName: "OPENAI_API_KEY",
    suggestModels: [
      {
        id: "gpt-5.6-luna",
        label: "5.6 Luna",
        tier: "small",
        context: 1_050_000,
      },
      {
        id: "gpt-5.6-terra",
        label: "5.6 Terra",
        tier: "mid",
        context: 1_050_000,
      },
      {
        id: "gpt-5.6-sol",
        label: "5.6 Sol",
        tier: "large",
        context: 1_050_000,
      },
      {
        id: "gpt-6-astra",
        label: "6 Astra",
        tier: "large",
        context: 1_050_000,
      },
    ],
  },
  anthropic: {
    label: "Claude",
    apiKeyName: "ANTHROPIC_API_KEY",
    suggestModels: [
      { id: "claude-haiku-4-5", label: "Haiku 4.5", tier: "small" },
      {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        tier: "mid",
        context: 1_000_000,
      },
      {
        id: "claude-opus-5",
        label: "Opus 5",
        tier: "large",
        context: 1_000_000,
      },
      { id: "claude-fable-5-1", label: "Fable 5.1", tier: "large" },
    ],
  },
  google: {
    label: "Gemini",
    apiKeyName: "GOOGLE_GENERATIVE_AI_API_KEY",
    suggestModels: [
      {
        id: "gemini-3.5-flash-lite",
        label: "3.5 Flash Lite",
        tier: "small",
        context: 1_000_000,
      },
      {
        id: "gemini-3.8-flash",
        label: "3.8 Flash",
        tier: "mid",
        context: 1_000_000,
      },
    ],
  },
  xai: {
    label: "xAI",
    apiKeyName: "XAI_API_KEY",
    suggestModels: [
      { id: "grok-4.6", label: "Grok 4.6", tier: "large", context: 500_000 },
    ],
  },
  /**
   * Cross-vendor shelf, cheapest first, shown until the live catalog arrives. Vendor names are
   * the gateway's own (xAI is `spacexai`); ids are checked against the live list (model.ts liveGatewayIds).
   */
  "vercel-ai-gateway": {
    label: "Vercel AI GateWay",
    apiKeyName: "AI_GATEWAY_API_KEY",
    suggestModels: [
      { id: "zai/glm-5.3-flash", label: "GLM 5.3 Flash", tier: "small" },
      {
        id: "google/gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        tier: "small",
      },
      {
        id: "openai/gpt-5.6-luna",
        label: "GPT 5.6 Luna",
        tier: "small",
        context: 1_050_000,
      },
      { id: "zai/glm-5.3", label: "GLM 5.3", tier: "mid" },
      {
        id: "spacexai/grok-4.6",
        label: "Grok 4.6",
        tier: "mid",
        context: 500_000,
      },
      {
        id: "anthropic/claude-sonnet-5",
        label: "Claude Sonnet 5",
        tier: "mid",
      },
      {
        id: "openai/gpt-5.6-terra",
        label: "GPT 5.6 Terra",
        tier: "mid",
        context: 1_050_000,
      },
      { id: "moonshotai/kimi-k3", label: "Kimi K3", tier: "mid" },
      {
        id: "openai/gpt-5.6-sol",
        label: "GPT 5.6 Sol",
        tier: "large",
        context: 1_050_000,
      },
      {
        id: "anthropic/claude-opus-5",
        label: "Claude Opus 5",
        tier: "large",
        context: 1_000_000,
      },
      {
        id: "openai/gpt-6-astra",
        label: "GPT 6 Astra",
        tier: "large",
        context: 1_050_000,
      },
    ],
  },
};

/** A provider's model at one tier, or its first one when it has none at that size. */
const modelOfTier = (
  provider: { suggestModels: SuggestModel[] },
  tier: ModelTier,
): string | undefined =>
  (
    provider.suggestModels.find((model) => model.tier === tier) ??
    provider.suggestModels[0]
  )?.id;

/** What a provider runs when nobody picked: the middle of its row. */
export const defaultModelOf = (provider: { suggestModels: SuggestModel[] }) =>
  modelOfTier(provider, "mid");

/**
 * The speech-to-speech backends. `models` and `voices` are suggestion lists, not validation
 * lists (the api takes more, e.g. a cloned voice id); the first model is the default. Written
 * out rather than fetched, best first.
 */
export const SPEACH_MODEL_PROVIDERS: Record<
  SpeachModelProviderId,
  {
    label: string;
    apiKeyName: string;
    /** What a key of theirs starts with (`detectSpeachProvider`); longest match wins. */
    keyPrefix: string[];
    /** Newest first — the head of this list is the default. */
    models: { id: string; label: string }[];
    voices: string[];
    defaultVoice: string;
  }
> = {
  openai: {
    apiKeyName: TEXT_MODEL_PROVIDERS.openai.apiKeyName,
    label: TEXT_MODEL_PROVIDERS.openai.label,
    keyPrefix: ["sk-"],
    models: [
      { id: "gpt-realtime-2.1", label: "Realtime 2.1" },
      { id: "gpt-realtime-2.1-mini", label: "Realtime 2.1 mini" },
      { id: "gpt-realtime-2", label: "Realtime 2" },
    ],
    // The spec's VoiceIdsShared enum; `marin` and `cedar` lead as the realtime docs' best-quality voices
    voices: [
      "marin",
      "cedar",
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "sage",
      "shimmer",
      "verse",
    ],
    defaultVoice: "marin",
  },
  xai: {
    apiKeyName: TEXT_MODEL_PROVIDERS.xai.apiKeyName,
    label: TEXT_MODEL_PROVIDERS.xai.label,
    keyPrefix: ["xai-"],
    models: [
      { id: "grok-voice-think-fast-2.0", label: "Voice Think Fast 2.0" },
      // Tracks whatever xAI ships next; second because a name that moves under a running call is not a default
      { id: "grok-voice-latest", label: "Voice latest" },
    ],
    // `eve` is xAI's own default. All built-in ids; a cloned voice from POST /v1/custom-voices goes in the same field
    voices: ["eve", "ara", "leo", "rex", "sal"],
    defaultVoice: "eve",
  },
};

/**
 * Which voice provider a pasted key belongs to; null when unknown. `sk-ant-` is excluded
 * because Anthropic keys share OpenAI's prefix and Anthropic cannot take a call.
 */
export function detectSpeachProvider(
  key: string,
): SpeachModelProviderId | null {
  const trimmed = key.trim();
  if (!trimmed || trimmed.startsWith("sk-ant-")) return null;

  let found: SpeachModelProviderId | null = null;
  let longest = 0;
  for (const id of Object.keys(
    SPEACH_MODEL_PROVIDERS,
  ) as SpeachModelProviderId[]) {
    for (const prefix of SPEACH_MODEL_PROVIDERS[id].keyPrefix) {
      if (trimmed.startsWith(prefix) && prefix.length > longest) {
        found = id;
        longest = prefix.length;
      }
    }
  }
  return found;
}

/** The record above in a stable order — the voice picker walks it. */
export const SPEACH_MODEL_PROVIDER_LIST = (
  Object.keys(SPEACH_MODEL_PROVIDERS) as SpeachModelProviderId[]
).map((id) => ({ id, ...SPEACH_MODEL_PROVIDERS[id] }));

/** The record above in a stable order — routes and pickers walk it. */
export const TEXT_MODEL_PROVIDER_LIST = (
  Object.keys(TEXT_MODEL_PROVIDERS) as TextModelProviderId[]
).map((id) => ({ id, ...TEXT_MODEL_PROVIDERS[id] }));

/**
 * A provider as the settings screen sees it: what it is called, whether a key
 * is set, and a few model names worth suggesting.
 */
export type AiProvider = {
  id: TextModelProviderId;
  label: string;
  apiKeyName: string;
  hasKey: boolean;
  suggestModels: SuggestModel[];
};

/** What a gateway row can be picked as: text, one of the studio kinds, or a word this app offers nowhere (embedding, reranking, realtime). */
export const GATEWAY_TEXT = "language";

/** The gateway tag a text model must carry: a bot that cannot call a tool cannot do a job. */
export const GATEWAY_TOOL_USE = "tool-use";

/**
 * How the gateway bills one model, flattened in `readGatewayCatalog` from the ten
 * shapes its pricing answers with. A null price is "the gateway did not say", never zero.
 */
export type GatewayPrice = {
  /** USD per 1M tokens; null when the model is not billed per token at all. */
  in: number | null;
  out: number | null;
  /** The unit when it is not tokens ("$0.2/s 720p"), or what qualifies the token price ("tiered"). */
  note: string | null;
  free: boolean;
};

/** One row of the gateway's live model list — only the gateway has one. */
export type GatewayModel = {
  /** Gateway id, "<provider>/<model>" — used as the model name. */
  id: string;
  label: string;
  /** Who runs it, the gateway's own word. Four of them are providers this app draws (provider-icon). */
  owner: string;
  /** Settled in ai/model `readGatewayCatalog`, not passed through; null when the gateway did not say. */
  type?: string | null;
  /** The gateway's own words for what a model can do; only `tool-use` is read. */
  tags: string[];
  price: GatewayPrice;
  /** The gateway has dated its retirement. */
  retiring: boolean;
  /** Context window in tokens; null when the gateway did not say. What a run compacts against (bot.run). */
  contextWindow: number | null;
};
