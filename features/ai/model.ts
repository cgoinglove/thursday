import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import {
  APICallError,
  createGateway,
  type experimental_generateVideo,
  type ImageModel,
  type LanguageModel,
  NoOutputGeneratedError,
  RetryError,
  type SpeechModel,
  type ToolSet,
  type TranscriptionModel,
} from "ai";
import { GATEWAY_LOW_CREDIT } from "@/config";
import {
  DEFAULT_MODEL_KEY,
  MEDIA_MODEL_KEYS,
} from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { clip, errorToString } from "@/lib/utils";
import { chatGptModel } from "./chatgpt";
import {
  canMakeKind,
  compactAtFor,
  contextWindowOf,
  defaultModelOf,
  GATEWAY_TEXT,
  type GatewayCredits,
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

/** How much of a raw provider body is worth reading back; a page of JSON is not. */
const PROVIDER_BODY_MAX = 300;

/**
 * A provider's refusal as one line. Only the other side can say whether a key is
 * wrong, spent, or not entitled to this model, so its own words are what a caller
 * reports. When the body did not fit the sdk's error schema the message it built is
 * the status word alone ("Unauthorized"), and the body it wrapped comes out with it.
 */
export function modelErrorToString(cause: unknown): string {
  if (!APICallError.isInstance(cause)) return errorToString(cause);
  const status = cause.statusCode ? ` (${cause.statusCode})` : "";
  const body = cause.responseBody?.trim();
  const said =
    body && !body.includes(cause.message)
      ? ` ${clip(body, PROVIDER_BODY_MAX)}`
      : "";
  return `${cause.message}${status}${said}`;
}

/**
 * What a failed model call means for the run that made it (bot.runner): `transient`
 * is trouble a moment fixes — a rate limit, an overload, a dropped connection, a call
 * that went quiet; `overflow` is a context the model refused as too long, which a
 * compaction fixes; anything else is `fatal`, a person's to act on (a key, the credit,
 * a model id). The sdk wraps retries and causes, so the whole chain is read.
 */
export type ModelFailure = "transient" | "overflow" | "fatal";

/** Connection failures by the code Node or undici gives them. */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * How providers word a context too long for the model; the sdk has no error class for
 * it. Read off a 400 or a 413, or off an error with no status of its own — a retry
 * wrapper repeats the words of the one it wraps.
 */
const TOO_LONG =
  /context[ _-]?(length|window)|maximum context|prompt is too long|too many (input )?tokens|input token count|exceeds? the (maximum|model'?s?) (context|input|prompt|number of tokens)|maximum prompt length|request (entity )?too large/i;

export function modelFailureOf(cause: unknown): ModelFailure {
  let transient = false;
  for (const error of causeChain(cause)) {
    const { statusCode, isRetryable, code, name, message } = error as {
      statusCode?: unknown;
      isRetryable?: unknown;
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    const body = APICallError.isInstance(error)
      ? (error.responseBody ?? "")
      : "";
    if (
      (statusCode === undefined || statusCode === 400 || statusCode === 413) &&
      TOO_LONG.test(`${String(message ?? "")} ${body}`)
    ) {
      return "overflow";
    }
    if (
      isRetryable === true ||
      name === "TimeoutError" ||
      NoOutputGeneratedError.isInstance(error) ||
      (typeof statusCode === "number" &&
        (statusCode === 408 ||
          statusCode === 409 ||
          statusCode === 429 ||
          statusCode >= 500)) ||
      (typeof code === "string" && NETWORK_CODES.has(code))
    ) {
      transient = true;
    }
  }
  return transient ? "transient" : "fatal";
}

/** An error and everything it wraps — its `cause`, each attempt of a retry. */
function causeChain(cause: unknown): object[] {
  const chain: object[] = [];
  const queue: unknown[] = [cause];
  while (queue.length && chain.length < 12) {
    const next = queue.shift();
    if (typeof next !== "object" || next === null || chain.includes(next)) {
      continue;
    }
    chain.push(next);
    if (RetryError.isInstance(next)) queue.push(...next.errors);
    if ("cause" in next) queue.push(next.cause);
  }
  return chain;
}

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
    case "chatgpt":
      // Signs every request with the stored sign-in itself (ai/chatgpt), so no key is passed
      return { ref, model: chatGptModel(ref.model), searchTools: null };
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
  context_window?: number | null;
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
  const videoClip = Array.isArray(pricing.video_duration_pricing)
    ? pricing.video_duration_pricing[0]
    : null;
  if (videoClip)
    return {
      in: null,
      out: null,
      note: `$${videoClip.cost_per_second}/s ${videoClip.resolution}`,
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
        contextWindow:
          typeof row.context_window === "number" && row.context_window > 0
            ? row.context_window
            : null,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  catalogCache = { at: Date.now(), models: list };
  return list;
}

/** Unlike the listing, this answers only to a key. */
const GATEWAY_CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

/**
 * What is left on the gateway key. The gateway is the one provider that tells this to the key
 * a user typed; the others keep a balance behind an admin key. A key it turns away is a state
 * of that key, not a failed read, so it comes back as `refused` in the gateway's own words.
 */
export async function readGatewayCredits(): Promise<GatewayCredits | null> {
  const apiKey = await readConfig(
    TEXT_MODEL_PROVIDERS["vercel-ai-gateway"].apiKeyName,
  );
  if (!apiKey) return null;

  const response = await fetch(GATEWAY_CREDITS_URL, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  }).catch((cause: unknown) => {
    logger.warn({ cause }, "gateway credits unreachable");
    publicError("Could not reach the gateway");
  });

  const body = (await response.json().catch(() => null)) as {
    balance?: string;
    error?: { message?: string };
  } | null;
  const said = clip(body?.error?.message ?? "", PROVIDER_BODY_MAX);

  if (response.status === 401 || response.status === 403)
    return { refused: said || `The gateway answered ${response.status}` };
  if (!response.ok)
    publicError(
      `The gateway answered ${response.status}${said ? `: ${said}` : ""}`,
    );

  const balance = Number(body?.balance);
  if (!body?.balance || !Number.isFinite(balance))
    publicError("The gateway did not say what is left");
  return { balance, low: balance <= GATEWAY_LOW_CREDIT };
}

/**
 * Where a run summarises itself, in tokens (bot.run): what the bot's owner set,
 * else the model's own window worked out the same way the settings screen does
 * (model.schema compactAtFor). An unknown window falls back to `BOT_RUN.compactAt`,
 * which assumes the window a current model carries.
 */
export async function compactBudget(
  ref: TextModelRef,
  /** What the bot's owner set, if anything (bot.compactAt); it wins. */
  chosen?: number | null,
): Promise<number> {
  if (chosen && chosen > 0) return chosen;
  // Never worth failing a run over: an unreachable catalog is a fallback, not an error
  const catalog =
    ref.provider === "vercel-ai-gateway"
      ? await readGatewayCatalog().catch(() => [])
      : [];
  return compactAtFor(contextWindowOf(ref.provider, ref.model, catalog));
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
  const { label, apiKeyName, signIn } = TEXT_MODEL_PROVIDERS[ref.provider];
  const apiKey = await readConfig(apiKeyName);
  if (!apiKey) {
    publicError(
      signIn
        ? `${label} is not signed in — sign in from Config.`
        : `No ${label} key — add one in Config.`,
    );
  }
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
