"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowRight,
  ChevronRight,
  Loader2,
  Minus,
  Pin,
  PinOff,
  Plus,
  TriangleAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { toast } from "@/components/ui/toast";
import { ModelPicker } from "@/features/ai/components/model-picker";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import { MemoryMark } from "@/features/memory/components/memory-mark";
import {
  cancelMemoryTidyAction,
  runMemoryTidyAction,
  setMemoryTidyModelAction,
  setMemoryTidyOnAction,
} from "@/features/memory/memory.action";
import type {
  MemoryTidyChange,
  MemoryTidyRun,
  MemoryTidyStatusView,
} from "@/features/memory/memory.schema";
import { tidyTally } from "@/features/memory/memory.schema";
import {
  SettingDialogContent,
  SettingGroup,
  SettingNote,
  SettingSkeleton,
  SettingToggle,
} from "@/features/settings/components/setting-ui";
import { openSettings } from "@/features/settings/settings.store";
import { toDate } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/**
 * Reading calls back, in Settings › Thursday: one switch, the model it runs on,
 * and what the last read did. `SettingToggle`, the same as Wake and Shortcut,
 * because it is the same kind of setting — something that runs by itself.
 * State arrives on the `memory-tidy` signal.
 */
export function TidySetting() {
  const { data } = useServerRoute<MemoryTidyStatusView>(queryKey.memoryTidy);
  const refresh = { onOk: () => revalidate(queryKey.memoryTidy) } as const;
  const [setOn] = useServerAction(setMemoryTidyOnAction, refresh);

  return (
    <SettingGroup label="After a call">
      <SettingToggle
        label="Read the call back"
        description="During a call she saves what she catches between sentences. Afterwards a model reads the whole thing back and fixes what she missed."
        checked={data?.on ?? false}
        disabled={!data}
        onChange={(on) => setOn(on)}
      >
        {data && <TidyBody status={data} />}
      </SettingToggle>
    </SettingGroup>
  );
}

/** The two rows and the line under them; only drawn while it is on. */
function TidyBody({ status }: { status: MemoryTidyStatusView }) {
  const running = status.current;
  const last = status.last;

  return (
    <>
      <div className="border-t border-border/60">
        <ModelRow value={status.model} />
        <div className="flex items-center gap-3 border-t border-border/60 py-2">
          <span className="w-20 shrink-0 text-[13px] text-muted-foreground">
            {running ? "Reading" : "Last read"}
          </span>
          {running ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="truncate">
                the last {running.messages}{" "}
                {running.messages === 1 ? "message" : "messages"}
              </span>
            </span>
          ) : (
            <LastRead run={last} />
          )}
          <TidyLogButton run={running ?? last} />
        </div>
      </div>

      <SettingNote className={cn(!status.model && WAITING_INK)}>
        {status.model
          ? `Reads back after every ${status.every} messages of talk. ${status.pending} since the last one.`
          : "Nothing is read back until a model is picked — this never runs on the app default."}
      </SettingNote>
    </>
  );
}

/** Unpicked is not "automatic" here: it is the one thing stopping this from running. */
function ModelRow({ value }: { value: string | null }) {
  return (
    <button
      type="button"
      onClick={() => openTidyModel(value)}
      className="flex w-full items-center gap-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">
        Model
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[11px]",
          value ? "text-muted-foreground" : WAITING_INK,
        )}
      >
        {value ?? "Not picked"}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

/** One line on the last read: what it changed, or why it failed. */
function LastRead({ run }: { run: MemoryTidyRun | null }) {
  if (!run) {
    return (
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        Nothing read back yet
      </span>
    );
  }
  const when = formatDistanceToNowStrict(toDate(run.endedAt ?? run.startedAt), {
    addSuffix: true,
  });
  if (run.status !== "done") {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-destructive">
        <TriangleAlert className="size-3.5 shrink-0" />
        <span className="truncate font-mono text-[11px]">
          {run.status === "failed" ? "Failed" : "Stopped"} {when}
          {run.error ? ` — ${run.error}` : ""}
        </span>
      </span>
    );
  }
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
      {when} · {tidyTally(run.changes)}
    </span>
  );
}

function TidyLogButton({ run }: { run: MemoryTidyRun | null }) {
  if (!run) return <span className="size-4 shrink-0" />;
  return (
    <button
      type="button"
      aria-label="What the last read changed"
      onClick={() => openTidyLog()}
      className="shrink-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronRight className="size-4 text-muted-foreground/60" />
    </button>
  );
}

/** Picks the model this runs on; empty is the app default, same as a bot's. */
function openTidyModel(current: string | null) {
  return notify.component({
    className: "sm:max-w-lg",
    renderer: ({ close }) => (
      <TidyModelDialog current={current} onDone={close} />
    ),
  });
}

function TidyModelDialog({
  current,
  onDone,
}: {
  current: string | null;
  onDone: () => void;
}) {
  const [save, saving] = useServerAction(setMemoryTidyModelAction, {
    onOk: () => {
      revalidate(queryKey.memoryTidy);
      onDone();
    },
  });
  const parts = current?.split("/") ?? null;
  const [pick, setPick] = useState<{
    provider: TextModelProviderId | null;
    model: string;
  }>({
    provider: (parts?.[0] as TextModelProviderId | undefined) ?? null,
    model: parts?.slice(1).join("/") ?? "",
  });

  return (
    <SettingDialogContent
      title="Model"
      description="What re-reads a call. There is no default: without a pick nothing is read back, so a model nobody chose never spends."
      footer={
        <>
          <Button variant="ghost" onClick={() => save("")}>
            Clear
          </Button>
          <Button
            loading={saving}
            disabled={!pick.provider || !pick.model.trim()}
            onClick={() => save(`${pick.provider}/${pick.model.trim()}`)}
          >
            Save
          </Button>
        </>
      }
    >
      <ModelPicker
        provider={pick.provider}
        model={pick.model}
        onChange={setPick}
      />
    </SettingDialogContent>
  );
}

export function openTidyLog() {
  return notify.component({
    className: "sm:max-w-2xl",
    renderer: () => <TidyLogDialog />,
  });
}

function TidyLogDialog() {
  const { data } = useServerRoute<MemoryTidyStatusView>(queryKey.memoryTidy);
  const refresh = { onOk: () => revalidate(queryKey.memoryTidy) } as const;
  const [run, starting] = useServerAction(runMemoryTidyAction, refresh);
  const [cancel, cancelling] = useServerAction(cancelMemoryTidyAction, refresh);

  if (!data) {
    return (
      <SettingDialogContent title="What the last read changed">
        <SettingSkeleton rows={2} />
      </SettingDialogContent>
    );
  }

  const shown = data.current ?? data.last;
  const when = shown
    ? formatDistanceToNowStrict(toDate(shown.endedAt ?? shown.startedAt), {
        addSuffix: true,
      })
    : "";

  return (
    <SettingDialogContent
      title="What the last read changed"
      description="Memory as it stands after the model read those messages back. Every line here is one it wrote, revised or dropped."
      footer={
        data.current ? (
          <Button
            variant="outline"
            loading={cancelling}
            onClick={() => cancel()}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="outline"
            loading={starting}
            disabled={data.pending === 0 || !data.model}
            onClick={() => run()}
          >
            {!starting && <MemoryMark className="size-3.5" />}
            Read now
          </Button>
        )
      }
    >
      {shown ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">
              {data.current
                ? `Reading the last ${shown.messages} messages`
                : `${shown.messages} messages, ${when}`}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {shown.provider !== "-" && shown.model}
              {shown.inputTokens > 0 &&
                ` · ${shown.inputTokens.toLocaleString()} in / ${shown.outputTokens.toLocaleString()} out`}
            </span>
          </div>

          {shown.error && (
            <p className="font-mono text-xs text-destructive">{shown.error}</p>
          )}

          {shown.changes.length > 0 ? (
            <ul className="border-b border-border/60">
              {shown.changes.map((change, at) => (
                <ChangeRow
                  key={`${at}-${change.op}-${change.text}`}
                  change={change}
                />
              ))}
            </ul>
          ) : (
            !data.current && (
              <p className="text-xs text-muted-foreground/70">
                Nothing needed changing.
              </p>
            )
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70">
          Nothing has been read back yet.
        </p>
      )}
    </SettingDialogContent>
  );
}

/** One glyph per op. Pin is the one the memory screen already uses for a carried line. */
const OP_MARK: Record<
  MemoryTidyChange["op"],
  { icon: ComponentType<{ className?: string }>; label: string }
> = {
  add: { icon: Plus, label: "added" },
  replace: { icon: ArrowRight, label: "revised" },
  forget: { icon: Minus, label: "dropped" },
  carry: { icon: Pin, label: "carried into every call" },
  uncarry: { icon: PinOff, label: "no longer carried" },
};

function ChangeRow({ change }: { change: MemoryTidyChange }) {
  const { icon: Icon, label } = OP_MARK[change.op];
  return (
    <li className="flex gap-3 border-t border-border/60 py-3">
      <span className="flex w-3.5 shrink-0 justify-center pt-1 text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="sr-only">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/90">
        {change.text}
      </span>
      <span className="shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground/50">
        {change.path}
      </span>
    </li>
  );
}

/**
 * Mounted on the call screen: a read that ends while the settings are closed is
 * off-screen, so it is a toast. The `memory-tidied` event carries the tally.
 */
export function MemoryTidyNotice() {
  useAppEvent({
    "memory-tidied": (event) => {
      toast.add({
        type: event.failed ? "error" : "success",
        title: event.failed ? "Could not read the call back" : "Memory tidied",
        description: event.tally,
        actionProps: {
          children: "Show",
          onClick: () => {
            openSettings("thursday");
            void openTidyLog();
          },
        },
      });
    },
  });
  return null;
}
