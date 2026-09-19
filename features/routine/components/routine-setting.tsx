"use client";

import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import { Segmented } from "@/components/ui/segmented";
import { ShinyText } from "@/components/ui/shiny-text";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ROUTINE } from "@/config";
import type { Bot } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { KeepWorkingSwitch } from "@/features/bot/components/keep-working-switch";
import { roomOpens } from "@/features/bot/thread.store";
import {
  SettingError,
  SettingItems,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { useSettingsStore } from "@/features/settings/settings.store";
import { whenOf } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, plainText, WAITING_INK } from "@/lib/utils";
import {
  createRoutineAction,
  deleteRoutineAction,
  runRoutineNowAction,
  updateRoutineAction,
} from "../routine.action";
import {
  nextRun,
  type Routine,
  type RoutineInput,
  type RoutineSchedule,
  scheduleText,
  WEEKDAYS,
} from "../routine.schema";
import { RoutineMark } from "./routine-mark";

/** The sheet holds a routine, or the one being made. */
type Open = string | "new" | null;

const STARTS_NOTE =
  "Starts while Thursday is running on this computer, with a tab open unless work goes on with the app closed. A time that passed meanwhile starts once, not once for each.";

export function RoutineSetting() {
  const [open, setOpen] = useState<Open>(null);
  const {
    data: routines,
    isLoading,
    error,
  } = useServerRoute<Routine[]>(queryKey.routines);
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);

  const [update] = useServerAction(updateRoutineAction, {
    onOk: () => revalidate(queryKey.routines),
  });

  if (isLoading) return <SettingSkeleton rows={3} />;
  if (error) return <SettingError message={error.message} />;

  const all = routines ?? [];
  const on = all.filter((routine) => routine.enabled).length;
  const reading = all.find((routine) => routine.id === open);

  return (
    <>
      <SettingScreen
        footer={
          <>
            <SettingRailNote>
              {all.length} of {ROUTINE.max} · {on} on
            </SettingRailNote>
            {/* A routine's time is kept only as far as this allows, so it is set where they are */}
            <KeepWorkingSwitch />
          </>
        }
      >
        {/* At the head of the list, where Skills and Connectors add theirs: the foot was not seen */}
        <SettingItems
          addRow={
            all.length < ROUTINE.max
              ? { label: "New routine", onClick: () => setOpen("new") }
              : undefined
          }
        >
          {all.length === 0 ? (
            <p className="p-4 text-sm leading-relaxed text-muted-foreground">
              Nothing starts by itself yet. Tell Thursday what should — "every
              weekday at nine, go through my mail" — or make one here.
            </p>
          ) : (
            all.map((routine) => (
              <Row
                key={routine.id}
                routine={routine}
                bots={bots}
                open={routine.id === open}
                onOpen={() => setOpen(routine.id)}
                onSwitch={(enabled) => update(routine.id, { enabled })}
              />
            ))
          )}
        </SettingItems>
      </SettingScreen>

      <RoutineSheet
        // A routine deleted elsewhere closes its sheet
        routine={open === "new" ? "new" : (reading ?? null)}
        bots={bots ?? []}
        onClose={() => setOpen(null)}
        onMade={(id) => setOpen(id)}
      />
    </>
  );
}

const markOf = (name: string, bots?: Bot[]) => {
  const icon = bots?.find((bot) => bot.name === name)?.icon;
  return {
    color: icon?.color,
    shape: icon?.shape,
    outline: icon?.outline,
    paint: icon?.paint,
  };
};

/**
 * What a routine's second line says. Amber only where it waits on the user: its last run
 * asked or stopped (so the next start is skipped), or its bot cannot take a job.
 */
function stateOf(
  routine: Routine,
  bots?: Bot[],
): { text: string; tone: string; shine?: boolean; waits?: boolean } {
  const last = routine.runs[0];
  const said = last?.outcome ? plainText(last.outcome) : "";
  const before = last
    ? `${whenOf(last.updatedAt)}${said ? ` — ${said}` : ""}`
    : "Not run yet";
  if (!routine.enabled)
    return { text: `Off · ${before}`, tone: "text-muted-foreground" };
  const bot = bots?.find((one) => one.name === routine.bot);
  if (bots && (!bot || bot.disabled))
    return {
      text: bot
        ? `${routine.bot} is switched off`
        : `${routine.bot} is gone — pick another bot`,
      tone: WAITING_INK,
      waits: true,
    };
  if (last?.status === "running")
    return { text: "Running now", tone: "", shine: true };
  if (last?.status === "waiting")
    return {
      text: `The last run waits on you${said ? `: ${said}` : ""}`,
      tone: WAITING_INK,
      waits: true,
    };
  return { text: before, tone: "text-muted-foreground" };
}

function Row({
  routine,
  bots,
  open,
  onOpen,
  onSwitch,
}: {
  routine: Routine;
  bots?: Bot[];
  /** Its routine is on the sheet. */
  open: boolean;
  onOpen: () => void;
  onSwitch: (enabled: boolean) => void;
}) {
  const state = stateOf(routine, bots);
  const running = routine.runs[0]?.status === "running";
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-4 transition-colors",
        open ? "bg-muted/80" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          !routine.enabled && "opacity-70",
        )}
      >
        <BotMark
          size={40}
          seed={routine.bot}
          {...markOf(routine.bot, bots)}
          state={running ? "thinking" : "idle"}
          notify={Boolean(state.waits)}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {routine.label}
            </span>
            {running && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            )}
          </span>
          <span className="flex min-w-0 text-[13px] leading-snug">
            {state.shine ? (
              <ShinyText
                text={state.text}
                speed={2.2}
                className="min-w-0 truncate"
              />
            ) : (
              <span className={cn("min-w-0 truncate", state.tone)}>
                {state.text}
              </span>
            )}
          </span>
        </span>
        <span className="flex w-44 shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">
          <span className="flex max-w-full items-center gap-1.5 text-foreground">
            <RoutineMark className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{scheduleText(routine.schedule)}</span>
          </span>
          <span className="max-w-full truncate text-muted-foreground/70">
            {routine.enabled ? `next ${whenOf(routine.nextRunAt)}` : "off"}
          </span>
        </span>
      </button>
      <Switch
        checked={routine.enabled}
        onCheckedChange={onSwitch}
        aria-label={`${routine.label} on or off`}
        className="shrink-0"
      />
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${routine.label}`}
        className="shrink-0 rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

type Draft = {
  label: string;
  bot: string;
  request: string;
  kind: RoutineSchedule["kind"];
  time: string;
  days: number[];
  hours: string;
};

const draftOf = (routine: Routine | null, bots: Bot[]): Draft => {
  const schedule = routine?.schedule;
  return {
    label: routine?.label ?? "",
    bot: routine?.bot ?? bots.find((bot) => !bot.disabled)?.name ?? "",
    request: routine?.request ?? "",
    kind: schedule?.kind ?? "daily",
    time: schedule?.kind === "daily" ? schedule.time : "09:00",
    days: schedule?.kind === "daily" ? schedule.days : [...WEEKDAYS],
    hours: schedule?.kind === "every" ? String(schedule.hours) : "6",
  };
};

/** The schedule a draft spells; null while it spells none (no day picked, hours not a number). */
function scheduleOf(draft: Draft): RoutineSchedule | null {
  if (draft.kind === "daily")
    return draft.days.length && /^\d\d:\d\d$/.test(draft.time)
      ? { kind: "daily", time: draft.time, days: draft.days }
      : null;
  const hours = Number(draft.hours);
  return Number.isInteger(hours) && hours >= ROUTINE.minHours
    ? { kind: "every", hours }
    : null;
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The sets of days most routines want, one press each. */
const DAY_SETS = [
  { label: "Every day", days: [1, 2, 3, 4, 5, 6, 7] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [6, 7] },
];
const DAY_WORDS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/**
 * A routine on a sheet down the settings window's right edge, where a thread opens
 * (thread-setting ThreadSheet): who, when, what, and the runs it opened. One that exists
 * saves a field as it is left, the way a bot's page does; a new one is made by its button.
 */
function RoutineSheet({
  routine,
  bots,
  onClose,
  onMade,
}: {
  routine: Routine | "new" | null;
  bots: Bot[];
  onClose: () => void;
  onMade: (id: string) => void;
}) {
  // Portals into the settings dialog, not the page, so it is placed against the window
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLElement | null) => {
    setHost(node?.closest<HTMLElement>("[data-slot=dialog-content]") ?? null);
  }, []);

  const saved = routine === "new" ? null : routine;
  const key = routine === "new" ? "new" : (routine?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved, bots));
  // A different routine on the sheet is a different draft; the same one keeps what is typed
  useEffect(() => setDraft(draftOf(saved, bots)), [key]);
  const patch = (next: Partial<Draft>) =>
    setDraft((was) => ({ ...was, ...next }));

  const refresh = () => revalidate(queryKey.routines);
  const [create, creating] = useServerAction(createRoutineAction, {
    onOk: (made) => {
      refresh();
      onMade(made.id);
    },
  });
  const [update] = useServerAction(updateRoutineAction, { onOk: refresh });
  const [remove] = useServerAction(deleteRoutineAction, { onOk: refresh });
  const [runNow, starting] = useServerAction(runRoutineNowAction, {
    onOk: () => {
      refresh();
      revalidate(queryKey.threads);
    },
  });

  const schedule = scheduleOf(draft);
  const input: RoutineInput | null =
    schedule && draft.label.trim() && draft.bot && draft.request.trim()
      ? {
          label: draft.label.trim(),
          bot: draft.bot,
          request: draft.request.trim(),
          schedule,
        }
      : null;

  /** One field of a routine that exists, written when it differs from what is kept. */
  const commit = (next: Partial<RoutineInput>) => {
    if (saved) void update(saved.id, next).catch(() => {});
  };
  const commitSchedule = (next: Partial<Draft>) => {
    patch(next);
    const spelled = scheduleOf({ ...draft, ...next });
    if (spelled) commit({ schedule: spelled });
  };

  const confirmDelete = async () => {
    if (!saved) return;
    const confirmed = await notify.confirm({
      title: `Delete "${saved.label}"?`,
      description: "It starts no more. The jobs it already opened stay.",
      okText: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    await remove(saved.id).catch(() => {});
    onClose();
  };

  const openRun = (id: string) => {
    // The thread opens where threads are read: the room on the call screen
    useSettingsStore.getState().hide();
    roomOpens.open(id);
  };

  const picked = bots.find((bot) => bot.name === draft.bot);
  const lastOpen =
    saved?.runs[0]?.status === "running" ||
    saved?.runs[0]?.status === "waiting";

  return (
    <>
      <span ref={anchor} hidden />
      <Dialog
        open={Boolean(routine && host)}
        onOpenChange={(next) => !next && onClose()}
        modal={false}
        disablePointerDismissal
      >
        <DialogPortal container={host}>
          <DialogPopup className="absolute inset-y-0 right-0 z-10 flex w-[min(35rem,calc(100%-13rem))] flex-col border-l border-border/60 bg-popover text-popover-foreground shadow-2xl shadow-black/10 duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-right-4 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-right-4">
            {routine && (
              <>
                <div className="flex shrink-0 items-center gap-2.5 pt-3.5 pr-3 pb-1.5 pl-5">
                  {picked ? (
                    <BotMark
                      size={28}
                      seed={picked.name}
                      {...markOf(picked.name, bots)}
                      notify={false}
                      className="shrink-0"
                    />
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <RoutineMark className="size-3.5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="sr-only">
                      {saved ? saved.label : "New routine"}
                    </DialogTitle>
                    <p className="truncate text-[15px] leading-5 font-semibold">
                      {saved ? saved.label : "New routine"}
                    </p>
                    {saved && (
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <RoutineMark className="size-3 shrink-0" />
                        <span className="truncate">
                          {saved.bot} · {scheduleText(saved.schedule)}
                          {saved.enabled &&
                            ` · next ${whenOf(saved.nextRunAt)}`}
                        </span>
                      </p>
                    )}
                  </div>
                  {saved && (
                    <>
                      <Switch
                        checked={saved.enabled}
                        onCheckedChange={(enabled) =>
                          void update(saved.id, { enabled }).catch(() => {})
                        }
                        aria-label={`${saved.label} on or off`}
                        className="mr-1 shrink-0"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="More"
                              className="text-muted-foreground"
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={confirmDelete}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                  <DialogClose
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Close the routine"
                      />
                    }
                  >
                    <X />
                  </DialogClose>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-3 pb-5">
                  <Field label="Name" htmlFor="routine-name">
                    <Input
                      id="routine-name"
                      value={draft.label}
                      onChange={(event) => patch({ label: event.target.value })}
                      onBlur={() => {
                        const next = draft.label.trim();
                        if (next && next !== saved?.label)
                          commit({ label: next });
                      }}
                      placeholder="Morning mail"
                      maxLength={80}
                      autoFocus={!saved}
                    />
                    <Hint>
                      What it is called in this list, and what she calls it on a
                      call.
                    </Hint>
                  </Field>

                  <Field label="Bot">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            className="justify-start gap-2 pl-1.5 font-normal"
                          />
                        }
                      >
                        {picked ? (
                          <BotMark
                            size={20}
                            seed={picked.name}
                            {...markOf(picked.name, bots)}
                            notify={false}
                            className="shrink-0"
                          />
                        ) : null}
                        <span
                          className={cn(
                            !picked && "pl-1.5 text-muted-foreground",
                          )}
                        >
                          {picked?.name ?? (draft.bot || "Pick a bot")}
                        </span>
                        <ChevronDown className="ml-1 size-3.5 text-muted-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuGroup>
                          {bots
                            .filter((bot) => !bot.disabled)
                            .map((bot) => (
                              <DropdownMenuItem
                                key={bot.name}
                                onClick={() => {
                                  patch({ bot: bot.name });
                                  if (bot.name !== saved?.bot)
                                    commit({ bot: bot.name });
                                }}
                              >
                                <BotMark
                                  size={16}
                                  seed={bot.name}
                                  {...markOf(bot.name, bots)}
                                  notify={false}
                                  className="shrink-0"
                                />
                                {bot.name}
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Hint>Who does the job each time it starts.</Hint>
                  </Field>

                  <Field label="When">
                    <Segmented
                      aria-label="How it repeats"
                      value={draft.kind}
                      onChange={(kind) => commitSchedule({ kind })}
                      options={[
                        { value: "daily", label: "At a set time" },
                        { value: "every", label: "Every few hours" },
                      ]}
                    />
                    {draft.kind === "daily" ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="text-sm text-muted-foreground">
                            At
                          </span>
                          <Input
                            type="time"
                            aria-label="Time of day"
                            value={draft.time}
                            onChange={(event) =>
                              patch({ time: event.target.value })
                            }
                            onBlur={() => commitSchedule({})}
                            className="w-36 font-mono text-[13px]"
                          />
                          <span className="text-sm text-muted-foreground">
                            on
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {WEEKDAYS.map((day) => {
                            const on = draft.days.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                aria-pressed={on}
                                aria-label={DAY_WORDS[day - 1]}
                                onClick={() =>
                                  commitSchedule({
                                    days: on
                                      ? draft.days.filter((one) => one !== day)
                                      : [...draft.days, day].sort(),
                                  })
                                }
                                className={cn(
                                  "flex h-7 items-center justify-center rounded-full px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                                  on
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground ring-1 ring-border ring-inset hover:text-foreground",
                                )}
                              >
                                {DAY_SHORT[day - 1]}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-3">
                          {DAY_SETS.map((set) => {
                            const on =
                              set.days.length === draft.days.length &&
                              set.days.every((day) => draft.days.includes(day));
                            return (
                              <button
                                key={set.label}
                                type="button"
                                onClick={() =>
                                  commitSchedule({ days: [...set.days] })
                                }
                                className={cn(
                                  "rounded-sm text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                                  on
                                    ? "text-foreground underline underline-offset-4"
                                    : "text-muted-foreground",
                                )}
                              >
                                {set.label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-sm text-muted-foreground">
                            Every
                          </span>
                          <Input
                            inputMode="numeric"
                            aria-label="Hours between starts"
                            value={draft.hours}
                            onChange={(event) =>
                              patch({ hours: event.target.value })
                            }
                            onBlur={() => commitSchedule({})}
                            className="w-16 font-mono text-[13px]"
                          />
                          <span className="text-sm text-muted-foreground">
                            hours
                          </span>
                        </div>
                        <Hint>
                          No more often than every{" "}
                          {ROUTINE.minHours === 1
                            ? "hour"
                            : `${ROUTINE.minHours} hours`}
                          , counted from its last start.
                        </Hint>
                      </>
                    )}
                    {schedule ? (
                      // What was picked, said back in words: the check that the form was read right
                      <p className="flex items-center gap-1.5 pt-1 text-[13px]">
                        <RoutineMark className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">
                          {scheduleText(schedule)}
                          <span className="text-muted-foreground">
                            {" "}
                            · first start{" "}
                            {whenOf(nextRun(schedule, new Date()))}
                          </span>
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-destructive">
                        {draft.kind === "daily"
                          ? "Pick a time and at least one day."
                          : `A whole number of hours, ${ROUTINE.minHours} or more.`}
                      </p>
                    )}
                  </Field>

                  <Field label="Job" htmlFor="routine-request">
                    <Textarea
                      id="routine-request"
                      value={draft.request}
                      onChange={(event) =>
                        patch({ request: event.target.value })
                      }
                      onBlur={() => {
                        const next = draft.request.trim();
                        if (next && next !== saved?.request)
                          commit({ request: next });
                      }}
                      placeholder="Go through the mail that came since the last run and draft replies to what needs one. Send nothing."
                      className="min-h-28"
                    />
                    <Hint>
                      Handed to the bot as a new thread each time, with a line
                      on how the last run ended. Nobody is there to ask, so say
                      everything it needs.
                    </Hint>
                  </Field>

                  {saved && (
                    <div className="pt-1">
                      <div className="flex h-6 items-center">
                        <span className="font-mono text-xs text-muted-foreground">
                          Runs
                        </span>
                      </div>
                      {saved.runs.length === 0 ? (
                        <p className="py-2 text-[13px] text-muted-foreground">
                          Not run yet.
                        </p>
                      ) : (
                        saved.runs.map((run) => (
                          <button
                            key={run.id}
                            type="button"
                            onClick={() => openRun(run.id)}
                            className="flex h-9 w-full items-center gap-3 border-t border-border/60 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <span className="w-28 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                              {whenOf(run.updatedAt)}
                            </span>
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate",
                                run.status === "waiting"
                                  ? WAITING_INK
                                  : "text-muted-foreground",
                              )}
                            >
                              {run.status === "running"
                                ? "Running now"
                                : run.outcome
                                  ? plainText(run.outcome)
                                  : run.status === "cancelled"
                                    ? "Stopped"
                                    : "No words"}
                            </span>
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3 border-t border-border/60 px-5 py-3">
                  <p className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
                    {saved || input
                      ? STARTS_NOTE
                      : `Still needs ${missingOf(draft, schedule)}.`}
                  </p>
                  {saved ? (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={starting}
                      disabled={lastOpen}
                      title={
                        lastOpen ? "Its last run is still open" : undefined
                      }
                      onClick={() => void runNow(saved.id).catch(() => {})}
                    >
                      <Play />
                      Run now
                    </Button>
                  ) : (
                    <Button
                      variant="brand"
                      size="sm"
                      loading={creating}
                      disabled={!input}
                      onClick={() =>
                        input && void create(input).catch(() => {})
                      }
                    >
                      Create
                    </Button>
                  )}
                </div>
              </>
            )}
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </>
  );
}

/** What a routine being made still lacks, in words: "a name, a bot and a job". */
function missingOf(draft: Draft, schedule: RoutineSchedule | null): string {
  const lacks = [
    draft.label.trim() ? null : "a name",
    draft.bot ? null : "a bot",
    schedule ? null : "a time",
    draft.request.trim() ? null : "a job",
  ].filter((one): one is string => one !== null);
  return lacks.length > 1
    ? `${lacks.slice(0, -1).join(", ")} and ${lacks.at(-1)}`
    : (lacks[0] ?? "nothing");
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);

/** A form row, labelled the way a bot's page labels its own. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <label
        htmlFor={htmlFor}
        className="w-14 shrink-0 pt-2 font-mono text-xs text-muted-foreground"
      >
        {label}
      </label>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </div>
  );
}
