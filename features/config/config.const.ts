import {
  canMakeKind,
  MEDIA_MODEL_PROVIDER_LIST,
  type MediaKind,
  parseMediaModel,
  parseTextModel,
  SPEACH_MODEL_PROVIDERS,
  TEXT_MODEL_PROVIDER_LIST,
  type TextModelProviderId,
} from "@/features/ai/model.schema";

/**
 * Every config key the app reads, derived from the provider records. Values
 * are secrets and never leave the server, except entries with `choices`.
 */

export type ConfigChoice = {
  value: string;
  label: string;
  /** The key that must be set for this choice to work. */
  needs: string;
};

export type ConfigEntry = {
  key: string;
  label: string;
  hint?: string;
  /** A text model as `provider/model`, picked with the model picker. Unset is normal: `resolveDefaultModel` chooses. */
  text?: true;
  /** Whose key this is; draws the mark in front of the row. */
  provider?: TextModelProviderId;
  /** Present means a choice, not a secret: the value may be shown and served. */
  choices?: ConfigChoice[];
  /** A studio kind. The value is `provider/model`, picked with the model picker, so ids outside `choices` are accepted. */
  kind?: MediaKind;
};

/**
 * Every group id. A union, not a string, because `isCallable` looks the voice
 * group up by id and a typo there silently makes the app always callable.
 */
export const CONFIG_GROUP_IDS = [
  "voice",
  "text",
  "search",
  "bots",
  "studio",
] as const;
export type ConfigGroupId = (typeof CONFIG_GROUP_IDS)[number];

/** The group a call runs on: one of its keys must be set (config.query isCallable). */
export const VOICE_GROUP_ID: ConfigGroupId = "voice";

export type ConfigGroup = {
  id: ConfigGroupId;
  title: string;
  /** A fainter phrase beside the title saying what the set is for. */
  hint?: string;
  section: "keys" | "models";
  require: "any" | "none";
  /** The keys `require: "any"` counts; all of the group when absent. */
  requireKeys?: string[];
  /** Shown while the requirement is unmet. */
  note?: string;
  entries: ConfigEntry[];
};

/** Calls run on one of these. */
const voiceKeys = [
  ...new Set(
    Object.values(SPEACH_MODEL_PROVIDERS).map((entry) => entry.apiKeyName),
  ),
];

/** The studio model per kind, as `provider/model`. Unset means the tool is absent, not a fallback. */
export const MEDIA_MODEL_KEYS: Record<MediaKind, string> = {
  image: "IMAGE_MODEL",
  video: "VIDEO_MODEL",
  speech: "SPEECH_MODEL",
  transcription: "TRANSCRIPTION_MODEL",
};

const MEDIA_ENTRY: Record<MediaKind, { label: string; hint: string }> = {
  image: { label: "Image model", hint: "What bots draw with" },
  video: { label: "Video model", hint: "What bots film with — minutes a clip" },
  speech: { label: "Speech model", hint: "What reads text aloud into a file" },
  transcription: {
    label: "Transcription model",
    hint: "What turns a recording into text",
  },
};

/** "an image model" — how a screen names one that is missing. The article differs by kind. */
export const mediaModelWords = (kind: MediaKind) =>
  `${kind === "image" ? "an" : "a"} ${kind} model`;

/** Each of these costs real money per call, so none is offered until it is picked (ai/model resolveMediaRef). */

const mediaEntry = (kind: MediaKind): ConfigEntry => ({
  key: MEDIA_MODEL_KEYS[kind],
  ...MEDIA_ENTRY[kind],
  kind,
  // For labels only; the picker does the choosing (config-setting MediaDialog)
  choices: MEDIA_MODEL_PROVIDER_LIST.flatMap((provider) =>
    provider.models[kind].map((model) => ({
      value: `${provider.id}/${model.id}`,
      label: `${provider.label} · ${model.label}`,
      needs: provider.apiKeyName,
    })),
  ),
});

/**
 * What a bot searches the web with. Set, every bot searches through Exa in one HTTP call;
 * unset, only a bot whose own model carries a native search has the tool at all — there is
 * no borrowed model to search on (ai/tools/search.tool).
 */
export const EXA_API_KEY = "EXA_API_KEY";

/** What a bot runs on when it has not picked its own model (bot.schema `provider`/`model`). */
export const DEFAULT_MODEL_KEY = "DEFAULT_MODEL";

const defaultModelEntry: ConfigEntry = {
  key: DEFAULT_MODEL_KEY,
  label: "Default model",
  hint: "What a bot thinks with until it picks its own",
  text: true,
  // For labels only; the picker does the choosing, and typed ids are accepted
  choices: TEXT_MODEL_PROVIDER_LIST.flatMap((provider) =>
    provider.suggestModels.map((model) => ({
      value: `${provider.id}/${model.id}`,
      label: `${provider.label} · ${model.label}`,
      needs: provider.apiKeyName,
    })),
  ),
};

/**
 * Whether a value may be stored for an entry. Model entries accept ids outside
 * `choices` — the provider must be one that can serve them; a bad model id
 * would fail in the next call, not here.
 */
export function acceptsChoice(entry: ConfigEntry, value: string): boolean {
  if (entry.kind) {
    const ref = parseMediaModel(value);
    return ref !== null && canMakeKind(ref.provider, entry.kind);
  }
  if (entry.text) return parseTextModel(value) !== null;
  return Boolean(entry.choices?.some((choice) => choice.value === value));
}

/**
 * Keys split by what they buy: one voice key keeps calls alive, the rest only
 * widen what bots can reach. The split is the requirement — a group that must
 * have something set says so, and the others say nothing.
 */
const isVoiceKey = (provider: { apiKeyName: string }) =>
  voiceKeys.includes(provider.apiKeyName);

const keyEntry = (provider: (typeof TEXT_MODEL_PROVIDER_LIST)[number]) => ({
  key: provider.apiKeyName,
  label: provider.label,
  provider: provider.id,
});

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: "voice",
    title: "voice",
    hint: "calls run on one of these",
    section: "keys",
    require: "any",
    note: "one is required",
    entries: TEXT_MODEL_PROVIDER_LIST.filter(isVoiceKey).map(keyEntry),
  },
  {
    id: "text",
    title: "models",
    hint: "what bots think with — add any, or none",
    section: "keys",
    require: "none",
    entries: TEXT_MODEL_PROVIDER_LIST.filter(
      (provider) => !isVoiceKey(provider),
    ).map(keyEntry),
  },
  {
    id: "search",
    title: "search",
    hint: "how bots look things up — one key, or their own model's",
    section: "keys",
    require: "none",
    entries: [
      {
        key: EXA_API_KEY,
        label: "Exa",
        hint: "web search in one call — dashboard.exa.ai",
      },
    ],
  },
  {
    id: "bots",
    title: "Bots",
    hint: "what a bot runs on when it has not picked its own",
    section: "models",
    require: "none",
    entries: [defaultModelEntry],
  },
  {
    id: "studio",
    title: "Studio",
    hint: "what a bot draws, films and speaks with — off until you pick one",
    section: "models",
    require: "none",
    entries: (Object.keys(MEDIA_MODEL_KEYS) as MediaKind[]).map(mediaEntry),
  },
];

export const CONFIG_ENTRIES: Record<string, ConfigEntry> = Object.fromEntries(
  CONFIG_GROUPS.flatMap((group) => group.entries).map((entry) => [
    entry.key,
    entry,
  ]),
);

/** The only keys the write action accepts. */
export const CONFIG_KEYS = CONFIG_GROUPS.flatMap((group) =>
  group.entries.map((entry) => entry.key),
);

/** Choice entries: the only keys whose value may be served. */
export const CONFIG_CHOICES: Record<string, ConfigChoice[]> =
  Object.fromEntries(
    CONFIG_GROUPS.flatMap((group) => group.entries)
      .filter((entry) => entry.choices?.length)
      .map((entry) => [entry.key, entry.choices as ConfigChoice[]]),
  );

/** What /api/config returns; never a secret's value. */
export type ConfigStatus = {
  key: string;
  set: boolean;
  /** Choice entries only. */
  value?: string;
};

export function isConfigSet(
  status: ConfigStatus[] | undefined,
  key: string,
): boolean {
  return status?.some((entry) => entry.key === key && entry.set) ?? false;
}

export function groupSatisfied(
  group: ConfigGroup,
  isSet: (key: string) => boolean,
): boolean {
  if (group.require === "none") return true;
  const keys = group.requireKeys ?? group.entries.map((entry) => entry.key);
  return keys.some(isSet);
}
