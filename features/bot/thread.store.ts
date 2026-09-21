"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { markSeenAction } from "@/features/bot/bot.action";
import type {
  Bot,
  BotIcon,
  ResultPart,
  Thread,
  TokenUsage,
} from "@/features/bot/bot.schema";
import { type DateLike, toDate } from "@/lib/date-like";
import { unwrapResult } from "@/lib/protocol/result";
import { revalidate } from "@/lib/protocol/use-server-route";
import { errorToString } from "@/lib/utils";
import { ROOM_THURSDAY, type RoomView } from "./room.schema";

/**
 * Client mirror of threads, keyed by thread rather than as one message stream so
 * concurrent delegations stay readable. Rebuilt whole from server rows via
 * `sync`; the screen never writes lines here directly.
 */

export type BotRef = { name: string; icon?: BotIcon | null };

/**
 * `note` and `stop` are the app's markers, not speech. `note` is a compaction
 * summary (bot.run compact), drawn as a divider; `stop` is where the app stopped
 * the run (bot.runner), drawn muted in the bot's turn.
 */
type ChatterKind = "say" | "ask" | "tool" | "user" | "result" | "note" | "stop";

/** One tool call. `name` picks the renderer (components/bot-tool); `results` arrive after the call. */
export type ToolUse = {
  name: string;
  /** Query, command, url: whatever it was called with. */
  input: string;
  /** Model-written label (bash description). */
  note?: string | null;
  /** Unclipped path a file tool received; what "Open" opens. */
  path?: string | null;
  /** A glance's worth of text lines; arrives after the call. */
  results?: ResultPart[];
  /** Key for the full result on the server (queryKey.toolResult). */
  callId?: string;
  /** The output holds more than `results`: more lines, a clipped line, or an image. */
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
  question?: boolean;
  /** Only for kind `user`: the words landed between the bot's steps, so the user stepped in on a running turn. */
  steppedIn?: boolean;
  /** Only for kind `tool`. */
  tool?: ToolUse;
  /** When it was written: a `stop`, whose repeats fold into one line, and a `tool`, so a folded run can say how long it took. */
  at?: DateLike;
};

/** `waiting`: the bot stopped to ask the user something. */
export type ThreadViewStatus = "working" | "waiting" | "done" | "cancelled";

export type ThreadView = {
  /** The thread row's id. */
  id: string;
  /** What Thursday asked for, verbatim. */
  request: string;
  /** A few words naming the thread; every ambient view prefixes lines with it. Falls back to the head of the request. */
  label: string;
  /** Who it went to. Other bots join through messages (`ask`). */
  bot: BotRef;
  /**
   * Every bot in this thread, its own first, in the order each took part. Read
   * off the room, not the lines: the inbox leaves an ended thread's lines out
   * (thread.query `listInboxThreads`) and its row still has to name everyone.
   */
  roster: BotRef[];
  lines: Chatter[];
  room: RoomView;
  status: ThreadViewStatus;
  /** Text it came back with; only after it returned. */
  outcome: string | null;
  /** What it is asking while `waiting`. */
  ask: Thread["ask"];
  /** Whether the user has had the ending (Thread `seen`). */
  seen: boolean;
  /** The routine that opened it, if one did (Thread `routineId`). */
  routineId: string | null;
  /** Burned so far. */
  tokens: TokenUsage;
  /** Context read on the last step and the compaction threshold; the header meter is their ratio. Both 0 means no step ran yet. */
  contextTokens: number;
  contextBudget: number;
  /** Last movement. */
  updatedAt: DateLike;
};

let threads: ThreadView[] = [];
/** Whether server rows arrived at least once. Before that, an empty list means "unknown", not "none". */
let primed = false;
const listeners = new Set<() => void>();

function commit(next: ThreadView[]) {
  threads = next;
  for (const listener of listeners) listener();
}

export const botThreads = {
  /** Replaces everything with the server rows (newest first). A rebuild, not a diff. */
  sync(rows: Thread[], bots?: Bot[]) {
    primed = true;
    commit([...rows].reverse().map((row) => threadFromRow(row, bots)));
  },

  /** Whether truth arrived at least once. */
  primed: () => primed,
};

/**
 * One row in the shape the screen draws: the thread replayed as a conversation.
 * Pure, so it can be rebuilt on every sync. Faces come from the bot list; bots
 * not in it (deleted, default) draw by name only.
 */
export function threadFromRow(row: Thread, bots?: Bot[]): ThreadView {
  const ref = (name: string): BotRef => ({
    name,
    icon: bots?.find((bot) => bot.name === name)?.icon ?? null,
  });
  const owner = ref(row.bot);
  const lines: Chatter[] = [];
  /** Tool call id to the line its result belongs to. */
  const openLines = new Map<string, number>();
  const askers = new Map<string, BotRef>();
  /** Message call id to its line, so a refused send can be redrawn as the step it was. */
  const sends = new Map<string, number>();

  for (const line of row.lines) {
    // A participant speaks to whoever opened its exchange; the job's own bot to nobody
    const bot = line.bot ? ref(line.bot) : owner;
    const to = line.to
      ? ref(line.to)
      : line.parent
        ? (askers.get(line.parent) ?? null)
        : null;
    switch (line.kind) {
      case "user":
        lines.push({
          id: line.id,
          bot: line.to ? ref(line.to) : owner,
          to: line.to ? ref(line.to) : null,
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
          at: line.at,
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
        const at = openLines.get(line.callId) ?? sends.get(line.callId);
        const open = at === undefined ? undefined : lines[at];
        if (open?.tool && at !== undefined) {
          lines[at] = {
            ...open,
            tool: { ...open.tool, results: line.results, more: line.more },
          };
        } else if (open?.kind === "ask" && at !== undefined) {
          // Only a send the tool refused leaves a result here (thread.query): it
          // reached nobody, so it draws as the failed step it was, not as speech.
          lines[at] = {
            id: open.id,
            bot: open.bot,
            to: null,
            text: open.text,
            kind: "tool",
            tool: {
              name: line.name,
              input: open.text,
              callId: line.callId,
              results: line.results,
              more: line.more,
            },
          };
        }
        break;
      }
      case "ask": {
        sends.set(line.callId, lines.length);
        const other = ref(line.to);
        askers.set(line.callId, bot);
        lines.push({
          id: line.id,
          bot,
          to: other,
          text: line.text,
          kind: "ask",
          question: line.question,
        });
        break;
      }
    }
  }

  // Derived, not stored: words the bot read straight after a step of its own can
  // only have been stepped in with. After a question they are its answer, after an
  // ending they carry the thread on.
  lines.forEach((line, at) => {
    if (line.kind !== "user") return;
    const before = lines
      .slice(0, at)
      .findLast((one) => one.kind !== "user" && one.bot.name === line.bot.name);
    if (before?.kind === "tool") lines[at] = { ...line, steppedIn: true };
  });

  // The answer is the last text said, and the row's outcome says which
  if (row.status === "done") {
    const last = lines.at(-1);
    if (last && last.kind === "say" && last.text === row.outcome) {
      lines[lines.length - 1] = { ...last, kind: "result" };
    }
  }

  const roster: BotRef[] = [owner];
  const join = (bot: BotRef | null) => {
    if (!bot || bot.name === ROOM_THURSDAY) return;
    if (!roster.some((one) => one.name === bot.name)) roster.push(bot);
  };
  for (const one of row.room.participants) join(ref(one.bot));
  // A bot a line names before it has a participant row of its own
  for (const line of lines) {
    join(line.bot);
    join(line.to);
  }

  return {
    id: row.id,
    room: row.room,
    request: row.request,
    label: row.label,
    bot: owner,
    roster,
    lines,
    status: row.status === "running" ? "working" : row.status,
    outcome: row.outcome,
    ask: row.ask,
    seen: row.seen,
    routineId: row.routineId,
    tokens: row.tokens,
    contextTokens: row.contextTokens,
    contextBudget: row.contextBudget,
    updatedAt: row.updatedAt,
  };
}

/** Last thing on the bot side (skips user answers and app markers). */
export function lastSaid(thread: ThreadView): Chatter | null {
  for (let at = thread.lines.length - 1; at >= 0; at--) {
    const line = thread.lines[at];
    if (line.kind !== "user" && line.kind !== "note" && line.kind !== "stop")
      return line;
  }
  return null;
}

/**
 * What the user did on screen that an open call cannot see for itself. Announced so the
 * call can hear it: a poll cannot tell a screen answer from a voice answer, a cancel is
 * never relayed (bot.runner cancelThread marks it seen), and a file put down is nowhere
 * in the conversation until somebody says so.
 */
type ScreenAct =
  /** Answered a waiting thread, interjected into a running one, or continued a finished one. */
  | {
      kind: "answered";
      id: string;
      label: string;
      answer: string;
      recipient?: string;
      replyTo?: string;
    }
  /** Stopped the thread. */
  | { kind: "stopped"; id: string; label: string }
  /** Handed files over through the write line; they are kept at these workspace paths. */
  | { kind: "gave"; paths: string[] };

/** Drafts and selected recipients survive switching threads, independently for each participant. */
const drafts = new Map<string, Map<string, string>>();
const recipients = new Map<string, string>();

export const threadDrafts = {
  recipient: (id: string) => recipients.get(id),
  select: (id: string, bot: string) => {
    recipients.set(id, bot);
  },
  get: (id: string, bot: string, question?: string) =>
    drafts.get(id)?.get(JSON.stringify([bot, question ?? null])) ?? "",
  set(id: string, bot: string, text: string, question?: string) {
    const own = drafts.get(id) ?? new Map<string, string>();
    const key = JSON.stringify([bot, question ?? null]);
    if (text) own.set(key, text);
    else own.delete(key);
    if (own.size) drafts.set(id, own);
    else drafts.delete(id);
  },
};

/**
 * The threads the call screen holds under her face while she rings. One ending is asked
 * about in one place, so the room's pill leaves their rows to the screen and keeps
 * only its own mark on them.
 */
let rung: string[] = [];
const rungListeners = new Set<() => void>();
const NO_RUNG: string[] = [];

export const ringingThreads = {
  set(ids: string[]) {
    if (ids.length === rung.length && ids.every((id, at) => rung[at] === id))
      return;
    rung = ids;
    for (const listener of rungListeners) listener();
  },
};

export function useRingingThreads(): string[] {
  return useSyncExternalStore(
    (listener) => {
      rungListeners.add(listener);
      return () => rungListeners.delete(listener);
    },
    () => rung,
    () => NO_RUNG,
  );
}

const writes = new Set<() => void>();
let writeLineUp = false;
const writeLineListeners = new Set<() => void>();

/**
 * Asks the screen for its write line: the pill's "+" does, from either place the pill stands.
 * The line says when it is up (`shown`), since it stands where the pill's card would grow.
 */
export const writeLine = {
  open() {
    for (const listener of writes) listener();
  },
  subscribe(listener: () => void) {
    writes.add(listener);
    return () => {
      writes.delete(listener);
    };
  },
  shown(up: boolean) {
    if (up === writeLineUp) return;
    writeLineUp = up;
    for (const listener of writeLineListeners) listener();
  },
};

/** Whether the write line is up at the foot of the screen. */
export function useWriteLineUp(): boolean {
  return useSyncExternalStore(
    (listener) => {
      writeLineListeners.add(listener);
      return () => writeLineListeners.delete(listener);
    },
    () => writeLineUp,
    () => false,
  );
}

const opens = new Set<(id: string) => void>();

/** Asks the room to open a thread from elsewhere on the screen. */
export const roomOpens = {
  open(id: string) {
    for (const listener of opens) listener(id);
  },
  subscribe(listener: (id: string) => void) {
    opens.add(listener);
    return () => {
      opens.delete(listener);
    };
  },
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

const EMPTY: ThreadView[] = [];

export function useBotThreads(): ThreadView[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => threads,
    () => EMPTY,
  );
}

const isOutcome = (line: Chatter) => line.kind === "result";

/** The model message a line was cut from: thread.query ids its lines `<message id>-<part>`. */
const messageOf = (line: Chatter) => line.id.slice(0, line.id.lastIndexOf("-"));

/** Who says a line. The user's words carry the bot that heard them as `bot`. */
const speakerOf = (line: Chatter): BotRef =>
  line.kind === "user" ? { name: ROOM_THURSDAY } : line.bot;

/** Who a line reached: the bot that heard the user's words, else whom it names. */
export const heardBy = (line: Chatter): BotRef | null =>
  line.kind === "user" ? line.bot : line.to;

/**
 * Which lines are messages: the user's words, anything sent between
 * participants (questions, answers, reports), an ending, and a bot's words in a
 * model message that did nothing else — its reply. Everything else is a bot's
 * work: steps, stops, compactions and the words beside a call.
 */
function messagesIn(lines: Chatter[]): (line: Chatter) => boolean {
  const acting = new Set(
    lines
      .filter((line) => line.kind === "tool" || line.kind === "ask")
      .map(messageOf),
  );
  return (line) =>
    line.kind === "user" ||
    line.kind === "ask" ||
    isOutcome(line) ||
    (line.kind === "say" && !acting.has(messageOf(line)));
}

/**
 * One thing in a speaker's turn: a message, or its work since the last message
 * it sent or received. Open work has no message after it yet: what the bot is
 * on now, or where it stopped.
 */
type TurnEntry =
  | { kind: "message"; key: string; line: Chatter }
  | { kind: "work"; key: string; lines: Chatter[]; open: boolean };

/**
 * The thread in the order it is drawn: a bot arriving, a line of its own the
 * first time a message names it, and turns — one speaker's entries in a row.
 */
export type ThreadItem =
  | { kind: "invite"; key: string; from: BotRef; to: BotRef }
  | { kind: "turn"; key: string; speaker: BotRef; entries: TurnEntry[] };

type Drawn =
  | Extract<ThreadItem, { kind: "invite" }>
  | { kind: "entry"; speaker: BotRef; entry: TurnEntry };

type Work = { bot: BotRef; lines: Chatter[]; at: number };

const workEntry = (work: Work, open: boolean): Drawn => ({
  kind: "entry",
  speaker: work.bot,
  entry: {
    kind: "work",
    key: `${work.lines[0].id}-work`,
    lines: work.lines,
    open,
  },
});

/**
 * The thread as a conversation, from one bot's tab. The thread's own bot's tab
 * holds every line; another bot's holds its own lines and the messages that
 * reached it, which is what its context holds. A bot's work folds into one entry
 * before the next message it sends or receives, so a message follows the work
 * that led to it.
 */
export function threadItems(
  thread: ThreadView,
  tab: string,
  /** Bots at work or waiting on the user; one with no open work gets an empty open entry at the end. */
  live: BotRef[] = [],
): ThreadItem[] {
  const isMessage = messagesIn(thread.lines);
  const lines =
    tab === thread.bot.name
      ? thread.lines
      : thread.lines.filter(
          (line) =>
            speakerOf(line).name === tab ||
            (isMessage(line) && heardBy(line)?.name === tab),
        );

  // Who joined is decided on the whole thread, so a bot's tab never credits
  // another invite to it. The request draws Thursday and the owner entering.
  const seen = new Set([thread.bot.name, ROOM_THURSDAY]);
  const joins = new Map<string, { from: BotRef; to: BotRef }>();
  for (const line of thread.lines) {
    const to = heardBy(line);
    if (to && !seen.has(to.name)) {
      seen.add(to.name);
      joins.set(line.id, { from: speakerOf(line), to });
    }
    seen.add(line.bot.name);
  }

  const drawn: Drawn[] = [];
  /** Each bot's work since its last message, and how much was drawn when its latest line came. */
  const working = new Map<string, Work>();
  const settle = (bot: BotRef | null) => {
    const work = bot ? working.get(bot.name) : undefined;
    if (!work) return;
    working.delete(work.bot.name);
    drawn.push(workEntry(work, false));
  };
  for (const line of lines) {
    if (!isMessage(line)) {
      const work = working.get(line.bot.name) ?? {
        bot: line.bot,
        lines: [],
        at: 0,
      };
      work.lines.push(line);
      work.at = drawn.length;
      working.set(line.bot.name, work);
      continue;
    }
    // What the bot it reached did before it arrived, then what led the speaker to it.
    const speaker = speakerOf(line);
    settle(heardBy(line));
    const join = joins.get(line.id);
    if (join) drawn.push({ kind: "invite", key: `${line.id}-joins`, ...join });
    settle(speaker);
    drawn.push({
      kind: "entry",
      speaker,
      entry: { kind: "message", key: line.id, line },
    });
  }

  // Work no message has followed stays where its latest line came. Inserted from
  // the back, so earlier places hold and ties keep the order they started in.
  const open = [...working.values()].sort((a, b) => a.at - b.at).reverse();
  for (const work of open) drawn.splice(work.at, 0, workEntry(work, true));
  for (const bot of live) {
    if (working.has(bot.name)) continue;
    drawn.push({
      kind: "entry",
      speaker: bot,
      entry: { kind: "work", key: `${bot.name}-now`, lines: [], open: true },
    });
  }

  const items: ThreadItem[] = [];
  for (const one of drawn) {
    const turn = items.at(-1);
    if (one.kind === "invite") items.push(one);
    else if (turn?.kind === "turn" && turn.speaker.name === one.speaker.name)
      turn.entries.push(one.entry);
    else
      items.push({
        kind: "turn",
        key: one.entry.key,
        speaker: one.speaker,
        entries: [one.entry],
      });
  }
  return items;
}

/**
 * Opening a job's detail is reading its ending: the thread in the room, or on
 * the Settings › Threads sheet. That, or Thursday marking it seen once she has
 * told them (`thread` `seen`), is what clears its dot — a list scrolled past is
 * not. Keyed by `updatedAt` as well, because a follow-up ends a job a second time
 * and that ending is new again.
 */
export function useSeenOnDetail(
  thread:
    | { id: string; status: string; seen: boolean; updatedAt: DateLike }
    | null
    | undefined,
) {
  const sent = useRef(new Set<string>());
  const id = thread?.id ?? null;
  const key = thread
    ? `${thread.id}@${toDate(thread.updatedAt).getTime()}`
    : null;
  const owed = !!thread && thread.status === "done" && !thread.seen;

  useEffect(() => {
    if (!id || !key || !owed || sent.current.has(key)) return;
    sent.current.add(key);
    void markSeenAction([id])
      .then(unwrapResult)
      .then(() => revalidate(queryKey.threads))
      .catch((cause) => {
        // Released, so opening it again tries again
        sent.current.delete(key);
        toast.add({
          type: "error",
          title: "Could not mark the thread as read",
          description: errorToString(cause),
        });
      });
  }, [id, key, owed]);
}
