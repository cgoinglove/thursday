import {
  auth,
  type CallToolResult,
  createMCPClient,
  type MCPClient,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientProvider,
  type OAuthTokens,
  UnauthorizedError,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { APP_NAME, APP_URL } from "@/config";
import { logger } from "@/lib/logger";
import { errorToString } from "@/lib/utils";
import {
  findServer,
  findServerByOAuthState,
  saveConnectionError,
  saveOAuthData,
  syncServerTools,
} from "./mcp.query";
import {
  isRemoteConfig,
  type MCPOAuthData,
  type MCPServerConfig,
  type MCPToolInfo,
} from "./mcp.schema";

/**
 * MCP connection manager and the one instance this app runs. A session opens
 * on first use, every tool call pushes the idle timer back, and the next call
 * after it closes reconnects with stored credentials. Callers only handle
 * `auth_required`.
 */

export interface StoredMcpServer {
  name: string;
  config: MCPServerConfig;
  oauth?: MCPOAuthData | null;
}

export interface McpServerStore {
  /** The whole row including the oauth blob. Null when the name is unknown. */
  load(name: string): Promise<StoredMcpServer | null>;
  /** Replace a server's oauth blob (null clears it). */
  saveOAuth(name: string, oauth: MCPOAuthData | null): Promise<void>;
  /** Record what a connect produced: tools on success, an error otherwise. */
  saveConnectionResult(
    name: string,
    result: { toolInfo: MCPToolInfo[]; lastError: string | null },
  ): Promise<void>;
  /** Reverse lookup for the OAuth callback — which server started this `state`. */
  findByOAuthState(state: string): Promise<StoredMcpServer | null>;
}

export type ConnectOutcome =
  | { status: "connected"; tools: MCPToolInfo[] }
  /** The server wants the user in front of a browser. Send them to `authorizationUrl`. */
  | { status: "auth_required"; authorizationUrl: string };

/** Thrown from `callTool` when no session can exist without re-authorizing. */
export class McpAuthRequiredError extends Error {
  constructor(
    public readonly serverName: string,
    public readonly authorizationUrl?: string,
  ) {
    super(`MCP server "${serverName}" requires authorization`);
    this.name = "McpAuthRequiredError";
  }
}

export interface McpManagerOptions {
  /** The absolute URL the authorization server redirects back to. */
  callbackUrl: string;
  /** How long an unused session stays open. 30 minutes by default. */
  idleTtlMs?: number;
  /** The client name announced to servers and registered at DCR time. */
  clientName?: string;
}

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * An `OAuthClientProvider` whose persistence hooks write through the store.
 * On a 401 the SDK discovers the AS, registers a client (DCR), saves the PKCE
 * verifier and `state`, then calls `redirectToAuthorization`. Server-side
 * there is nobody to redirect, so the URL is kept in `lastAuthorizationUrl`.
 */
class StoreOAuthProvider implements OAuthClientProvider {
  lastAuthorizationUrl?: URL;

  constructor(
    private readonly store: McpServerStore,
    private readonly serverName: string,
    private oauth: MCPOAuthData,
    private readonly callbackUrl: string,
    private readonly clientName: string,
    /** A hand-registered client, for servers that will not do DCR. */
    private readonly staticClient?: OAuthClientInformation,
  ) {}

  get redirectUrl() {
    return this.callbackUrl;
  }

  get clientMetadata() {
    return {
      client_name: this.clientName,
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  /** Every change rewrites the whole blob: one writer, no half states. */
  private async persist(patch: Partial<MCPOAuthData>) {
    this.oauth = { ...this.oauth, ...patch };
    await this.store.saveOAuth(this.serverName, this.oauth);
  }

  // Config beats the stored blob: fixing a client id in the form has to take
  // effect without hand-clearing the credentials.
  clientInformation() {
    return (
      this.staticClient ??
      (this.oauth.clientInformation as OAuthClientInformation | undefined)
    );
  }
  async saveClientInformation(info: OAuthClientInformation) {
    await this.persist({ clientInformation: info });
  }

  tokens() {
    return this.oauth.tokens as OAuthTokens | undefined;
  }
  async saveTokens(tokens: OAuthTokens) {
    await this.persist({ tokens });
  }

  authorizationServerInformation() {
    return this.oauth.authorizationServer as
      | OAuthAuthorizationServerInformation
      | undefined;
  }
  async saveAuthorizationServerInformation(
    info: OAuthAuthorizationServerInformation,
  ) {
    await this.persist({
      authorizationServer:
        info as unknown as MCPOAuthData["authorizationServer"],
    });
  }

  codeVerifier() {
    if (!this.oauth.codeVerifier) throw new Error("No code verifier saved");
    return this.oauth.codeVerifier;
  }
  async saveCodeVerifier(codeVerifier: string) {
    await this.persist({ codeVerifier });
  }

  /** `state` doubles as the routing key that brings the callback back here. */
  state() {
    return crypto.randomUUID();
  }
  async saveState(state: string) {
    await this.persist({ state });
  }
  storedState() {
    return this.oauth.state;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.lastAuthorizationUrl = authorizationUrl;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    const next: MCPOAuthData = { ...this.oauth };
    if (scope === "all" || scope === "client")
      next.clientInformation = undefined;
    if (scope === "all" || scope === "tokens") next.tokens = undefined;
    if (scope === "all" || scope === "verifier") next.codeVerifier = undefined;
    this.oauth = next;
    await this.store.saveOAuth(this.serverName, next);
  }
}

interface Session {
  client: MCPClient;
  idleTimer: ReturnType<typeof setTimeout>;
}

export class McpManager {
  private readonly sessions = new Map<string, Session>();
  /** Collapses concurrent connects to the same server. */
  private readonly connecting = new Map<string, Promise<ConnectOutcome>>();
  private readonly idleTtlMs: number;
  private readonly callbackUrl: string;
  private readonly clientName: string;

  constructor(
    private readonly store: McpServerStore,
    options: McpManagerOptions,
  ) {
    this.callbackUrl = options.callbackUrl;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.clientName = options.clientName ?? APP_NAME;
  }

  /** Connect (or reconnect) and sync the tool list. The outcome is also written through the store. */
  async connect(name: string): Promise<ConnectOutcome> {
    const pending = this.connecting.get(name);
    if (pending) return pending;

    const attempt = this.doConnect(name).finally(() =>
      this.connecting.delete(name),
    );
    this.connecting.set(name, attempt);
    return attempt;
  }

  /**
   * Run a tool, opening or reviving the session if needed. Every call pushes the idle timer back.
   * `signal` is the only bound: the client waits forever when given none.
   */
  async callTool(
    name: string,
    tool: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const client = await this.ensureClient(name);
    try {
      const result = await client.callTool({
        name: tool,
        arguments: args,
        options: signal ? { signal } : undefined,
      });
      this.touch(name);
      return result;
    } catch (error) {
      // The transport already tried refreshing before giving up, so this
      // session is unrecoverable without a person. Drop it and say so.
      if (error instanceof UnauthorizedError) {
        await this.closeSession(name);
        throw new McpAuthRequiredError(name);
      }
      throw error;
    }
  }

  /** The OAuth callback: `state` says which server, `code` buys the tokens. Returns the server name. */
  async finishAuthorization(params: URLSearchParams): Promise<string> {
    const state = params.get("state");
    const code = params.get("code");
    if (!state || !code) {
      throw new Error("OAuth callback is missing code or state");
    }

    const row = await this.store.findByOAuthState(state);
    if (!row || !isRemoteConfig(row.config)) {
      throw new Error("No server is waiting for this authorization");
    }

    const provider = this.providerFor(row);
    const result = await auth(provider, {
      serverUrl: row.config.url,
      authorizationCode: code,
      callbackState: state,
    });
    if (result !== "AUTHORIZED") {
      throw new Error(`Token exchange ended in "${result}"`);
    }

    // The handshake's one-shot values have done their job. Keep only the
    // long-lived credentials.
    await provider.invalidateCredentials("verifier");

    await this.connect(row.name);
    return row.name;
  }

  /** Close and forget the session. The row (and its tokens) stays. */
  async disconnect(name: string): Promise<void> {
    await this.closeSession(name);
  }

  /** Close everything (dev reload, shutdown). */
  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((n) => this.closeSession(n)),
    );
  }

  private async doConnect(name: string): Promise<ConnectOutcome> {
    await this.closeSession(name);

    const row = await this.store.load(name);
    if (!row) throw new Error(`Unknown MCP server "${name}"`);

    // A local, not a field: two servers connecting at once share one manager,
    // and a field would let one connect clear the other's url
    const authUrl: { href?: string } = {};

    try {
      const client = await this.openClient(row, authUrl);
      const listed = await client.listTools();
      const tools: MCPToolInfo[] = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as MCPToolInfo["inputSchema"],
        outputSchema: tool.outputSchema as MCPToolInfo["outputSchema"],
      }));

      this.adopt(name, client);
      await this.store.saveConnectionResult(name, {
        toolInfo: tools,
        lastError: null,
      });
      logger.info(`mcp "${name}" connected — ${tools.length} tools`);
      return { status: "connected", tools };
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        (error as Error)?.cause instanceof UnauthorizedError
      ) {
        // The row keeps its state so the callback finds its way back
        const url = authUrl.href;
        if (url) {
          await this.store.saveConnectionResult(name, {
            toolInfo: [],
            lastError:
              "Authorization required — finish sign-in in the opened tab",
          });
          return { status: "auth_required", authorizationUrl: url };
        }
      }

      const message = describeConnectFailure(error, row);
      await this.store.saveConnectionResult(name, {
        toolInfo: [],
        lastError: message,
      });
      logger.warn(`mcp "${name}" failed — ${message}`);
      throw new Error(message, { cause: error });
    }
  }

  /** `authUrl` is filled in on the way out, for the one caller that connects. */
  private async openClient(
    row: StoredMcpServer,
    authUrl: { href?: string } = {},
  ): Promise<MCPClient> {
    if (isRemoteConfig(row.config)) {
      const provider = this.providerFor(row);
      try {
        return await createMCPClient({
          name: this.clientName,
          transport: {
            type: "http",
            url: row.config.url,
            headers: row.config.headers,
            authProvider: provider,
            // Default is "error"; a 3xx (trailing slash, moved endpoint) would fail before auth starts
            redirect: "follow",
          },
        });
      } finally {
        authUrl.href = provider.lastAuthorizationUrl?.href;
      }
    }

    return createMCPClient({
      name: this.clientName,
      transport: new StdioMCPTransport({
        command: row.config.command,
        args: row.config.args,
        env: row.config.env,
      }),
    });
  }

  private providerFor(row: StoredMcpServer): StoreOAuthProvider {
    const configured = isRemoteConfig(row.config)
      ? row.config.oauthClient
      : undefined;
    return new StoreOAuthProvider(
      this.store,
      row.name,
      row.oauth ?? {},
      this.callbackUrl,
      this.clientName,
      configured && {
        client_id: configured.clientId,
        client_secret: configured.clientSecret,
      },
    );
  }

  private async ensureClient(name: string): Promise<MCPClient> {
    const session = this.sessions.get(name);
    if (session) return session.client;

    const outcome = await this.connect(name);
    if (outcome.status === "auth_required") {
      throw new McpAuthRequiredError(name, outcome.authorizationUrl);
    }

    const revived = this.sessions.get(name);
    if (!revived) throw new Error(`Session for "${name}" vanished mid-connect`);
    return revived.client;
  }

  /** Register the session and arm its idle timer. */
  private adopt(name: string, client: MCPClient): void {
    this.sessions.set(name, {
      client,
      idleTimer: this.armIdleTimer(name),
    });
  }

  /** Debounce: each use replaces the timer, pushing the close back. */
  private touch(name: string): void {
    const session = this.sessions.get(name);
    if (!session) return;
    clearTimeout(session.idleTimer);
    session.idleTimer = this.armIdleTimer(name);
  }

  private armIdleTimer(name: string) {
    const timer = setTimeout(() => {
      void this.closeSession(name);
    }, this.idleTtlMs);
    // Never keep the process alive just to close one idle connection
    timer.unref?.();
    return timer;
  }

  private async closeSession(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) return;
    this.sessions.delete(name);
    clearTimeout(session.idleTimer);
    await session.client.close().catch(() => {
      // A dead transport is the reason we are closing
    });
  }
}

/** A blocked registration endpoint surfaces as "HTTP 403: Invalid OAuth error response"; name the fix. */
function describeConnectFailure(error: unknown, row: StoredMcpServer): string {
  const message = errorToString(error);
  const blockedRegistration =
    /\b40[13]\b/.test(message) && /OAuth|register/i.test(message);
  if (
    blockedRegistration &&
    isRemoteConfig(row.config) &&
    !row.config.oauthClient
  ) {
    return "This server does not allow automatic client registration. Register an OAuth app with the provider and add its client ID and secret.";
  }
  return message;
}

export function createMcpManager(
  store: McpServerStore,
  options: McpManagerOptions,
): McpManager {
  return new McpManager(store, options);
}

const store: McpServerStore = {
  load: (name) => findServer(name),
  saveOAuth: (name, oauth) => saveOAuthData(name, oauth),
  // A failed connect must not touch the tool rows; bots pin those ids
  saveConnectionResult: (name, result) =>
    result.lastError === null
      ? syncServerTools(name, result.toolInfo)
      : saveConnectionError(name, result.lastError),
  findByOAuthState: (state) => findServerByOAuthState(state),
};

/** Where the authorization server redirects back to (app/api/mcp/oauth/callback), on APP_URL's origin. */
const OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";

function build() {
  return createMcpManager(store, {
    callbackUrl: new URL(OAUTH_CALLBACK_PATH, APP_URL).href,
    clientName: APP_NAME,
  });
}

const holder = globalThis as unknown as {
  __thursdayMcpManager?: ReturnType<typeof build>;
};

// Hot reload replaces this module but not the process: close the previous instance's sessions first
if (holder.__thursdayMcpManager) void holder.__thursdayMcpManager.dispose();
holder.__thursdayMcpManager = build();

export const mcpManager = holder.__thursdayMcpManager;
