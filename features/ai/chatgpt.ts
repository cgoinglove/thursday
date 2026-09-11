import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { formatDistanceToNowStrict } from "date-fns";
import { z } from "zod";
import { appEvents } from "@/app/api/events/app-event.server";
import { CHATGPT_SIGN_IN, CHATGPT_USAGE_HIGH } from "@/config";
import { readConfig, writeConfig } from "@/features/config/config.query";
import { logger } from "@/lib/logger";
import { oauthPage } from "@/lib/oauth-page";
import { publicError } from "@/lib/public-error";
import { createKeyedLock } from "@/lib/queue";
import { errorToString } from "@/lib/utils";
import { type SubscriptionUsage, TEXT_MODEL_PROVIDERS } from "./model.schema";

/**
 * ChatGPT as a text provider: the Codex usage a ChatGPT plan carries, in place of an API key.
 * Signing in is OpenAI's OAuth for the Codex CLI, the way other agent apps reach a plan. The
 * model is the Responses API behind chatgpt.com, which takes less than api.openai.com does;
 * `codexFetch` is the difference.
 */

/** The Codex CLI's public OAuth client. */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
/** The only redirect registered for that client, so the answer comes back to this port and no other. */
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
/**
 * Both loopbacks: `localhost` in the browser reaches whichever answers first, and an
 * address bound here outranks another app's `::` or `0.0.0.0` on the same port — so the
 * answer cannot land in someone else's server.
 */
const CALLBACK_HOSTS = ["127.0.0.1", "::1"];
const SCOPE = "openid profile email offline_access";
const CODEX_URL = "https://chatgpt.com/backend-api/codex";
/** The access token's claim naming the account and its plan. */
const AUTH_CLAIM = "https://api.openai.com/auth";
/** How this app names itself to OpenAI. */
const ORIGINATOR = "thursday";

const { apiKeyName: SIGN_IN_KEY, label: LABEL } = TEXT_MODEL_PROVIDERS.chatgpt;
const NOT_SIGNED_IN = `${LABEL} is not signed in — sign in from Config.`;

/** What a sign-in leaves in config. Tokens: it never reaches the browser. */
const SignInSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  /** When the access token runs out, epoch ms. */
  expires: z.number(),
  accountId: z.string().min(1),
  /** The plan as the token names it ("free", "plus", "pro"); null when it does not say. */
  plan: z.string().nullable(),
});
type SignIn = z.infer<typeof SignInSchema>;

type Pinned = {
  __chatgptListeners?: Server[] | null;
  __chatgptRenewal?: ReturnType<typeof createKeyedLock>;
};

/** Pinned to globalThis: next dev reloads this module, and the listeners holding the port and the renewal lane must be the originals. */
const pinned = globalThis as Pinned;

/**
 * One renewal at a time. A refresh token is spent by using it, so two requests renewing at
 * once leave one holding a token OpenAI has already retired — which signs the app out.
 */
const renewal = (pinned.__chatgptRenewal ??= createKeyedLock());

/**
 * Starts a sign-in and returns the page to send the browser to. The answer comes back to the
 * loopback port, so the app listens there until it arrives or `CHATGPT_SIGN_IN.waitMs` passes;
 * starting again replaces a sign-in still waiting.
 */
export async function startChatGptSignIn(): Promise<string> {
  stopListening();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");

  const servers: Server[] = [];
  const answer: RequestListener = (request, response) => {
    void answerCallback(request.url ?? "/", { state, verifier }).then(
      (page) => {
        response.writeHead(page.status, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(
          oauthPage(page.title, page.detail, {
            autoClose: page.status === 200,
          }),
          () => {
            if (page.last && pinned.__chatgptListeners === servers) {
              stopListening();
            }
          },
        );
      },
    );
  };

  for (const host of CALLBACK_HOSTS) {
    const server = createServer(answer);
    const failure = await new Promise<NodeJS.ErrnoException | null>(
      (resolve) => {
        server.once("error", resolve);
        server.listen(CALLBACK_PORT, host, () => resolve(null));
      },
    );
    if (!failure) {
      servers.push(server);
      continue;
    }
    // No IPv6 on this machine: nobody else can answer there either
    if (failure.code === "EADDRNOTAVAIL" || failure.code === "EAFNOSUPPORT") {
      continue;
    }
    for (const bound of servers) bound.close();
    publicError(
      failure.code === "EADDRINUSE"
        ? `Port ${CALLBACK_PORT} is in use by another app — often a ChatGPT or Codex sign-in still waiting. Finish or close it, then try again.`
        : `Could not wait for the sign-in: ${errorToString(failure)}`,
    );
  }
  pinned.__chatgptListeners = servers;
  // A page nobody finishes must not hold the port for the life of the process
  setTimeout(() => {
    if (pinned.__chatgptListeners === servers) stopListening();
  }, CHATGPT_SIGN_IN.waitMs).unref();

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    // What the Codex CLI asks for: the account's organizations in the token, and the short consent page
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: ORIGINATOR,
  }).toString();
  return url.toString();
}

function stopListening() {
  const servers = pinned.__chatgptListeners;
  pinned.__chatgptListeners = null;
  for (const server of servers ?? []) {
    server.close();
    server.closeIdleConnections();
  }
}

type CallbackPage = {
  status: number;
  title: string;
  detail: string;
  /** The sign-in is over, however it went, so the port is let go. */
  last: boolean;
};

async function answerCallback(
  path: string,
  flow: { state: string; verifier: string },
): Promise<CallbackPage> {
  const url = new URL(path, REDIRECT_URI);
  // A browser asks the same port for a favicon; that is not the answer
  if (url.pathname !== "/auth/callback") {
    return { status: 404, title: "Not found", detail: "", last: false };
  }

  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description");
    return {
      status: 400,
      title: "Sign-in failed",
      detail: description ? `${error}: ${description}` : error,
      last: true,
    };
  }
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== flow.state) {
    return {
      status: 400,
      title: "Sign-in failed",
      detail:
        "This is not the sign-in that was started. Start again from Config.",
      last: false,
    };
  }

  try {
    const signIn = await requestToken({
      grant_type: "authorization_code",
      code,
      code_verifier: flow.verifier,
      redirect_uri: REDIRECT_URI,
    });
    await writeConfig(SIGN_IN_KEY, JSON.stringify(signIn));
    // The screen that opened this page is waiting on it
    appEvents.emit({ type: "config" });
    return {
      status: 200,
      title: "Signed in to ChatGPT",
      detail: "Bots can run on your plan now. This window closes itself.",
      last: true,
    };
  } catch (cause) {
    logger.warn({ cause }, "chatgpt sign-in failed");
    return {
      status: 502,
      title: "Sign-in failed",
      detail: errorToString(cause),
      last: true,
    };
  }
}

/** The account, plan and expiry an access token carries. Read, never verified: it came from OpenAI over TLS. */
function claimsOf(access: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(access.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const auth = (payload[AUTH_CLAIM] ?? {}) as Record<string, unknown>;
    return {
      accountId:
        typeof auth.chatgpt_account_id === "string"
          ? auth.chatgpt_account_id
          : null,
      plan:
        typeof auth.chatgpt_plan_type === "string"
          ? auth.chatgpt_plan_type
          : null,
      expires: typeof payload.exp === "number" ? payload.exp * 1000 : null,
    };
  } catch {
    return { accountId: null, plan: null, expires: null };
  }
}

/** One call to OpenAI's token endpoint — the first exchange, or a renewal. A refusal comes back in its own words. */
async function requestToken(fields: Record<string, string>): Promise<SignIn> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }),
  }).catch((cause: unknown) => {
    logger.warn({ cause }, "chatgpt token endpoint unreachable");
    publicError("Could not reach ChatGPT's sign-in");
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string | { message?: string; code?: string };
    error_description?: string;
  } | null;

  const access = body?.access_token;
  if (!response.ok || !access) {
    const error = body?.error;
    const said =
      typeof error === "string"
        ? [error, body?.error_description].filter(Boolean).join(": ")
        : (error?.message ?? error?.code ?? "");
    publicError(
      `ChatGPT's sign-in answered ${response.status}${said ? `: ${said}` : ""}`,
    );
  }

  const claims = claimsOf(access);
  const refresh = body?.refresh_token ?? fields.refresh_token;
  if (!claims.accountId || !refresh) {
    publicError("ChatGPT's sign-in came back without an account");
  }
  const expiresIn = body?.expires_in;
  return {
    access,
    refresh,
    expires:
      typeof expiresIn === "number"
        ? Date.now() + expiresIn * 1000
        : (claims.expires ?? Date.now()),
    accountId: claims.accountId,
    plan: claims.plan,
  };
}

async function readSignIn(): Promise<SignIn | null> {
  const stored = await readConfig(SIGN_IN_KEY);
  if (!stored) return null;
  try {
    return SignInSchema.parse(JSON.parse(stored));
  } catch {
    return null;
  }
}

const expiring = (signIn: SignIn) =>
  signIn.expires - CHATGPT_SIGN_IN.renewBeforeMs <= Date.now();

/** The sign-in to send a request with, renewed first when its access token is about to run out. */
async function currentSignIn(): Promise<SignIn> {
  const stored = await readSignIn();
  if (!stored) publicError(NOT_SIGNED_IN);
  if (!expiring(stored)) return stored;

  return renewal(SIGN_IN_KEY, async () => {
    // Another request may have renewed it while this one waited its turn
    const latest = await readSignIn();
    if (!latest) publicError(NOT_SIGNED_IN);
    if (!expiring(latest)) return latest;
    try {
      const renewed = await requestToken({
        grant_type: "refresh_token",
        refresh_token: latest.refresh,
      });
      await writeConfig(SIGN_IN_KEY, JSON.stringify(renewed));
      return renewed;
    } catch (cause) {
      publicError(
        `Could not renew the ${LABEL} sign-in (${errorToString(cause)}). If it keeps failing, sign in again from Config.`,
      );
    }
  });
}

/** The plan the signed-in account is on, for the settings screen; null when nobody is signed in. */
export async function readChatGptPlan(): Promise<string | null> {
  return (await readSignIn())?.plan ?? null;
}

/** Answers the sign-in's own token, so no second key is needed to say what is left. */
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

type UsageWindow = {
  used_percent?: number;
  /** Epoch seconds. */
  reset_at?: number;
  reset_after_seconds?: number;
};

/**
 * How much of the plan the signed-in account has used, by its tightest window — Free has one of
 * 30 days, a paid plan a short one and a weekly one — and when that window frees up; null when
 * nobody is signed in. A sign-in the plan turns away is a state of the sign-in, not a failed
 * read, so it comes back as `refused` in OpenAI's words.
 */
export async function readChatGptUsage(): Promise<SubscriptionUsage | null> {
  if (!(await readSignIn())) return null;
  let signIn: SignIn;
  try {
    signIn = await currentSignIn();
  } catch (cause) {
    return { refused: errorToString(cause) };
  }

  const response = await fetch(USAGE_URL, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${signIn.access}`,
      "chatgpt-account-id": signIn.accountId,
      originator: ORIGINATOR,
    },
  }).catch((cause: unknown) => {
    logger.warn({ cause }, "chatgpt usage unreachable");
    publicError("Could not reach ChatGPT");
  });
  const body = (await response.json().catch(() => null)) as {
    plan_type?: string;
    rate_limit?: {
      limit_reached?: boolean;
      primary_window?: UsageWindow | null;
      secondary_window?: UsageWindow | null;
    };
    detail?: string;
    error?: { message?: string };
  } | null;

  if (response.status === 401 || response.status === 403) {
    return {
      refused:
        body?.error?.message ??
        body?.detail ??
        `ChatGPT answered ${response.status}`,
    };
  }
  if (!response.ok) publicError(`ChatGPT answered ${response.status}`);

  const tightest = [
    body?.rate_limit?.primary_window,
    body?.rate_limit?.secondary_window,
  ]
    .filter(
      (window): window is UsageWindow =>
        typeof window?.used_percent === "number",
    )
    .sort((a, b) => (b.used_percent ?? 0) - (a.used_percent ?? 0))[0];
  if (!tightest)
    publicError("ChatGPT did not say how much of the plan is used");

  const usedPercent = Math.round(tightest.used_percent ?? 0);
  const spent = Boolean(body?.rate_limit?.limit_reached);
  const resetsAt = tightest.reset_at
    ? tightest.reset_at * 1000
    : tightest.reset_after_seconds
      ? Date.now() + tightest.reset_after_seconds * 1000
      : null;
  return {
    plan: body?.plan_type ?? signIn.plan,
    usedPercent,
    resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
    spent,
    high: spent || usedPercent >= CHATGPT_USAGE_HIGH,
  };
}

/** A Codex model on the signed-in plan. */
export function chatGptModel(modelId: string): LanguageModel {
  const chatgpt = createOpenAI({
    baseURL: CODEX_URL,
    // The sdk builds no request without a key; codexFetch signs every one with the sign-in instead
    apiKey: "signed-in",
    headers: { "OpenAI-Beta": "responses=experimental" },
    fetch: codexFetch,
  });
  // One key for the model's life — a run, its compactions, its answers — so its calls share a prompt cache
  const promptCacheKey = randomUUID();
  return wrapLanguageModel({
    model: chatgpt.responses(modelId),
    middleware: {
      // Unstored: the sdk then sends whole items rather than ids the backend never kept, and asks
      // for the encrypted reasoning a stored thread needs to be replayed
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            promptCacheKey,
            ...params.providerOptions?.openai,
            store: false,
          },
        },
      }),
    },
  });
}

type CodexBody = {
  input?: { role?: string; content?: string | { text?: string }[] }[];
  instructions?: string;
  stream?: boolean;
  store?: boolean;
  max_output_tokens?: number;
};

/**
 * What the ChatGPT backend asks of a Responses call that api.openai.com does not, applied to
 * every request the sdk makes: signed with the current sign-in, so a job that outlives a token
 * renews it; always streamed and never stored; the system prompt as `instructions`, which it
 * refuses a call without; no output cap.
 */
async function codexFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const signIn = await currentSignIn();
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${signIn.access}`);
  headers.set("chatgpt-account-id", signIn.accountId);
  headers.set("originator", ORIGINATOR);

  if (
    init?.method !== "POST" ||
    typeof init.body !== "string" ||
    !String(input).endsWith("/responses")
  ) {
    return fetch(input, { ...init, headers });
  }

  const body = JSON.parse(init.body) as CodexBody;
  const streamed = body.stream === true;
  const system: string[] = [];
  body.input = (body.input ?? []).filter((item) => {
    if (item.role !== "system" && item.role !== "developer") return true;
    system.push(
      typeof item.content === "string"
        ? item.content
        : (item.content ?? []).map((part) => part.text ?? "").join("\n"),
    );
    return false;
  });
  body.instructions =
    [body.instructions, ...system].filter(Boolean).join("\n\n") ||
    "You are a helpful assistant.";
  body.store = false;
  body.stream = true;
  body.max_output_tokens = undefined;

  headers.set("accept", "text/event-stream");
  const response = await fetch(input, {
    ...init,
    headers,
    body: JSON.stringify(body),
  });
  if (response.status === 429) return usageLimitOf(response);
  if (streamed || !response.ok) return response;
  return finishedOf(response);
}

/**
 * A 429 is either a rate limit a moment fixes or the plan's usage spent until its window resets
 * — hours, or on Free a month. The second becomes a 402 in the backend's words: the sdk does not
 * retry it, and a job fails with it (model.ts modelFailureOf) instead of waking every few
 * minutes to be refused again.
 */
async function usageLimitOf(response: Response): Promise<Response> {
  const text = await response.text();
  let said: {
    code?: string;
    type?: string;
    plan_type?: string;
    resets_at?: number;
    resets_in_seconds?: number;
  } = {};
  try {
    said = (JSON.parse(text) as { error?: typeof said }).error ?? {};
  } catch {}

  if (
    !/usage_limit_reached|usage_not_included/.test(`${said.code} ${said.type}`)
  ) {
    const retryAfter = response.headers.get("retry-after");
    return new Response(text, {
      status: 429,
      headers: {
        "content-type": "application/json",
        ...(retryAfter ? { "retry-after": retryAfter } : {}),
      },
    });
  }

  const resets = said.resets_at
    ? said.resets_at * 1000
    : said.resets_in_seconds
      ? Date.now() + said.resets_in_seconds * 1000
      : null;
  const plan = said.plan_type ? ` on the ${said.plan_type} plan` : "";
  const when = resets
    ? ` It resets in ${formatDistanceToNowStrict(resets)}.`
    : "";
  return Response.json(
    {
      error: {
        message: `${LABEL} usage limit reached${plan}.${when}`,
        code: said.code ?? said.type,
      },
    },
    { status: 402 },
  );
}

type StreamEvent = {
  type?: string;
  item?: unknown;
  response?: {
    output?: unknown[];
    error?: { code?: string; message?: string } | null;
  };
  code?: string;
  message?: string;
};

/**
 * The one JSON body a caller that did not stream expects, read off the stream the backend
 * insists on. The finished event's `output` arrives empty, so items are gathered as each
 * completes. A failed response becomes an error in its own words: a 400 when it was the
 * context, which a compaction fixes, a 500 otherwise.
 */
async function finishedOf(stream: Response): Promise<Response> {
  const items: unknown[] = [];
  let finished: { output?: unknown[] } | null = null;
  let failure: { code?: string; message?: string } | null = null;

  const blocks = (await stream.text()).replaceAll("\r\n", "\n").split("\n\n");
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch {
      continue;
    }
    if (event.type === "response.output_item.done") {
      items.push(event.item);
    } else if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      finished = event.response ?? {};
    } else if (event.type === "response.failed") {
      failure = event.response?.error ?? { message: "The response failed" };
    } else if (event.type === "error") {
      failure = { code: event.code, message: event.message };
    }
  }

  if (failure || !finished) {
    return Response.json(
      {
        error: {
          message:
            failure?.message ?? "The stream ended before the response finished",
          code: failure?.code,
        },
      },
      { status: failure?.code === "context_length_exceeded" ? 400 : 500 },
    );
  }
  return Response.json({
    ...finished,
    output: finished.output?.length ? finished.output : items,
  });
}
