import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createXai } from "@ai-sdk/xai";
import {
  APICallError,
  createGateway,
  type experimental_generateVideo,
  type ImageModel,
  type JSONValue,
  type LanguageModel,
  RetryError,
  type SpeechModel,
  type ToolSet,
  type TranscriptionModel,
} from "ai";
import { GATEWAY_CATALOG_MS, GATEWAY_LOW_CREDIT } from "@/config";
import {
  DEFAULT_EFFORT_KEY,
  DEFAULT_MODEL_KEY,
  MEDIA_MODEL_KEYS,
} from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { clip, errorToString } from "@/lib/utils";
import { chatGptModel, chatGptSearch, readChatGptPlan } from "./chatgpt";
import {
  canMakeKind,
  compactAtFor,
  contextWindowOf,
  defaultModelOf,
  EFFORTS,
  type Effort,
  effortSchema,
  effortsOf,
  GATEWAY_OWNERS,
  type GatewayCredits,
  type GatewayModel,
  type GatewayPrice,
  MEDIA_MODEL_PROVIDERS,
  type MediaKind,
  type MediaModelProviderId,
  type MediaModelRef,
  type ModelTier,
  parseMediaModel,
  parseTextModel,
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
 * Over HTTP/2 there is no status word, so that message is empty and the body is all
 * the provider said: an empty message is in every body, and must not hide it.
 */
export function modelErrorToString(cause: unknown): string {
  if (!APICallError.isInstance(cause)) return errorToString(cause);
  const status = cause.statusCode ? `(${cause.statusCode})` : "";
  const body = cause.responseBody?.trim();
  const said =
    body && !(cause.message && body.includes(cause.message))
      ? clip(body, PROVIDER_BODY_MAX)
      : "";
  return [cause.message, status, said].filter(Boolean).join(" ");
}

/** How providers word a context too long for the model; the sdk has no error class for it. */
const TOO_LONG =
  /context[ _-]?(length|window)|maximum context|prompt is too long|too many (input )?tokens|input token count|exceeds? the (maximum|model'?s?) (context|input|prompt|number of tokens)|maximum prompt length|request (entity )?too large/i;

/**
 * Whether the model refused the context as too long, which a compaction fixes (whether
 * anything else may pass on another try is `isProviderRefusal`). Read off the words of
 * a 400, a 413, or an error with no status of its own, anywhere in the chain: a retry
 * wrapper repeats the words of the one it wraps, and a streamed body the sdk could not
 * read as an error keeps them in a bare `error` string.
 */
export function isContextOverflow(cause: unknown): boolean {
  return causeChain(cause).some((error) => {
    const {
      statusCode,
      message,
      error: inner,
    } = error as { statusCode?: unknown; message?: unknown; error?: unknown };
    if (statusCode !== undefined && statusCode !== 400 && statusCode !== 413)
      return false;
    const body = APICallError.isInstance(error) ? error.responseBody : null;
    return [message, inner, body].some(
      (words) => typeof words === "string" && TOO_LONG.test(words),
    );
  });
}

/** 4xx statuses that are a moment's trouble, not a refusal: a timeout, a conflict, a rate limit. */
const PASSING_4XX = new Set([408, 409, 429]);

/**
 * Whether the provider refused the call — the key, the credit, the model id, a request
 * it will never take — which only a person can change. Anything else broke on the way
 * (a dropped or garbled stream, an overload, a model gone quiet) and may pass on another
 * try, and so may a context refused as too long, once it is compacted.
 */
export function isProviderRefusal(cause: unknown): boolean {
  if (isContextOverflow(cause)) return false;
  return causeChain(cause).some((error) => {
    const { statusCode } = error as { statusCode?: unknown };
    return (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500 &&
      !PASSING_4XX.has(statusCode)
    );
  });
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

/**
 * Whether a picture a tool hands back reaches this model as a picture (tools/look.tool): the
 * providers whose drivers carry an image inside a tool result. The gateway is asked by the
 * provider its model id opens with (`GATEWAY_OWNERS`), since it passes the request on to it.
 */
export function seesToolImages(ref: TextModelRef): boolean {
  const SEEING: TextModelProviderId[] = [
    "openai",
    "chatgpt",
    "anthropic",
    "google",
    "xai",
  ];
  const provider =
    ref.provider === "vercel-ai-gateway"
      ? GATEWAY_OWNERS[ref.model.split("/")[0]]
      : ref.provider;
  return provider !== undefined && SEEING.includes(provider);
}

/**
 * What gets a provider to reuse the part of a request it has already read, for a run that
 * sends the same instructions and a longer conversation at every step. OpenAI and the
 * ChatGPT plan cache by themselves and are told which requests belong together (`key`:
 * one per bot in a thread, so its runs there share one); Anthropic caches only when asked,
 * and its top-level marker follows the conversation's end as it grows, a write billed at
 * 1.25× input that the next step reads back at 0.1×; the gateway sets the marker the
 * provider behind the model needs. The rest cache by themselves or not at all.
 */
export function promptCacheOptions(
  ref: TextModelRef,
  key: string | null,
): Record<string, Record<string, JSONValue>> {
  switch (ref.provider) {
    case "openai":
    case "chatgpt":
      return key ? { openai: { promptCacheKey: key } } : {};
    case "anthropic":
      return { anthropic: { cacheControl: { type: "ephemeral" } } };
    case "vercel-ai-gateway":
      return { gateway: { caching: "auto" } };
    default:
      return {};
  }
}

/** A model whose provider has no web search to bind. */
const plain = (ref: TextModelRef, model: LanguageModel): TextModel => ({
  ref,
  model,
  searchTools: null,
});

/** The one place a text provider is constructed. */
function buildTextModel(ref: TextModelRef, apiKey: string): TextModel {
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
      // Signs every request with the stored sign-in itself (ai/chatgpt), so no key is passed.
      // Without a search of its own a bot on the plan scraped result pages and was turned away
      return {
        ref,
        model: chatGptModel(ref.model),
        searchTools: { search: chatGptSearch() },
      };
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
    // A key and a model id are all these take, and none carries a search of its own
    case "mistral":
      return plain(ref, createMistral({ apiKey })(ref.model));
    case "deepseek":
      return plain(ref, createDeepSeek({ apiKey })(ref.model));
    case "groq":
      return plain(ref, createGroq({ apiKey })(ref.model));
    case "cerebras":
      return plain(ref, createCerebras({ apiKey })(ref.model));
    case "togetherai":
      return plain(ref, createTogetherAI({ apiKey })(ref.model));
    case "fireworks":
      return plain(ref, createFireworks({ apiKey })(ref.model));
    case "deepinfra":
      return plain(ref, createDeepInfra({ apiKey })(ref.model));
    case "cohere":
      return plain(ref, createCohere({ apiKey })(ref.model));
    case "vercel-ai-gateway": {
      const gateway = createGateway({ apiKey });
      return { ref, model: gateway(ref.model), searchTools: null };
    }
    default:
      publicError(`Not supported provider: ${String(ref.provider)}`);
  }
}

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
  pricing?: CatalogPricing | null;
  context_window?: number | null;
  /** How this model's reasoning can be set: a named ladder, a budget in tokens, or an on/off. */
  reasoning_options?: { type?: string; values?: string[] }[] | null;
};

/**
 * A row's prices as the gateway sends them, dollar amounts as strings, each field only where the
 * model is billed that way; only the fields `priceOfGatewayModel` reads are named.
 */
type CatalogPricing = {
  input?: string | null;
  output?: string | null;
  transcription_duration_cost_per_second?: string | null;
  realtime_session_duration_cost_per_second?: string | null;
  speech_input_character_cost?: string | null;
  video_duration_pricing?:
    | { cost_per_second?: string; resolution?: string }[]
    | null;
  image?: string | null;
  image_dimension_quality_pricing?: unknown;
  input_tiers?: unknown;
  varies_by_provider?: boolean | null;
};

/**
 * The steps of the gateway's ladder the app can actually set. A row may name a step no sdk
 * setting reaches (`max`), or price its reasoning by the token instead of by name — both come
 * back as null, which reads as "nothing to offer here" rather than as a step.
 */
function effortsOfRow(row: CatalogRow): Effort[] | null {
  const named = (row.reasoning_options ?? []).find(
    (option) => option?.type === "effort",
  );
  const kept = EFFORTS.filter((step) => named?.values?.includes(step));
  return kept.length ? kept : null;
}

/** USD per 1M tokens from the gateway's per-token string. Null is "it did not say", never zero. */
function per1M(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 1e6 * 1e4) / 1e4 : null;
}

/**
 * The gateway bills ten different ways; this is the one place that knows it. Billed by the
 * second or the character, a token price would misstate the model, so the unit replaces it;
 * where tokens do price it, anything that qualifies them rides along as a note.
 */
function priceOfGatewayModel(row: CatalogRow): GatewayPrice {
  const pricing: CatalogPricing = row.pricing ?? {};
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
  // A clip that names no price says nothing a note could show ("$undefined/s")
  if (videoClip?.cost_per_second)
    return {
      in: null,
      out: null,
      note: `$${videoClip.cost_per_second}/s ${videoClip.resolution ?? ""}`.trimEnd(),
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
 * as the gateway states it and their price flattened (`priceOfGatewayModel`), so a screen
 * filters and sorts on plain fields. The gateway is the only provider that can be asked.
 */
export async function readGatewayCatalog(): Promise<GatewayModel[]> {
  if (catalogCache && Date.now() - catalogCache.at < GATEWAY_CATALOG_MS)
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
        // The gateway's own word. A Gemini `*-image` row says `language` and lists
        // `text,image` output, but the gateway's image endpoint takes `type: "image"`
        // only, so offering one as an image model only makes a choice that always fails.
        type: row.type ?? null,
        tags: row.tags ?? [],
        price: priceOfGatewayModel(row),
        retiring: Boolean(row.deprecated_at),
        contextWindow:
          typeof row.context_window === "number" && row.context_window > 0
            ? row.context_window
            : null,
        efforts: effortsOfRow(row),
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
  const catalog = await runCatalog(ref);
  return compactAtFor(contextWindowOf(ref.provider, ref.model, catalog));
}

/** The gateway's shelf for a run on the gateway; empty for any other provider. */
async function runCatalog(ref: TextModelRef): Promise<GatewayModel[]> {
  if (ref.provider !== "vercel-ai-gateway") return [];
  // Never worth failing a run over: an unreachable catalog is a fallback, not an error
  return await readGatewayCatalog().catch(() => []);
}

/**
 * How hard a run thinks: what the bot's owner set, else the app default (Settings > Models).
 * It is sent only when the model's own ladder is known to hold it — a step a provider hands
 * straight to its API fails the whole call, so an unknown ladder runs on the model's default
 * instead of guessing. What a model quietly folds into another step is the sdk's business and
 * comes back as a warning, not an error.
 */
export async function runEffort(
  ref: TextModelRef,
  /** What the bot's owner set, if anything (bot.effort); it wins. */
  chosen?: Effort | null,
): Promise<Effort | undefined> {
  const wanted =
    chosen ?? effortSchema.safeParse(await readConfig(DEFAULT_EFFORT_KEY)).data;
  if (!wanted) return undefined;
  const catalog = await runCatalog(ref);
  return effortsOf(ref.provider, ref.model, catalog)?.includes(wanted)
    ? wanted
    : undefined;
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
        ? `${label} is not signed in — sign in from Settings › API keys.`
        : `No ${label} key — add one in Settings › API keys.`,
    );
  }
  return buildTextModel(ref, apiKey);
}

/**
 * The model when nobody picked one; a bot with no model asks here on every run (bot.run
 * resolveModel), and Settings › Models names what it answers (api/llm-model/automatic). Order:
 * the named provider, then the default set in Settings > Models, then the GPT Subscription,
 * OpenAI and xAI, then any provider with a key. The plan comes before a key, as a call in
 * writing already has it (thursday.text): the user pays for it either way, and a key bills.
 * A default picked in Settings whose key is gone stops the run and says so rather than moving
 * to another provider, which would bill one nobody chose.
 */
export async function resolveDefaultModel(
  providerId?: string,
  /** Asked by the screen to name it, not by a run: nothing to log. */
  { quiet = false }: { quiet?: boolean } = {},
): Promise<TextModelRef> {
  const workhorse = async (provider: {
    id: TextModelProviderId;
    defaultTier?: ModelTier;
    suggestModels: SuggestModel[];
  }) =>
    defaultModelOf({
      // A Free plan opens Luna alone (model.schema chatgpt): its middle one would be refused
      defaultTier:
        provider.id === "chatgpt" && (await readChatGptPlan()) === "free"
          ? "small"
          : provider.defaultTier,
      suggestModels: await callableRows(provider.id, provider.suggestModels),
    });

  const named = providerId
    ? TEXT_MODEL_PROVIDER_LIST.find((v) => v.id === providerId)
    : undefined;
  const preferred = (["chatgpt", "openai", "xai"] as const).map((id) => ({
    ...TEXT_MODEL_PROVIDERS[id],
    id,
  }));

  if (named) {
    const model = await workhorse(named);
    if (model) return { provider: named.id, model };
  }

  // What the user set in Settings > Models
  const chosen = parseTextModel(
    (await readConfig(DEFAULT_MODEL_KEY)) ?? undefined,
  );
  if (chosen) {
    const { label, apiKeyName, signIn } = TEXT_MODEL_PROVIDERS[chosen.provider];
    if (await readConfig(apiKeyName)) return chosen;
    publicError(
      signIn
        ? `The default model is ${chosen.model} on ${label}, which is signed out — sign in again, or pick another in Settings › Models.`
        : `The default model is ${chosen.model}, and there is no ${label} key any more — add it in Settings › API keys, or pick another in Settings › Models.`,
    );
  }

  for (const provider of [...preferred, ...TEXT_MODEL_PROVIDER_LIST]) {
    if (!(await readConfig(provider.apiKeyName))) continue;
    const model = await workhorse(provider);
    if (model) {
      // Nobody picked this, so say which one answered — a run that behaves
      // oddly on a fresh install is usually running on a model nobody chose
      if (!quiet)
        logger.info(`no model set, falling back to ${provider.id}/${model}`);
      return { provider: provider.id, model };
    }
  }
  publicError("No model key is set — add one in Settings › API keys.");
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
