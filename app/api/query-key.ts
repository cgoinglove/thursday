/**
 * Every endpoint the browser reads. Keys double as SWR cache keys; `revalidate`
 * matches by url prefix, so invalidating `queryKey.memory` also refreshes
 * `queryKey.notePath(path)`. Writes go through server actions, not here.
 */
/** Encodes per segment, keeping the path's `/`. */
const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

/**
 * Inverse of encodePath for catch-all segments. No decoding: Next already
 * decodes segments, and decoding again throws on names containing `%`.
 */
export const decodePath = (segments: string[]) => segments.join("/");

export const queryKey = {
  /** MemoryNote[] first page: pinned first, then by warmth */
  memory: "/api/memory",
  /** Next page; `offset` is the count received so far */
  memoryPage: (offset: number) => ({
    url: "/api/memory",
    query: { offset: offset || null },
  }),
  /** One note with all facts, by path. Paths contain `/`, so it is a query, not a
   *  segment: pass the hook null instead of building this key when closed. */
  notePath: (path: string) => ({ url: "/api/memory", query: { path } }),
  /** MemoryTidyStatusView: settings, what is pending, the pass in progress and the last one. Under the memory prefix on purpose: a fact changing moves it too. */
  memoryTidy: "/api/memory/tidy",

  /** MCPServerSummary[] with tool counts, no tools */
  mcp: "/api/mcp",
  /** MCPServer, one server with its tools */
  mcpServer: (name: string | null) => ({
    url: "/api/mcp",
    pathVariable: [name],
  }),

  /** Every MCP tool across servers, flat */
  mcpTools: "/api/mcp/tools",

  /** SkillSummary[], custom first */
  skills: "/api/skills",
  /**
   * SkillNode: a folder listing or a file's text inside a skill.
   * `path` is relative to the skill folder; "" is the skill itself.
   */
  skillNode: (source: string | null, dir: string | null, path: string) => ({
    url: "/api/skills",
    pathVariable: [source, dir],
    query: { path },
  }),

  /**
   * Bot[]. `tasks` and `taskHistory` sit under this prefix, so editing a bot
   * also revalidates the inbox and loaded history pages.
   */
  bot: "/api/bot",

  /**
   * Inbox: Task[] newest first with threads, everything running or asking plus
   * the most recent finished few. Read by use-thursday only; the `tasks` signal
   * triggers revalidation, with a 30s poll as fallback.
   */
  tasks: "/api/bot/task",
  /**
   * History page: Task[] newest first. `before` is the last page's final
   * updatedAt (ISO), null for the first page.
   */
  taskHistory: (before: string | null) => ({
    url: "/api/bot/task",
    query: { history: 1, before },
  }),
  /** ResultPart[]: the full result of one tool call; lists carry only a few lines. */
  toolResult: (taskId: string | null, callId: string | null) => ({
    url: "/api/bot/task",
    pathVariable: [taskId],
    query: { call: callId },
  }),
  /**
   * WorkspaceFolder: one folder's rows plus what the whole workspace takes on
   * disk. The bare key is the root, so invalidating it refreshes every folder.
   */
  workspace: "/api/workspace",
  workspaceFolder: (path: string) => ({
    url: "/api/workspace",
    query: { path: path || null },
  }),

  /** Raw workspace file, no Result envelope; for iframe, img and fetch, not SWR. */
  file: (path: string) => `/api/file/${encodePath(path)}`,
  /** File viewer page (new tab): md rendered, html and pdf framed */
  fileView: (path: string) => `/artifact/${encodePath(path)}`,

  /**
   * Server-sent events, not a read; only app-event.client's `AppEventSource`
   * opens it. The payloads are the AppEvent union in app/api/events/app-event.ts.
   */
  events: "/api/events",

  /** ConfigStatus[]: which declared config keys are set; values stay on the server */
  config: "/api/config",

  /**
   * CallRecord[] page, newest call first, turns in speaking order; pages count
   * calls (CALL_HISTORY_PAGE). `before` is the oldest call's `startedAt` (ISO)
   * on the previous page, null for the first. Calls with no turns are omitted.
   */
  callHistory: (before: string | null) => ({
    url: "/api/thursday/call",
    query: { before },
  }),

  /**
   * POST, not a read; the one endpoint here SWR never touches. Body is
   * {toolCallId, callId, name, input}; one JSON Result per call, abortable.
   */
  toolCall: "/api/thursday/tool-call",

  /** Providers this app can call and whether each key is set */
  llmModel: "/api/llm-model",
  /** Models reachable with the AI Gateway key; gateway only */
  modelCatalog: "/api/llm-model/catalog",
} as const;
