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
  type GatewayPrice,
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

/** One shelf for the app: the listing is the same for everyone, key or no key. */
let catalogCache: { at: number; models: GatewayModel[] } | null = null;

/**
 * The gateway's own listing, the one vercel.com/ai-gateway/models draws from. The SDK's
 * `getAvailableModels` reads a different endpoint (/v4/ai/config), carries 27 fewer models
 * and drops tags in its schema, so the catalog is read here instead. It answers
 * unauthenticated: the shelf is browsable before a key is set.
 */
const GATEWAY_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

/** One row as the gateway sends it; only the fields a picker reads are named. */
type CatalogRow = {
  id?: string;
  name?: string;
  owned_by?: string;
  type?: string | null;
  tags?: string[] | null;
  deprecated_at?: number | null;
  modalities?: { output?: string[] | null } | null;
  pricing?: Record<string, unknown> | null;
};

/** USD per 1M tokens from the gateway's per-token string. Null is "it did not say", never zero. */
function per1M(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 1e6 * 1e4) / 1e4 : null;
}

/**
 * What a row may be offered as. The gateway's own word is right except for the models that
 * both talk and draw — Gemini's `*-image` family answers `language`, and a picker that
 * believed it would leave them out of the image list. Their output modality gives them away.
 */
function kindOfGatewayModel(row: CatalogRow) {
  const type = row.type ?? null;
  if (type === GATEWAY_TEXT && (row.modalities?.output ?? []).includes("image"))
    return "image";
  return type;
}

/**
 * The gateway bills ten different ways; this is the one place that knows it. Billed by the
 * second or the character, a token price would misstate the model, so the unit replaces it;
 * where tokens do price it, anything that qualifies them rides along as a note.
 */
function priceOfGatewayModel(row: CatalogRow): GatewayPrice {
  const pricing = (row.pricing ?? {}) as Record<string, any>;
  const tokensIn = per1M(pricing.input);
  const out = per1M(pricing.output);

  if ((row.tags ?? []).includes("free") || tokensIn === 0)
    return { in: 0, out: 0, note: null, free: true };

  const perSecond =
    pricing.transcription_duration_cost_per_second ??
    pricing.realtime_session_duration_cost_per_second;
  if (perSecond)
    return { in: null, out: null, note: `$${perSecond}/s`, free: false };
  if (pricing.speech_input_character_cost)
    return { in: null, out: null, note: "per character", free: false };
  const clip = Array.isArray(pricing.video_duration_pricing)
    ? pricing.video_duration_pricing[0]
    : null;
  if (clip)
    return {
      in: null,
      out: null,
      note: `$${clip.cost_per_second}/s ${clip.resolution}`,
      free: false,
    };

  const perImage = pricing.image
    ? `$${pricing.image}/image`
    : pricing.image_dimension_quality_pricing
      ? "per image, by size"
      : null;
  if (tokensIn === null && out === null)
    return { in: null, out: null, note: perImage, free: false };

  return {
    in: tokensIn,
    out,
    note: pricing.input_tiers
      ? "tiered"
      : pricing.varies_by_provider
        ? "varies"
        : perImage && "+ per image",
    free: false,
  };
}

/**
 * What the gateway carries now, every modality in one listing. Rows come back with their kind
 * settled (`kindOfGatewayModel`) and their price flattened (`priceOfGatewayModel`), so a screen
 * filters and sorts on plain fields. The gateway is the only provider that can be asked.
 */
export async function readGatewayCatalog(): Promise<GatewayModel[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL)
    return catalogCache.models;

  const response = await fetch(GATEWAY_CATALOG_URL, {
    headers: { accept: "application/json" },
  }).catch((cause: unknown) => {
    logger.warn({ cause }, "gateway catalog unreachable");
    publicError("Could not reach the gateway");
  });
  if (!response.ok) publicError(`The gateway answered ${response.status}`);

  const body = (await response.json()) as { data?: CatalogRow[] };
  const list = (body.data ?? [])
    .filter((row): row is CatalogRow & { id: string } => Boolean(row.id))
    .map(
      (row): GatewayModel => ({
        id: row.id,
        label: row.name || row.id,
        owner: row.owned_by || row.id.slice(0, row.id.indexOf("/")),
        type: kindOfGatewayModel(row),
        tags: row.tags ?? [],
        price: priceOfGatewayModel(row),
        retiring: Boolean(row.deprecated_at),
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  catalogCache = { at: Date.now(), models: list };
  return list;
}

/**
 * The gateway shelf as a set of ids. Null means it could not be asked, which is not "not there":
 * callers keep the written rows. Only existence is checked; the gateway prices image and video
 * rows in units of their own, so it cannot order them.
 */
async function liveGatewayIds(): Promise<Set<string> | null> {
  return await readGatewayCatalog()
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
 * accepts any `vendor/model`. There is deliberately no fallback: a picture, a film or a minute of
 * speech costs real money, so a kind nobody picked returns null and the tool is simply absent
 * (tools/studio.tool) rather than running on a model nobody chose.
 */
export async function resolveMediaRef(
  kind: MediaKind,
): Promise<{ ref: MediaModelRef; apiKey: string } | null> {
  const chosen = parseMediaModel(await readConfig(MEDIA_MODEL_KEYS[kind]));
  if (!chosen) return null;
  // A chosen provider that cannot make this kind is skipped (canMakeKind); otherwise
  // `build…Model` throws and loadStudio takes both prompts down with it
  if (!canMakeKind(chosen.provider, kind)) return null;
  const apiKey = await readConfig(
    MEDIA_MODEL_PROVIDERS[chosen.provider].apiKeyName,
  );
  if (!apiKey) return null;
  return { ref: chosen, apiKey };
}

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
