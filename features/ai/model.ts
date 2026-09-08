import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import {
  createGateway,
  type experimental_generateVideo,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type ToolSet,
  type TranscriptionModel,
} from "ai";
import {
  DEFAULT_MODEL_KEY,
  MEDIA_MODEL_KEYS,
} from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import {
  canMakeKind,
  cheapestModelOf,
  defaultModelOf,
  GATEWAY_TEXT,
  type GatewayModel,
  MEDIA_MODEL_PROVIDER_LIST,
  MEDIA_MODEL_PROVIDERS,
  type MediaKind,
  type MediaModelProviderId,
  type MediaModelRef,
  parseMediaModel,
  parseTextModel,
  SPEACH_MODEL_PROVIDER_LIST,
  type SuggestModel,
  TEXT_MODEL_PROVIDER_LIST,
  TEXT_MODEL_PROVIDERS,
  type TextModelProviderId,
  type TextModelRef,
} from "./model.schema";

/**
 * Which model a run runs on, and how it is built; every path to a model goes through here.
 * Keys are read from config (env wins, config.query) and passed to the provider explicitly,
 * never picked up from ambient process env inside an SDK.
 */

/** A resolved model. Provider-native tools (web search) are built off the provider instance, not the model, so both come out of one switch. */
export type TextModel = {
  ref: TextModelRef;
  model: LanguageModel;
  /** The provider's own web search, bound to it; null when it has none (the gateway). Never handed to a bot as is: `web_search` (tools/search.tool) runs it one call down. */
  searchTools: ToolSet | null;
};

/** The one place a text provider is constructed. */
export function buildTextModel(ref: TextModelRef, apiKey: string): TextModel {
  switch (ref.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return {
        ref,
        model: openai(ref.model),
        searchTools: { search: openai.tools.webSearch() },
      };
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return {
        ref,
        model: anthropic(ref.model),
        searchTools: { search: anthropic.tools.webSearch_20260209() },
      };
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return {
        ref,
        model: google(ref.model),
        searchTools: { search: google.tools.googleSearch({}) },
      };
    }
    case "xai": {
      const xai = createXai({ apiKey });
      return {
        ref,
        model: xai(ref.model),
        searchTools: { search: xai.tools.webSearch() },
      };
    }
    case "vercel-ai-gateway": {
      const gateway = createGateway({ apiKey });
      return { ref, model: gateway(ref.model), searchTools: null };
    }
    default:
      publicError(`Not supported provider: ${String(ref.provider)}`);
  }
}

/** How long the gateway catalog is believed; a model list does not change inside a call. */
const CATALOG_TTL = 10 * 60_000;

/** Keyed by api key: each key sees a different shelf. */
let catalogCache: {
  at: number;
  key: string;
  models: GatewayModel[];
} | null = null;

/**
 * What a row may be offered as. The gateway's own word is right except for the models that
 * both talk and draw — Gemini's `*-image` family answers `language`, and a picker that
 * believed it would put drawing models in the text list.
 */
function kindOfGatewayModel(id: string, type: string | null | undefined) {
  const name = id.slice(id.indexOf("/") + 1);
  if (type === GATEWAY_TEXT && name.includes("image")) return "image";
  return type;
}

/**
 * What the gateway carries now, every modality in one listing. Rows come back with their kind
 * settled (`kindOfGatewayModel`) so a screen filters on one field. The gateway is the only
 * provider that can be asked. Throws the gateway's own message: a wrong key and an unreachable
 * network read alike without it.
 */
export async function readGatewayCatalog(
  apiKey: string,
): Promise<GatewayModel[]> {
  if (
    catalogCache &&
    catalogCache.key === apiKey &&
    Date.now() - catalogCache.at < CATALOG_TTL
  ) {
    return catalogCache.models;
  }

  const { models } = await createGateway({ apiKey })
    .getAvailableModels()
    // The SDK wraps a transport failure in a shell that says nothing useful —
    // a wrong key and an unreachable network read alike without the cause
    .catch((cause: unknown) => {
      const error = cause as { message?: string; cause?: { message?: string } };
      publicError(
        error?.cause?.message ??
          error?.message ??
          "Could not reach the gateway",
      );
    });

  const list = models
    .map(
      (model): GatewayModel => ({
        id: model.id,
        label: model.name,
        type: kindOfGatewayModel(model.id, model.modelType),
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  catalogCache = { at: Date.now(), key: apiKey, models: list };
  return list;
}

/**
 * The gateway shelf as a set of ids. Null means it could not be asked, which is not "not there":
 * callers keep the written rows. Only existence is checked; gateway pricing reports 0 for image
 * and video rows, so it cannot order them.
 */
async function liveGatewayIds(): Promise<Set<string> | null> {
  const apiKey = await readConfig(
    TEXT_MODEL_PROVIDERS["vercel-ai-gateway"].apiKeyName,
  );
  if (!apiKey) return null;

  return await readGatewayCatalog(apiKey)
    .then((models) => new Set(models.map((model) => model.id)))
    .catch(() => null);
}

/**
 * A provider's written rows minus the ones the gateway does not carry; other providers pass
 * through. Order is kept, and an empty result hands back the rows whole rather than leaving a
 * bot with no model.
 */
async function callableRows<T extends { id: string }>(
  provider: TextModelProviderId | MediaModelProviderId,
  rows: T[],
): Promise<T[]> {
  if (provider !== "vercel-ai-gateway") return rows;
  const live = await liveGatewayIds();
  if (!live) return rows;
  const kept = rows.filter((row) => live.has(row.id));
  return kept.length > 0 ? kept : rows;
}

export async function getTextModel(ref: TextModelRef): Promise<TextModel> {
  const { label, apiKeyName } = TEXT_MODEL_PROVIDERS[ref.provider];
  const apiKey = await readConfig(apiKeyName);
  if (!apiKey) publicError(`No ${label} key — add one in Config.`);
  return buildTextModel(ref, apiKey);
}

/**
 * The model when nobody picked one; a bot with no model asks here on every run (bot.run
 * resolveModel). Order: the named provider, then the default set in Settings > Models, then
 * the provider the calls run on (a voice key is also a text key, model.schema
 * SPEACH_MODEL_PROVIDERS), then any provider with a key.
 */
export async function resolveDefaultModel(
  providerId?: string,
): Promise<TextModelRef> {
  const workhorse = async (provider: {
    id: TextModelProviderId;
    suggestModels: SuggestModel[];
  }) =>
    defaultModelOf({
      suggestModels: await callableRows(provider.id, provider.suggestModels),
    });

  const named = providerId
    ? TEXT_MODEL_PROVIDER_LIST.find((v) => v.id === providerId)
    : undefined;
  // The provider the calls run on; REALTIME_PROVIDERS is a subset of the text list, so ids carry over (realtime.schema)
  const voiced = SPEACH_MODEL_PROVIDER_LIST.map((provider) => ({
    ...TEXT_MODEL_PROVIDERS[provider.id],
    id: provider.id,
  }));

  if (named) {
    const model = await workhorse(named);
    if (model) return { provider: named.id, model };
  }

  // What the user set in Settings > Models; only honoured while its key is set
  const chosen = parseTextModel(
    (await readConfig(DEFAULT_MODEL_KEY)) ?? undefined,
  );
  if (
    chosen &&
    (await readConfig(TEXT_MODEL_PROVIDERS[chosen.provider].apiKeyName))
  )
    return chosen;

  for (const provider of [...voiced, ...TEXT_MODEL_PROVIDER_LIST]) {
    if (!(await readConfig(provider.apiKeyName))) continue;
    const model = await workhorse(provider);
    if (model) {
      // Nobody picked this, so say which one answered — a run that behaves
      // oddly on a fresh install is usually running on a model nobody chose
      logger.info(`no model set, falling back to ${provider.id}/${model}`);
      return { provider: provider.id, model };
    }
  }
  publicError("No model key is set — add one in Config");
}

/**
 * The model a search runs on: this run's own when it has a native search, else the first
 * search-capable provider with a key, else null (the tool drops off the list).
 */
export async function resolveSearchModel(
  run?: TextModel | null,
): Promise<TextModel | null> {
  if (run?.searchTools) return run;

  for (const provider of TEXT_MODEL_PROVIDER_LIST) {
    const apiKey = await readConfig(provider.apiKeyName);
    // The smallest one it has: this call reads pages and hands back a
    // paragraph, and nobody upstream can tell what it ran on
    const model = cheapestModelOf(provider);
    if (!apiKey || !model) continue;
    const candidate = buildTextModel({ provider: provider.id, model }, apiKey);
    if (candidate.searchTools) return candidate;
  }
  return null;
}

/** The sdk declares this one but does not export it — read off the function that takes it. */
type VideoModel = Parameters<typeof experimental_generateVideo>[0]["model"];

/**
 * One app-wide pick per kind, stored in config as `provider/model` (config.const); the gateway
 * accepts any `vendor/model`. Falls back to the first provider with a key that can do it; null
 * means the tool is absent (tools/studio.tool).
 */
export async function resolveMediaRef(
  kind: MediaKind,
): Promise<{ ref: MediaModelRef; apiKey: string } | null> {
  const chosen = parseMediaModel(await readConfig(MEDIA_MODEL_KEYS[kind]));
  // A chosen provider that cannot make this kind is skipped (canMakeKind); otherwise
  // `build…Model` throws and loadStudio takes both prompts down with it
  if (chosen && canMakeKind(chosen.provider, kind)) {
    const apiKey = await readConfig(
      MEDIA_MODEL_PROVIDERS[chosen.provider].apiKeyName,
    );
    if (apiKey) return { ref: chosen, apiKey };
  }

  for (const provider of MEDIA_MODEL_PROVIDER_LIST) {
    if (provider.models[kind].length === 0) continue;
    const apiKey = await readConfig(provider.apiKeyName);
    if (!apiKey) continue;
    // The head of the row is the errand-priced one, but only if the provider
    // still carries it — this value goes straight into a `generate` call
    const model = (await callableRows(provider.id, provider.models[kind]))[0]
      ?.id;
    if (model) {
      logger.info(
        `no ${kind} model set, falling back to ${provider.id}/${model}`,
      );
      return { ref: { provider: provider.id, model }, apiKey };
    }
  }
  logger.warn(
    `no ${kind} model — the studio drops that tool (Config → Models)`,
  );
  return null;
}

/** The same switch as `buildTextModel`, once per kind; each provider spells its accessor slightly differently. */
export function buildImageModel(
  ref: MediaModelRef,
  apiKey: string,
): ImageModel {
  switch (ref.provider) {
    case "openai":
      return createOpenAI({ apiKey }).image(ref.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey }).image(ref.model);
    case "xai":
      return createXai({ apiKey }).image(ref.model);
    case "vercel-ai-gateway":
      return createGateway({ apiKey }).image(ref.model);
    default:
      publicError(`Not supported image provider: ${String(ref.provider)}`);
  }
}

export function buildSpeechModel(
  ref: MediaModelRef,
  apiKey: string,
): SpeechModel {
  switch (ref.provider) {
    case "openai":
      return createOpenAI({ apiKey }).speech(ref.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey }).speech(ref.model);
    case "xai":
      return createXai({ apiKey }).speech();
    case "vercel-ai-gateway":
      return createGateway({ apiKey }).speech(ref.model);
    default:
      publicError(`Not supported speech provider: ${String(ref.provider)}`);
  }
}

export function buildTranscriptionModel(
  ref: MediaModelRef,
  apiKey: string,
): TranscriptionModel {
  switch (ref.provider) {
    case "openai":
      return createOpenAI({ apiKey }).transcription(ref.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey }).transcription(ref.model);
    case "xai":
      return createXai({ apiKey }).transcription();
    case "vercel-ai-gateway":
      return createGateway({ apiKey }).transcription(ref.model);
    default:
      publicError(
        `Not supported transcription provider: ${String(ref.provider)}`,
      );
  }
}

export function buildVideoModel(
  ref: MediaModelRef,
  apiKey: string,
): VideoModel {
  switch (ref.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey }).video(ref.model);
    case "xai":
      return createXai({ apiKey }).video(ref.model);
    case "vercel-ai-gateway":
      return createGateway({ apiKey }).video(ref.model);
    default:
      publicError(`${ref.provider} has no video model`);
  }
}
