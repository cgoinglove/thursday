"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { markSeenAction } from "@/features/bot/bot.action";
import type {
  Bot,
  BotIcon,
  ResultPart,
  Task,
  TokenUsage,
} from "@/features/bot/bot.schema";
import { type DateLike, toDate } from "@/lib/date-like";
import { unwrapResult } from "@/lib/protocol/result";
import { revalidate } from "@/lib/protocol/use-server-route";
import { errorToString } from "@/lib/utils";

/**
 * Client mirror of tasks, keyed by task rather than as one message stream so
 * concurrent delegations stay readable. Rebuilt whole from server rows via
 * `sync`; the screen never writes lines here directly.
 */

export type BotRef = { name: string; icon?: BotIcon | null };

/**
 * `note` and `stop` are the app's markers, not speech. `note` is a compaction
 * summary (bot.run compact), drawn as a divider; `stop` is where the app stopped
 * the run (bot.runner parkTask), drawn muted in the bot's turn.
 */
export type ChatterKind =
  | "say"
  | "ask"
  | "tool"
  | "user"
  | "result"
  | "error"
  | "note"
  | "stop";

/** One tool call. `name` picks the renderer (components/bot-tool); `results` arrive after the call. */
export type ToolUse = {
  name: string;
  /** Query, command, url: whatever it was called with. */
  input: string;
  /** Model-written label (bash description). */
  note?: string | null;
  /** Unclipped path a file tool received; what "Open" opens. */
  path?: string | null;
  /** A glance's worth; arrives after the call. */
  results?: ResultPart[];
  /** Key for the full result on the server (queryKey.toolResult). */
  callId?: string;
  /** More than listed here. */
  more?: boolean;
};

export type Chatter = {
  id: string;
  /** Who speaks. */
  bot: BotRef;
  /** Who is addressed; null is to nobody. */
  to: BotRef | null;
  text: string;
  kind: ChatterKind;
  /** Only for kind `tool`. */
  tool?: ToolUse;
  /** Options attached to a question; only on the line where the bot stopped to ask. */
  options?: string[];
  /** When it was written; only for kind `stop`, whose repeats fold into one line. */
  at?: DateLike;
};

/** `waiting`: the bot stopped to ask the user something. */
export type TaskViewStatus = "working" | "waiting" | "done" | "failed";

export type TaskView = {
  /** Anything the caller can match on; a tool call id will do. */
  id: string;
  /** What Thursday asked for, verbatim. */
  request: string;
  /** A few words naming the task; every ambient view prefixes lines with it. Falls back to the head of the request. */
  label: string;
  /** Who it went to. Other bots may join through `ask`. */
  bot: BotRef;
  lines: Chatter[];
  status: TaskViewStatus;
  /** Text it came back with; only after it returned. */
  outcome: string | null;
  /** What it is asking while `waiting`. */
  ask: Task["ask"];
  /** Whether the user has had the ending (Task `seen`). */
  seen: boolean;
  /** Burned so far. */
  tokens: TokenUsage;
  /** Context read on the last step and the compaction threshold; the header meter is their ratio. Both 0 means no step ran yet. */
  contextTokens: number;
  contextBudget: number;
  /** Last movement. */
  updatedAt: DateLike;
};

/** The list scrolls; this only bounds very long calls. */
const KEEP = 30;

let tasks: TaskView[] = [];
/** Whether server rows arrived at least once. Before that, an empty list means "unknown", not "none". */
let primed = false;
const listeners = new Set<() => void>();

function commit(next: TaskView[]) {
  tasks = next.slice(-KEEP);
  for (const listener of listeners) listener();
}

export const botTasks = {
  /** Replaces everything with the server rows (newest first). A rebuild, not a diff. */
  sync(rows: Task[], bots?: Bot[]) {
    primed = true;
    commit([...rows].reverse().map((row) => taskFromRow(row, bots)));
  },

  /** Whether truth arrived at least once. */
  primed: () => primed,
};

/**
 * One row in the shape the screen draws: the thread replayed as a conversation.
 * Pure, so it can be rebuilt on every sync. Faces come from the bot list; bots
 * not in it (deleted, default) draw by name only.
 */
export function taskFromRow(row: Task, bots?: Bot[]): TaskView {
  const ref = (name: string): BotRef => ({
    name,
    icon: bots?.find((bot) => bot.name === name)?.icon ?? null,
  });
  const owner = ref(row.bot);
  const lines: Chatter[] = [];
  /** Tool call id to the line its result belongs to. */
  const openLines = new Map<string, number>();
  /** `ask_bot` call id to who was asked, so the answer draws as a reply. */
  const asked = new Map<string, BotRef>();

  for (const line of row.lines) {
    // A borrowed bot speaks to the borrower; the job's own bot speaks to nobody
    const bot = line.bot ? ref(line.bot) : owner;
    const to = line.parent
      ? asked.get(line.parent)?.name
        ? owner
        : null
      : null;
    switch (line.kind) {
      case "user":
        lines.push({
          id: line.id,
          bot: owner,
          to: null,
          text: line.text,
          kind: "user",
        });
        break;
      case "text":
        lines.push({ id: line.id, bot, to, text: line.text, kind: "say" });
        break;
      case "note":
        lines.push({ id: line.id, bot, to, text: line.text, kind: "note" });
        break;
      case "stop":
        lines.push({
          id: line.id,
          bot,
          to,
          text: line.text,
          kind: "stop",
          at: line.at,
        });
        break;
      case "tool":
        openLines.set(line.callId, lines.length);
        lines.push({
          id: line.id,
          bot,
          to,
          text: line.note ?? line.input,
          kind: "tool",
          tool: {
            name: line.name,
            input: line.input,
            note: line.note,
            path: line.path,
            callId: line.callId,
          },
        });
        break;
      case "tool-result": {
        const at = openLines.get(line.callId);
        const open = at === undefined ? undefined : lines[at];
        if (open?.tool && at !== undefined) {
          lines[at] = {
            ...open,
            tool: { ...open.tool, results: line.results, more: line.more },
          };
        }
        break;
      }
      case "ask": {
        const other = ref(line.to);
        asked.set(line.callId, other);
        lines.push({
          id: line.id,
          bot,
          to: other,
          text: line.text,
          kind: "ask",
        });
        break;
      }
      case "ask-result": {
        const other = asked.get(line.callId);
        if (other && line.text) {
          lines.push({
            id: line.id,
            bot: other,
            to: bot,
            text: line.text,
            kind: "ask",
          });
        }
        break;
      }
      case "waiting":
        lines.push({
          id: line.id,
          bot,
          to: null,
          text: line.question,
          kind: "result",
          options: line.options,
        });
        break;
    }
  }

  // The ending lives on the row, not in the thread: the answer is the last text
  // said, failure exists only here. `waiting` is treated like done: a job that
  // the app stopped answered first, so that line is a result.
  if (row.status === "failed" && row.outcome) {
    lines.push({
      id: `${row.id}-end`,
      bot: owner,
      to: null,
      text: row.outcome,
      kind: "error",
    });
  } else if (row.status === "done" || row.status === "waiting") {
    const last = lines.at(-1);
    if (last && last.kind === "say" && last.text === row.outcome) {
      lines[lines.length - 1] = { ...last, kind: "result" };
    }
  }

  return {
    id: row.id,
    request: row.request,
    label: row.label,
    bot: owner,
    lines,
    status: row.status === "running" ? "working" : row.status,
    outcome: row.outcome,
    ask: row.ask,
    seen: row.seen,
    tokens: row.tokens,
    contextTokens: row.contextTokens,
    contextBudget: row.contextBudget,
    updatedAt: row.updatedAt,
  };
}

/** Last thing on the bot side (skips user answers and app markers). */
export function lastSaid(task: TaskView): Chatter | null {
  for (let at = task.lines.length - 1; at >= 0; at--) {
    const line = task.lines[at];
    if (line.kind !== "user" && line.kind !== "note" && line.kind !== "stop")
      return line;
  }
  return null;
}

/**
 * What the screen did to a task. Announced so the call can hear it: a poll
 * cannot tell a screen answer from a voice answer, and a cancel is never relayed
 * (bot.runner cancelTask marks it seen).
 */
export type ScreenAct =
  /** Answered a waiting task, interjected into a running one, or continued a finished one. */
  | { kind: "answered"; id: string; label: string; answer: string }
  /** Stopped the task. */
  | { kind: "stopped"; id: string; label: string };

/**
 * Unsent drafts, keyed by task rather than held by the reply box, so switching
 * threads keeps them apart and the room can ask whether the user is typing on
 * a task. Not subscribed to: read at event time, not at render.
 */
const drafts = new Map<string, string>();

export const taskDrafts = {
  get: (id: string) => drafts.get(id) ?? "",
  set(id: string, text: string) {
    if (text) drafts.set(id, text);
    else drafts.delete(id);
  },
  /** Whether a non-blank draft exists for this task. */
  typing: (id: string) => (drafts.get(id)?.trim().length ?? 0) > 0,
};

const acted = new Set<(act: ScreenAct) => void>();

export const screenActs = {
  announce(act: ScreenAct) {
    for (const listener of acted) listener(act);
  },
  subscribe(listener: (act: ScreenAct) => void) {
    acted.add(listener);
    return () => {
      acted.delete(listener);
    };
  },
};

const EMPTY: TaskView[] = [];

export function useBotTasks(): TaskView[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tasks,
    () => EMPTY,
  );
}

export const isOutcome = (line: Chatter) =>
  line.kind === "result" || line.kind === "error";

/** Consecutive lines from one speaker to one addressee, so the avatar is not repeated per line. */
export type ChatterGroup = {
  key: string;
  bot: BotRef;
  to: BotRef | null;
  lines: Chatter[];
};

export function groupChatter(lines: Chatter[]): ChatterGroup[] {
  const groups: ChatterGroup[] = [];
  for (const line of lines) {
    const open = groups.at(-1);
    if (
      open &&
      open.bot.name === line.bot.name &&
      open.to?.name === line.to?.name &&
      (open.lines[0].kind === "user") === (line.kind === "user")
    ) {
      open.lines.push(line);
      continue;
    }
    groups.push({ key: line.id, bot: line.bot, to: line.to, lines: [line] });
  }
  return groups;
}

/** Every bot that spoke in this thread, the task's own first. */
export function rosterOf(task: TaskView): BotRef[] {
  const out: BotRef[] = [task.bot];
  for (const line of task.lines) {
    if (!out.some((bot) => bot.name === line.bot.name)) out.push(line.bot);
  }
  return out;
}

/**
 * The thread in the order it is drawn. A bot arriving is a line of its own
 * rather than a mark on somebody's message: an `ask` names who is being asked,
 * and the first time a name appears there, that is the invite.
 */
export type ThreadItem =
  | { kind: "invite"; key: string; from: BotRef; to: BotRef }
  | { kind: "group"; key: string; group: ChatterGroup };

export function threadItems(task: TaskView): ThreadItem[] {
  // The task's own bot was invited by Thursday; the request draws that one.
  const seen = new Set([task.bot.name]);
  const out: ThreadItem[] = [];
  for (const group of groupChatter(task.lines)) {
    if (group.to && !seen.has(group.to.name)) {
      seen.add(group.to.name);
      out.push({
        kind: "invite",
        key: `${group.key}-joins`,
        from: group.bot,
        to: group.to,
      });
    }
    seen.add(group.bot.name);
    out.push({ kind: "group", key: group.key, group });
  }
  return out;
}

/**
 * Each bot's latest line and the task it belongs to. Bots that took a job but
 * have not spoken yet are included with `line` null.
 */
export type BotLine = {
  bot: BotRef;
  task: TaskView;
  line: Chatter | null;
  /** How many of their tasks are still running. */
  open: number;
};

export function latestPerBot(list: TaskView[]): BotLine[] {
  const byBot = new Map<string, BotLine>();

  for (const task of list) {
    // Assigned but still silent; still in the room
    if (!byBot.has(task.bot.name)) {
      byBot.set(task.bot.name, { bot: task.bot, task, line: null, open: 0 });
    }
    for (const line of task.lines) {
      if (line.kind === "user" || line.kind === "note" || line.kind === "stop")
        continue;
      byBot.set(line.bot.name, {
        bot: line.bot,
        task,
        line,
        open: byBot.get(line.bot.name)?.open ?? 0,
      });
    }
  }

  for (const task of list) {
    if (task.status !== "working") continue;
    const entry = byBot.get(task.bot.name);
    if (entry) entry.open += 1;
  }

  return [...byBot.values()];
}

/**
 * Opening a job's detail is reading its ending: the thread in the room, a row
 * expanded in Settings › Tasks. That is what clears its dot — a list scrolled
 * past or a line heard on a call is not. Keyed by `updatedAt` as well, because a
 * follow-up ends a job a second time and that ending is new again.
 */
export function useSeenOnDetail(
  task:
    | { id: string; status: string; seen: boolean; updatedAt: DateLike }
    | null
    | undefined,
) {
  const sent = useRef(new Set<string>());
  const id = task?.id ?? null;
  const key = task ? `${task.id}@${toDate(task.updatedAt).getTime()}` : null;
  const owed =
    !!task &&
    (task.status === "done" || task.status === "failed") &&
    !task.seen;

  useEffect(() => {
    if (!id || !key || !owed || sent.current.has(key)) return;
    sent.current.add(key);
    void markSeenAction([id])
      .then(unwrapResult)
      .then(() => revalidate(queryKey.tasks))
      .catch((cause) => {
        // Released, so opening it again tries again
        sent.current.delete(key);
        toast.add({
          type: "error",
          title: "Could not mark the task as read",
          description: errorToString(cause),
        });
      });
  }, [id, key, owed]);
}
