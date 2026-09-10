"use client";

import { ChevronRight, Phone, Trash2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { CALL_HISTORY_PAGE } from "@/config";
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
import { cn } from "@/lib/utils";
import { deleteCallAction } from "../thursday.action";
import { type CallRecord, type CallTurn } from "../thursday.schema";
import { toolLine } from "../tool-line";
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
          {calls.map((call) => (
            <Thread key={call.id} call={call} onDropped={refresh} />
          ))}
        </div>
      )}
    </>
  );
}

/** Placeholder for an older call while its page loads; sits above the oldest call. */
function CallGhost() {
  return (
    <div className="space-y-3 pb-3">
      <div className="flex items-center gap-3 py-5">
        <span className="h-px flex-1 bg-border/60" />
        <Skeleton className="h-6 w-36 rounded-full" />
        <span className="h-px flex-1 bg-border/60" />
        <span className="size-7 shrink-0" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-9 w-3/5 rounded-2xl rounded-br-md" />
      </div>
      <Skeleton className="h-5 w-2/3" />
    </div>
  );
}

/** One call: a header with its time and duration, then its turns. */
function Thread({
  call,
  onDropped,
}: {
  call: CallRecord;
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
      {/* The delete button keeps its slot so the date pill does not shift on hover. */}
      <div className="group flex items-center gap-3 py-5">
        <span className="h-px flex-1 bg-border/60" />
        <span
          title={`${call.provider} · ${call.model}`}
          className="flex shrink-0 items-center gap-2 rounded-full bg-muted/60 py-1 pr-3 pl-2.5 ring-1 ring-border/50"
        >
          <Phone className="size-3 text-muted-foreground" />
          <span className="font-mono text-[11px]">{whenOf(started)}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {ran}
          </span>
        </span>
        <span className="h-px flex-1 bg-border/60" />
        <span className="flex size-7 shrink-0 items-center justify-center">
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

      {fold(call.turns).map(({ turn, repeats }, index, folded) => {
        const before = folded[index - 1]?.turn;
        const after = folded[index + 1]?.turn;
        return (
          <Turn
            key={turn.id}
            turn={turn}
            repeats={repeats}
            opensRun={before?.role !== turn.role}
            closesRun={after?.role !== turn.role}
          />
        );
      })}
    </>
  );
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

/** One spoken turn. Plain text, never markdown: asterisks were said aloud. */
function Turn({
  turn,
  opensRun,
  closesRun,
  repeats = 1,
}: {
  turn: CallTurn;
  opensRun: boolean;
  closesRun: boolean;
  /** Consecutive repeats of the same tool turn (ToolTurn only). */
  repeats?: number;
}) {
  if (turn.role === "tool") return <ToolTurn turn={turn} repeats={repeats} />;

  const mine = turn.role === "user";

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        opensRun ? "mt-3" : "mt-1",
        mine ? "justify-end" : "justify-start",
      )}
    >
      {!mine && (
        // The slot is held even without the mark so a run stays in one column.
        <span className="mb-0.5 grid size-[18px] shrink-0 place-items-center">
          {closesRun && <ThursdayMark size={18} />}
        </span>
      )}

      <p
        className={cn(
          "max-w-[min(34rem,78%)] px-3.5 py-2 text-[13.5px] leading-relaxed break-keep whitespace-pre-wrap",
          mine
            ? "rounded-2xl bg-muted"
            : "rounded-2xl bg-card ring-1 ring-border/70",
          closesRun && (mine ? "rounded-br-sm" : "rounded-bl-sm"),
        )}
      >
        {turn.text}
      </p>
    </div>
  );
}

/** A tool turn: centered line with the readable sentence, then the tool name. */
function ToolTurn({ turn, repeats }: { turn: CallTurn; repeats: number }) {
  const name = turn.tool ?? "";
  const Icon = toolIcon(name);
  const said = toolLine(name, turn.text);

  return (
    <div className="mt-3 mb-1 flex justify-center">
      <span className="flex max-w-full items-center gap-2 rounded-full bg-muted/40 px-2.5 py-1 text-muted-foreground">
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
  );
}
