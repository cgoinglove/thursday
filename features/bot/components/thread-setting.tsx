"use client";

import {
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notify } from "@/components/ui/notify";
import { ShinyText } from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SIZE } from "@/config";
import {
  cancelThreadAction,
  clearFinishedThreadsAction,
  deleteThreadAction,
} from "@/features/bot/bot.action";
import {
  type Bot,
  isAppStop,
  needsThreadReply,
  type Thread,
  type ThreadLine,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoster } from "@/features/bot/components/bot-roster";
import { toolIcon } from "@/features/bot/components/bot-tool";
import {
  Conversation,
  ThreadFacts,
} from "@/features/bot/components/room-conversation";
import {
  rosterOf,
  screenActs,
  threadFromRow,
  useSeenOnDetail,
} from "@/features/bot/thread.store";
import { RoutineMark } from "@/features/routine/components/routine-mark";
import {
  SettingError,
  SettingFilter,
  SettingGroup,
  SettingItems,
  SettingMore,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { toDate, whenOf } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { useServerPages } from "@/lib/protocol/use-server-pages";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatCount, plainText, WAITING_INK } from "@/lib/utils";
import { ThreadReply } from "./thread-reply";

/*
 * Every thread the bots have taken, newest first, cursor-paged (thread.query listThreadHistory):
 * the `threads` signal re-reads the loaded pages, and later pages read below the previous
 * page's last timestamp so they never shift or overlap. A row opens its thread on a sheet
 * beside the list.
 */

export function ThreadSetting() {
  /** The thread on the sheet; null leaves the list alone. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);

  const {
    items: threads,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    sentinelRef,
  } = useServerPages<Thread>({
    // Page 0 has no cursor; each next page reads below the previous page's last row.
    key: (index, previous) => {
      if (index === 0) return queryKey.threadHistory(null);
      const tail = previous?.at(-1);
      return tail
        ? queryKey.threadHistory(toDate(tail.updatedAt).toISOString())
        : null;
    },
    size: PAGE_SIZE,
  });

  // A thread that leaves the list (deleted, cleared) closes the sheet.
  const reading = threads.find((thread) => thread.id === openId);
  // Opening a thread is reading its ending; that is what clears its dot.
  useSeenOnDetail(reading);

  // The row says it stopped, and a deleted one leaves the list: neither needs a toast
  const [stop] = useServerAction(cancelThreadAction, {
    onOk: (stopped) => {
      revalidate(queryKey.threads);
      // Cancel is not relayed on its own; tell the open call.
      screenActs.announce({
        kind: "stopped",
        id: stopped.id,
        label: stopped.label,
      });
    },
  });
  const [remove] = useServerAction(deleteThreadAction, {
    onOk: () => revalidate(queryKey.threads),
  });
  const [clear] = useServerAction(clearFinishedThreadsAction, {
    onOk: () => revalidate(queryKey.threads),
  });

  // Narrows what has loaded; the sentinel keeps fetching, so scrolling widens the search
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? threads.filter((thread) =>
        [thread.label, thread.outcome, thread.bot]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : threads;

  const confirmClear = async () => {
    const confirmed = await notify.confirm({
      title: "Clear finished jobs?",
      description:
        "Everything done or stopped goes, messages included. Running and waiting jobs stay.",
      okText: "Clear",
      destructive: true,
    });
    if (confirmed) clear();
  };

  const confirmRemove = async (thread: Thread) => {
    const confirmed = await notify.confirm({
      title: `Delete "${thread.label}"?`,
      description: "Its messages go with it — nothing can be picked back up.",
      okText: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    // The thread on the sheet hands the sheet to its neighbour in the list.
    const at = shown.findIndex((row) => row.id === thread.id);
    const next = shown[at + 1] ?? shown[at - 1];
    try {
      await remove(thread.id);
    } catch {
      // Already toasted; the sheet stays where it is.
      return;
    }
    if (thread.id === openId) setOpenId(next?.id ?? null);
  };

  if (isLoading) return <SettingSkeleton rows={3} />;
  if (error) return <SettingError message={error.message} />;

  const waiting = threads.filter(
    (thread) => thread.status === "waiting",
  ).length;

  return (
    <>
      <SettingScreen
        footer={
          <>
            <SettingRailNote>
              {threads.length} loaded
              {waiting > 0 && ` · ${waiting} waiting on you`}
            </SettingRailNote>
            {/* only with something to clear: a page not read yet may hold some */}
            {(hasMore ||
              threads.some(
                (thread) =>
                  thread.status === "done" || thread.status === "cancelled",
              )) && (
              <Button variant="outline" size="sm" onClick={confirmClear}>
                Clear finished
              </Button>
            )}
          </>
        }
      >
        <SettingGroup
          filter={
            <SettingFilter
              value={filter}
              onChange={setFilter}
              placeholder="Filter by label, bot or word"
            />
          }
          right={needle ? `${shown.length} of ${threads.length}` : undefined}
        >
          <SettingItems>
            {shown.length === 0 ? (
              <p className="p-4 text-sm leading-relaxed text-muted-foreground">
                {needle
                  ? "Nothing loaded matches. Keep scrolling to search further back."
                  : "Nothing yet. When Thursday hands a job to a bot mid-call, it shows up here — while it runs, and after."}
              </p>
            ) : (
              shown.map((thread) => (
                <Row
                  key={thread.id}
                  thread={thread}
                  bots={bots}
                  open={thread.id === reading?.id}
                  onOpen={() => setOpenId(thread.id)}
                  onStop={() => stop(thread.id)}
                  onDelete={() => confirmRemove(thread)}
                />
              ))
            )}
            <SettingMore
              hasMore={hasMore}
              loading={isLoadingMore}
              sentinelRef={sentinelRef}
              ghost={<Ghost />}
              className="divide-y divide-border/60"
            />
          </SettingItems>
        </SettingGroup>
      </SettingScreen>

      <ThreadSheet
        thread={reading}
        bots={bots}
        onClose={() => setOpenId(null)}
        onStop={(thread) => stop(thread.id)}
        onDelete={confirmRemove}
      />
    </>
  );
}

/** Width of the right column, the same on every row. */
const META = "w-36";

function Row({
  thread,
  bots,
  open,
  onOpen,
  onStop,
  onDelete,
}: {
  thread: Thread;
  bots?: Bot[];
  /** Its thread is on the sheet. */
  open: boolean;
  onOpen: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const running = thread.status === "running";
  // The messages replayed once per row, for the roster.
  const view = useMemo(() => threadFromRow(thread, bots), [thread, bots]);
  const line = secondLine(thread);
  const tokens = thread.tokens.input + thread.tokens.output;

  return (
    // Named group: StepLog shows on the row's hover.
    <div
      className={cn(
        "group/row relative transition-colors",
        open ? "bg-muted/80" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <BotMark
            size={40}
            seed={thread.bot}
            {...markOf(thread.bot, bots)}
            state={running ? "thinking" : "idle"}
            notify={needsThreadReply(thread)}
            crossed={thread.status === "cancelled"}
            className="shrink-0"
          />

          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {thread.label}
              </span>
              {thread.routineId && (
                <span title="Started by a routine" className="shrink-0">
                  <RoutineMark className="size-3 text-muted-foreground/80" />
                </span>
              )}
              <BotRoster bots={rosterOf(view)} />
              {running && (
                <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
              )}
            </span>
            {line && (
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug">
                {line.tool && (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {line.tool}
                  </span>
                )}
                {line.shine ? (
                  <ShinyText
                    text={line.text}
                    speed={2.2}
                    className="min-w-0 truncate"
                  />
                ) : (
                  <span className={cn("min-w-0 truncate", line.tone)}>
                    {line.text}
                  </span>
                )}
              </span>
            )}
          </span>

          <span
            className={cn(
              "flex shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] leading-4 text-muted-foreground tabular-nums",
              META,
            )}
          >
            <span>{whenOf(thread.updatedAt)}</span>
            <span
              className="max-w-full truncate text-muted-foreground/70"
              title={
                tokens > 0
                  ? `${thread.id} · in ${formatCount(thread.tokens.input)} · out ${formatCount(thread.tokens.output)}`
                  : thread.id
              }
            >
              {thread.bot}
              {tokens > 0 && ` · ${formatCount(tokens)}`}
            </span>
          </span>

          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>

        <ThreadMenu thread={thread} onStop={onStop} onDelete={onDelete} />
      </div>

      {running && <StepLog thread={thread} />}
    </div>
  );
}

/** Stop while the thread is live, Delete always. The row and the sheet carry the same menu. */
function ThreadMenu({
  thread,
  onStop,
  onDelete,
  className,
}: {
  thread: Thread;
  onStop: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const live = thread.status === "running" || thread.status === "waiting";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="icon-sm" variant="ghost" className={className} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {live && (
          <DropdownMenuItem onClick={onStop}>
            <Square />
            Stop
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The open thread on a sheet down the settings window's right edge: its head,
 * the conversation as the one scroll, the composer at the foot. Not modal, and
 * a press outside leaves it open, so the list beside it stays live and a row
 * click swaps the thread. Esc closes the sheet before the settings.
 */
function ThreadSheet({
  thread,
  bots,
  onClose,
  onStop,
  onDelete,
}: {
  /** The open thread; none closes the sheet. */
  thread?: Thread;
  bots?: Bot[];
  onClose: () => void;
  onStop: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
}) {
  // The sheet portals into the settings dialog, not the page, so it is placed
  // against the window: full height, its right edge on the window's.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLElement | null) => {
    setHost(node?.closest<HTMLElement>("[data-slot=dialog-content]") ?? null);
  }, []);
  /** The tab each thread was left on; missing is All. */
  const [sides, setSides] = useState<Record<string, string | null>>({});
  const view = useMemo(
    () => (thread ? threadFromRow(thread, bots) : null),
    [thread, bots],
  );
  const side = thread ? (sides[thread.id] ?? null) : null;

  return (
    <>
      <span ref={anchor} hidden />
      <Dialog
        open={Boolean(thread && host)}
        onOpenChange={(next) => !next && onClose()}
        modal={false}
        disablePointerDismissal
      >
        <DialogPortal container={host}>
          <DialogPopup className="absolute inset-y-0 right-0 z-10 flex w-[min(35rem,calc(100%-13rem))] flex-col border-l border-border/60 bg-popover text-popover-foreground shadow-2xl shadow-black/10 duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-right-4 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-right-4">
            {thread && view && (
              <>
                <div className="flex shrink-0 items-center gap-2.5 pt-3.5 pr-3 pb-1.5 pl-5">
                  <BotMark
                    size={28}
                    seed={thread.bot}
                    {...markOf(thread.bot, bots)}
                    state={thread.status === "running" ? "thinking" : "idle"}
                    notify={needsThreadReply(thread)}
                    crossed={thread.status === "cancelled"}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="sr-only">
                      {thread.label}
                    </DialogTitle>
                    <p className="truncate text-[15px] leading-5 font-semibold">
                      {thread.label}
                    </p>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span title={thread.id} className="min-w-0 truncate">
                        {thread.bot} · {whenOf(thread.updatedAt)}
                      </span>
                      <ThreadFacts thread={view} />
                    </div>
                  </div>
                  <ThreadMenu
                    thread={thread}
                    onStop={() => onStop(thread)}
                    onDelete={() => onDelete(thread)}
                    className="text-muted-foreground"
                  />
                  <DialogClose
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Close the thread"
                      />
                    }
                  >
                    <X />
                  </DialogClose>
                </div>

                <Conversation
                  thread={view}
                  tab={side}
                  onTab={(next) =>
                    setSides((was) => ({ ...was, [thread.id]: next }))
                  }
                  className="max-h-none min-h-0 flex-1 px-5"
                  tabsClassName="px-5"
                />

                <div className="shrink-0 px-5 pt-2 pb-4">
                  <ThreadReply
                    thread={{
                      id: thread.id,
                      label: thread.label,
                      bot: thread.bot,
                      ask: thread.ask,
                      room: thread.room,
                    }}
                    status={thread.status}
                    faces={rosterOf(view)}
                    to={side ?? thread.bot}
                  />
                </div>
              </>
            )}
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </>
  );
}

/** Icon from the bot list; the row only carries the name. */
function markOf(name: string, bots?: Bot[]) {
  const icon = bots?.find((bot) => bot.name === name)?.icon;
  return {
    color: icon?.color,
    shape: icon?.shape,
    outline: icon?.outline,
    paint: icon?.paint,
  };
}

/**
 * Second row: a question waiting on the user (a participant's, even while others
 * work), the outcome, or the last tool the bot reached for.
 */
function secondLine(
  thread: Thread,
): { text: string; tone: string; tool?: string; shine?: boolean } | null {
  const question = thread.room.questions[0];
  if (question) return { text: plainText(question.text), tone: WAITING_INK };
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
      tone: had ? "text-muted-foreground" : "text-foreground/80",
    };
  }
  for (let at = thread.lines.length - 1; at >= 0; at--) {
    const line = thread.lines[at];
    if (line.kind === "tool") {
      return {
        text: line.note ?? line.input,
        tone: "text-muted-foreground",
        tool: line.name,
        shine: true,
      };
    }
    if (line.kind === "text") {
      // Still running, so still moving: shine whether or not it is a tool line.
      return { text: line.text, tone: "text-muted-foreground", shine: true };
    }
    if (line.kind === "user") break;
  }
  return {
    text: `${thread.bot} is taking it on…`,
    tone: "text-muted-foreground italic",
    shine: true,
  };
}

type ToolStep = Extract<ThreadLine, { kind: "tool" }>;

/** Last steps shown in the hover log; the full list is on the sheet. */
const STEPS_SHOWN = 6;

/**
 * Hover log for a running row: the tools reached for and how long each took (the gap
 * to the next line; the last one is still running). Not interactive.
 */
function StepLog({ thread }: { thread: Thread }) {
  const steps: { step: ToolStep; took: number | null }[] = [];
  thread.lines.forEach((line, at) => {
    if (line.kind !== "tool") return;
    const next = thread.lines[at + 1];
    steps.push({
      step: line,
      took: next ? toDate(next.at).getTime() - toDate(line.at).getTime() : null,
    });
  });
  if (steps.length === 0) return null;

  const ran =
    toDate(thread.updatedAt).getTime() - toDate(thread.createdAt).getTime();

  return (
    <div className="pointer-events-none absolute top-[calc(100%-0.75rem)] left-17 z-20 hidden w-96 max-w-[calc(100%-5rem)] rounded-xl bg-background p-3 pb-2 shadow-xl shadow-black/10 ring-1 ring-border/60 group-hover/row:block">
      <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span>{thread.bot}</span>
        <span className="opacity-50">·</span>
        <span>
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>
        <span className="opacity-50">·</span>
        <span>{tookOf(ran)}</span>
      </div>
      {steps.slice(-STEPS_SHOWN).map(({ step, took }) => {
        const Icon = toolIcon(step.name);
        return (
          <div
            key={step.id}
            className="flex h-5.5 items-center gap-2 font-mono text-[11px]"
          >
            {took === null ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Icon className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="w-24 shrink-0 truncate text-muted-foreground">
              {step.name}
            </span>
            {took === null ? (
              <ShinyText
                text={step.note ?? step.input}
                speed={2.2}
                className="min-w-0 flex-1 truncate"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-foreground">
                {step.note ?? step.input}
              </span>
            )}
            <span className="w-10 shrink-0 text-right text-muted-foreground/70 tabular-nums">
              {took === null ? "" : tookOf(took)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 0.8s, 12s, 2m 14s. */
function tookOf(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/** Placeholder row while the next page loads (SettingMore ghost). */
function Ghost() {
  return (
    <div className="flex items-center gap-3 p-4">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-40 max-w-full" />
        <Skeleton className="h-2.5 w-80 max-w-full" />
      </span>
      <span className={cn("flex shrink-0 flex-col items-end gap-1.5", META)}>
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="h-2.5 w-24" />
      </span>
      <span className="size-4 shrink-0" />
      <span className="size-7 shrink-0" />
    </div>
  );
}
