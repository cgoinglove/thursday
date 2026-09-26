import { KEY_LOW_CREDIT } from "@/config";
import { readConfig } from "@/features/config/config.query";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { clip } from "@/lib/utils";
import {
  CATALOG_TEXT,
  CATALOG_TOOL_USE,
  type CatalogModel,
  type CatalogPrice,
  EFFORTS,
  type Effort,
  type KeyCredits,
  TEXT_MODEL_PROVIDERS,
} from "./model.schema";

/**
 * OpenRouter as a catalog provider: its public model list read into the rows the gateway's
 * shelf draws (model-browser), and what is left on its key. Running a model is the sdk's
 * (`@openrouter/ai-sdk-provider`, built in ai/model buildTextModel).
 */

/** The listing openrouter.ai/models draws from. It answers without a key. */
const CATALOG_URL = "https://openrouter.ai/api/v1/models";
/** Credit bought and used on the account the key belongs to; answers to the key alone. */
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";

/** How much of a refusal's body is worth showing. */
const BODY_MAX = 300;

/**
 * OpenRouter's vendor names where the gateway's differ, so a row's mark and what its provider
 * can do are read through one table (model.schema VENDOR_PROVIDERS, vendor-mark). A vendor
 * named alike in both needs no line; one not here keeps OpenRouter's word and draws no mark.
 */
const AS_GATEWAY: Record<string, string> = {
  "x-ai": "spacexai",
  "z-ai": "zai",
  mistralai: "mistral",
  "meta-llama": "meta",
  qwen: "alibaba",
  "bytedance-seed": "bytedance",
};

/** One row as OpenRouter sends it; only the fields a picker or a run reads are named. */
type Row = {
  id?: string;
  name?: string;
  context_length?: number | null;
  architecture?: { output_modalities?: string[] | null } | null;
  /** Dollars per token (or per unit) as strings; `-1` where the price is set per request (`openrouter/auto`). */
  pricing?: { prompt?: string | null; completion?: string | null } | null;
  supported_parameters?: string[] | null;
  expiration_date?: string | null;
  reasoning?: { supported_efforts?: string[] | null } | null;
};

/**
 * The vendor a row is made by, in the gateway's words. An id opening with `~` is OpenRouter's
 * alias that follows a vendor's latest model (`~openai/gpt-latest`); its vendor is the same.
 */
export const vendorOf = (id: string) => {
  const vendor = id.slice(0, id.indexOf("/")).replace(/^~/, "");
  return AS_GATEWAY[vendor] ?? vendor;
};

/** USD per 1M tokens from a per-token string. Null is "it did not say" or a per-request price, never zero. */
function per1M(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 1e6 * 1e4) / 1e4;
}

function priceOf(row: Row): CatalogPrice {
  const tokensIn = per1M(row.pricing?.prompt);
  const out = per1M(row.pricing?.completion);
  if (tokensIn === 0 && out === 0)
    return { in: 0, out: 0, note: null, free: true };
  return {
    in: tokensIn,
    out,
    // `openrouter/auto` is billed as whichever model it routes to
    note: tokensIn === null && out === null ? "per model it picks" : null,
    free: false,
  };
}

/** The steps OpenRouter lists for a model that the app can set; `max` has no sdk setting. */
function effortsOf(row: Row): Effort[] | null {
  const listed = row.reasoning?.supported_efforts ?? [];
  const kept = EFFORTS.filter((step) => listed.includes(step));
  return kept.length ? kept : null;
}

/**
 * Every model OpenRouter lists, in the words the shelf reads: a model that writes text is a
 * text row whatever else it makes, and one that takes `tools` is tagged as able to call them.
 * Image and audio rows are listed too but no studio kind reads them: the studio's models are
 * built from the providers that make media (model.schema MEDIA_MODEL_PROVIDERS).
 */
export async function fetchOpenRouterCatalog(): Promise<CatalogModel[]> {
  const response = await fetch(CATALOG_URL, {
    headers: { accept: "application/json" },
  }).catch((cause: unknown) => {
    logger.warn({ cause }, "openrouter catalog unreachable");
    publicError("Could not reach OpenRouter");
  });
  if (!response.ok) publicError(`OpenRouter answered ${response.status}`);

  const body = (await response.json()) as { data?: Row[] };
  return (body.data ?? [])
    .filter((row): row is Row & { id: string } => Boolean(row.id))
    .map(
      (row): CatalogModel => ({
        id: row.id,
        label: row.name || row.id,
        owner: vendorOf(row.id),
        type: (row.architecture?.output_modalities ?? []).includes("text")
          ? CATALOG_TEXT
          : null,
        tags: (row.supported_parameters ?? []).includes("tools")
          ? [CATALOG_TOOL_USE]
          : [],
        price: priceOf(row),
        retiring: Boolean(row.expiration_date),
        contextWindow:
          typeof row.context_length === "number" && row.context_length > 0
            ? row.context_length
            : null,
        efforts: effortsOf(row),
      }),
    );
}

/**
 * What is left on the account the OpenRouter key belongs to: credit bought less credit used.
 * A key it turns away is a state of that key, not a failed read, so it comes back as `refused`
 * in OpenRouter's own words.
 */
export async function readOpenRouterCredits(): Promise<KeyCredits | null> {
  const apiKey = await readConfig(TEXT_MODEL_PROVIDERS.openrouter.apiKeyName);
  if (!apiKey) return null;

  const response = await fetch(CREDITS_URL, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  }).catch((cause: unknown) => {
    logger.warn({ cause }, "openrouter credits unreachable");
    publicError("Could not reach OpenRouter");
  });

  const body = (await response.json().catch(() => null)) as {
    data?: { total_credits?: number; total_usage?: number };
    error?: { message?: string };
  } | null;
  const said = clip(body?.error?.message ?? "", BODY_MAX);

  if (response.status === 401 || response.status === 403)
    return { refused: said || `OpenRouter answered ${response.status}` };
  if (!response.ok)
    publicError(
      `OpenRouter answered ${response.status}${said ? `: ${said}` : ""}`,
    );

  const bought = body?.data?.total_credits;
  const used = body?.data?.total_usage;
  if (typeof bought !== "number" || typeof used !== "number")
    publicError("OpenRouter did not say what is left");
  const balance = bought - used;
  return { balance, low: balance <= KEY_LOW_CREDIT };
}
