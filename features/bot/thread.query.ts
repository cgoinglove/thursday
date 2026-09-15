import type { AssistantContent, ModelMessage, ToolContent } from "ai";
import { and, desc, eq, inArray, isNotNull, lt, max, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { INBOX_FINISHED, THREAD_STATUS_LIMIT } from "@/config";
import { database } from "@/database/db";
import {
  threadDeliveryTable,
  threadMessageTable,
  threadRelayTable,
  threadTable,
  threadWorkTable,
} from "@/database/tables";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { clip } from "@/lib/utils";
import {
  type ResultPart,
  THREAD_HISTORY_PAGE,
  type Thread,
  type ThreadLine,
  type ThreadPending,
  type ThreadStatus,
  type TokenUsage,
  untagSpeaker,
} from "./bot.schema";
import { ROOM_THURSDAY } from "./room.schema";

// Threads and their messages. Bots themselves (roster, pinned tools) are bot.query.

/** Every write in this file ends with this; the screen re-reads the list on it. */
const changed = () => appEvents.emit({ type: "threads" });

/** Thread state without its messages. `lines` is filled by `withLines` from thread_message; `pending` folds into `ask`. */
const threadView = {
  id: threadTable.id,
  bot: threadTable.bot,
  label: threadTable.label,
  request: threadTable.request,
  status: threadTable.status,
  outcome: threadTable.outcome,
  pending: threadTable.pending,
  seen: threadTable.seen,
  inputTokens: threadTable.inputTokens,
  outputTokens: threadTable.outputTokens,
  contextTokens: threadTable.contextTokens,
  contextBudget: threadTable.contextBudget,
  createdAt: threadTable.createdAt,
  updatedAt: threadTable.updatedAt,
};

type ThreadRow = {
  id: string;
  bot: string;
  label: string;
  request: string;
  status: ThreadStatus;
  outcome: string | null;
  pending: ThreadPending | null;
  seen: boolean;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextBudget: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One row plus the thread's first message. `request` is what the screen shows;
 * `opening` is what the model reads (who handed it over, and the job). The screen
 * skips seq 0 and shows `request` instead (linesOf).
 */
export async function insertThread(input: {
  bot: string;
  label: string;
  request: string;
  callId?: string | null;
  opening: Extract<ModelMessage, { role: "user" }>["content"];
}) {
  const { opening, ...row } = input;
  const [thread] = await database
    .insert(threadTable)
    .values({ id: crypto.randomUUID(), status: "running", ...row })
    .returning();
  await upsertMessage(thread.id, 0, {
    bot: null,
    parent: null,
    role: "user",
    content: opening,
  });
  changed();
  return thread;
}

export async function updateThread(
  id: string,
  patch: Partial<{
    status: ThreadStatus;
    outcome: string | null;
    pending: ThreadPending | null;
    seen: boolean;
    endedAt: Date | null;
    /** Where the job compacts from now on; also written at every step (addThreadUsage). */
    contextBudget: number;
  }>,
) {
  await database
    .update(threadTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(threadTable.id, id));
  changed();
}

/** Bypasses `updateThread` on purpose: being seen is not movement and must not reorder the inbox by updatedAt. */
export async function markSeen(ids: string[]) {
  if (ids.length === 0) return;
  await database
    .update(threadTable)
    .set({ seen: true })
    .where(inArray(threadTable.id, ids));
  changed();
}

/**
 * Adds one step's usage (added, not set: borrowed-bot steps land on the same
 * thread in parallel) without touching updatedAt. `context` is overwritten: it is
 * the current window fill and threshold, not a sum. null leaves it as is.
 */
export async function addThreadUsage(
  id: string,
  usage: TokenUsage,
  context: { tokens: number; budget: number } | null = null,
) {
  if (!usage.input && !usage.output && context === null) return;
  await database
    .update(threadTable)
    .set({
      inputTokens: sql`${threadTable.inputTokens} + ${usage.input}`,
      outputTokens: sql`${threadTable.outputTokens} + ${usage.output}`,
      ...(context === null
        ? {}
        : { contextTokens: context.tokens, contextBudget: context.budget }),
    })
    .where(eq(threadTable.id, id));
  changed();
}

/** One thread as the screen sees it, messages included. null if missing. */
export async function findThreadView(id: string): Promise<Thread | null> {
  const [row] = await database
    .select(threadView)
    .from(threadTable)
    .where(eq(threadTable.id, id));
  if (!row) return null;
  const [thread] = await withLines([row]);
  return thread ?? null;
}

export async function findThread(id: string) {
  const [thread] = await database
    .select()
    .from(threadTable)
    .where(eq(threadTable.id, id));
  return thread ?? null;
}

/** Keep open work, unread endings and unrelayed messages alongside recent read endings. */
export async function listInboxThreads(): Promise<Thread[]> {
  const [open, finished, unread, unrelayed] = await Promise.all([
    database
      .select(threadView)
      .from(threadTable)
      .where(inArray(threadTable.status, ["running", "waiting"]))
      .orderBy(desc(threadTable.updatedAt)),
    database
      .select(threadView)
      .from(threadTable)
      .where(inArray(threadTable.status, ["done", "failed"]))
      .orderBy(desc(threadTable.updatedAt))
      .limit(INBOX_FINISHED),
    database
      .select(threadView)
      .from(threadTable)
      .where(
        and(
          inArray(threadTable.status, ["done", "failed"]),
          eq(threadTable.seen, false),
        ),
      ),
    database
      .select(threadView)
      .from(threadTable)
      .where(
        inArray(
          threadTable.id,
          database
            .select({ id: threadRelayTable.threadId })
            .from(threadRelayTable)
            .where(eq(threadRelayTable.accepted, false)),
        ),
      ),
  ]);
  const rows = [
    ...new Map(
      [...open, ...finished, ...unread, ...unrelayed].map((row) => [
        row.id,
        row,
      ]),
    ).values(),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return withLines(rows);
}

/** The call's bounded overview includes older open work before recent endings. */
export async function listThreadOverview(): Promise<Thread[]> {
  const rows = await database
    .select(threadView)
    .from(threadTable)
    .orderBy(
      sql`case when ${threadTable.status} in ('running', 'waiting') then 0 else 1 end`,
      desc(threadTable.updatedAt),
      desc(threadTable.id),
    )
    .limit(THREAD_STATUS_LIMIT);
  return withLines(rows);
}

/** All threads, newest first, one page at a time. `before` is a cursor (last page's updatedAt), not an offset, because rows move in between. */
export async function listThreadHistory(
  options: { before?: Date | null; limit?: number } = {},
): Promise<Thread[]> {
  const rows = await database
    .select(threadView)
    .from(threadTable)
    .where(
      options.before ? lt(threadTable.updatedAt, options.before) : undefined,
    )
    .orderBy(desc(threadTable.updatedAt))
    .limit(options.limit ?? THREAD_HISTORY_PAGE);
  return withLines(rows);
}

/**
 * What each of these calls handed over, for the transcript the next call reads
 * (ai/prompts/thursday.prompt). Not the inbox: a job belongs to the call it was
 * opened from, and this is how it is still there once that call is over.
 */
export async function listCallJobs(callIds: string[]) {
  if (!callIds.length) return [];
  return await database
    .select({
      id: threadTable.id,
      callId: threadTable.callId,
      label: threadTable.label,
      status: threadTable.status,
      outcome: threadTable.outcome,
    })
    .from(threadTable)
    .where(inArray(threadTable.callId, callIds))
    .orderBy(threadTable.createdAt);
}

export type CallJob = Awaited<ReturnType<typeof listCallJobs>>[number];

/** Its messages go with it (cascade). The runner stops a live one first. */
export async function deleteThread(id: string) {
  const removed = await database
    .delete(threadTable)
    .where(eq(threadTable.id, id))
    .returning({ id: threadTable.id });
  if (removed.length) changed();
  return removed.length > 0;
}

/** Everything finished, done or failed. Running and waiting rows stay: they are still work. */
export async function deleteFinishedThreads() {
  const removed = await database
    .delete(threadTable)
    .where(inArray(threadTable.status, ["done", "failed"]))
    // The label comes back too: a job's working folder is named for it and goes
    // with the row (bot.runner removeFinishedThreads).
    .returning({ id: threadTable.id, label: threadTable.label });
  if (removed.length) changed();
  return removed;
}

/** Every job, newest first. The caller stops each one before deleting it (bot.runner removeThread). */
export async function listAllThreadIds(): Promise<string[]> {
  const rows = await database
    .select({ id: threadTable.id })
    .from(threadTable)
    .orderBy(desc(threadTable.createdAt));
  return rows.map((row) => row.id);
}

/** Rows a previous server left as running; the runner decides which still are. */
export async function listRunningThreadIds() {
  const rows = await database
    .select({ id: threadTable.id })
    .from(threadTable)
    .where(eq(threadTable.status, "running"));
  return rows.map((row) => row.id);
}

/** Every job with what names its folder and whether it still keeps it (bot.runner sweepJobFiles). */
export async function listThreadFolders() {
  return await database
    .select({
      id: threadTable.id,
      label: threadTable.label,
      status: threadTable.status,
      endedAt: threadTable.endedAt,
      updatedAt: threadTable.updatedAt,
    })
    .from(threadTable);
}

/** Jobs paused for browser absence; legacy retry timestamps remain readable. */
export async function listAutoStoppedThreads() {
  const rows = await database
    .select({ id: threadTable.id, pending: threadTable.pending })
    .from(threadTable)
    .where(eq(threadTable.status, "waiting"));
  return rows.flatMap((row) =>
    row.pending?.auto
      ? [{ id: row.id, retryAt: row.pending.retryAt ?? 0 }]
      : [],
  );
}

/**
 * Paths a list of message contents gave `write_file`, oldest first and each once; a
 * path written again moves to the end. A refused write is here too, so whoever shows
 * them checks the disk (workspace.ts filesOnDisk).
 */
export function writtenPathsIn(contents: unknown[]): string[] {
  const paths = new Set<string>();
  for (const content of contents) {
    if (!Array.isArray(content)) continue;
    for (const part of content as {
      type?: unknown;
      toolName?: unknown;
      input?: unknown;
    }[]) {
      if (
        part.type !== "tool-call" ||
        part.toolName !== TOOL_NAMES.write_file
      ) {
        continue;
      }
      const path = (part.input as { path?: unknown } | null)?.path;
      if (typeof path !== "string" || !path.trim()) continue;
      paths.delete(path.trim());
      paths.add(path.trim());
    }
  }
  return [...paths];
}

/** Every path this job gave `write_file`: its own bot and each bot it borrowed (writtenPathsIn). */
export async function listWrittenPaths(threadId: string): Promise<string[]> {
  const rows = await database
    .select({ content: threadMessageTable.content })
    .from(threadMessageTable)
    .where(
      and(
        eq(threadMessageTable.threadId, threadId),
        eq(threadMessageTable.role, "assistant"),
      ),
    )
    .orderBy(threadMessageTable.seq);
  return writtenPathsIn(rows.map((row) => row.content));
}

/**
 * Finds a thread by id or by exact label (case-insensitive). No looser matching:
 * a miss returns null and the caller lists recent threads instead.
 */
export async function resolveThread(ref: string) {
  const term = ref.trim();
  if (!term) return null;
  const whole = await findThread(term);
  if (whole) return whole;

  const lower = term.toLowerCase();
  const recent = await database
    .select()
    .from(threadTable)
    .orderBy(desc(threadTable.updatedAt))
    .limit(20);
  return recent.find((thread) => thread.label.toLowerCase() === lower) ?? null;
}

export type ThreadMessageInput = {
  bot: string | null;
  parent: string | null;
  role: ModelMessage["role"];
  content: ModelMessage["content"];
  /** Compaction summary row; `listParticipantTranscript` re-reads from here. */
  compact?: boolean;
  /** Drawn as the app's own line, not as something a person or a bot said. */
  note?: boolean;
};

/**
 * Writes by seat, not append: a step's messages are written while streaming and
 * rewritten whole when it ends, and the second write must replace the first.
 */
export async function upsertMessage(
  threadId: string,
  seq: number,
  message: ThreadMessageInput,
) {
  await database
    .insert(threadMessageTable)
    .values({
      threadId,
      seq,
      ...message,
      compact: message.compact ?? false,
      note: message.note ?? false,
    })
    .onConflictDoUpdate({
      target: [threadMessageTable.threadId, threadMessageTable.seq],
      set: {
        role: message.role,
        content: message.content,
        compact: message.compact ?? false,
        note: message.note ?? false,
      },
    });
  changed();
}

/** Frees seats claimed while streaming but unused when the step ended. Left in, they put unmatched tool results in the transcript the model re-reads. */
export async function deleteMessages(threadId: string, seqs: number[]) {
  if (!seqs.length) return;
  await database
    .delete(threadMessageTable)
    .where(
      and(
        eq(threadMessageTable.threadId, threadId),
        inArray(threadMessageTable.seq, seqs),
      ),
    );
  changed();
}

/** Highest seq taken so far; -1 for an empty thread. */
export async function lastSeq(threadId: string): Promise<number> {
  const [row] = await database
    .select({ seq: max(threadMessageTable.seq) })
    .from(threadMessageTable)
    .where(eq(threadMessageTable.threadId, threadId));
  return row?.seq ?? -1;
}

/** A participant keeps its own work across every request, including requests from different bots. */
export async function listBotTranscript(threadId: string, bot: string) {
  const rows = await database
    .select()
    .from(threadMessageTable)
    .where(
      and(
        eq(threadMessageTable.threadId, threadId),
        isNotNull(threadMessageTable.parent),
        eq(sql`lower(${threadMessageTable.bot})`, bot.toLowerCase()),
      ),
    )
    .orderBy(threadMessageTable.seq);
  // Older runs store their opening only in the caller's tool arguments.
  const requests = await database
    .select({
      content: threadMessageTable.content,
      bot: threadMessageTable.bot,
    })
    .from(threadMessageTable)
    .where(
      and(
        eq(threadMessageTable.threadId, threadId),
        eq(threadMessageTable.role, "assistant"),
      ),
    )
    .orderBy(threadMessageTable.seq);
  const openings = new Map<string, ModelMessage>();
  for (const row of requests) {
    if (!Array.isArray(row.content)) continue;
    for (const part of row.content) {
      if (part.type !== "tool-call" || part.toolName !== TOOL_NAMES.ask_bot)
        continue;
      const input = part.input as { request?: string; context?: string };
      openings.set(part.toolCallId, {
        role: "user",
        content: `${row.bot} → ${bot}:\n\n${input.request ?? ""}\n\n${input.context ?? ""}`,
      });
    }
  }
  const history: { message: ModelMessage; compact: boolean }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.parent && !seen.has(row.parent)) {
      seen.add(row.parent);
      if (row.role !== "user" || row.compact) {
        const opening = openings.get(row.parent);
        if (opening) history.push({ message: opening, compact: false });
      }
    }
    history.push({
      message: { role: row.role, content: row.content } as ModelMessage,
      compact: row.compact,
    });
  }
  const from = history.findLastIndex((row) => row.compact);
  const kept = from > 0 ? [history[0], ...history.slice(from)] : history;
  return kept.map((row) => row.message);
}

/** One row in the screen's shape; `pending` folds into `ask`. */
function viewOf(row: ThreadRow, lines: ThreadLine[]): Thread {
  // contextTokens and contextBudget pass through in `rest`
  const { pending, inputTokens, outputTokens, ...rest } = row;
  return {
    ...rest,
    ask:
      row.status === "waiting"
        ? {
            question: row.outcome ?? "",
            options: pending?.options ?? [],
            auto: pending?.auto === true,
            messageId: pending?.messageId,
            bot: pending?.bot,
          }
        : null,
    tokens: { input: inputTokens, output: outputTokens },
    lines,
  };
}

/** Reduces every thread's messages to lines and attaches them to the rows. */
async function withLines(rows: ThreadRow[]): Promise<Thread[]> {
  if (rows.length === 0) return [];
  const messages = await database
    .select()
    .from(threadMessageTable)
    .where(
      inArray(
        threadMessageTable.threadId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(threadMessageTable.seq);

  const threadIds = rows.map((row) => row.id);
  const [works, deliveries, relays] = await Promise.all([
    database
      .select()
      .from(threadWorkTable)
      .where(inArray(threadWorkTable.threadId, threadIds)),
    database
      .select()
      .from(threadDeliveryTable)
      .where(
        and(
          inArray(threadDeliveryTable.threadId, threadIds),
          eq(threadDeliveryTable.visible, true),
        ),
      ),
    database
      .select()
      .from(threadRelayTable)
      .where(
        and(
          inArray(threadRelayTable.threadId, threadIds),
          eq(threadRelayTable.accepted, false),
        ),
      ),
  ]);
  // ask_back lines name no addressee; the thread's own bot is the addressee
  const owners = new Map(rows.map((row) => [row.id, row.bot]));
  const askers = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content))
      continue;
    for (const part of message.content) {
      if (
        part.type === "tool-call" &&
        part.toolName === TOOL_NAMES.ask_bot &&
        message.bot
      ) {
        askers.set(`${message.threadId}:${part.toolCallId}`, message.bot);
      }
    }
  }
  for (const item of works)
    askers.set(`${item.threadId}:${item.id}`, item.caller);
  const exchanges = new Set(works.map((item) => item.id));
  const byThread = new Map<string, ThreadLine[]>();
  for (const message of messages) {
    const list = byThread.get(message.threadId) ?? [];
    list.push(
      ...linesOf(
        message,
        (message.parent
          ? askers.get(`${message.threadId}:${message.parent}`)
          : null) ??
          owners.get(message.threadId) ??
          "",
        message.parent !== null && exchanges.has(message.parent),
      ),
    );
    byThread.set(message.threadId, list);
  }
  return rows.map((row) => {
    const own = works.filter((item) => item.threadId === row.id);
    const rank = [
      "running",
      "queued",
      "paused",
      "waiting",
      "done",
      "cancelled",
    ];
    const participants = [...new Set(own.map((item) => item.bot))]
      .filter((bot) => bot !== ROOM_THURSDAY)
      .map((bot) => ({
        bot,
        state: own
          .filter((item) => item.bot === bot)
          .sort((a, b) => rank.indexOf(a.state) - rank.indexOf(b.state))[0]
          .state,
      }));
    return {
      ...viewOf(row, byThread.get(row.id) ?? []),
      room: own.length
        ? {
            participants,
            questions: own
              .filter((item) => item.state === "external")
              .map((item) => ({
                id: item.id,
                bot: item.caller,
                text: item.result ?? "",
                options: item.options,
              })),
            deliveries: deliveries
              .filter((item) => item.threadId === row.id)
              .map((item) => ({
                id: item.key,
                bot: own.find((w) => w.id === item.workId)?.bot ?? row.bot,
                text: item.text,
                delivered: item.consumed,
              })),
            relays: relays.filter((item) => item.threadId === row.id),
          }
        : null,
    };
  });
}

/** One-line cap: room for a path, small enough for a row. */
const LINE_MAX = 120;

/** Argument names likely to carry the point, in reading order. */
const TELLING = [
  "query",
  "command",
  "prompt",
  "url",
  "path",
  "pattern",
  "request",
  "question",
  "title",
  "name",
  "thread",
  "text",
] as const;

const stringAt = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : null;
};

/** Model-written label on bash. null when absent; the command is then the label. */
function labelOf(args: Record<string, unknown>): string | null {
  const note = stringAt(args, "description");
  return note ? clip(note, LINE_MAX) : null;
}

/**
 * One tool call as one line, for the screen. No per-tool summary table: the
 * label is model-written (bash `description`), other tools use the first
 * telling argument, else the argument shape.
 */
export function toolLine(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  if (typeof args !== "object" || Array.isArray(args)) {
    return clip(String(input ?? ""), LINE_MAX);
  }
  if (name === TOOL_NAMES.bash) {
    return labelOf(args) ?? clip(String(args.command ?? ""), LINE_MAX);
  }
  if (name === TOOL_NAMES.tool_call || name === TOOL_NAMES.tool_search) {
    // For MCP the call is inside the args. Server name alone would collapse
    // twenty different calls into one line, and a resumed bot would repeat them
    const called = Array.isArray(args.tools)
      ? args.tools.map(String).join(", ")
      : String(args.tool ?? "");
    const passed =
      args.args && typeof args.args === "object"
        ? JSON.stringify(args.args)
        : "";
    return clip(
      [String(args.server ?? ""), called, passed].filter(Boolean).join(" "),
      LINE_MAX,
    );
  }
  for (const key of TELLING) {
    const value = stringAt(args, key);
    if (value) return clip(value, LINE_MAX);
  }
  for (const key of Object.keys(args)) {
    const value = stringAt(args, key);
    if (value) return clip(value, LINE_MAX);
  }
  const keys = Object.keys(args);
  return keys.length ? clip(JSON.stringify(args), LINE_MAX) : "";
}

/** Result lines carried in the list, enough for a glance. */
const RESULT_LINES = 4;

/**
 * Characters kept of each glance line. The list carries every thread's results
 * on every read, so a long line (a skill's body, a JSON blob) would ride along
 * whole; the output opens in full on demand. Long enough for a file path.
 */
const RESULT_LINE_MAX = 200;

/** Cap for the full result, so one log file cannot flatten the browser. */
const FULL_RESULT_LINES = 400;

/** Everything one tool returned, as written; only when the screen asks for it. The list carries a clipped glance (resultLine). */
export async function readToolResult(
  threadId: string,
  toolCallId: string,
): Promise<ResultPart[] | null> {
  // Usually a tool row, but results of provider-run tools (search) sit inside
  // an assistant row, so both are scanned
  const rows = await database
    .select({
      role: threadMessageTable.role,
      content: threadMessageTable.content,
    })
    .from(threadMessageTable)
    .where(
      and(
        eq(threadMessageTable.threadId, threadId),
        inArray(threadMessageTable.role, ["tool", "assistant"]),
      ),
    );
  for (const row of rows) {
    if (typeof row.content === "string") continue;
    for (const part of row.content as ToolContent) {
      if (part.type === "tool-result" && part.toolCallId === toolCallId) {
        return resultParts(part.output, FULL_RESULT_LINES, true);
      }
    }
  }
  return null;
}

/** Said to a resumed run after why it stopped. The screen shows only the why (linesOf). */
const IN_FLIGHT =
  "Anything that was under way — a command, a page loading, a download — may not have finished: check before relying on it, then carry on.";

/** The thread line a stop the app made leaves (bot.runner parkThread). */
export const stopNote = (why: string) => `${why} ${IN_FLIGHT}`;

/** Who a message call names, with Thursday spelled the room's way whatever case the model wrote. */
function addresseeOf(args: Record<string, unknown>): string {
  const to = String(args.bot ?? args.to ?? "").trim();
  return to.toLowerCase() === ROOM_THURSDAY.toLowerCase() ? ROOM_THURSDAY : to;
}

type StoredMessage = typeof threadMessageTable.$inferSelect;

/**
 * One stored message as screen lines. seq 0 is the request and is drawn from the
 * row instead, so it yields nothing. Tool calls aimed at the user or another bot
 * get their own kinds because the screen draws them as speech. `owner` is the
 * thread's bot, the addressee of an ask_back line.
 */
function linesOf(
  message: StoredMessage,
  owner: string,
  roomMessage: boolean,
): ThreadLine[] {
  if (message.hidden) return [];
  const base = {
    seq: message.seq,
    bot: message.bot,
    parent: message.parent,
    to: message.role === "user" ? message.bot : owner,
    at: message.createdAt,
  };
  const id = (index: number) => `${message.id}-${index}`;
  const content = message.content;

  if (message.role === "user") {
    // Participant requests already appear as the caller's ask_bot line.
    if (
      message.seq === 0 ||
      (message.parent && !roomMessage && !message.compact && !message.note)
    )
      return [];
    const text = typeof content === "string" ? content : textOf(content);
    if (!text) return [];
    // The app's own lines, never the user's words. `compact` alone marks a
    // compaction: rows written before `note` existed carry only that.
    if (message.compact) return [{ ...base, id: id(0), kind: "note", text }];
    if (message.note) {
      const why = text.endsWith(IN_FLIGHT)
        ? text.slice(0, -IN_FLIGHT.length).trimEnd()
        : text;
      return [{ ...base, id: id(0), kind: "stop", text: why }];
    }
    // Tagged with who said it for the bot (bot.schema tagSpeaker); the screen draws the words
    return [{ ...base, id: id(0), kind: "user", text: untagSpeaker(text) }];
  }

  if (message.role === "assistant") {
    const content = message.content as AssistantContent;
    if (typeof content === "string") {
      return content.trim()
        ? [{ ...base, id: id(0), kind: "text", text: content.trim() }]
        : [];
    }
    const lines: ThreadLine[] = [];
    content.forEach((part, index) => {
      if (part.type === "text") {
        const text = part.text.trim();
        if (text) lines.push({ ...base, id: id(index), kind: "text", text });
        return;
      }
      // Result of a provider-run tool (search) arrives inside the same message
      if (part.type === "tool-result") {
        lines.push(resultLine(base, id(index), part));
        return;
      }
      if (part.type !== "tool-call") return;
      const args = (part.input ?? {}) as Record<string, unknown>;
      if (part.toolName === TOOL_NAMES.ask_thursday) {
        lines.push({
          ...base,
          id: id(index),
          kind: "waiting",
          callId: part.toolCallId,
          question: String(args.question ?? ""),
          options: optionsOf(args.options),
        });
      } else if (isAnswerCall(part.toolName)) {
        // The answer is a tool call but draws as text: it is the last thing said
        // in the thread, and threadFromRow promotes it to the result line
        const text = String(args.result ?? "").trim();
        if (text) lines.push({ ...base, id: id(index), kind: "text", text });
      } else if (
        part.toolName === TOOL_NAMES.ask_bot ||
        part.toolName === TOOL_NAMES.send_message
      ) {
        lines.push({
          ...base,
          id: id(index),
          kind: "ask",
          callId: part.toolCallId,
          to: addresseeOf(args),
          text: String(args.request ?? args.text ?? ""),
          question:
            part.toolName === TOOL_NAMES.send_message
              ? args.kind === "question" ||
                (args.kind === undefined && addresseeOf(args) === ROOM_THURSDAY)
              : undefined,
        });
      } else if (part.toolName === TOOL_NAMES.ask_back) {
        // Borrowed bot asking its borrower; the addressee is not in the args
        lines.push({
          ...base,
          id: id(index),
          kind: "ask",
          callId: part.toolCallId,
          to: owner,
          text: String(args.question ?? ""),
        });
      } else if (part.toolName === TOOL_NAMES.bash) {
        // Shell line: the command is the body, the model-written label sits above it
        lines.push({
          ...base,
          id: id(index),
          kind: "tool",
          callId: part.toolCallId,
          name: part.toolName,
          input: clip(String(args.command ?? ""), LINE_MAX),
          note: labelOf(args),
        });
      } else {
        lines.push({
          ...base,
          id: id(index),
          kind: "tool",
          callId: part.toolCallId,
          name: part.toolName,
          input: toolLine(part.toolName, args),
          // Any tool's model-written `description` is its label
          note: labelOf(args),
          // File tools open from the screen, so the path also travels unclipped
          path:
            part.toolName === TOOL_NAMES.write_file
              ? (stringAt(args, "path") ?? null)
              : null,
        });
      }
    });
    return lines;
  }

  if (message.role === "tool") {
    const lines: ThreadLine[] = [];
    (message.content as ToolContent).forEach((part, index) => {
      if (part.type !== "tool-result") return;
      if (
        part.toolName === TOOL_NAMES.send_message &&
        part.output.type !== "error-text"
      )
        return;
      if (isAnswerCall(part.toolName) && answerAccepted(part.output)) {
        // An accepted answer's result is only a confirmation; the answer itself
        // was drawn from the call. A rejected one is drawn: it explains the next step
        return;
      }
      if (part.toolName === TOOL_NAMES.ask_thursday) {
        // The user's answer, returned as the question's result
        const text = resultParts(part.output, RESULT_LINES)
          .flatMap((result) => (result.type === "text" ? [result.text] : []))
          .join("\n");
        lines.push({
          ...base,
          id: id(index),
          kind: "user",
          text: untagSpeaker(text),
        });
      } else if (
        part.toolName === TOOL_NAMES.ask_bot ||
        part.toolName === TOOL_NAMES.ask_back
      ) {
        // Another bot's answer: result of an ask, or of an ask_back
        const text = resultParts(part.output, RESULT_LINES)
          .flatMap((result) => (result.type === "text" ? [result.text] : []))
          .join("\n");
        lines.push({
          ...base,
          id: id(index),
          kind: "ask-result",
          callId: part.toolCallId,
          text,
        });
      } else {
        lines.push(resultLine(base, id(index), part));
      }
    });
    return lines;
  }

  return [];
}

/**
 * List line for one tool result: a glance of text lines, each clipped, and whether
 * the output holds more. Asks for one line past the glance to know. Called for tool
 * rows and, for provider-run tools, assistant rows.
 */
function resultLine(
  base: Omit<ThreadLine, "id" | "kind">,
  id: string,
  part: { toolCallId: string; toolName: string; output: unknown },
): ThreadLine {
  const peek = resultParts(part.output, RESULT_LINES + 1);
  const lines = peek.flatMap((result) =>
    result.type === "text" ? [result.text] : [],
  );
  const glance = lines.slice(0, RESULT_LINES);
  return {
    ...base,
    id,
    kind: "tool-result",
    callId: part.toolCallId,
    name: part.toolName,
    // Images stay out of the list: a screenshot is fetched with the full output
    results: glance.map((text) => ({
      type: "text" as const,
      text: clip(text, RESULT_LINE_MAX),
    })),
    more:
      lines.length > glance.length ||
      peek.length > lines.length ||
      glance.some((text) => text.length > RESULT_LINE_MAX),
  };
}

/**
 * Options the model gave. Only arrays are read. Some providers serialise the
 * array as one string with no separator; that cannot be split back, so the
 * schema accepts a string (keeping the call valid) and it becomes an open
 * question here rather than a guess.
 */
export function optionsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((option) => String(option).trim()).filter(Boolean)
    : [];
}

function textOf(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n")
    .trim();
}

/**
 * Tool output as parts: text and images. A glance trims lines and drops blank ones;
 * `full` keeps the text as written and lays objects out to be read. ai-sdk output
 * shapes first, then our tools' shapes, then raw JSON.
 */
function resultParts(
  output: unknown,
  limit: number,
  full = false,
): ResultPart[] {
  if (output == null) return [];
  if (typeof output === "string") return textParts(output, limit, full);
  if (typeof output !== "object") return textParts(String(output), limit, full);

  const wrapped = output as { type?: unknown; value?: unknown };
  switch (wrapped.type) {
    case "text":
    case "error-text":
      return textParts(String(wrapped.value ?? ""), limit, full);
    case "json":
    case "error-json":
      return resultParts(wrapped.value, limit, full);
    case "execution-denied":
      return textParts("Denied.", limit, full);
    case "content": {
      if (!Array.isArray(wrapped.value)) return [];
      const parts: ResultPart[] = [];
      for (const block of wrapped.value as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(...textParts(block.text, limit, full));
          continue;
        }
        const image = imageSrc(block);
        if (image) parts.push({ type: "image", src: image });
      }
      return parts;
    }
    default:
      break;
  }

  const record = output as Record<string, unknown>;
  if (Array.isArray(record.sources)) {
    return (
      record.sources
        .map((source) => String((source as { title?: string })?.title ?? ""))
        // Untitled results would be blank rows; filter after map so slice still fills
        .filter(Boolean)
        .slice(0, limit)
        .map((text) => ({ type: "text" as const, text }))
    );
  }
  if (typeof record.stdout === "string") {
    return textParts(record.stdout || String(record.stderr ?? ""), limit, full);
  }
  if (typeof record.answer === "string")
    return textParts(record.answer, limit, full);
  return textParts(
    full ? readable(output) : JSON.stringify(output),
    limit,
    full,
  );
}

/** An object read whole: a multi-line string (a skill's body) as the text it is, anything else as indented JSON. */
function readable(value: object): string {
  if (Array.isArray(value)) return JSON.stringify(value, null, 2);
  return Object.entries(value)
    .map(([key, field]) =>
      typeof field === "string" && field.includes("\n")
        ? `${key}:\n${field}`
        : `${key}: ${JSON.stringify(field, null, 2)}`,
    )
    .join("\n");
}

/** A file block holding an image, as something <img> can show. base64 becomes a data url, urls pass through, anything else is dropped. */
function imageSrc(block: Record<string, unknown>): string | null {
  const mediaType = String(block.mediaType ?? "");
  if (!mediaType.startsWith("image/")) return null;
  const data = block.data as
    | string
    | { type?: string; data?: unknown; url?: string }
    | undefined;
  if (typeof data === "string") return `data:${mediaType};base64,${data}`;
  if (data?.type === "url" && data.url) return data.url;
  if (data?.type === "data" && typeof data.data === "string") {
    return `data:${mediaType};base64,${data.data}`;
  }
  return null;
}

/**
 * Text as parts. A glance is one part per non-blank trimmed line, up to `limit`;
 * `full` is the text as written in one part, cut after `limit` lines with a count
 * of what was left.
 */
function textParts(text: string, limit: number, full = false): ResultPart[] {
  if (full) {
    const lines = text.split("\n");
    const kept = lines.slice(0, limit);
    if (lines.length > limit) kept.push(`… ${lines.length - limit} more lines`);
    const whole = kept.join("\n").trimEnd();
    return whole ? [{ type: "text", text: whole }] : [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => ({ type: "text" as const, text: line }));
}

/** Legacy completion tools remain prose when an older transcript is opened. */
const isAnswerCall = (name: string) =>
  name === TOOL_NAMES.answer || name === TOOL_NAMES.report;

function answerAccepted(output: unknown) {
  const text =
    typeof output === "string"
      ? output
      : output && typeof output === "object" && "value" in output
        ? output.value
        : null;
  return typeof text !== "string" || !text.startsWith("Not answered:");
}
