"use client";

import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { ChevronLeft, ChevronsRight, Loader2 } from "lucide-react";
import {
  Fragment,
  type RefObject,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { ShinyText } from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type Bot,
  DEFAULT_BOT,
  isAppStop,
  needsThreadReply,
  THREAD_CONTINUE,
  type Thread,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoster } from "@/features/bot/components/bot-roster";
import { useAnswerThread } from "@/features/bot/components/thread-reply";
import { RoutineMark } from "@/features/routine/components/routine-mark";
import { type DateLike, shortAgo, toDate } from "@/lib/date-like";
import { type ServerPages } from "@/lib/protocol/use-server-pages";
import { cn, plainText, WAITING_INK } from "@/lib/utils";
import { lastSaid, rosterOf, type ThreadView } from "../thread.store";
import { FoldButton, TAB } from "./room-conversation";

/** The room open on its lists: what is happening now, and the history behind it. Split out of bot-room by subject; see it for the room as a whole. */

export const needsYou = needsThreadReply;

/** An ending nobody has opened. It needs the user too, to read rather than to answer. */
export const isUnread = (thread: ThreadView) =>
  thread.status === "done" && !thread.seen;

/** The room's two lists. */
export type RoomTab = "now" | "history";

/** The two lists as pills, drawn like a thread's bot tabs, and the fold beside them. */
export function ListHeader({
  tab,
  current,
  onTab,
  onClose,
}: {
  tab: RoomTab;
  /** Rows on Now. */
  current: number;
  onTab: (tab: RoomTab) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-3 pr-3.5 pb-1.5 pl-2.5">
      <Tabs
        value={tab}
        onValueChange={(value) => onTab(value as RoomTab)}
        className="gap-0"
      >
        <TabsList className="gap-1 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="now" className={TAB}>
            Now
            {current > 0 && (
              <span className="font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
                {current}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className={TAB}>
            History
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <span className="flex-1" />
      <FoldButton onClick={onClose} />
    </div>
  );
}

/** A room that has never had a thread. The faces are already in the room's foot. */
export function Empty({ bots }: { bots?: Bot[] }) {
  return (
    <p className="px-6 pt-4 pb-5 text-center text-[12px] text-muted-foreground">
      {bots?.length
        ? "Nothing handed over yet — ask for something that takes a while."
        : `Thursday hands work to ${DEFAULT_BOT.name} until you make bots of your own in Settings › Bots.`}
    </p>
  );
}

/** Now with nothing on it, when the room has had threads: what ended is one tab over. */
export function Quiet() {
  return (
    <p className="px-6 pt-4 pb-5 text-center text-[12px] text-muted-foreground">
      Nothing running or waiting.
    </p>
  );
}

/**
 * Every thread that has ended, newest first, grouped by day. Pages arrive as the
 * end of the list scrolls into view (listThreadHistory).
 */
export function HistoryList({
  pages,
  threads,
  scroll,
  onPick,
}: {
  pages: ServerPages<Thread>;
  /** The ended threads among the loaded pages. */
  threads: ThreadView[];
  /** Where the list was left, restored when a thread opened from it closes. */
  scroll: RefObject<number>;
  onPick: (id: string) => void;
}) {
  const restore = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.scrollTop = scroll.current;
    },
    [scroll],
  );

  const days: { day: string; rows: ThreadView[] }[] = [];
  for (const thread of threads) {
    const day = dayOf(thread.updatedAt);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(thread);
    else days.push({ day, rows: [thread] });
  }

  return (
    <div
      ref={restore}
      onScroll={(event) => {
        scroll.current = event.currentTarget.scrollTop;
      }}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2 scrollbar-none"
    >
      {pages.error ? (
        <p className="px-2.5 py-3 text-[12px] text-destructive">
          {pages.error.message}
        </p>
      ) : pages.isLoading ? (
        // The shape of the shortest answer — a day and one row — so a short history
        // arrives without the card growing and then shrinking back
        <>
          <span className="flex h-6 items-center px-2.5 pt-1">
            <Skeleton className="h-2.5 w-16" />
          </span>
          <GhostRow />
        </>
      ) : (
        <>
          {days.map((group, at) => (
            <Fragment key={group.day}>
              <p
                className={cn(
                  "px-2.5 pb-1 font-mono text-[10px] text-muted-foreground",
                  at === 0 ? "pt-1" : "pt-3",
                )}
              >
                {group.day} · {group.rows.length}
              </p>
              {group.rows.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onPick={() => onPick(thread.id)}
                />
              ))}
            </Fragment>
          ))}
          {pages.hasMore ? (
            <div ref={pages.sentinelRef}>
              <GhostRow />
            </div>
          ) : (
            days.length === 0 && (
              <p className="px-6 pt-3 pb-4 text-center text-[12px] text-muted-foreground">
                Nothing has ended yet.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

/** "today", "yesterday", "sep 14" — lower case, like the room's other group labels. */
function dayOf(value: DateLike): string {
  const date = toDate(value);
  if (isToday(date)) return "today";
  if (isYesterday(date)) return "yesterday";
  return format(date, isThisYear(date) ? "MMM d" : "MMM d, yyyy").toLowerCase();
}

/** An open thread's shape while a job no list holds is read: the header, then a few lines. */
export function ThreadLoading({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the list"
          className="shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" />
        </button>
        <Skeleton className="size-5.5 shrink-0 rounded-md" />
        <span className="flex min-w-0 flex-1">
          <Skeleton className="h-3.5 w-2/5" />
        </span>
        <FoldButton onClick={onClose} />
      </div>
      <div className="flex flex-col gap-2 px-4 py-4">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </>
  );
}

/** A row's shape while its page is on the way: the face, the label, the line. */
function GhostRow() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <Skeleton className="size-8 shrink-0 rounded-[10px]" />
      <span className="flex h-9 min-w-0 flex-1 flex-col justify-center gap-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </span>
    </div>
  );
}

/** List sections in order, split by what a thread asks of the user rather than by status. First match wins. */
const GROUPS: {
  id: string;
  label: string;
  holds: (thread: ThreadView) => boolean;
}[] = [
  { id: "you", label: "needs you", holds: needsYou },
  { id: "unread", label: "new results", holds: isUnread },
  {
    id: "working",
    label: "working",
    holds: (thread) => thread.status === "working",
  },
  { id: "done", label: "done", holds: () => true },
];

export function ThreadList({
  threads,
  onPick,
}: {
  threads: ThreadView[];
  onPick: (id: string) => void;
}) {
  const bucket = new Map<string, ThreadView[]>();
  for (const thread of threads) {
    const group =
      GROUPS.find((one) => one.holds(thread)) ?? GROUPS[GROUPS.length - 1];
    const rows = bucket.get(group.id);
    if (rows) rows.push(thread);
    else bucket.set(group.id, [thread]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-1 scrollbar-none">
      {GROUPS.map((group, at) => {
        const rows = bucket.get(group.id) ?? [];
        if (!rows.length) return null;
        return (
          <Fragment key={group.id}>
            <p
              className={cn(
                "px-2.5 pb-1 font-mono text-[10px] text-muted-foreground",
                at === 0 ? "pt-1" : "pt-3",
              )}
            >
              {group.label} · {rows.length}
            </p>
            {rows.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                onPick={() => onPick(thread.id)}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

export function ThreadRow({
  thread,
  onPick,
}: {
  thread: ThreadView;
  onPick: () => void;
}) {
  const attention = needsYou(thread);
  // secondLine runs plainText over the whole answer. Every sync rebuilds each ThreadView
  // (thread.store), so depend on the fields that change the line, not on `thread`.
  const last = thread.lines.at(-1);
  const line = useMemo(
    () => secondLine(thread),
    [
      thread.status,
      thread.outcome,
      thread.seen,
      thread.ask,
      thread.room.questions,
      last?.id,
    ],
  );
  const [answer, answering] = useAnswerThread();
  const [sending, setSending] = useState<string | null>(null);
  // Options are answered inline, without opening the thread.
  const options =
    thread.status === "waiting" && isAppStop(thread.ask)
      ? (thread.ask?.options ?? [])
      : [];

  return (
    // The row is not itself a button: the option buttons cannot nest inside one.
    <div className="rounded-xl transition-colors hover:bg-muted/60">
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className="relative flex size-8 shrink-0 items-center justify-center overflow-visible"
          title={thread.bot.name}
        >
          <BotMark
            size={32}
            seed={thread.bot.name}
            color={thread.bot.icon?.color}
            shape={thread.bot.icon?.shape}
            outline={thread.bot.icon?.outline}
            paint={thread.bot.icon?.paint}
            state={thread.status === "working" ? "thinking" : "idle"}
            notify={attention}
            crossed={thread.status === "cancelled"}
          />
        </span>

        <span className="min-w-0 flex-1">
          {(attention || isUnread(thread)) && (
            <span
              className={cn(
                "block font-mono text-[10px] tracking-wide",
                // a result is what arrived; a question keeps the muted label, its words carry the amber
                attention ? "text-muted-foreground" : "text-brand",
              )}
            >
              {thread.room.questions.length
                ? `${thread.room.questions.length === 1 ? "Question" : `${thread.room.questions.length} questions`} · ${[...new Set(thread.room.questions.map((question) => question.bot))].join(", ")}`
                : thread.status === "waiting"
                  ? isAppStop(thread.ask)
                    ? "Paused"
                    : "Question"
                  : "New result"}
            </span>
          )}
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-[14px] leading-5 tracking-[-0.15px]",
                attention ? "text-foreground" : "text-foreground/80",
                // the rows that need you or are new stand out by weight, not by a heavier label
                (attention || isUnread(thread)) && "font-medium",
              )}
            >
              {thread.label}
            </span>
            {thread.routineId && (
              <span title="Started by a routine" className="shrink-0">
                <RoutineMark className="size-3 text-muted-foreground/80" />
              </span>
            )}
            <BotRoster bots={rosterOf(thread)} />
            <span className="flex-1" />
            <span className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground/70 tabular-nums">
              {shortAgo(thread.updatedAt)}
            </span>
          </span>
          <span className="mt-px flex h-4 items-center gap-1.5">
            {thread.status === "working" && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" />
            )}
            {/* Anything still moving says so by shining, here as in the thread
                (bot-tool) and the pill (Chip). */}
            {thread.status === "working" && !attention ? (
              <ShinyText
                text={line.text}
                speed={2.2}
                // The shine brings its own ink; only the placeholder's italic carries over.
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] leading-4",
                  line.tone.includes("italic") && "italic",
                )}
              />
            ) : (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] leading-4",
                  line.tone,
                )}
              >
                {line.text}
              </span>
            )}
          </span>
        </span>
      </button>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5 pr-2 pb-2 pl-12.5">
          {options.map((option) => (
            <Button
              key={option}
              size="sm"
              variant="outline"
              loading={sending === option}
              disabled={answering}
              onClick={async () => {
                setSending(option);
                await answer(thread, option);
                setSending(null);
              }}
              // what moves the job on, so blue; outlined, so a list of them does not outweigh the call
              className="h-7 gap-1.5 rounded-full border-brand bg-background px-3 text-[12px] text-brand hover:bg-brand/8 hover:text-brand dark:border-brand dark:bg-transparent dark:hover:bg-brand/12"
            >
              {option === THREAD_CONTINUE && (
                <ChevronsRight className="size-3.5" />
              )}
              {option}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Second row of a thread line: the question, the outcome, or the bot's last step. */
function secondLine(thread: ThreadView): { text: string; tone: string } {
  const question = thread.room.questions[0];
  if (question) {
    return { text: plainText(question.text), tone: "text-foreground" };
  }
  if (thread.status === "waiting" && thread.ask) {
    // A budget stop is not a question, but it waits on the user exactly as one
    // does, so it carries the waiting colour too; only the words differ.
    return {
      text: isAppStop(thread.ask)
        ? plainText(thread.outcome ?? thread.ask.question)
        : thread.ask.question,
      tone: WAITING_INK,
    };
  }
  // Reports are markdown; keep only the text. An ending the user has opened steps back.
  const had = thread.seen;
  if (thread.status === "cancelled") {
    return { text: "Stopped", tone: "text-muted-foreground" };
  }
  if (thread.status === "done") {
    return {
      text: plainText(thread.outcome ?? "Done"),
      tone: had ? "text-muted-foreground" : "text-foreground",
    };
  }
  const last = lastSaid(thread);
  if (!last) {
    return {
      text: `${thread.bot.name} is taking it on…`,
      tone: "text-muted-foreground italic",
    };
  }
  return {
    text:
      last.kind === "tool" && last.tool
        ? // The model's own label when it wrote one, else the raw call.
          (last.tool.note ?? `${last.tool.name} · ${last.tool.input}`)
        : last.text,
    tone: "text-muted-foreground",
  };
}
