"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  momentOf,
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
  /** The time of day, for one that starts once and one on set days alike. */
  time: string;
  days: number[];
  hours: number;
  /** The day one that starts once starts, "YYYY-MM-DD". */
  date: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A day in this machine's own time as "YYYY-MM-DD", `ahead` days after `from`. */
function dayOf(ahead: number, from = new Date()): string {
  const at = new Date(from);
  at.setDate(at.getDate() + ahead);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

const draftOf = (routine: Routine | null, bots: Bot[]): Draft => {
  const schedule = routine?.schedule;
  return {
    label: routine?.label ?? "",
    bot: routine?.bot ?? bots.find((bot) => !bot.disabled)?.name ?? "",
    request: routine?.request ?? "",
    kind: schedule?.kind ?? "daily",
    time:
      schedule?.kind === "daily"
        ? schedule.time
        : schedule?.kind === "once"
          ? schedule.at.slice(11)
          : "09:00",
    days: schedule?.kind === "daily" ? schedule.days : [...WEEKDAYS],
    hours: schedule?.kind === "every" ? schedule.hours : 6,
    date: schedule?.kind === "once" ? schedule.at.slice(0, 10) : dayOf(1),
  };
};

/** The schedule a draft spells; null while it spells none (no day picked, no time). */
function scheduleOf(draft: Draft): RoutineSchedule | null {
  const timed = /^\d\d:\d\d$/.test(draft.time);
  if (draft.kind === "once")
    return timed && draft.date
      ? { kind: "once", at: `${draft.date} ${draft.time}` }
      : null;
  if (draft.kind === "daily")
    return draft.days.length && timed
      ? { kind: "daily", time: draft.time, days: draft.days }
      : null;
  return { kind: "every", hours: draft.hours };
}

/** One that starts once, at a moment already gone: the server refuses it too (routine.query). */
const isSpent = (schedule: RoutineSchedule | null) =>
  schedule?.kind === "once" && momentOf(schedule.at) <= new Date();

/** An hour from now, on the next five minutes: what "In an hour" sets. */
function inAnHour(): Pick<Draft, "date" | "time"> {
  const at = new Date(Date.now() + 3_600_000);
  at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5, 0, 0);
  return {
    date: dayOf(0, at),
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
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
/** The gaps between starts most routines want; another one, set by a call, shows beside them. */
const HOUR_STEPS = [1, 2, 3, 6, 12, 24].filter(
  (hours) => hours >= ROUTINE.minHours,
);

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
    schedule &&
    !isSpent(schedule) &&
    draft.label.trim() &&
    draft.bot &&
    draft.request.trim()
      ? {
          label: draft.label.trim(),
          bot: draft.bot,
          request: draft.request.trim(),
          schedule,
        }
      : null;

  /** One field of a routine that exists, written when it differs from what is kept. */
  const commit = (next: Partial<RoutineInput> & { enabled?: boolean }) => {
    if (saved) void update(saved.id, next).catch(() => {});
  };
  const commitSchedule = (next: Partial<Draft>) => {
    patch(next);
    const spelled = scheduleOf({ ...draft, ...next });
    if (!spelled || isSpent(spelled)) return;
    // Picking the moment of one that starts once sets it, whether or not it already ran
    commit({
      schedule: spelled,
      ...(spelled.kind === "once" ? { enabled: true } : {}),
    });
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
                    <div className="space-y-3.5">
                      <Segmented
                        aria-label="How it starts"
                        value={draft.kind}
                        onChange={(kind) => commitSchedule({ kind })}
                        options={[
                          { value: "once", label: "Once" },
                          { value: "daily", label: "On set days" },
                          { value: "every", label: "Every few hours" },
                        ]}
                      />
                      <div className="space-y-2.5">
                        {draft.kind === "once" ? (
                          <>
                            <WhenRow word="On">
                              <OnceDays
                                value={draft.date}
                                onPick={(date) => commitSchedule({ date })}
                              />
                            </WhenRow>
                            <WhenRow word="At">
                              <TimeField
                                value={draft.time}
                                onChange={(time) => patch({ time })}
                                onDone={() => commitSchedule({})}
                              />
                              <span className="text-[13px] text-muted-foreground">
                                or
                              </span>
                              <Pill
                                picked={false}
                                onClick={() => commitSchedule(inAnHour())}
                              >
                                In an hour
                              </Pill>
                            </WhenRow>
                          </>
                        ) : draft.kind === "daily" ? (
                          <>
                            <WhenRow word="On">
                              {WEEKDAYS.map((day) => {
                                const on = draft.days.includes(day);
                                return (
                                  <Pill
                                    key={day}
                                    picked={on}
                                    several
                                    aria-label={DAY_WORDS[day - 1]}
                                    onClick={() =>
                                      commitSchedule({
                                        days: on
                                          ? draft.days.filter(
                                              (one) => one !== day,
                                            )
                                          : [...draft.days, day].sort(
                                              (a, b) => a - b,
                                            ),
                                      })
                                    }
                                  >
                                    {DAY_SHORT[day - 1]}
                                  </Pill>
                                );
                              })}
                            </WhenRow>
                            {/* Shortcuts that fill the days: what is on is what the days show */}
                            <WhenRow>
                              {DAY_SETS.map((set) => (
                                <button
                                  key={set.label}
                                  type="button"
                                  onClick={() =>
                                    commitSchedule({ days: [...set.days] })
                                  }
                                  className="h-6.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                                >
                                  {set.label}
                                </button>
                              ))}
                            </WhenRow>
                            <WhenRow word="At">
                              <TimeField
                                value={draft.time}
                                onChange={(time) => patch({ time })}
                                onDone={() => commitSchedule({})}
                              />
                            </WhenRow>
                          </>
                        ) : (
                          <WhenRow word="Every">
                            {(HOUR_STEPS.includes(draft.hours)
                              ? HOUR_STEPS
                              : [...HOUR_STEPS, draft.hours].sort(
                                  (a, b) => a - b,
                                )
                            ).map((hours) => (
                              <Pill
                                key={hours}
                                picked={hours === draft.hours}
                                onClick={() => commitSchedule({ hours })}
                                className="min-w-10 px-3"
                              >
                                {hours}
                              </Pill>
                            ))}
                            <span className="text-[13px] text-muted-foreground">
                              hours
                            </span>
                          </WhenRow>
                        )}
                      </div>
                      <WhenSaid schedule={schedule} kind={draft.kind} />
                    </div>
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
    !schedule ? "a time" : isSpent(schedule) ? "a time still ahead" : null,
    draft.request.trim() ? null : "a job",
  ].filter((one): one is string => one !== null);
  return lacks.length > 1
    ? `${lacks.slice(0, -1).join(", ")} and ${lacks.at(-1)}`
    : (lacks[0] ?? "nothing");
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);

/**
 * One choice of the When field. What is picked is filled blue and what is not is a
 * hairline, as everywhere that something is picked, so no pill is left to read twice.
 * One of several that may all be picked (the days) is tinted with a tick instead, so a
 * week of them stays light (the user's pick).
 */
function Pill({
  picked,
  several = false,
  className,
  children,
  ...button
}: React.ComponentProps<"button"> & { picked: boolean; several?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        !picked &&
          "text-foreground ring-1 ring-border ring-inset hover:bg-muted",
        picked &&
          (several
            ? "bg-brand/10 pl-2.5 font-medium text-brand ring-1 ring-brand/30 ring-inset"
            : "bg-brand font-medium text-brand-foreground"),
        className,
      )}
      {...button}
    >
      {picked && several && <Check className="size-3.5" />}
      {children}
    </button>
  );
}

/** One question of the When field: its word in a column of its own, then the choices. */
function WhenRow({
  word,
  children,
}: {
  word?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-8 w-9 shrink-0 items-center text-[13px] text-muted-foreground">
        {word}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}

/** "Sun 21" for a day this week, "Fri, Oct 3" further out. */
function dayName(day: string): string {
  const at = momentOf(`${day} 00:00`);
  const days = (at.getTime() - momentOf(`${dayOf(0)} 00:00`).getTime()) / 864e5;
  return format(at, days < 7 ? "EEE d" : "EEE, MMM d");
}

/** Today, tomorrow and the two days after as pills; any other day from the calendar. */
function OnceDays({
  value,
  onPick,
}: {
  value: string;
  onPick: (day: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const near = [0, 1, 2, 3].map((ahead) => dayOf(ahead));
  const open = () => picker.current?.showPicker();
  return (
    <>
      {near.map((day, ahead) => (
        <Pill key={day} picked={day === value} onClick={() => onPick(day)}>
          {ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : dayName(day)}
        </Pill>
      ))}
      {!near.includes(value) && (
        <Pill picked onClick={open}>
          {dayName(value)}
        </Pill>
      )}
      {/* The browser's own calendar, opened from the pill it sits under */}
      <span className="relative">
        <Pill
          picked={false}
          aria-label="Another day"
          onClick={open}
          className="w-8 px-0"
        >
          <CalendarDays className="size-3.5" />
        </Pill>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          min={near[0]}
          value={value}
          onChange={(event) => event.target.value && onPick(event.target.value)}
          className="pointer-events-none absolute inset-0 opacity-0"
        />
      </span>
    </>
  );
}

/** A time of day, large, without the browser's clock glyph; a click opens its picker all the same. */
function TimeField({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (time: string) => void;
  onDone: () => void;
}) {
  return (
    <Input
      type="time"
      aria-label="Time of day"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onDone}
      onClick={(event) => event.currentTarget.showPicker?.()}
      className="h-8.5 w-28 px-3 text-[15px] tabular-nums md:text-[15px] [&::-webkit-calendar-picker-indicator]:hidden"
    />
  );
}

/** What was picked, said back in words: the check that the form was read right. */
function WhenSaid({
  schedule,
  kind,
}: {
  schedule: RoutineSchedule | null;
  kind: RoutineSchedule["kind"];
}) {
  if (!schedule || isSpent(schedule))
    return (
      <p className="text-xs text-destructive">
        {schedule
          ? "That time has passed. Pick a later one."
          : kind === "daily"
            ? "Pick a time and at least one day."
            : "Pick a time."}
      </p>
    );
  const first = nextRun(schedule, new Date());
  return (
    <p className="flex items-start gap-2 text-[13px] leading-5">
      <RoutineMark className="mt-0.75 size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        {scheduleText(schedule)}
        <span className="text-muted-foreground">
          {" · "}
          {schedule.kind === "once"
            ? `${formatDistanceToNowStrict(first, { addSuffix: true })}, then it switches itself off`
            : `first start ${whenOf(first)}`}
        </span>
      </span>
    </p>
  );
}

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
