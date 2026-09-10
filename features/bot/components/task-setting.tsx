"use client";

import {
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notify } from "@/components/ui/notify";
import ShinyText from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelTaskAction,
  clearFinishedTasksAction,
  deleteTaskAction,
} from "@/features/bot/bot.action";
import {
  type Bot,
  isAppStop,
  TASK_HISTORY_PAGE,
  type Task,
  type TaskLine,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { Conversation } from "@/features/bot/components/bot-room";
import { BotRoster } from "@/features/bot/components/bot-roster";
import { toolIcon } from "@/features/bot/components/bot-tool";
import {
  rosterOf,
  screenActs,
  taskFromRow,
  useSeenOnDetail,
} from "@/features/bot/task.store";
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
import { TaskReply } from "./task-reply";

/*
 * Every task the bots have taken, newest first, cursor-paged (bot.query listTaskHistory):
 * the first page polls while a task runs, later pages read below the previous page's
 * last timestamp so they never shift or overlap.
 */

/** First-page refresh while a task is running, ms. */
const POLL_MS = 3000;

export function TaskSetting() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);

  const {
    items: tasks,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    sentinelRef,
  } = useServerPages<Task>({
    // Page 0 has no cursor; each next page reads below the previous page's last row.
    key: (index, previous) => {
      if (index === 0) return queryKey.taskHistory(null);
      const tail = previous?.at(-1);
      return tail
        ? queryKey.taskHistory(toDate(tail.updatedAt).toISOString())
        : null;
    },
    size: TASK_HISTORY_PAGE,
    swr: {
      // swr/infinite skips cached pages on a poll tick by default; re-read the first
      // page only. Later pages sit below the cursor and stay put.
      revalidateFirstPage: true,
      refreshInterval: (pages: Task[][] | undefined) =>
        pages?.[0]?.some((task) => task.status === "running") ? POLL_MS : 0,
    },
  });

  // Expanding a row is reading its ending; that is what clears its dot.
  useSeenOnDetail(tasks.find((task) => task.id === openId));

  const [stop] = useServerAction(cancelTaskAction, {
    okMessage: "Task stopped",
    onOk: (stopped) => {
      revalidate(queryKey.tasks);
      // Cancel is not relayed on its own; tell the open call.
      screenActs.announce({
        kind: "stopped",
        id: stopped.id,
        label: stopped.label,
      });
    },
  });
  const [remove] = useServerAction(deleteTaskAction, {
    okMessage: "Task deleted",
    onOk: () => revalidate(queryKey.tasks),
  });

  // The rows leave the screen, so the result needs no toast
  const [clear] = useServerAction(clearFinishedTasksAction, {
    onOk: () => revalidate(queryKey.tasks),
  });

  const confirmClear = async () => {
    const confirmed = await notify.confirm({
      title: "Clear finished jobs?",
      description:
        "Everything done or failed goes, threads included. Running and waiting jobs stay.",
      okText: "Clear",
      destructive: true,
    });
    if (confirmed) clear();
  };

  const confirmRemove = async (task: Task) => {
    const confirmed = await notify.confirm({
      title: `Delete "${task.label}"?`,
      description: "The thread goes with it — nothing can be picked back up.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) remove(task.id);
  };

  if (isLoading) return <SettingSkeleton rows={3} />;
  if (error) return <SettingError message={error.message} />;

  // Narrows what has loaded; the sentinel keeps fetching, so scrolling widens the search
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? tasks.filter((task) =>
        [task.label, task.outcome, task.bot]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : tasks;
  const waiting = tasks.filter((task) => task.status === "waiting").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  return (
    <SettingScreen
      footer={
        <>
          <SettingRailNote>
            {tasks.length} loaded
            {waiting > 0 && ` · ${waiting} waiting on you`}
            {failed > 0 && ` · ${failed} failed`}
          </SettingRailNote>
          <Button variant="outline" size="sm" onClick={confirmClear}>
            Clear finished
          </Button>
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
        right={needle ? `${shown.length} of ${tasks.length}` : undefined}
      >
        <SettingItems>
          {shown.length === 0 ? (
            <p className="p-4 text-sm leading-relaxed text-muted-foreground">
              {needle
                ? "Nothing loaded matches. Keep scrolling to search further back."
                : "Nothing yet. When Thursday hands a job to a bot mid-call, it shows up here — while it runs, and after."}
            </p>
          ) : (
            shown.map((task) => (
              <Row
                key={task.id}
                task={task}
                bots={bots}
                open={openId === task.id}
                onToggle={() =>
                  setOpenId((was) => (was === task.id ? null : task.id))
                }
                onStop={() => stop(task.id)}
                onDelete={() => confirmRemove(task)}
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
  );
}

/** Width of the right column, the same on every row. */
const META = "w-36";

function Row({
  task,
  bots,
  open,
  onToggle,
  onStop,
  onDelete,
}: {
  task: Task;
  bots?: Bot[];
  open: boolean;
  onToggle: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const live = task.status === "running" || task.status === "waiting";
  const running = task.status === "running";
  // The thread replayed once per row: the roster reads it, and so does the
  // expanded Conversation below.
  const view = useMemo(() => taskFromRow(task, bots), [task, bots]);
  const line = secondLine(task);
  const tokens = task.tokens.input + task.tokens.output;

  return (
    // Named group because the expanded thread has groups of its own; StepLog shows on hover.
    <div className="group/row relative transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <BotMark
            size={40}
            seed={task.bot}
            vary={task.id}
            {...markOf(task.bot, bots)}
            state={running ? "thinking" : "idle"}
            notify={task.status === "waiting"}
            className="shrink-0"
          />

          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{task.label}</span>
              <BotRoster bots={rosterOf(view)} taskId={task.id} />
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
                    color="var(--muted-foreground)"
                    shineColor="var(--foreground)"
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
            <span>{whenOf(task.updatedAt)}</span>
            <span
              className="max-w-full truncate text-muted-foreground/70"
              title={
                tokens > 0
                  ? `${task.id} · in ${formatCount(task.tokens.input)} · out ${formatCount(task.tokens.output)}`
                  : task.id
              }
            >
              {task.bot}
              {tokens > 0 && ` · ${formatCount(tokens)}`}
            </span>
          </span>

          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-sm" variant="ghost" />}
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
      </div>

      {running && !open && <StepLog task={task} />}

      {open && (
        <div className="mx-4 mb-4 space-y-2">
          <div className="rounded-xl border border-border/60 bg-background">
            <Conversation task={view} />
          </div>
          <TaskReply
            task={{
              id: task.id,
              label: task.label,
              bot: task.bot,
              ask: task.ask,
            }}
            status={task.status}
          />
        </div>
      )}
    </div>
  );
}

/** Icon from the bot list; the row only carries the name. */
function markOf(name: string, bots?: Bot[]) {
  const icon = bots?.find((bot) => bot.name === name)?.icon;
  return { color: icon?.color, shape: icon?.shape, outline: icon?.outline };
}

/** Second row: the question, the outcome, or the last tool the bot reached for. */
function secondLine(
  task: Task,
): { text: string; tone: string; tool?: string; shine?: boolean } | null {
  if (task.status === "waiting" && task.ask) {
    // A budget stop is not a question, but it waits on the user exactly as one
    // does, so it carries the waiting colour too; only the words differ.
    return {
      text: isAppStop(task.ask)
        ? plainText(task.outcome ?? task.ask.question)
        : task.ask.question,
      tone: WAITING_INK,
    };
  }
  // Reports are markdown; keep only the text.
  // An ending the user has opened steps back; red stays red, only quieter.
  const had = task.seen;
  if (task.status === "failed") {
    return {
      text: plainText(task.outcome ?? "Failed"),
      tone: had ? "text-destructive/70" : "text-destructive",
    };
  }
  if (task.status === "done") {
    return {
      text: plainText(task.outcome ?? "Done"),
      tone: had ? "text-muted-foreground" : "text-foreground/80",
    };
  }
  for (let at = task.lines.length - 1; at >= 0; at--) {
    const line = task.lines[at];
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
    if (line.kind === "user" || line.kind === "waiting") break;
  }
  return {
    text: `${task.bot} is taking it on…`,
    tone: "text-muted-foreground italic",
    shine: true,
  };
}

type ToolStep = Extract<TaskLine, { kind: "tool" }>;

/** Last steps shown in the hover log; the full list is in the expanded thread. */
const STEPS_SHOWN = 6;

/**
 * Hover log for a running row: the tools reached for and how long each took (the gap
 * to the next line; the last one is still running). Not interactive.
 */
function StepLog({ task }: { task: Task }) {
  const steps: { step: ToolStep; took: number | null }[] = [];
  task.lines.forEach((line, at) => {
    if (line.kind !== "tool") return;
    const next = task.lines[at + 1];
    steps.push({
      step: line,
      took: next ? toDate(next.at).getTime() - toDate(line.at).getTime() : null,
    });
  });
  if (steps.length === 0) return null;

  const ran =
    toDate(task.updatedAt).getTime() - toDate(task.createdAt).getTime();

  return (
    <div className="pointer-events-none absolute top-[calc(100%-0.75rem)] left-17 z-20 hidden w-96 max-w-[calc(100%-5rem)] rounded-xl bg-background p-3 pb-2 shadow-xl shadow-black/10 ring-1 ring-border/60 group-hover/row:block">
      <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span>{task.bot}</span>
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
                color="var(--muted-foreground)"
                shineColor="var(--foreground)"
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
