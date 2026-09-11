import type { ModelMessage } from "ai";
import { index, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { int, text } from "drizzle-orm/sqlite-core/columns";
import { sqliteTable } from "drizzle-orm/sqlite-core/table";
import z from "zod";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import {
  botIconSchema,
  type TaskPending,
  type TaskStatus,
} from "@/features/bot/bot.schema";
import {
  MCPOAuthData,
  MCPServerConfig,
  MCPToolInfo,
} from "@/features/connectors/mcp.schema";
import type { MemorySource } from "@/features/memory/memory.schema";

/** Workers that background jobs are delegated to. */
export const botTable = sqliteTable("bot", {
  /** The name is the identity: spoken aloud and typed back into `delegate`. */
  name: text("name").primaryKey(),
  /** One line, shown in lists and in the prompt's Bots section. */
  description: text("description").notNull(),
  /** Appended after the base persona, never replacing it. null means generalist. */
  systemPrompt: text("system_prompt"),
  icon: text("icon", {
    mode: "json",
  }).$type<z.infer<typeof botIconSchema>>(),
  /** Both null unless a model was explicitly picked; runs then use the app default. */
  provider: text("provider").$type<TextModelProviderId>(),
  model: text("model"),
  /**
   * Context size in tokens at which this bot's runs summarize themselves. Null is
   * the usual answer: the run reads the model's own window instead (ai/model
   * `compactBudget`), and falls back to a constant only where that is unknowable.
   */
  compactAt: int("compact_at"),
  /**
   * Switched off: the row stays whole and nothing is thrown away, but no model
   * is ever shown this bot (bot.query listJobBots). Jobs it already has still
   * run and resume — a job that is under way is not a bot the agent may pick.
   */
  disabled: int("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * A bot's own notes: what it decided to carry into its next job, rewritten
 * whole at every `report` (features/ai/tools/bot.tool). Keyed by name and
 * deliberately not a foreign key, for the same reason task.bot is not one —
 * the default bot has no row and keeps notes like any other. Capped at
 * BOT_RUN.noteChars, which is the point: the cap makes the bot pick again what
 * survives instead of appending.
 */
export const botNoteTable = sqliteTable("bot_note", {
  bot: text("bot").primaryKey(),
  text: text("text").notNull(),
  updatedAt: int("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** One row per registered MCP server. Its tools live in mcp_tool. */
export const mcpServerTable = sqliteTable("mcp_server", {
  /** Also the prefix of every tool name shown to the model. */
  name: text("name").primaryKey(),
  /** How to connect: remote (`url`) or stdio (`command`), told apart by shape. */
  config: text("config", {
    mode: "json",
  })
    .notNull()
    .$type<MCPServerConfig>(),
  /** When mcp_tool was last synced for this server. */
  toolsSyncedAt: int("tools_synced_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Why the last connect failed; null when it succeeded. */
  lastError: text("last_error"),
  // Server-only: list queries must never select this column.
  oauth: text("oauth", { mode: "json" }).$type<MCPOAuthData>(),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * One row per tool a server reported. Exists so bots can pin tools by id;
 * deleting the server cascades to its tools and their pins. Sync must upsert
 * on (server_name, name), not delete-and-insert, or every pin silently vanishes.
 */
export const mcpToolTable = sqliteTable(
  "mcp_tool",
  {
    /** Surrogate key that pins point at; sync must preserve it. */
    id: int("id").primaryKey({ autoIncrement: true }),
    serverName: text("server_name")
      .notNull()
      .references(() => mcpServerTable.name, { onDelete: "cascade" }),
    /** The server's own tool name; the model sees it prefixed with the server name. */
    name: text("name").notNull(),
    description: text("description"),
    /** Stored loose: parsing with a known-key schema strips unknown keys to `{}`. */
    inputSchema: text("input_schema", { mode: "json" }).$type<
      MCPToolInfo["inputSchema"]
    >(),
    outputSchema: text("output_schema", { mode: "json" }).$type<
      MCPToolInfo["outputSchema"]
    >(),
  },
  (t) => [
    // Also serves "all tools of this server" lookups (server_name is leftmost).
    unique("uq_mcp_tool_server_name").on(t.serverName, t.name),
  ],
);

/** MCP tools a bot has pinned ahead of tool search. Only MCP tools are pinnable. */
export const botMcpToolTable = sqliteTable(
  "bot_mcp_tool",
  {
    botName: text()
      .notNull()
      .references(() => botTable.name, { onDelete: "cascade" }),
    toolId: int("tool_id")
      .notNull()
      .references(() => mcpToolTable.id, { onDelete: "cascade" }),
  },
  // The row itself is the pin; both columns form the key.
  (t) => [primaryKey({ columns: [t.botName, t.toolId] })],
);

/**
 * A job handed to a bot. Outlives the call that opened it. Two independent
 * axes: `status` is where the job is, `seen` is whether the user has had the ending.
 */
export const taskTable = sqliteTable("task", {
  /** uuid; the spoken and shown identifier is `label`. */
  id: text("id").primaryKey(),
  /** Bot name, deliberately not a foreign key: the default bot has no row, and a deleted bot's jobs stay. */
  bot: text("bot").notNull(),
  /** Two or three words, for the screen and for speech. */
  label: text("label").notNull(),
  /** The full briefing; first user message of the thread, reused on resume. */
  request: text("request").notNull(),
  /**
   * running | waiting (asked via `ask_thursday`, resumes on answer) | done | failed.
   * A done job goes back to running when it gets a follow-up answer.
   */
  status: text("status").notNull().$type<TaskStatus>(),
  /** Last message, or the pending question. */
  outcome: text("outcome"),
  /**
   * While `waiting`: what it waits on (bot.schema TaskPending); null once answered.
   * `toolCallId` null means the app stopped the run rather than the bot asking,
   * and the answer becomes a new user turn instead of a tool result.
   */
  pending: text("pending", { mode: "json" }).$type<TaskPending>(),
  /**
   * Whether the user has had the ending: relayed on a call, or on a task list
   * they had open. Highlight and badge only; the inbox selects by status.
   */
  seen: int("seen", { mode: "boolean" }).notNull().default(false),
  /** The call that opened the job; null when resumed from the screen. Decides who gets the finish notice (bot.runner). */
  callId: text("call_id"),
  /** Running totals across all segments, borrowed bots included; added per step. */
  inputTokens: int("input_tokens").notNull().default(0),
  outputTokens: int("output_tokens").notNull().default(0),
  /** Context size of the last step, not a total; overwritten every step. */
  contextTokens: int("context_tokens").notNull().default(0),
  /**
   * Where this job compacts, written at every step so the screen can draw the meter
   * without config. Lowered when the model refused the context as too long
   * (bot.runner parkTask), and a resume never runs above it (bot.run `budget`).
   */
  contextBudget: int("context_budget").notNull().default(0),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Every list sorts by this, descending. */
  updatedAt: int("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Set on done/failed; reset to null on waiting. */
  endedAt: int("ended_at", { mode: "timestamp" }),
});

/**
 * A job's thread, one ModelMessage per row. Read back as the model's own
 * history on resume, and drawn by the screen from the same rows.
 */
export const taskMessageTable = sqliteTable(
  "task_message",
  {
    /** Surrogate key; ordering is `seq`. */
    id: int("id").primaryKey({ autoIncrement: true }),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, { onDelete: "cascade" }),
    /**
     * Position in the thread, assigned by the runner before content exists:
     * a step is written while streaming and again when it ends, and bots
     * borrowed via `ask_bot` interleave in the same thread.
     */
    seq: int("seq").notNull(),
    /** Bot that produced the message; null is the user side (request, answers). */
    bot: text("bot"),
    /** `ask_bot` tool-call id on a borrowed bot's messages; rows with null are the job's own thread. */
    parent: text("parent"),
    role: text("role").notNull().$type<ModelMessage["role"]>(),
    /** ModelMessage content as-is, tool calls and results included. */
    content: text("content", { mode: "json" })
      .notNull()
      .$type<ModelMessage["content"]>(),
    /** A compaction summary (user row). Resume reads from the last one (task.query listThread). */
    compact: int("compact", { mode: "boolean" }).notNull().default(false),
    /**
     * The app speaking rather than anyone in the room: why a run stopped, and
     * the compaction marker. Separate from `compact`, which says where a resume
     * starts — how a row reads and where a resume begins are two facts, and a
     * break row marked `compact` would throw the thread away on the next run.
     */
    note: int("note", { mode: "boolean" }).notNull().default(false),
    /** Informational; ordering is `seq`. */
    createdAt: int("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // Streaming and end-of-step writes upsert on this key.
  (t) => [unique("uq_task_message_seq").on(t.taskId, t.seq)],
);

/**
 * One row per call; turns are in call_message. The browser holds the
 * transcript and sends each turn as it is confirmed; audio never reaches the server.
 */
export const callTable = sqliteTable("call", {
  id: text("id").primaryKey(),
  /** Recorded per call, since settings and fallbacks change between calls. */
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  startedAt: int("started_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /**
   * null while open, or when nobody recorded the hangup (tab vanished).
   * Decides whether a finished job notifies the call or the desktop (bot.runner).
   */
  endedAt: int("ended_at", { mode: "timestamp" }),
});

/** One spoken turn in a call. */
export const callMessageTable = sqliteTable(
  "call_message",
  {
    callId: text("call_id")
      .notNull()
      .references(() => callTable.id, { onDelete: "cascade" }),
    /** Provider item id; unique within a call only. */
    id: text("id").notNull(),
    /** Position in the conversation. Turns arrive out of order (user transcripts
     *  land after the reply starts), so this orders them, not `at`. */
    seq: int("seq").notNull(),
    /** `tool` turns keep only the tool name and its arguments, not the result. */
    role: text("role").notNull().$type<"user" | "assistant" | "tool">(),
    /** Tool name for `tool` turns; `text` is then the argument JSON. */
    tool: text("tool"),
    text: text("text").notNull(),
    /** Insert time; ordering is `seq`. */
    at: int("at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Item ids repeat across calls; repeated fragments of a turn upsert on this key.
    primaryKey({ columns: [t.callId, t.id] }),
    index("idx_call_message_call").on(t.callId, t.seq),
  ],
);

/**
 * One note per subject. Path convention: 'profile' | 'preferences' | 'inbox'
 * | 'people/<name>' | 'projects/<name>' | 'topics/<topic>'.
 * Forgetting score = (hits + 1) / (1 + days since lastReadAt).
 */

export const memoryNoteTable = sqliteTable("memory_note", {
  /** Surrogate key; `path` is the name people and the model use. */
  id: int("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  // One line; the listing shows nothing else, so it stands in for search.
  description: text("description").notNull(),
  // Other names for the same subject, as people say them.
  aliases: text("aliases", { mode: "json" }).$type<string[]>().default([]),
  // Written by the user, not observed by the agent; the note survives losing its last fact.
  ownedByUser: int("owned_by_user", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Numerator of the forgetting score. */
  hits: int("hits").notNull().default(0),
  /** Denominator of the forgetting score; null if never read. */
  lastReadAt: int("last_read_at", { mode: "timestamp" }),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Last time a fact was added or removed; reads do not touch it. */
  updatedAt: int("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** One fact line inside a note. */
export const memoryFactTable = sqliteTable(
  "memory_fact",
  {
    /** Surrogate key; also the read order within a note. */
    id: int("id").primaryKey({ autoIncrement: true }),
    noteId: int("note_id")
      .notNull()
      .references(() => memoryNoteTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    // false marks a superseded version; edits append a new row instead of overwriting.
    isLatest: int("is_latest", { mode: "boolean" }).notNull().default(true),
    /** Carried in every prompt without opening the note. Cap: config MEMORY_LIMITS.carried. */
    alwaysLoad: int("always_load", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Who wrote it (memory.schema MemorySource): the user on the screen, the
     * call, or a bot mid-job. Memory is one note kept by three hands, and a
     * reader that cannot tell them apart reads what a bot inferred as
     * something the user said. Null on rows written before this column —
     * unknown, not guessed.
     */
    source: text("source").$type<MemorySource>(),
    /**
     * The call it was said in, when a call wrote it; null for the screen and
     * for a bot. Set by the runtime, never by a model (ai/load-tools). A deleted
     * call leaves the fact and drops the link.
     */
    callId: text("call_id").references(() => callTable.id, {
      onDelete: "set null",
    }),
    createdAt: int("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_memory_fact_note").on(t.noteId, t.isLatest),
    index("idx_memory_fact_always").on(t.alwaysLoad, t.isLatest),
    index("idx_memory_fact_call").on(t.callId),
  ],
);

/** Settings written from the UI, mostly API keys. Env vars still win on read. */
export const configTable = sqliteTable("config", {
  /** Same name as the env var (config.const). */
  key: text("key").primaryKey(),
  /** Plaintext; never sent to the browser. */
  value: text("value").notNull(),
});
