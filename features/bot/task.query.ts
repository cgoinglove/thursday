import type { AssistantContent, ModelMessage, ToolContent } from "ai";
import { and, desc, eq, inArray, isNull, lt, max, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { database } from "@/database/db";
import { taskMessageTable, taskTable } from "@/database/tables";
import { reportAccepted } from "@/features/ai/tools/bot.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { clip } from "@/lib/utils";
import {
  type ResultPart,
  TASK_HISTORY_PAGE,
  type Task,
  type TaskLine,
  type TaskStatus,
  type TokenUsage,
} from "./bot.schema";

// Tasks and their threads. Bots themselves (roster, pinned tools) are bot.query.

/** Every write in this file ends with this; the screen re-reads the list on it. */
const changed = () => appEvents.emit({ type: "tasks" });

/** Task state without the thread. `lines` is filled by `withLines` from task_message; `pending` folds into `ask`. */
const taskView = {
  id: taskTable.id,
  bot: taskTable.bot,
  label: taskTable.label,
  request: taskTable.request,
  status: taskTable.status,
  outcome: taskTable.outcome,
  pending: taskTable.pending,
  reported: taskTable.reported,
  inputTokens: taskTable.inputTokens,
  outputTokens: taskTable.outputTokens,
  contextTokens: taskTable.contextTokens,
  contextBudget: taskTable.contextBudget,
  createdAt: taskTable.createdAt,
  updatedAt: taskTable.updatedAt,
};

type TaskRow = {
  id: string;
  bot: string;
  label: string;
  request: string;
  status: TaskStatus;
  outcome: string | null;
  pending: { toolCallId: string | null; options: string[] } | null;
  reported: boolean;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextBudget: number;
  createdAt: Date;
  updatedAt: Date;
};

/** How many finished tasks the inbox keeps; the rest live in Settings > Tasks. */
const INBOX_RECENT_FINISHED = 3;

/**
 * One row plus the thread's first message. `request` is what the screen shows;
 * `opening` is what the model reads (request plus recent call turns). The screen
 * skips seq 0 and shows `request` instead (linesOf).
 */
export async function insertTask(input: {
  bot: string;
  label: string;
  request: string;
  callId?: string | null;
  opening: string;
}) {
  const { opening, ...row } = input;
  const [task] = await database
    .insert(taskTable)
    .values({ id: crypto.randomUUID(), status: "running", ...row })
    .returning();
  await upsertMessage(task.id, 0, {
    bot: null,
    parent: null,
    role: "user",
    content: opening,
  });
  changed();
  return task;
}

export async function updateTask(
  id: string,
  patch: Partial<{
    status: TaskStatus;
    outcome: string | null;
    pending: { toolCallId: string | null; options: string[] } | null;
    reported: boolean;
    endedAt: Date | null;
  }>,
) {
  await database
    .update(taskTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(taskTable.id, id));
  changed();
}

/** Bypasses `updateTask` on purpose: reporting is not movement and must not reorder the inbox by updatedAt. */
export async function markReported(ids: string[]) {
  if (ids.length === 0) return;
  await database
    .update(taskTable)
    .set({ reported: true })
    .where(inArray(taskTable.id, ids));
  changed();
}

/**
 * Adds one step's usage (added, not set: borrowed-bot steps land on the same
 * task in parallel) without touching updatedAt. `context` is overwritten: it is
 * the current window fill and threshold, not a sum. null leaves it as is.
 */
export async function addTaskUsage(
  id: string,
  usage: TokenUsage,
  context: { tokens: number; budget: number } | null = null,
) {
  if (!usage.input && !usage.output && context === null) return;
  await database
    .update(taskTable)
    .set({
      inputTokens: sql`${taskTable.inputTokens} + ${usage.input}`,
      outputTokens: sql`${taskTable.outputTokens} + ${usage.output}`,
      ...(context === null
        ? {}
        : { contextTokens: context.tokens, contextBudget: context.budget }),
    })
    .where(eq(taskTable.id, id));
  changed();
}

/** One task as the screen sees it, thread included. null if missing. */
export async function findTaskView(id: string): Promise<Task | null> {
  const [row] = await database
    .select(taskView)
    .from(taskTable)
    .where(eq(taskTable.id, id));
  if (!row) return null;
  const [task] = await withLines([row]);
  return task ?? null;
}

export async function findTask(id: string) {
  const [task] = await database
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, id));
  return task ?? null;
}

/** Inbox: everything running or waiting plus the most recently finished few, newest first. `reported` is not a filter here. */
export async function listInboxTasks(): Promise<Task[]> {
  const [open, finished] = await Promise.all([
    database
      .select(taskView)
      .from(taskTable)
      .where(inArray(taskTable.status, ["running", "waiting"]))
      .orderBy(desc(taskTable.updatedAt)),
    database
      .select(taskView)
      .from(taskTable)
      .where(inArray(taskTable.status, ["done", "failed"]))
      .orderBy(desc(taskTable.updatedAt))
      .limit(INBOX_RECENT_FINISHED),
  ]);
  const rows = [...open, ...finished].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  return withLines(rows);
}

/** All tasks, newest first, one page at a time. `before` is a cursor (last page's updatedAt), not an offset, because rows move in between. */
export async function listTaskHistory(
  options: { before?: Date | null; limit?: number } = {},
): Promise<Task[]> {
  const rows = await database
    .select(taskView)
    .from(taskTable)
    .where(options.before ? lt(taskTable.updatedAt, options.before) : undefined)
    .orderBy(desc(taskTable.updatedAt))
    .limit(options.limit ?? TASK_HISTORY_PAGE);
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
      id: taskTable.id,
      callId: taskTable.callId,
      label: taskTable.label,
      status: taskTable.status,
      outcome: taskTable.outcome,
    })
    .from(taskTable)
    .where(inArray(taskTable.callId, callIds))
    .orderBy(taskTable.createdAt);
}

export type CallJob = Awaited<ReturnType<typeof listCallJobs>>[number];

/** The thread goes with it (cascade). The runner stops a live one first. */
export async function deleteTask(id: string) {
  const removed = await database
    .delete(taskTable)
    .where(eq(taskTable.id, id))
    .returning({ id: taskTable.id });
  if (removed.length) changed();
  return removed.length > 0;
}

/** Everything finished, done or failed. Running and waiting rows stay: they are still work. */
export async function deleteFinishedTasks() {
  const removed = await database
    .delete(taskTable)
    .where(inArray(taskTable.status, ["done", "failed"]))
    .returning({ id: taskTable.id });
  if (removed.length) changed();
  return removed.length;
}

/** Every job, newest first. The caller stops each one before deleting it (bot.runner removeTask). */
export async function listAllTaskIds(): Promise<string[]> {
  const rows = await database
    .select({ id: taskTable.id })
    .from(taskTable)
    .orderBy(desc(taskTable.createdAt));
  return rows.map((row) => row.id);
}

/** Rows a previous server left as running; the runner decides which still are. */
export async function listRunningTaskIds() {
  const rows = await database
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(eq(taskTable.status, "running"));
  return rows.map((row) => row.id);
}

/**
 * Finds a task by id or by exact label (case-insensitive). No looser matching:
 * a miss returns null and the caller lists recent tasks instead.
 */
export async function resolveTask(ref: string) {
  const term = ref.trim();
  if (!term) return null;
  const whole = await findTask(term);
  if (whole) return whole;

  const lower = term.toLowerCase();
  const recent = await database
    .select()
    .from(taskTable)
    .orderBy(desc(taskTable.updatedAt))
    .limit(20);
  return recent.find((task) => task.label.toLowerCase() === lower) ?? null;
}

export type TaskMessageInput = {
  bot: string | null;
  parent: string | null;
  role: ModelMessage["role"];
  content: ModelMessage["content"];
  /** Compaction summary row; `listThread` re-reads from here. */
  compact?: boolean;
  /** Drawn as the app's own line, not as something a person or a bot said. */
  note?: boolean;
};

/**
 * Writes by seat, not append: a step's messages are written while streaming and
 * rewritten whole when it ends, and the second write must replace the first.
 */
export async function upsertMessage(
  taskId: string,
  seq: number,
  message: TaskMessageInput,
) {
  await database
    .insert(taskMessageTable)
    .values({
      taskId,
      seq,
      ...message,
      compact: message.compact ?? false,
      note: message.note ?? false,
    })
    .onConflictDoUpdate({
      target: [taskMessageTable.taskId, taskMessageTable.seq],
      set: {
        role: message.role,
        content: message.content,
        compact: message.compact ?? false,
        note: message.note ?? false,
      },
    });
  changed();
}

/** Frees seats claimed while streaming but unused when the step ended. Left in, they put unmatched tool results in the thread the model re-reads. */
export async function deleteMessages(taskId: string, seqs: number[]) {
  if (!seqs.length) return;
  await database
    .delete(taskMessageTable)
    .where(
      and(
        eq(taskMessageTable.taskId, taskId),
        inArray(taskMessageTable.seq, seqs),
      ),
    );
  changed();
}

/** Highest seq taken so far; -1 for an empty thread. */
export async function lastSeq(taskId: string): Promise<number> {
  const [row] = await database
    .select({ seq: max(taskMessageTable.seq) })
    .from(taskMessageTable)
    .where(eq(taskMessageTable.taskId, taskId));
  return row?.seq ?? -1;
}

/**
 * The task's own thread as the model sees it: parent-less messages in order.
 * What a borrowed bot said inside an `ask_bot` call is not here; its result is.
 * Starts at the last compact row when there is one.
 */
export async function listThread(taskId: string): Promise<ModelMessage[]> {
  const rows = await database
    .select({
      role: taskMessageTable.role,
      content: taskMessageTable.content,
      compact: taskMessageTable.compact,
    })
    .from(taskMessageTable)
    .where(
      and(eq(taskMessageTable.taskId, taskId), isNull(taskMessageTable.parent)),
    )
    .orderBy(taskMessageTable.seq);
  const from = rows.findLastIndex((row) => row.compact);
  return rows
    .slice(Math.max(from, 0))
    .map((row) => ({ role: row.role, content: row.content }) as ModelMessage);
}

/** One row in the screen's shape; `pending` folds into `ask`. */
function viewOf(row: TaskRow, lines: TaskLine[]): Task {
  // contextTokens and contextBudget pass through in `rest`
  const { pending, inputTokens, outputTokens, ...rest } = row;
  return {
    ...rest,
    ask:
      row.status === "waiting"
        ? { question: row.outcome ?? "", options: pending?.options ?? [] }
        : null,
    tokens: { input: inputTokens, output: outputTokens },
    lines,
  };
}

/** Reduces every task's thread to lines and attaches them to the rows. */
async function withLines(rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const messages = await database
    .select()
    .from(taskMessageTable)
    .where(
      inArray(
        taskMessageTable.taskId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(taskMessageTable.seq);

  // ask_back lines name no addressee; the task's own bot is the addressee
  const owners = new Map(rows.map((row) => [row.id, row.bot]));
  const byTask = new Map<string, TaskLine[]>();
  for (const message of messages) {
    const list = byTask.get(message.taskId) ?? [];
    list.push(...linesOf(message, owners.get(message.taskId) ?? ""));
    byTask.set(message.taskId, list);
  }
  return rows.map((row) => viewOf(row, byTask.get(row.id) ?? []));
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
  "task",
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
 * One tool call as one line. Shared by the screen and by the resumed bot's
 * re-read history (bot.run condenseThread). No per-tool summary table: the
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

/** Cap for the full result, so one log file cannot flatten the browser. */
const FULL_RESULT_LINES = 400;

/** Everything one tool returned; only when the screen asks for more. The list carries a few lines (linesOf). */
export async function readToolResult(
  taskId: string,
  toolCallId: string,
): Promise<ResultPart[] | null> {
  // Usually a tool row, but results of provider-run tools (search) sit inside
  // an assistant row, so both are scanned
  const rows = await database
    .select({ role: taskMessageTable.role, content: taskMessageTable.content })
    .from(taskMessageTable)
    .where(
      and(
        eq(taskMessageTable.taskId, taskId),
        inArray(taskMessageTable.role, ["tool", "assistant"]),
      ),
    );
  for (const row of rows) {
    if (typeof row.content === "string") continue;
    for (const part of row.content as ToolContent) {
      if (part.type === "tool-result" && part.toolCallId === toolCallId) {
        return resultParts(part.output, FULL_RESULT_LINES);
      }
    }
  }
  return null;
}

type StoredMessage = typeof taskMessageTable.$inferSelect;

/**
 * One stored message as screen lines. seq 0 is the request and is drawn from the
 * row instead, so it yields nothing. Tool calls aimed at the user or another bot
 * get their own kinds because the screen draws them as speech. `owner` is the
 * task's bot, the addressee of an ask_back line.
 */
function linesOf(message: StoredMessage, owner: string): TaskLine[] {
  const base = {
    seq: message.seq,
    bot: message.bot,
    parent: message.parent,
    at: message.createdAt,
  };
  const id = (index: number) => `${message.id}-${index}`;
  const content = message.content;

  if (message.role === "user") {
    if (message.seq === 0) return [];
    const text = typeof content === "string" ? content : textOf(content);
    if (!text) return [];
    // The app's own line — a compaction marker, or why a run stopped — never
    // the user's words. `compact` is read too: rows written before `note` was.
    if (message.note || message.compact)
      return [{ ...base, id: id(0), kind: "note", text }];
    return [{ ...base, id: id(0), kind: "user", text }];
  }

  if (message.role === "assistant") {
    const content = message.content as AssistantContent;
    if (typeof content === "string") {
      return content.trim()
        ? [{ ...base, id: id(0), kind: "text", text: content.trim() }]
        : [];
    }
    const lines: TaskLine[] = [];
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
      } else if (part.toolName === TOOL_NAMES.report) {
        // The report is a tool call but draws as text: it is the last thing said
        // in the thread, and taskFromRow promotes it to the result line
        const text = String(args.result ?? "").trim();
        if (text) lines.push({ ...base, id: id(index), kind: "text", text });
      } else if (part.toolName === TOOL_NAMES.ask_bot) {
        lines.push({
          ...base,
          id: id(index),
          kind: "ask",
          callId: part.toolCallId,
          to: String(args.bot ?? ""),
          text: String(args.request ?? ""),
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
    const lines: TaskLine[] = [];
    (message.content as ToolContent).forEach((part, index) => {
      if (part.type !== "tool-result") return;
      if (part.toolName === TOOL_NAMES.report && reportAccepted(part.output)) {
        // An accepted report's result is only a confirmation; the report itself
        // was drawn from the call. A rejected one is drawn: it explains the next step
        return;
      }
      if (part.toolName === TOOL_NAMES.ask_thursday) {
        // The user's answer, returned as the question's result
        const text = resultParts(part.output, RESULT_LINES)
          .flatMap((result) => (result.type === "text" ? [result.text] : []))
          .join("\n");
        lines.push({ ...base, id: id(index), kind: "user", text });
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

/** List line for one tool result. Asks for one line extra to know whether it was clipped. Called for tool rows and, for provider-run tools, assistant rows. */
function resultLine(
  base: Omit<TaskLine, "id" | "kind">,
  id: string,
  part: { toolCallId: string; toolName: string; output: unknown },
): TaskLine {
  const peek = resultParts(part.output, RESULT_LINES + 1);
  return {
    ...base,
    id,
    kind: "tool-result",
    callId: part.toolCallId,
    name: part.toolName,
    results: peek.slice(0, RESULT_LINES),
    more: peek.length > RESULT_LINES,
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

/** Tool output as a few glanceable parts: text becomes lines, images stay images. ai-sdk output shapes first, then our tools' shapes, then raw JSON. */
function resultParts(output: unknown, limit: number): ResultPart[] {
  if (output == null) return [];
  if (typeof output === "string") return textParts(output, limit);
  if (typeof output !== "object") return textParts(String(output), limit);

  const wrapped = output as { type?: unknown; value?: unknown };
  switch (wrapped.type) {
    case "text":
    case "error-text":
      return textParts(String(wrapped.value ?? ""), limit);
    case "json":
    case "error-json":
      return resultParts(wrapped.value, limit);
    case "execution-denied":
      return textParts("Denied.", limit);
    case "content": {
      if (!Array.isArray(wrapped.value)) return [];
      const parts: ResultPart[] = [];
      for (const block of wrapped.value as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(...textParts(block.text, limit));
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
    return textParts(record.stdout || String(record.stderr ?? ""), limit);
  }
  if (typeof record.answer === "string") return textParts(record.answer, limit);
  return textParts(JSON.stringify(output), limit);
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

function textParts(text: string, limit: number): ResultPart[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => ({ type: "text" as const, text: line }));
}
