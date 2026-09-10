"use client";

import { ChevronRight, Phone, Trash2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { CALL_HISTORY_PAGE } from "@/config";
import type { TaskStatus } from "@/features/bot/bot.schema";
import { toolIcon } from "@/features/bot/components/bot-tool";
import {
  SettingDialogContent,
  SettingError,
  SettingGroup,
  SettingItems,
  SettingMore,
} from "@/features/settings/components/setting-ui";
import { toDate, whenOf } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { useServerPages } from "@/lib/protocol/use-server-pages";
import { cn, plainText, WAITING_INK } from "@/lib/utils";
import { deleteCallAction, deleteEndedCallsAction } from "../thursday.action";
import { type CallRecord, type CallTurn } from "../thursday.schema";
import { delegatedLabel, toolLine } from "../tool-line";
import { ThursdayMark } from "./thursday-mark";

/** The Settings › Thursday row that opens the call history dialog. */
export function CallHistoryRow() {
  return (
    <SettingGroup label="Transcripts">
      <SettingItems>
        <button
          type="button"
          onClick={() =>
            notify.component({
              className: "sm:max-w-3xl",
              renderer: () => (
                <SettingDialogContent
                  title="Call history"
                  description="Everything said on the line, oldest at the top. Scroll up for older calls."
                >
                  <CallLog />
                </SettingDialogContent>
              ),
            })
          }
          className="flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Phone className="size-4" />
          </span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-sm font-medium">Call history</span>
            <span className="block text-xs text-muted-foreground">
              Every call, word for word — hers and yours
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </SettingItems>
    </SettingGroup>
  );
}

type CallJob = CallRecord["jobs"][number];

/** How a job reads under the line that opened it. Only waiting and failed carry colour. */
const JOB_WORD: Record<TaskStatus, string> = {
  running: "working",
  waiting: "waiting on you",
  done: "done",
  failed: "failed",
};
const JOB_LOOK: Record<TaskStatus, string> = {
  running: "text-muted-foreground",
  waiting: WAITING_INK,
  done: "text-muted-foreground",
  failed: "text-destructive",
};

/** The box the log fills, kept while it loads so the dialog does not resize. */
const LOG_BOX = "h-[min(34rem,58vh)] min-h-64 px-1";

/**
 * Transcript of every call, oldest at the top, opened at the bottom. Older
 * pages are prepended, so this owns its scroll box and holds the scroll
 * position across a prepend (`held`).
 */
function CallLog() {
  const {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    sentinelRef,
    refresh,
  } = useServerPages<CallRecord>({
    // Pages arrive newest-first; the cursor is the previous page's oldest call.
    key: (index, previous) => {
      if (index === 0) return queryKey.callHistory(null);
      const oldest = previous?.at(-1);
      return oldest
        ? queryKey.callHistory(toDate(oldest.startedAt).toISOString())
        : null;
    },
    size: CALL_HISTORY_PAGE,
    // A refetch would invalidate the held scroll position.
    swr: { revalidateOnFocus: false },
  });

  const calls = useMemo(() => [...items].reverse(), [items]);

  const [dropAll, droppingAll] = useServerAction(deleteEndedCallsAction, {
    okMessage: (count) =>
      count === 1 ? "1 call deleted" : `${count} calls deleted`,
    onOk: refresh,
  });

  const confirmDropAll = async () => {
    const confirmed = await notify.confirm({
      title: "Delete every call?",
      description:
        "Every turn of every call goes — and she stops reading any of it back into the next call. A call still on the line stays.",
      okText: "Delete all",
      destructive: true,
    });
    if (confirmed) dropAll();
  };

  const scroller = useRef<HTMLDivElement>(null);
  /** Has the first page been dropped at its bottom yet. */
  const opened = useRef(false);
  /** Distance from the bottom of the content, held across a prepend. */
  const held = useRef(0);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || calls.length === 0) return;
    if (!opened.current) {
      opened.current = true;
      box.scrollTop = box.scrollHeight;
    } else {
      // Older calls were prepended; restore the distance from the bottom.
      box.scrollTop = box.scrollHeight - held.current;
    }
    held.current = box.scrollHeight - box.scrollTop;
  }, [calls]);

  if (isLoading)
    return (
      <div className={cn(LOG_BOX, "overflow-hidden")}>
        <CallGhost />
      </div>
    );
  if (error) return <SettingError message={error.message} />;

  return (
    <>
      {calls.length === 0 ? (
        <p className="px-1 text-sm leading-relaxed text-muted-foreground">
          No calls yet. Everything said on the line is kept here — hers and
          yours, in the order it was said.
        </p>
      ) : (
        <>
          <div
            ref={scroller}
            onScroll={(event) => {
              const box = event.currentTarget;
              held.current = box.scrollHeight - box.scrollTop;
            }}
            className={cn(LOG_BOX, "overflow-y-auto overscroll-contain pb-6")}
          >
            <SettingMore
              hasMore={hasMore}
              loading={isLoadingMore}
              sentinelRef={sentinelRef}
              count={1}
              ghost={<CallGhost />}
            />
            {calls.map((call, index) => (
              <Thread
                key={call.id}
                call={call}
                first={index === 0}
                onDropped={refresh}
              />
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              loading={droppingAll}
              onClick={confirmDropAll}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
              Delete all
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/** Placeholder for an older call while its page loads; sits above the oldest call. */
function CallGhost() {
  return (
    <div className="pb-3">
      <div className="flex h-7 items-center gap-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-10" />
      </div>
      <div className="mt-2 mb-[18px] h-px bg-border/60" />
      <div className="flex justify-end">
        <Skeleton className="h-9 w-3/5 rounded-2xl rounded-br-sm" />
      </div>
      <div className="mt-3 flex items-start gap-2">
        <Skeleton className="mt-0.5 size-[18px] shrink-0 rounded-full" />
        <Skeleton className="mt-1 h-3.5 w-2/3" />
      </div>
    </div>
  );
}

/** Whose run a turn is in. Her words and her tools are one run: both are her acting. */
const sideOf = (turn: CallTurn) => (turn.role === "user" ? "user" : "her");

/** One call: a datestamp over a hairline, then its turns. */
function Thread({
  call,
  first,
  onDropped,
}: {
  call: CallRecord;
  /** The topmost call loaded; nothing above it to be set apart from. */
  first: boolean;
  /** Re-reads every page after a delete. */
  onDropped: () => void;
}) {
  const [drop, dropping] = useServerAction(deleteCallAction, {
    okMessage: "Call deleted",
    onOk: onDropped,
  });
  const started = toDate(call.startedAt);
  // Duration runs to the last turn, not `endedAt`: a call closed by sweepCalls
  // at boot would otherwise read as long as the server was down.
  const last = call.turns.at(-1);
  const ran =
    call.endedAt && last ? spanOf(started, toDate(last.at)) : "on the line";

  const confirmDrop = async () => {
    const confirmed = await notify.confirm({
      title: `Delete the call from ${whenOf(started)}?`,
      description:
        "Every turn of it goes — and she stops reading it back into the next call.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) drop(call.id);
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2.5",
          first ? "mt-1" : "mt-11",
        )}
      >
        <span
          title={`${call.provider} · ${call.model}`}
          className="font-mono text-[10px] tracking-[0.14em] uppercase"
        >
          {whenOf(started)}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {ran}
        </span>
        {/* The slot is held so the row keeps its height while the button is hidden. */}
        <span className="ml-auto flex size-7 shrink-0 items-center justify-center">
          {call.endedAt && (
            <Button
              size="icon-sm"
              variant="ghost"
              loading={dropping}
              aria-label="Delete this call"
              onClick={confirmDrop}
              className="text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
            >
              <Trash2 />
            </Button>
          )}
        </span>
      </div>
      <div className="mt-2 mb-[18px] h-px bg-border/60" />

      {fold(call.turns).map(({ turn, repeats }, index, folded) => {
        const before = folded[index - 1]?.turn;
        const after = folded[index + 1]?.turn;
        return (
          <Turn
            key={turn.id}
            turn={turn}
            job={jobOf(call, turn)}
            repeats={repeats}
            opensRun={!before || sideOf(before) !== sideOf(turn)}
            closesRun={!after || sideOf(after) !== sideOf(turn)}
          />
        );
      })}
    </>
  );
}

/** The job a `delegate` turn opened, found by label the way her prompt finds it. */
function jobOf(call: CallRecord, turn: CallTurn): CallJob | undefined {
  const label = delegatedLabel(turn.tool, turn.text);
  return label ? call.jobs.find((job) => job.label === label) : undefined;
}

/** Collapses consecutive identical tool turns (same name and arguments) into one with a count. */
function fold(turns: CallRecord["turns"]) {
  const out: { turn: CallRecord["turns"][number]; repeats: number }[] = [];
  for (const turn of turns) {
    const last = out.at(-1);
    if (
      last &&
      turn.role === "tool" &&
      last.turn.role === "tool" &&
      last.turn.tool === turn.tool &&
      last.turn.text === turn.text
    ) {
      last.repeats += 1;
      continue;
    }
    out.push({ turn, repeats: 1 });
  }
  return out;
}

/** How long the call ran — "48s", "4m 12s", "1h 06m". */
function spanOf(from: Date, to: Date): string {
  const seconds = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * One spoken turn. Plain text, never markdown: asterisks were said aloud.
 * Only the user speaks in bubbles; her words sit bare in her column, so her
 * text and her tool lines start on one edge.
 */
function Turn({
  turn,
  job,
  opensRun,
  closesRun,
  repeats = 1,
}: {
  turn: CallTurn;
  /** What became of the job a `delegate` turn opened (ToolTurn only). */
  job?: CallJob;
  opensRun: boolean;
  closesRun: boolean;
  /** Consecutive repeats of the same tool turn (ToolTurn only). */
  repeats?: number;
}) {
  if (turn.role === "tool")
    return (
      <ToolTurn turn={turn} job={job} repeats={repeats} opensRun={opensRun} />
    );

  if (turn.role === "user")
    return (
      <div className={cn("flex justify-end", opensRun ? "mt-3" : "mt-1")}>
        <p
          className={cn(
            "max-w-[min(34rem,78%)] rounded-2xl bg-muted px-3.5 py-2 text-[13.5px] leading-relaxed break-keep whitespace-pre-wrap",
            closesRun && "rounded-br-sm",
          )}
        >
          {turn.text}
        </p>
      </div>
    );

  return (
    <div className={cn("flex items-start gap-2", opensRun ? "mt-3" : "mt-1")}>
      {/* mt-0.5 centres the 18px face on the first 22px line */}
      <FaceSlot face={opensRun} className="mt-0.5" />
      <p className="max-w-[min(34rem,78%)] text-[13.5px] leading-relaxed break-keep whitespace-pre-wrap">
        {turn.text}
      </p>
    </div>
  );
}

/**
 * Her column. Her face marks where her run opens — the first thing she does
 * after the user speaks, a sentence or a tool — and the slot is held empty for
 * the rest of the run so it stays on one edge.
 */
function FaceSlot({ face, className }: { face: boolean; className?: string }) {
  return (
    <span
      className={cn("grid size-[18px] shrink-0 place-items-center", className)}
    >
      {face && <ThursdayMark size={18} />}
    </span>
  );
}

/** A tool turn: her column, then the glyph, the readable sentence and the tool name. */
function ToolTurn({
  turn,
  job,
  repeats,
  opensRun,
}: {
  turn: CallTurn;
  job?: CallJob;
  repeats: number;
  opensRun: boolean;
}) {
  const name = turn.tool ?? "";
  const Icon = toolIcon(name);
  const said = toolLine(name, turn.text);

  return (
    <>
      <div
        className={cn("flex items-center gap-2", opensRun ? "mt-3" : "mt-1.5")}
      >
        <FaceSlot face={opensRun} />
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3 shrink-0" />
          {said && (
            <span className="truncate text-[11px] break-keep">{said}</span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
            {name}
          </span>
          {repeats > 1 && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
              ×{repeats}
            </span>
          )}
        </span>
      </div>
      {/* Under the line that opened it, in her column (18px face + 8px gap): what
        became of the job, as it stands now. */}
      {job && (
        <p className="mt-0.5 ml-[26px] flex min-w-0 items-baseline gap-1.5 text-[11px]">
          <span
            className={cn(
              "shrink-0 font-mono text-[10px]",
              JOB_LOOK[job.status],
            )}
          >
            {JOB_WORD[job.status]}
          </span>
          {job.outcome && job.status !== "running" && (
            <span className="truncate text-muted-foreground">
              {plainText(job.outcome)}
            </span>
          )}
        </p>
      )}
    </>
  );
}
