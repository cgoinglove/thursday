"use client";

import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Copy,
  History,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { FoldedText } from "@/components/ui/folded-text";
import { Markdown } from "@/components/ui/markdown";
import ShinyText from "@/components/ui/shiny-text";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { BOT_RUN } from "@/config";
import { markReportedAction, startTaskAction } from "@/features/bot/bot.action";
import {
  type Bot,
  DEFAULT_BOT,
  isBudgetAsk,
  TASK_CONTINUE,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoster } from "@/features/bot/components/bot-roster";
import { PathChips } from "@/features/bot/components/path-chips";
import { TaskReply, useAnswerTask } from "@/features/bot/components/task-reply";
import { openSettings } from "@/features/settings/settings.store";
import { FileViewer } from "@/features/workspace/components/file-view";
import { shortAgo, toDate } from "@/lib/date-like";
import { unwrapResult } from "@/lib/protocol/result";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import {
  cn,
  errorToString,
  formatCount,
  plainText,
  WAITING_INK,
} from "@/lib/utils";
import { MARK_PALETTE, MARK_SHAPES } from "../mark.const";
import {
  type BotRef,
  botTasks,
  type Chatter,
  type ChatterGroup,
  isOutcome,
  lastSaid,
  latestPerBot,
  rosterOf,
  type TaskView,
  type TaskViewStatus,
  threadItems,
  useBotTasks,
} from "../task.store";
import { BotTool } from "./bot-tool";

/**
 * The task room and inbox in the corner of the call screen: what is running, what is
 * asking, and what just finished (bot.query listInboxTasks). It only projects server
 * state.
 *
 * Folded, it is not a badge you have to open. Anything waiting on an answer is drawn
 * on the chip itself, with its buttons, and anything that merely happened borrows the
 * chip's one sentence for three seconds (useBeats). Opening the room is for reading a
 * thread, never for answering — a chevron that reveals the rows would put a click in
 * front of the one thing this corner exists to remove.
 *
 * memo: the parent re-renders per transcript chunk and this reads only its store.
 */
export const BotRoom = memo(function BotRoom() {
  const tasks = useBotTasks();
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const [open, setOpen] = useState(false);
  /** Open thread; null shows the list. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Writing a new job, folded or in the room. */
  const [composing, setComposing] = useState(false);

  const newest = [...tasks].reverse();
  const current = picked
    ? (newest.find((entry) => entry.id === picked) ?? null)
    : null;

  const [beat, announce] = useBeats();

  // What each task was, and what each bot last said, at the previous sync. Only
  // changes since then are announced.
  const known = useRef<Map<string, TaskViewStatus> | null>(null);
  const said = useRef(new Map<string, string>());

  useEffect(() => {
    if (!botTasks.primed()) return;
    const now = new Map(newest.map((entry) => [entry.id, entry.status]));
    const was = known.current;
    known.current = now;

    const lines = new Map<string, string>();
    for (const entry of latestPerBot(tasks)) {
      if (entry.line) lines.set(entry.bot.name, entry.line.id);
    }
    const heard = said.current;
    said.current = lines;

    // The first list only seeds the two maps: nothing on it just happened.
    if (!was) return;

    // A bot holds one seat in the queue, so the last push for a bot wins. Steps
    // go first and a change of status overwrites them: that a job stopped to ask
    // outranks whatever tool it called on the way there.
    for (const entry of latestPerBot(tasks)) {
      if (entry.task.status !== "working") continue;
      const at = entry.line?.id;
      if (!at || heard.get(entry.bot.name) === at) continue;
      announce({
        bot: entry.bot.name,
        label: entry.task.label,
        what: secondLine(entry.task).text,
        live: true,
      });
    }

    for (const task of newest) {
      const before = was.get(task.id);
      if (before === task.status) continue;
      // First seen already finished — polling skipped the whole run. Say it only
      // if nobody has heard it yet.
      if (before === undefined && task.status !== "working" && task.relayed) {
        continue;
      }
      announce({
        bot: task.bot.name,
        label: task.label,
        ...beatFor(task, before === undefined),
      });
    }
  }, [tasks, announce]);

  // Opening a finished thread marks it reported. The key includes updatedAt: a
  // follow-up request finishes again and that result is unread. markReported does not
  // move `updatedAt`, so the set only bridges the gap until the next poll.
  const marked = useRef(new Set<string>());
  useEffect(() => {
    if (!current || current.relayed) return;
    if (current.status !== "done" && current.status !== "failed") return;
    const key = `${current.id}@${toDate(current.updatedAt).getTime()}`;
    if (marked.current.has(key)) return;
    marked.current.add(key);
    // unwrapResult folds Result failures and rejections into one path; on failure
    // release the key so the task can be marked again.
    void markReportedAction([current.id])
      .then(unwrapResult)
      .then(() => revalidate(queryKey.tasks))
      .catch((cause) => {
        marked.current.delete(key);
        toast.add({
          type: "error",
          title: "Could not mark the task as read",
          description: errorToString(cause),
        });
      });
  }, [current]);

  const busy = tasks.filter((entry) => entry.status === "working").length;
  const attention = newest.filter(needsYou);
  const pending = attention.length;
  // Bots with a task waiting on the user; the chip shows them in front.
  const waiting = attention
    .map((entry) => entry.bot)
    .filter(
      (bot, at, all) =>
        all.findIndex((other) => other.name === bot.name) === at,
    );

  const closeCompose = useCallback(() => setComposing(false), []);

  return (
    <div className="pointer-events-none absolute right-5 bottom-5 z-10 flex w-132 max-w-[calc(100vw-2.5rem)] flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto flex max-h-[min(44rem,78vh)] w-full animate-in flex-col overflow-hidden rounded-3xl bg-background/75 shadow-2xl shadow-black/6 ring-1 ring-border/50 backdrop-blur-xl fade-in slide-in-from-bottom-1 duration-200">
          {current ? (
            <>
              <ThreadHeader
                task={current}
                onBack={() => setPicked(null)}
                onClose={() => setOpen(false)}
              />
              <Conversation task={current} className="min-h-0 flex-1" />
              <TaskReply
                task={{
                  id: current.id,
                  label: current.label,
                  bot: current.bot.name,
                  ask: askFor(current),
                }}
                status={
                  current.status === "working" ? "running" : current.status
                }
                lines={current.lines}
                className="mx-3 mb-2 shrink-0"
              />
            </>
          ) : (
            <>
              <ListHeader
                count={tasks.length}
                pending={pending}
                composing={composing}
                onCompose={() => setComposing(true)}
                onClose={() =>
                  composing ? setComposing(false) : setOpen(false)
                }
              />
              {composing ? (
                <Compose bots={bots} onDone={closeCompose} />
              ) : newest.length ? (
                <TaskList tasks={newest} onPick={setPicked} />
              ) : (
                <Empty bots={bots} />
              )}
              {!composing && <Footer />}
            </>
          )}
        </div>
      ) : (
        <Chip
          bots={bots}
          rows={attention}
          waiting={waiting}
          count={tasks.length}
          busy={busy}
          pending={pending}
          beat={beat}
          composing={composing}
          onCompose={() => setComposing(true)}
          onCloseCompose={closeCompose}
          onPick={(id) => {
            setPicked(id);
            setOpen(true);
          }}
          onOpen={() => {
            // A single waiting task opens straight into its thread.
            if (!picked && attention.length === 1) setPicked(attention[0].id);
            setOpen(true);
          }}
        />
      )}
    </div>
  );
});

/** How long one announcement holds the chip's sentence, ms. */
const BEAT_MS = 3000;
/** The sentence goes back to rest between two of them, so they never blur into one. */
const BEAT_GAP_MS = 260;

/**
 * What the chip is saying for a moment: who moved, on what, and what they did.
 * `live` is the difference between a step and an ending — a step is still going
 * while the sentence is up, so it shines; "finished" does not.
 */
type Beat = {
  bot: string;
  label: string;
  what: string;
  tone?: string;
  live?: boolean;
};

/**
 * The one queue anything announces itself through.
 *
 * A beat holds the sentence for BEAT_MS and they play one at a time, so a busy
 * minute reads as a list rather than a flicker. **A bot holds one seat**: a second
 * beat from the same bot overwrites its place instead of joining the back of the
 * queue, so three bots stepping at once still take turns and the newest thing a
 * given bot did is the one you see.
 */
function useBeats() {
  const [now, setNow] = useState<Beat | null>(null);
  const queue = useRef<Beat[]>([]);
  const holding = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  // Held in a ref because it calls itself to drain the queue.
  const pump = useRef(() => {});
  pump.current = () => {
    if (holding.current) return;
    const next = queue.current.shift();
    if (!next) return;
    holding.current = true;
    setNow(next);
    timers.current.push(
      setTimeout(() => {
        setNow(null);
        timers.current.push(
          setTimeout(() => {
            holding.current = false;
            pump.current();
          }, BEAT_GAP_MS),
        );
      }, BEAT_MS),
    );
  };

  const announce = useCallback((beat: Beat) => {
    const at = queue.current.findIndex((one) => one.bot === beat.bot);
    if (at >= 0) queue.current[at] = beat;
    else queue.current.push(beat);
    pump.current();
  }, []);

  return [now, announce] as const;
}

/**
 * What a change of status says. Budget stops are worded apart from questions so a
 * job that is really blocked is not buried among them (bot.schema isBudgetAsk).
 */
function beatFor(
  task: TaskView,
  first: boolean,
): Pick<Beat, "what" | "tone" | "live"> {
  const who = task.bot.name;
  if (task.status === "working") {
    return {
      what: first ? `${who} took this on` : `${who} picked it back up`,
      live: true,
    };
  }
  if (task.status === "waiting") {
    return isBudgetAsk(task.ask)
      ? { what: `${who} is out of steps` }
      : {
          what: `${who} is asking`,
          tone: WAITING_INK,
        };
  }
  return task.status === "failed"
    ? { what: `${who} could not finish`, tone: "text-destructive" }
    : { what: `${who} finished` };
}

/** Blanks the question in the reply box when it already is the last thread line (budget stops). */
function askFor(task: TaskView): TaskView["ask"] {
  if (!task.ask?.question) return task.ask;
  const last = task.lines.at(-1);
  return last && isOutcome(last) && last.text === task.ask.question
    ? { ...task.ask, question: "" }
    : task.ask;
}

/**
 * A task that cannot move until the user answers: a question, or a budget stop.
 *
 * A finished job is not on this list. It has nothing for the user to do, and
 * counting it here made the chip hold itself open over a report nobody had to
 * act on. A report says itself once, in the sentence, and then it is a row in
 * the room like every other one.
 */
const needsYou = (task: TaskView) => task.status === "waiting";

/** What the chip says when nothing just happened, most urgent first. */
function restingState({
  count,
  busy,
  pending,
}: {
  count: number;
  busy: number;
  pending: number;
}): { text: string; tone?: string; shine?: "amber" | "muted" } {
  if (pending > 0)
    return {
      text: pending === 1 ? "waiting on you" : `${pending} waiting on you`,
      tone: WAITING_INK,
      shine: "amber",
    };
  if (busy > 0)
    return {
      text: busy === 1 ? "working" : `${busy} running`,
      tone: "text-muted-foreground",
      shine: "muted",
    };
  if (count > 0) return { text: "all done", tone: "text-muted-foreground" };
  return { text: "no jobs yet", tone: "text-muted-foreground" };
}

/**
 * The room folded into one object in the corner.
 *
 * Two parts, and they are one object: a pill that always says what is true right
 * now, and — while something is actually waiting on an answer — the rows for it,
 * grown in place above the pill. Nothing here sits behind a disclosure. The rows
 * appear because there is something to answer and leave when it is answered; a
 * chevron that revealed them would put a click in front of the one thing this
 * corner exists to remove. The pill's own click opens the room, to read.
 *
 * The corner radius does not animate with the height: interpolating a pill radius
 * down to a card radius while the box is also resizing warps the corners in flight.
 */
function Chip({
  bots,
  rows,
  waiting,
  count,
  busy,
  pending,
  beat,
  composing,
  onCompose,
  onCloseCompose,
  onPick,
  onOpen,
}: {
  bots?: Bot[];
  /** Everything waiting on an answer, newest first. */
  rows: TaskView[];
  waiting: BotRef[];
  count: number;
  busy: number;
  pending: number;
  beat: Beat | null;
  composing: boolean;
  onCompose: () => void;
  onCloseCompose: () => void;
  onPick: (id: string) => void;
  onOpen: () => void;
}) {
  const state = restingState({ count, busy, pending });
  const grown = composing || pending > 0;

  return (
    <div
      className={cn(
        "pointer-events-auto w-fit max-w-full overflow-hidden bg-background/78 ring-1 ring-border/50 backdrop-blur-md transition-shadow duration-300",
        grown
          ? "min-w-96 rounded-3xl shadow-lg shadow-black/8"
          : "rounded-full shadow-sm shadow-black/3",
      )}
    >
      {/* One box, two heights: the rows grow out of nothing rather than appearing. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          grown ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* Collapsed, this is still in the tree so the height can animate — inert
            keeps it out of the tab order and out of the way of a click. */}
        <div className="min-h-0 overflow-hidden" inert={!grown}>
          {composing ? (
            <Compose bots={bots} onDone={onCloseCompose} />
          ) : (
            <>
              <p className="flex items-center gap-2 px-3 py-2 font-mono text-[10px] tracking-wide text-muted-foreground">
                <span className="flex-1">needs you · {pending}</span>
                <ComposeButton onClick={onCompose} />
              </p>
              {/* px-1: a row keeps its own 8px, so its mark lands on the rail while
                  the shape it lights up on hover stays inside the card's corners */}
              <div className="px-1.5 pb-2">
                {rows.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onPick={() => onPick(task.id)}
                  />
                ))}
              </div>
              <span className="block h-1.5" />
            </>
          )}
        </div>
      </div>

      {/* The pill row. Same geometry either way, so the card shrinks into it. */}
      {/* px-3 is the chip's one rail: the faces here, the section line and every
          row's mark all start at 12px, and the trailing glyph ends at 12px — which
          is why a resting glyph carries no box. A box would centre it and leave
          its ink 5px short of the rail the faces start on. Rows reach the same rail
          as their own 8px inside a 4px list. */}
      <div className={cn("flex items-center gap-2 px-3 py-1.5")}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={count ? `Tasks (${count})` : "Bots"}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Faces bots={bots} waiting={waiting} only={beat?.bot} />

          {/* One slot, two things in it: what is true, and what just happened. */}
          <span className="flex h-7 min-w-0 flex-1 items-center">
            <Lane on={!!beat}>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                  {beat?.label}
                </span>
                {beat?.live ? (
                  <ShinyText
                    text={beat.what}
                    speed={2.4}
                    color="var(--muted-foreground)"
                    shineColor="var(--foreground)"
                    className="min-w-0 truncate text-[14px] leading-5 tracking-[-0.15px]"
                  />
                ) : (
                  <span
                    className={cn(
                      "min-w-0 truncate text-[14px] leading-5 tracking-[-0.15px]",
                      beat?.tone ?? "text-foreground",
                    )}
                  >
                    {beat?.what}
                  </span>
                )}
              </span>
            </Lane>
            <Lane on={!beat}>
              {state.shine ? (
                // Neither waiting nor running is a state at rest: one is held open
                // towards you, the other is moving. Slowly lit text says both better
                // than a glyph does. The colours are classes because they differ per
                // theme, and ShinyText reads the variables they set.
                <span
                  className={cn(
                    "block",
                    state.shine === "amber"
                      ? "[--rest:var(--color-amber-700)] [--shine:var(--color-amber-400)] dark:[--rest:var(--color-amber-400)] dark:[--shine:var(--color-amber-100)]"
                      : "[--rest:var(--muted-foreground)] [--shine:var(--foreground)]",
                  )}
                >
                  <ShinyText
                    text={state.text}
                    speed={2.6}
                    color="var(--rest)"
                    shineColor="var(--shine)"
                    className="truncate text-[14px] leading-5 tracking-[-0.15px]"
                  />
                </span>
              ) : (
                <span
                  key={state.text}
                  className={cn(
                    "block animate-in truncate text-[14px] leading-5 tracking-[-0.15px] fade-in duration-300",
                    state.tone,
                  )}
                >
                  {state.text}
                </span>
              )}
            </Lane>
          </span>
        </button>

        {composing && (
          <RoundButton onClick={onCloseCompose} label="Cancel the message">
            <X className="size-3.5" />
          </RoundButton>
        )}
        {!composing && pending === 0 && busy > 0 && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground/70" />
        )}
        {!composing && pending === 0 && busy === 0 && count > 0 && (
          <Check className="size-4 shrink-0 text-muted-foreground/60" />
        )}
      </div>
    </div>
  );
}

/**
 * Two things sharing one line: the one that is on takes the width and the other
 * folds to nothing. Both stay mounted, so the swap is a slide and not a jump.
 */
function Lane({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        // The width is the only thing that moves, and it moves fast: at half a
        // second the letters arrive one by one and it reads as typing.
        "grid min-w-0 transition-[grid-template-columns,opacity] duration-200 ease-out",
        on ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
      )}
    >
      <span className="min-w-0 overflow-hidden">{children}</span>
    </span>
  );
}

/** Starts a job. Lives in the header of whichever list is on screen. */
function ComposeButton({ onClick }: { onClick: () => void }) {
  return (
    <RoundButton onClick={onClick} label="Message a bot">
      <Plus className="size-4" />
    </RoundButton>
  );
}

function RoundButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

/**
 * Handing a bot a job without the call in the room: pick one, write, send
 * (bot.action startTaskAction). The message is the whole request — there is no
 * conversation to draw the rest from, which is why the box asks for a sentence.
 *
 * Nothing announces itself from here. The job shows up as a row on the next poll
 * and the chip says the bot took it on, exactly as a delegated one does.
 */
function Compose({ bots, onDone }: { bots?: Bot[]; onDone: () => void }) {
  const [picked, setPicked] = useState<BotRef | null>(null);
  const [draft, setDraft] = useState("");
  const [start, starting] = useServerAction(startTaskAction, {
    onOk: () => {
      revalidate(queryKey.tasks);
      onDone();
    },
  });

  // A fresh install has no rows and still has a worker (bot.schema DEFAULT_BOT).
  const roster: BotRef[] = bots?.length
    ? bots.map((bot) => ({ name: bot.name, icon: bot.icon }))
    : [{ name: DEFAULT_BOT.name, icon: DEFAULT_BOT.icon }];

  const send = () => {
    if (!picked || !draft.trim() || starting) return;
    start(picked.name, draft.trim());
  };

  // The picker holds three rows' worth of height whatever the roster has in it:
  // one row reads as a slot rather than a choice, and the panel must not resize
  // the day a second bot exists. The writing step keeps the same floor.
  if (!picked) {
    return (
      <div className="min-h-32 pb-3">
        <p className="px-3 pt-3 pb-1.5 font-mono text-[10px] tracking-wide text-muted-foreground">
          message a bot
        </p>
        <div className="px-1">
          {roster.map((bot) => (
            <button
              key={bot.name}
              type="button"
              onClick={() => setPicked(bot)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <BotMark
                size={22}
                seed={bot.name}
                vary={bot.name}
                color={bot.icon?.color}
                shape={bot.icon?.shape}
                outline={bot.icon?.outline}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {bot.name}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    // Holds roughly the height the picker had, so choosing a bot does not snap the
    // panel shut to one line and back open on the way back.
    <div className="flex min-h-32 flex-col pb-3">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={() => setPicked(null)}
          aria-label="Choose a different bot"
          className="grid size-6 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <BotMark
          size={22}
          seed={picked.name}
          vary={picked.name}
          color={picked.icon?.color}
          shape={picked.icon?.shape}
          outline={picked.icon?.outline}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
          To {picked.name}
        </span>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="mx-3 mt-auto flex items-end gap-1 rounded-2xl bg-background py-2 pr-2 pl-3 ring-1 ring-border/80 transition-shadow focus-within:ring-ring/60"
      >
        <Textarea
          value={draft}
          rows={1}
          autoFocus
          disabled={starting}
          onChange={(event) => setDraft(event.target.value)}
          // During IME composition Enter confirms the character, not the message
          // (keyCode 229 for browsers without isComposing).
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            send();
          }}
          placeholder={`What should ${picked.name} do? It cannot hear the call, so say the whole job.`}
          aria-label={`Message for ${picked.name}`}
          className="max-h-32 min-h-15 flex-1 resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon-sm"
          variant={draft.trim() ? "default" : "ghost"}
          disabled={!draft.trim() || starting}
          aria-label="Send"
          className="rounded-full"
        >
          {starting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}

/** Stand-in faces for an install with no bots. Fixed, not random: this renders on the server too and Math.random would break hydration. */
const GHOSTS = ["alto", "brio", "cinder", "delta"].map((seed, index) => ({
  key: seed,
  seed,
  color: MARK_PALETTE[Math.floor((index * MARK_PALETTE.length) / 4)],
  shape: MARK_SHAPES[index % MARK_SHAPES.length],
  outline: undefined as boolean | undefined,
}));

/** A single face reads as one worker, not as a crew; below this the row is padded out. */
const CREW = 3;

/** The crew stacked behind each other; GHOSTS stand in when there are no bots. */
function Faces({
  bots,
  waiting = [],
  only,
}: {
  bots?: Bot[];
  waiting?: BotRef[];
  /** While one bot is speaking the crowd narrows to it, then fans back out. */
  only?: string;
}) {
  // Faces with a task waiting go in front and are the only ones with the dot.
  const roster = bots?.length
    ? bots.map((bot) => ({
        key: bot.name,
        seed: bot.name,
        color: bot.icon?.color,
        shape: bot.icon?.shape,
        outline: bot.icon?.outline,
        notify: false,
      }))
    : GHOSTS.map((ghost) => ({ ...ghost, notify: false }));

  const front = waiting.map((bot) => ({
    key: bot.name,
    seed: bot.name,
    color: bot.icon?.color,
    shape: bot.icon?.shape,
    outline: bot.icon?.outline,
    notify: true,
  }));

  // A fresh install has one worker (DEFAULT_BOT) and one silhouette says "one bot",
  // which is the wrong thing to say about a room. Stand-ins fill the row out to CREW
  // and are dimmed with it, so the corner reads as a crew before it holds one.
  const named = [
    ...front,
    ...roster.filter((face) => !front.some((one) => one.key === face.key)),
  ].map((face) => ({ ...face, standIn: false }));
  const filler = GHOSTS.filter(
    (ghost) => !named.some((face) => face.key === ghost.key),
  )
    .slice(0, Math.max(0, CREW - named.length))
    .map((ghost) => ({ ...ghost, notify: false, standIn: true }));
  const crew = [...named, ...filler].slice(0, 4);

  return (
    <span
      className={cn(
        "flex shrink-0 items-center",
        !bots?.length && !front.length && "opacity-50",
      )}
    >
      {crew.map((face, index) => (
        <span
          key={face.key}
          // Silhouettes overlapped, never ringed: a ring needs a circle and these
          // are not circles. One speaking bot pulls the rest in behind it.
          className={cn(
            "origin-right transition-[margin,opacity,transform] duration-300 ease-out",
            index > 0 && "-ml-2",
            face.standIn && "opacity-35",
            only && face.key !== only && "-ml-[28px] scale-50 opacity-0",
          )}
          style={{ zIndex: crew.length - index }}
        >
          <BotMark
            size={28}
            seed={face.seed}
            vary={face.seed}
            color={face.color}
            shape={face.shape}
            outline={face.outline}
            notify={face.notify}
          />
        </span>
      ))}
    </span>
  );
}

/**
 * Folds the room; shared by both headers. An X on its own filled circle, not a
 * chevron: in the thread header it sits a few pixels from the back arrow, and two
 * chevrons that differ only by rotation read as the same button twice. The fill is
 * always on rather than on hover, so it is found before the pointer gets there.
 */
function FoldButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Fold the room away"
      className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-foreground outline-none transition-colors hover:bg-muted-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <X className="size-3.5" />
    </button>
  );
}

function ListHeader({
  count,
  pending,
  composing,
  onCompose,
  onClose,
}: {
  count: number;
  pending: number;
  composing: boolean;
  onCompose: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
      <span className="text-[13px] font-medium">Tasks</span>
      {count > 0 && !composing && (
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {pending > 0 ? `${pending} for you · ${count}` : count}
        </span>
      )}
      <span className="flex-1" />
      {/* Same rule as the chip: whichever list is on screen carries the "+". */}
      {!composing && <ComposeButton onClick={onCompose} />}
      <FoldButton onClick={onClose} />
    </div>
  );
}

function ThreadHeader({
  task,
  onBack,
  onClose,
}: {
  task: TaskView;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to the list"
        className="shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft className="size-4" />
      </button>
      <BotMark
        size={22}
        seed={task.bot.name}
        vary={task.id}
        color={task.bot.icon?.color}
        shape={task.bot.icon?.shape}
        outline={task.bot.icon?.outline}
        notify={false}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {task.label}
        <span
          title={task.id}
          className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground/60"
        >
          {task.id.slice(0, 8)}
        </span>
      </span>
      <Tokens usage={task.tokens} />
      <Context task={task} />
      <State task={task} />
      <FoldButton onClick={onClose} />
    </div>
  );
}

/** Tokens this task has used: the total shown, the split in the title. */
function Tokens({ usage }: { usage: TaskView["tokens"] }) {
  const total = usage.input + usage.output;
  if (!total) return null;
  return (
    <span
      title={`in ${formatCount(usage.input)} · out ${formatCount(usage.output)}`}
      className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums"
    >
      {formatCount(total)}
    </span>
  );
}

/** Context fill of the last step, not the running total. At the budget the bot compacts (bot.run compact) and the bar drops. */
function Context({ task }: { task: TaskView }) {
  const { contextTokens: used, contextBudget: budget } = task;
  if (!used || !budget) return null;
  const full = Math.min(1, used / budget);

  return (
    <span
      title={`Context ${formatCount(used)} of ${formatCount(budget)} — it summarizes itself here`}
      className="block h-[3px] w-9 shrink-0 overflow-hidden rounded-full bg-muted"
    >
      <span
        className={cn(
          "block h-full rounded-full",
          full > 0.9 ? "bg-amber-500/80" : "bg-muted-foreground/70",
        )}
        style={{ width: `${Math.max(4, Math.round(full * 100))}%` }}
      />
    </span>
  );
}

/** Only waiting (amber) and failed (red) carry colour. */
const STATE_LOOK: Record<TaskViewStatus, string> = {
  working: "text-muted-foreground",
  waiting: WAITING_INK,
  done: "text-foreground",
  failed: "text-destructive",
};

function State({ task }: { task: TaskView }) {
  const look =
    task.status === "done" && task.relayed
      ? "text-muted-foreground"
      : STATE_LOOK[task.status];

  if (task.status === "working") {
    return (
      <ShinyText
        text="working"
        speed={2.2}
        color="var(--muted-foreground)"
        shineColor="var(--foreground)"
        className="shrink-0 font-mono text-[10px]"
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-[10px]",
        look,
      )}
    >
      {task.status}
    </span>
  );
}

function Empty({ bots }: { bots?: Bot[] }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-3 pb-4 text-center">
      <Faces bots={bots} />
      {bots?.length ? (
        <p className="text-[12px] text-muted-foreground">
          Nothing handed over yet — ask for something that takes a while.
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Thursday hands work to {DEFAULT_BOT.name} until you make bots of your
          own in Settings › Bots.
        </p>
      )}
    </div>
  );
}

/** Link to the full task history in Settings; the inbox only holds recent tasks. */
function Footer() {
  return (
    <div className="flex shrink-0 justify-end px-3 pb-2.5">
      <button
        type="button"
        onClick={() => openSettings("tasks")}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <History className="size-3" />
        History
      </button>
    </div>
  );
}

/** List sections in order, split by what a task asks of the user rather than by status. First match wins. */
const GROUPS: {
  id: string;
  label: string;
  holds: (task: TaskView) => boolean;
}[] = [
  { id: "you", label: "needs you", holds: needsYou },
  {
    id: "working",
    label: "working",
    holds: (task) => task.status === "working",
  },
  { id: "done", label: "done", holds: () => true },
];

function TaskList({
  tasks,
  onPick,
}: {
  tasks: TaskView[];
  onPick: (id: string) => void;
}) {
  const bucket = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const group = GROUPS.find((one) => one.holds(task)) ?? GROUPS[2];
    const rows = bucket.get(group.id);
    if (rows) rows.push(task);
    else bucket.set(group.id, [task]);
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
            {rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onPick={() => onPick(task.id)}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

function TaskRow({ task, onPick }: { task: TaskView; onPick: () => void }) {
  const attention = needsYou(task);
  // secondLine runs plainText over the whole report. Every sync rebuilds each TaskView
  // (task.store), so depend on the fields that change the line, not on `task`.
  const last = task.lines.at(-1);
  const line = useMemo(
    () => secondLine(task),
    [task.status, task.outcome, task.relayed, task.ask, last?.id],
  );
  const [answer, answering] = useAnswerTask();
  const [sending, setSending] = useState<string | null>(null);
  // Options are answered inline, without opening the thread.
  const options = task.status === "waiting" ? (task.ask?.options ?? []) : [];
  const budget = isBudgetAsk(task.ask);

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
          title={task.bot.name}
        >
          <BotMark
            size={32}
            seed={task.bot.name}
            vary={task.id}
            color={task.bot.icon?.color}
            shape={task.bot.icon?.shape}
            outline={task.bot.icon?.outline}
            state={task.status === "working" ? "thinking" : "idle"}
            notify={attention}
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-[14px] leading-5 tracking-[-0.15px]",
                attention ? "text-foreground" : "text-foreground/80",
              )}
            >
              {task.label}
            </span>
            <BotRoster bots={rosterOf(task)} taskId={task.id} />
            <span className="flex-1" />
            <span className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground/70 tabular-nums">
              {shortAgo(task.updatedAt)}
            </span>
          </span>
          <span className="mt-px flex h-4 items-center gap-1.5">
            {task.status === "working" && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" />
            )}
            {/* Anything still moving says so by shining, here as in the thread
                (bot-tool) and the pill (Folded). */}
            {task.status === "working" ? (
              <ShinyText
                text={line.text}
                speed={2.2}
                color="var(--muted-foreground)"
                shineColor="var(--foreground)"
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] leading-4",
                  line.tone,
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
                await answer(task, option);
                setSending(null);
              }}
              className={cn(
                "h-7 gap-1.5 rounded-full bg-background px-3 text-[12px]",
                // A budget stop is not a question, so it does not take the waiting colour.
                !budget && "border-amber-500/35",
              )}
            >
              {budget && option === TASK_CONTINUE && (
                <ChevronsRight className="size-3.5 text-muted-foreground" />
              )}
              {option}
              {budget && option === TASK_CONTINUE && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  +{BOT_RUN.steps} steps
                </span>
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Second row of a task line: the question, the outcome, or the bot's last step. */
function secondLine(task: TaskView): { text: string; tone: string } {
  if (task.status === "waiting" && task.ask) {
    // Budget stops are not questions; keep them out of the waiting colour.
    if (isBudgetAsk(task.ask)) {
      return {
        text: plainText(task.outcome ?? task.ask.question),
        tone: "text-muted-foreground",
      };
    }
    return {
      text: task.ask.question,
      tone: WAITING_INK,
    };
  }
  // Reports are markdown; keep only the text.
  if (task.status === "failed") {
    return {
      text: plainText(task.outcome ?? "Failed"),
      tone: "text-destructive",
    };
  }
  if (task.status === "done") {
    return {
      text: plainText(task.outcome ?? "Done"),
      tone: task.relayed ? "text-muted-foreground" : "text-foreground",
    };
  }
  const last = lastSaid(task);
  if (!last) {
    return {
      text: `${task.bot.name} is taking it on…`,
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

/** A task's whole thread. Follows the newest line while the reader is at the bottom. Also used by the Tasks settings screen. */
export function Conversation({
  task,
  className,
}: {
  task: TaskView;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  // A different task starts at its own end.
  useEffect(() => {
    following.current = true;
  }, [task.id]);

  useEffect(() => {
    const box = scroller.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [task.lines, task.status]);

  return (
    // One FileViewer per conversation, not per bubble.
    <FileViewer>
      <div
        ref={scroller}
        onScroll={(event) => {
          const box = event.currentTarget;
          following.current =
            box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        }}
        className={cn(
          "max-h-[64vh] space-y-3 overflow-y-auto px-4 pt-6 pb-4 mask-[linear-gradient(to_bottom,transparent,black_2rem)] scrollbar-none",
          className,
        )}
      >
        <Request task={task} />
        {threadItems(task).map((item) =>
          item.kind === "invite" ? (
            <Invite key={item.key} from={item.from} to={item.to} />
          ) : (
            <Group key={item.key} group={item.group} task={task} />
          ),
        )}
        {task.status === "working" && task.lines.length === 0 && (
          <ShinyText
            text={`${task.bot.name} is taking it on…`}
            speed={2.2}
            color="var(--muted-foreground)"
            shineColor="var(--foreground)"
            className="block px-1 font-mono text-[10px]"
          />
        )}
      </div>
    </FileViewer>
  );
}

/** The delegated request, folded to three lines (FoldedText). */
function Request({ task }: { task: TaskView }) {
  return (
    <>
      <Invite from={THURSDAY} to={task.bot} />
      <FromThursday>
        <Bubble align="end" className="max-w-full">
          <BubbleContent className="rounded-tr-md py-2 pr-2 pl-3.5">
            <FoldedText text={task.request} subject="request" />
          </BubbleContent>
        </Bubble>
      </FromThursday>
    </>
  );
}

/** Thursday's own face; she is not a bot and has no row to read one from. */
const THURSDAY: BotRef = { name: "Thursday" };

/**
 * A bot joining the room. It is not a message — nobody said it — so it takes no
 * side and wears no bubble: a centred line, the way a chat room announces one.
 */
function Invite({ from, to }: { from: BotRef; to: BotRef }) {
  return (
    <div className="flex animate-in justify-center fade-in duration-300">
      <span className="flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
        <Face bot={from} />
        <span className="shrink-0 text-muted-foreground/70">invited</span>
        <Face bot={to} />
      </span>
    </div>
  );
}

/** One name behind its own face, so the line reads as a sentence. */
function Face({ bot }: { bot: BotRef }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <BotMark
        size={15}
        seed={bot.name}
        color={bot.icon?.color}
        shape={bot.icon?.shape}
        outline={bot.icon?.outline}
        notify={false}
        className="shrink-0"
      />
      <span className="truncate">{bot.name}</span>
    </span>
  );
}

/** Thursday's side of the thread: the request, and any answer she carried back. */
function FromThursday({ children }: { children: ReactNode }) {
  return (
    <Turn
      side="end"
      name="Thursday"
      mark={
        <BotMark
          size={26}
          seed="thursday"
          notify={false}
          className="mt-1 shrink-0"
        />
      }
    >
      {children}
    </Turn>
  );
}

/**
 * One speaker's turn. The room belongs to the task's own bot, so it holds the
 * left; everyone it is talking to — Thursday, and any bot it delegated to —
 * answers from the right.
 */
function Turn({
  side,
  mark,
  name,
  children,
}: {
  side: "start" | "end";
  mark: ReactNode;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex gap-2.5", side === "end" && "flex-row-reverse")}>
      {mark}
      {/* One cap on the turn's column, not one per block inside it: a report and
          a one-line remark from the same bot then end on the same edge. The
          answering side hugs that edge, so the two sides face each other. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5 [&>*+*]:max-w-[80%]",
          side === "end" && "items-end",
        )}
      >
        <p className="max-w-[80%] truncate px-1 font-mono text-[10px] text-muted-foreground">
          {name}
        </p>
        {children}
      </div>
    </div>
  );
}

function Group({ group, task }: { group: ChatterGroup; task: TaskView }) {
  // User lines (answers, follow-ups) render on Thursday's side.
  if (group.lines[0]?.kind === "user") {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        <FromThursday>
          {group.lines.map((line) => (
            <Bubble key={line.id} align="end" className="max-w-full">
              <BubbleContent className="rounded-tr-md px-3.5 text-[13px] leading-snug break-keep">
                {line.text}
              </BubbleContent>
            </Bubble>
          ))}
        </FromThursday>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Turn
        side={group.bot.name === task.bot.name ? "start" : "end"}
        name={group.bot.name}
        mark={
          <BotMark
            size={26}
            seed={group.bot.name}
            vary={task.id}
            color={group.bot.icon?.color}
            shape={group.bot.icon?.shape}
            outline={group.bot.icon?.outline}
            notify={false}
            className="mt-1 shrink-0"
          />
        }
      >
        {runs(group.lines).map((run) =>
          run.kind === "tools" ? (
            <Steps key={run.key} lines={run.lines} taskId={task.id} />
          ) : (
            run.lines.map((line) => (
              <Line key={line.id} line={line} taskId={task.id} />
            ))
          ),
        )}
      </Turn>
    </div>
  );
}

function Line({ line, taskId }: { line: Chatter; taskId: string }) {
  // Consecutive tool calls are grouped in Steps; a lone one lands here.
  if (line.kind === "tool" && line.tool) {
    return <BotTool tool={line.tool} taskId={taskId} />;
  }

  // A compact summary (bot.run compact): a divider, with the summary behind it.
  if (line.kind === "note") {
    return (
      <details className="w-full py-1 text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 outline-none [&::-webkit-details-marker]:hidden">
          <span className="h-px flex-1 bg-border" />
          <span className="shrink-0 font-mono text-[10px]">
            Compacted — it goes on from its summary
          </span>
          <span className="h-px flex-1 bg-border" />
        </summary>
        <p className="mt-2 rounded-xl bg-muted/40 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-keep">
          {line.text}
        </p>
      </details>
    );
  }

  // Passing remarks are muted; the report is the one thing here at full weight.
  if (!isOutcome(line)) {
    return (
      <p className="px-1 text-[12.5px] leading-relaxed break-keep text-muted-foreground">
        {line.text}
      </p>
    );
  }

  // A question the bot stopped on; the options are what was offered at the time.
  if (line.options) {
    return (
      <div className="w-fit max-w-full space-y-1.5 rounded-2xl bg-amber-500/8 px-3 py-2 ring-1 ring-amber-500/25">
        <p className="text-[13px] leading-snug break-keep">{line.text}</p>
        {line.options.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {line.options.map((option) => (
              <span
                key={option}
                className="rounded-full bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {option}
              </span>
            ))}
          </p>
        )}
      </div>
    );
  }

  const failed = line.kind === "error";

  return (
    // The report is not a card. It sits in a thread that is already in a box,
    // in a section that is another: a fourth border reads as a second chat
    // window. What tells it from a passing remark is that it is the only prose
    // here at foreground weight, plus the files it names — and its copy button
    // rides the name line above (Turn's tail), where nothing else was.
    <div className="min-w-0 px-1">
      {failed && (
        <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] text-destructive">
          <X className="size-3 shrink-0" />
          Could not finish
        </p>
      )}
      <Markdown
        className={cn(
          "overflow-x-auto text-[13px] leading-relaxed break-keep [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:my-0.5 [&_table]:text-[12px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          failed && "text-destructive",
        )}
      >
        {line.text}
      </Markdown>
      {/* The files it names, and the copy — one row, because the end of the
          report is where a reader is when they want either. */}
      <div className="mt-2 flex items-center gap-2">
        <PathChips text={line.text} className="min-w-0" />
        {!failed && (
          <span className="ml-auto shrink-0">
            <CopyReport text={line.text} />
          </span>
        )}
      </div>
    </div>
  );
}

/** Copies the report. The icon confirms; a toast only reports failure. */
function CopyReport({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const back = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (back.current) clearTimeout(back.current);
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label="Copy the report"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          if (back.current) clearTimeout(back.current);
          back.current = setTimeout(() => setCopied(false), 1400);
        } catch (cause) {
          toast.add({
            type: "error",
            title: "Could not copy the report",
            description: errorToString(cause),
          });
        }
      }}
      className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

/**
 * A run of tool calls. Every step is drawn: the thread is the record of what the
 * bot did, and a tail that hides the rest behind a button asks the reader to
 * click before they can tell whether the bot went the right way. Each row is
 * one collapsed line, so the length costs scroll, not noise.
 */
function Steps({ lines, taskId }: { lines: Chatter[]; taskId: string }) {
  return (
    <div className="flex w-full flex-col gap-0.5 rounded-2xl bg-muted/40 p-1">
      {lines.length > 1 && (
        <p className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {lines.length} steps
        </p>
      )}
      {lines.map((line) =>
        line.tool ? (
          // All start collapsed; a running call expands itself (bot-tool Frame).
          <BotTool key={line.id} tool={line.tool} taskId={taskId} collapsed />
        ) : null,
      )}
    </div>
  );
}

/** Splits one speaker's lines into runs of tool calls and runs of everything else. */
type Run =
  | { kind: "tools"; key: string; lines: Chatter[] }
  | { kind: "said"; key: string; lines: Chatter[] };

function runs(lines: Chatter[]): Run[] {
  const out: Run[] = [];
  for (const line of lines) {
    const kind = line.kind === "tool" && line.tool ? "tools" : "said";
    const open = out.at(-1);
    if (open && open.kind === kind) open.lines.push(line);
    else out.push({ kind, key: line.id, lines: [line] });
  }
  return out;
}
