"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { toast } from "@/components/ui/toast";
import { ModelPicker } from "@/features/ai/components/model-picker";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import {
  cancelMemoryTidyAction,
  runMemoryTidyAction,
  setMemoryTidyLevelAction,
  setMemoryTidyModelAction,
} from "@/features/memory/memory.action";
import {
  MEMORY_TIDY_LEVEL_LABEL,
  MEMORY_TIDY_LEVELS,
  type MemoryTidyChange,
  type MemoryTidyRun,
  type MemoryTidyStatusView,
  tidyTally,
} from "@/features/memory/memory.schema";
import {
  SettingChoiceRows,
  SettingDialogContent,
  SettingError,
  SettingGroup,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { openSettings } from "@/features/settings/settings.store";
import { toDate } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/**
 * The tidy pass on screen (memory.tidy): a row in the memory index that says
 * where it stands, and the dialog it opens with the two settings, "tidy now",
 * and the log of the last pass. Progress arrives on the `memory-tidy` signal.
 */

const LEVEL_HINT: Record<(typeof MEMORY_TIDY_LEVELS)[number], string> = {
  off: "She still saves during calls; nobody re-reads them",
  often: "After a few calls' worth of talk",
  normal: "After a handful of calls' worth",
  rarely: "After a long stretch of calls",
};

/** The index row. Reads as a loader while a pass runs; otherwise one line on the last pass. */
export function TidyRow() {
  const { data } = useServerRoute<MemoryTidyStatusView>(queryKey.memoryTidy);
  const running = data?.current ?? null;
  const last = data?.last ?? null;

  const line = running
    ? `Reading call ${Math.min(running.done + 1, running.callIds.length)} of ${running.callIds.length}`
    : data?.level === "off"
      ? "Off"
      : last
        ? `${tidyTally(last.changes)} · ${formatDistanceToNowStrict(toDate(last.endedAt ?? last.startedAt), { addSuffix: true })}`
        : "Nothing read yet";

  return (
    <button
      type="button"
      onClick={openMemoryTidy}
      className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {running ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Sparkles className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block">Tidy</span>
        <span
          className={cn(
            "block truncate font-mono text-[10px] text-muted-foreground/70",
            last?.status === "failed" && !running && "text-destructive",
          )}
        >
          {line}
        </span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

export function openMemoryTidy() {
  return notify.component({
    className: "sm:max-w-2xl",
    renderer: () => <TidyDialog />,
  });
}

function TidyDialog() {
  const { data, isLoading, error } = useServerRoute<MemoryTidyStatusView>(
    queryKey.memoryTidy,
  );
  const refresh = { onOk: () => revalidate(queryKey.memoryTidy) } as const;
  const [setLevel, settingLevel] = useServerAction(
    setMemoryTidyLevelAction,
    refresh,
  );
  const [setModel] = useServerAction(setMemoryTidyModelAction, refresh);
  const [run, starting] = useServerAction(runMemoryTidyAction, refresh);
  const [cancel, cancelling] = useServerAction(cancelMemoryTidyAction, refresh);

  // The picker hands back a provider before a model; only a whole pick is saved
  const saved = data?.model?.split("/") ?? null;
  const [pick, setPick] = useState<{
    provider: TextModelProviderId;
    model: string;
  } | null>(null);
  const provider =
    pick?.provider ?? (saved?.[0] as TextModelProviderId | undefined) ?? null;
  const model = pick?.model ?? saved?.slice(1).join("/") ?? "";

  if (isLoading || !data) {
    return (
      <SettingDialogContent title="Tidy memory">
        <SettingSkeleton rows={3} />
      </SettingDialogContent>
    );
  }
  if (error) {
    return (
      <SettingDialogContent title="Tidy memory">
        <SettingError message={error.message} />
      </SettingDialogContent>
    );
  }

  const running = data.current;

  return (
    <SettingDialogContent
      title="Tidy memory"
      description="After calls, a text model re-reads them and puts memory right: what she missed goes in, what changed is corrected, what matters most is carried into every call."
      footer={
        running ? (
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
            disabled={data.level === "off" || data.pendingCalls === 0}
            onClick={() => run()}
          >
            {!starting && <Sparkles />}
            Tidy now
          </Button>
        )
      }
    >
      <div className="space-y-6">
        <SettingGroup label="How often">
          <SettingChoiceRows
            options={MEMORY_TIDY_LEVELS.map((level) => ({
              value: level,
              label: MEMORY_TIDY_LEVEL_LABEL[level],
              hint: LEVEL_HINT[level],
            }))}
            value={data.level}
            disabled={settingLevel}
            onChange={(level) => setLevel(level)}
          />
        </SettingGroup>

        <SettingGroup
          label="Model"
          hint="what reads the calls"
          right={
            data.model && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setPick(null);
                  setModel("");
                }}
              >
                Use app default
              </Button>
            )
          }
        >
          <ModelPicker
            provider={provider}
            model={model}
            onChange={(next) => {
              setPick(next);
              if (next.model.trim()) {
                setModel(`${next.provider}/${next.model.trim()}`);
              }
            }}
          />
        </SettingGroup>

        <SettingGroup label="Pending" right={<Pending status={data} />}>
          {running ? (
            <RunView run={running} />
          ) : data.last ? (
            <RunView run={data.last} />
          ) : (
            <p className="px-1 text-xs text-muted-foreground">
              No pass has run yet.
            </p>
          )}
        </SettingGroup>
      </div>
    </SettingDialogContent>
  );
}

/** What is owed and where a pass starts, in the list's own vocabulary. */
function Pending({ status }: { status: MemoryTidyStatusView }) {
  const calls = `${status.pendingCalls} call${status.pendingCalls === 1 ? "" : "s"}`;
  const size =
    status.threshold === null
      ? `${status.pendingTokens.toLocaleString()} tokens`
      : `${status.pendingTokens.toLocaleString()} of ${status.threshold.toLocaleString()} tokens`;
  return (
    <span
      className={cn(
        "font-mono text-[11px] text-muted-foreground",
        status.threshold !== null &&
          status.pendingTokens >= status.threshold &&
          WAITING_INK,
      )}
    >
      {calls} · {size}
    </span>
  );
}

/** One pass: its line, then what it changed. Running passes grow as they go. */
function RunView({ run }: { run: MemoryTidyRun }) {
  const running = run.status === "running";
  const when = formatDistanceToNowStrict(toDate(run.endedAt ?? run.startedAt), {
    addSuffix: true,
  });
  const head = running
    ? `Reading call ${Math.min(run.done + 1, run.callIds.length)} of ${run.callIds.length}`
    : run.status === "done"
      ? `Read ${run.done} call${run.done === 1 ? "" : "s"} ${when}`
      : `${run.status === "failed" ? "Failed" : "Stopped"} ${when} after ${run.done} of ${run.callIds.length}`;

  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="flex items-center gap-2">
        {running && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
        <span className="min-w-0 flex-1 truncate text-sm">{head}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {run.provider !== "-" ? run.model : ""}
          {run.inputTokens > 0 &&
            ` · ${(run.inputTokens + run.outputTokens).toLocaleString()} tokens`}
        </span>
      </div>

      {run.error && (
        <p className="font-mono text-xs text-destructive">{run.error}</p>
      )}

      {run.changes.length > 0 ? (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {run.changes.map((change, at) => (
            <ChangeRow key={`${at}-${change.text}`} change={change} />
          ))}
        </ul>
      ) : (
        !running && (
          <p className="text-xs text-muted-foreground/70">Nothing changed.</p>
        )
      )}
    </div>
  );
}

const OP_LABEL: Record<MemoryTidyChange["op"], string> = {
  add: "+",
  replace: "~",
  forget: "−",
  carry: "📌",
  uncarry: "un📌",
};

function ChangeRow({ change }: { change: MemoryTidyChange }) {
  return (
    <li className="flex gap-3 py-2">
      <span
        className={cn(
          "w-8 shrink-0 font-mono text-[11px]",
          change.op === "forget" ? "text-destructive" : "text-muted-foreground",
        )}
        title={change.op}
      >
        {OP_LABEL[change.op]}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/90">
        {change.text}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
        {change.path}
      </span>
    </li>
  );
}

/**
 * Mounted on the call screen: a pass ending while the settings are closed is
 * off-screen, so it is a toast. The `memory-tidied` event carries the tally.
 */
export function MemoryTidyNotice() {
  useAppEvent({
    "memory-tidied": (event) => {
      toast.add({
        type: "success",
        title: "Memory tidied",
        description: event.tally,
        actionProps: {
          children: "Show",
          onClick: () => {
            openSettings("memory");
            void openMemoryTidy();
          },
        },
      });
    },
  });
  return null;
}
