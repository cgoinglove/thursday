import type { AssistantContent, ModelMessage, ToolContent } from "ai";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  max,
  ne,
  sql,
} from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { queryKey } from "@/app/api/query-key";
import {
  BOT_WORK,
  INBOX_FINISHED,
  PAGE_SIZE,
  STUDIO_SERVER,
  THREAD_STATUS_LIMIT,
} from "@/config";
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
  type BotWorkLine,
  type ResultPart,
  type Thread,
  type ThreadLine,
  type ThreadPending,
  type ThreadStatus,
  type TokenUsage,
  untagSpeaker,
} from "./bot.schema";
import { RESUME_CHECK, ROOM_THURSDAY } from "./room.schema";

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
  routineId: threadTable.routineId,
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
  routineId: string | null;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextBudget: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One row, the thread's first message and the coordinator's first exchange, in one
 * transaction: a thread is a room from its first row. `request` is what the screen
 * shows; `opening` is what the model reads (who handed it over, and the job). The
 * screen skips seq 0 and shows `request` instead (linesOf).
 */
export async function insertThread(input: {
  bot: string;
  label: string;
  request: string;
  callId?: string | null;
  /** The routine that opened it (features/routine); a run carries its mark on every row. */
  routineId?: string | null;
  opening: Extract<ModelMessage, { role: "user" }>["content"];
}) {
  const { opening, ...row } = input;
  const thread = await database.transaction(async (tx) => {
    const [created] = await tx
      .insert(threadTable)
      .values({ id: crypto.randomUUID(), status: "running", ...row })
      .returning();
    await tx.insert(threadMessageTable).values({
      threadId: created.id,
      seq: 0,
      bot: null,
      parent: null,
      role: "user",
      content: opening,
      compact: false,
      note: false,
    });
    await tx.insert(threadWorkTable).values({
      id: crypto.randomUUID(),
      threadId: created.id,
      bot: created.bot,
      caller: ROOM_THURSDAY,
      state: "queued",
    });
    return created;
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
  }>,
) {
  await database
    .update(threadTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(threadTable.id, id));
  changed();
}

/**
 * Bypasses `updateThread` on purpose: being seen is not movement and must not
 * reorder the inbox by updatedAt. What was read on screen, or told enough on a
 * call, has nothing left to relay, so its relays are settled with it.
 */
export async function markSeen(ids: string[]) {
  if (ids.length === 0) return;
  await database.transaction(async (tx) => {
    await tx
      .update(threadTable)
      .set({ seen: true })
      .where(inArray(threadTable.id, ids));
    await tx
      .update(threadRelayTable)
      .set({ accepted: true })
      .where(inArray(threadRelayTable.threadId, ids));
  });
  changed();
}

/**
 * Adds one step's usage (added, not set: participants' steps land on the same
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

/** Whether a thread can still write another line. */
const isLive = (status: ThreadStatus) =>
  status === "running" || status === "waiting";

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
      // A cancel leaves the room's Now at once, so it takes none of these places
      .where(eq(threadTable.status, "done"))
      .orderBy(desc(threadTable.updatedAt))
      .limit(INBOX_FINISHED),
    database
      .select(threadView)
      .from(threadTable)
      .where(
        and(
          inArray(threadTable.status, ["done", "cancelled"]),
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
  // Only what can still move carries its transcript. An ended thread is in the
  // inbox so it can be seen and opened, and the row says all the list draws of
  // it (its outcome, its room); its lines come with the thread itself when it
  // is opened (queryKey.thread). Without this the one list the event stream
  // re-reads on every change is every finished job's transcript, again.
  return withLines(rows, (row) => isLive(row.status));
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
    .limit(options.limit ?? PAGE_SIZE);
  // As the inbox: only what can still move carries its transcript. Every page
  // loaded here is re-read on the same `threads` signal, so a screen left open
  // beside a working bot would re-read a page of endings per step.
  return withLines(rows, (row) => isLive(row.status));
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

/**
 * The other threads one bot has a desk in — the ones it coordinates and the ones it was
 * called into — for its own prompt (ai/prompts/bot.prompt). Read off thread and thread_work;
 * nothing is kept for it. `said` is the bot's own last ending there (thread_work `result`),
 * not `outcome`: that is the coordinator's, or the words of a stop.
 */
export async function listBotWork(
  bot: string,
  except: string | null,
): Promise<{ open: BotWorkLine[]; recent: BotWorkLine[] }> {
  const pick = (statuses: ThreadStatus[], limit: number) =>
    database
      .select({
        id: threadTable.id,
        owner: threadTable.bot,
        label: threadTable.label,
        status: threadTable.status,
        pending: threadTable.pending,
        updatedAt: threadTable.updatedAt,
      })
      .from(threadTable)
      .where(
        and(
          inArray(threadTable.status, statuses),
          except ? ne(threadTable.id, except) : undefined,
          inArray(
            threadTable.id,
            database
              .select({ id: threadWorkTable.threadId })
              .from(threadWorkTable)
              .where(eq(threadWorkTable.bot, bot)),
          ),
        ),
      )
      .orderBy(desc(threadTable.updatedAt))
      .limit(limit);
  const [open, recent] = await Promise.all([
    pick(["running", "waiting"], BOT_WORK.open),
    pick(["done", "cancelled"], BOT_WORK.recent),
  ]);
  const ids = [...open, ...recent].map((row) => row.id);
  if (!ids.length) return { open: [], recent: [] };

  const endings = await database
    .select({
      id: threadWorkTable.id,
      threadId: threadWorkTable.threadId,
      result: threadWorkTable.result,
    })
    .from(threadWorkTable)
    .where(
      and(
        eq(threadWorkTable.bot, bot),
        inArray(threadWorkTable.threadId, ids),
        isNotNull(threadWorkTable.result),
      ),
    )
    .orderBy(desc(threadWorkTable.createdAt));
  const said = new Map<string, { workId: string; words: string }>();
  for (const { id, threadId, result } of endings)
    if (result?.trim() && !said.has(threadId))
      said.set(threadId, { workId: id, words: result });

  const line = ({ pending, ...row }: (typeof open)[number]) => {
    const last = said.get(row.id);
    return {
      ...row,
      workId: last?.workId ?? null,
      asking: row.status === "waiting" && Boolean(pending?.messageId),
      said: last?.words ?? null,
      // Measured the way `clip` flattens it, so a line is cut exactly when this says so
      cut: last
        ? last.words.replace(/\s+/g, " ").trim().length > BOT_WORK.said
        : false,
    };
  };
  return { open: open.map(line), recent: recent.map(line) };
}

/**
 * What the bot was asked in one of those threads: the job itself where it coordinates,
 * else the messages that called it into the exchange its last words ended.
 */
export async function readBotAsk(
  bot: string,
  line: BotWorkLine,
): Promise<string> {
  if (line.owner === bot) {
    const [row] = await database
      .select({ request: threadTable.request })
      .from(threadTable)
      .where(eq(threadTable.id, line.id));
    return row?.request ?? "";
  }
  if (!line.workId) return "";
  const asked = await database
    .select({ text: threadDeliveryTable.text })
    .from(threadDeliveryTable)
    .where(eq(threadDeliveryTable.workId, line.workId))
    .orderBy(threadDeliveryTable.id);
  return asked.map((row) => row.text).join("\n\n");
}

/** Its messages go with it (cascade). The runner stops a live one first. */
export async function deleteThread(id: string) {
  const removed = await database
    .delete(threadTable)
    .where(eq(threadTable.id, id))
    .returning({ id: threadTable.id });
  if (removed.length) changed();
  return removed.length > 0;
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

/** Every path this job gave `write_file`, from every participant (writtenPathsIn). */
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

/** One row in the screen's shape; `pending` folds into `ask`. */
function viewOf(row: ThreadRow, lines: ThreadLine[]): Omit<Thread, "room"> {
  // contextTokens and contextBudget pass through in `rest`
  const { pending, inputTokens, outputTokens, ...rest } = row;
  return {
    ...rest,
    ask:
      row.status === "waiting"
        ? {
            question: row.outcome ?? "",
            options: pending?.options ?? [],
            messageId: pending?.messageId,
            bot: pending?.bot,
          }
        : null,
    tokens: { input: inputTokens, output: outputTokens },
    lines,
  };
}

/**
 * Rows in the shape the screen reads, their lines replayed from the stored
 * messages. `carries` leaves a row's lines out: the transcript is the whole
 * cost of a thread — a long job's runs to megabytes — and a list that is read
 * again on every change cannot afford the ones that cannot change.
 */
async function withLines(
  rows: ThreadRow[],
  carries: (row: ThreadRow) => boolean = () => true,
): Promise<Thread[]> {
  if (rows.length === 0) return [];
  const withText = rows.filter(carries).map((row) => row.id);
  const messages = withText.length
    ? await database
        .select()
        .from(threadMessageTable)
        .where(inArray(threadMessageTable.threadId, withText))
        .orderBy(threadMessageTable.seq)
    : [];

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
  // A line is addressed to whoever opened the exchange it was written under
  const owners = new Map(rows.map((row) => [row.id, row.bot]));
  const callers = new Map(works.map((item) => [item.id, item.caller]));
  const byThread = new Map<string, ThreadLine[]>();
  for (const message of messages) {
    const list = byThread.get(message.threadId) ?? [];
    list.push(
      ...linesOf(
        message,
        (message.parent ? callers.get(message.parent) : null) ??
          owners.get(message.threadId) ??
          "",
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
      room: {
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
      },
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
export function argumentLine(name: string, input: unknown): string {
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
    const inner = (args.args ?? null) as Record<string, unknown> | null;
    // The studio's tools are the app's own, and what they are given is a sentence
    // rather than a server's arguments: the row draws it as words, off this line
    // (`<server> <tool> <what it was given>`, bot/components/bot-tool studioCall)
    const passed =
      inner && typeof inner === "object"
        ? String(args.server ?? "") === STUDIO_SERVER
          ? tellingOf(inner)
          : JSON.stringify(inner)
        : "";
    return clip(
      [String(args.server ?? ""), called, passed].filter(Boolean).join(" "),
      LINE_MAX,
    );
  }
  const telling = tellingOf(args);
  if (telling) return clip(telling, LINE_MAX);
  const keys = Object.keys(args);
  return keys.length ? clip(JSON.stringify(args), LINE_MAX) : "";
}

/** The first argument that carries the point, as it was written. */
function tellingOf(args: Record<string, unknown>): string {
  for (const key of TELLING) {
    const value = stringAt(args, key);
    if (value) return value;
  }
  for (const key of Object.keys(args)) {
    const value = stringAt(args, key);
    if (value) return value;
  }
  return "";
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

/** Who a message call names, with Thursday spelled the room's way whatever case the model wrote. */
function addresseeOf(args: Record<string, unknown>): string {
  const to = String(args.to ?? "").trim();
  return to.toLowerCase() === ROOM_THURSDAY.toLowerCase() ? ROOM_THURSDAY : to;
}

type StoredMessage = typeof threadMessageTable.$inferSelect;

/**
 * One stored message as screen lines. seq 0 is the request and is drawn from the
 * row instead, so it yields nothing. A message call draws as speech. `addressee`
 * is who opened the exchange the message was written under.
 */
function linesOf(message: StoredMessage, addressee: string): ThreadLine[] {
  if (message.hidden) return [];
  const base = {
    seq: message.seq,
    bot: message.bot,
    parent: message.parent,
    to: message.role === "user" ? message.bot : addressee,
    at: message.createdAt,
  };
  const id = (index: number) => `${message.id}-${index}`;
  const content = message.content;

  if (message.role === "user") {
    if (message.seq === 0) return [];
    const text = typeof content === "string" ? content : textOf(content);
    if (!text) return [];
    // The app's own lines, never the user's words
    if (message.compact) return [{ ...base, id: id(0), kind: "note", text }];
    if (message.note) {
      const why = text.endsWith(RESUME_CHECK)
        ? text.slice(0, -RESUME_CHECK.length).trimEnd()
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
      if (part.toolName === TOOL_NAMES.send_message) {
        lines.push({
          ...base,
          id: id(index),
          kind: "ask",
          callId: part.toolCallId,
          to: addresseeOf(args),
          text: String(args.text ?? ""),
          // No kind is a message (room.schema RoomMessageSchema), never a question
          question: args.kind === "question",
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
          input: argumentLine(part.toolName, args),
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
      // A delivered message's receipt is not a step; a refused one is (thread.store)
      if (
        part.toolName === TOOL_NAMES.send_message &&
        part.output.type !== "error-text"
      )
        return;
      lines.push(resultLine(base, id(index), part));
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
/** How a search names a page it read (search.tool): `title — url`, its date after it at most. */
const PAGE_HEAD = /https?:\/\/\S+(?: · \d{4}-\d{2}-\d{2})?\s*$/;

function resultLine(
  base: Omit<ThreadLine, "id" | "kind">,
  id: string,
  part: { toolCallId: string; toolName: string; output: unknown },
): ThreadLine {
  // A search is glanced at by the pages it read, not by how the first of them begins:
  // the row draws those pages (bot-tool `pagesOf`)
  const search = part.toolName === TOOL_NAMES.web_search;
  const peek = resultParts(
    part.output,
    search ? FULL_RESULT_LINES : RESULT_LINES + 1,
  );
  const lines = peek.flatMap((result) =>
    result.type === "text" ? [result.text] : [],
  );
  const pages = search ? lines.filter((line) => PAGE_HEAD.test(line)) : [];
  const glance = (pages.length ? pages : lines).slice(0, RESULT_LINES);
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
  // A picture, as the row keeps it: the path it was looked at by (tools/look.tool). The
  // line names the file and the full result draws it, both off the file route
  if (
    typeof record.path === "string" &&
    String(record.mediaType ?? "").startsWith("image/")
  ) {
    return [
      { type: "text", text: record.path },
      { type: "image", src: queryKey.file(record.path) },
    ];
  }
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
