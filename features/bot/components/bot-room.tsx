"use client";

import { format } from "date-fns";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Copy,
  History,
  Loader2,
  Plus,
  RotateCw,
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
import { ShinyText, type ShinyTone } from "@/components/ui/shiny-text";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { startTaskAction } from "@/features/bot/bot.action";
import {
  type Bot,
  type BotIcon,
  DEFAULT_BOT,
  isAppStop,
  TASK_CONTINUE,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoster } from "@/features/bot/components/bot-roster";
import { PathChips } from "@/features/bot/components/path-chips";
import { TaskReply, useAnswerTask } from "@/features/bot/components/task-reply";
import { openSettings } from "@/features/settings/settings.store";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { FileViewer } from "@/features/workspace/components/file-view";
import { shortAgo, toDate } from "@/lib/date-like";
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
  useSeenOnDetail,
} from "../task.store";
import { BotTool } from "./bot-tool";

/**
 * The task room and inbox in the corner of the call screen: what is running, what is
 * asking, and what just finished (bot.query listInboxTasks). It only projects server
 * state.
 *
 * Folded, it is not a badge you have to open. Anything waiting on an answer is drawn
 * on the chip itself, with its buttons; what a bot is doing right now sits beside its
 * face, and what passed between two parties rides above one for a moment
 * (useHandoffs). Opening the room is for reading a thread, never for answering — a
 * chevron that reveals the rows would put a click in front of the one thing this
 * corner exists to remove.
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

  const [bubbles, handoff] = useHandoffs();
  const { crew, more } = useMemo(() => crewOf(bots, tasks), [bots, tasks]);

  // What each task was, and which hand-offs had already landed, at the previous
  // sync. Only what changed since then just happened.
  const known = useRef<Map<string, TaskViewStatus> | null>(null);
  const passed = useRef(new Set<string>());

  useEffect(() => {
    if (!botTasks.primed()) return;
    const now = new Map(newest.map((entry) => [entry.id, entry.status]));
    const was = known.current;
    known.current = now;

    const seen = new Set<string>();
    for (const task of tasks) {
      for (const line of task.lines) {
        if (line.kind === "ask" && line.to) seen.add(line.id);
      }
    }
    const had = passed.current;
    passed.current = seen;

    // The first list only seeds the two: nothing on it just happened.
    if (!was) return;

    // Bot to bot. A giver handing work to several at once would put a bubble
    // over each of them, 20px apart, so a whole round is drawn once — over the
    // giver — and the faces that took the work are awake, which says who.
    const rounds = new Map<
      string,
      { from: BotRef; to: BotRef; text: string }[]
    >();
    for (const task of tasks) {
      for (const line of task.lines) {
        if (line.kind !== "ask" || !line.to || had.has(line.id)) continue;
        const round = rounds.get(line.bot.name) ?? [];
        round.push({ from: line.bot, to: line.to, text: line.text });
        rounds.set(line.bot.name, round);
      }
    }
    for (const [giver, round] of rounds) {
      if (round.length === 1) {
        handoff({
          at: round[0].to.name,
          from: round[0].from,
          text: clipWord(round[0].text),
        });
        continue;
      }
      handoff({
        at: giver,
        from: round[0].from,
        text: `sent ${round.length} parts out`,
      });
    }

    for (const task of newest) {
      if (was.get(task.id) === task.status || task.status !== "working")
        continue;
      // A job that was never seen is one arriving; one that was is you having
      // answered it. The mark says who gave it away — and a job typed into the
      // compose box is Thursday's here too, because a task row does not record
      // which of the two started it.
      handoff(
        was.has(task.id)
          ? { at: task.bot.name, from: null, text: "picked it back up" }
          : {
              at: task.bot.name,
              from: THURSDAY,
              text: `took on \u201c${clipWord(task.label)}\u201d`,
            },
      );
    }
  }, [tasks, handoff]);

  // Reading a thread is reading its ending; that is what clears its dot.
  useSeenOnDetail(open ? current : null);

  const busy = tasks.filter((entry) => entry.status === "working").length;
  const attention = newest.filter(needsYou);
  const pending = attention.length;
  const unread = newest.filter(isUnread);
  const failed = unread.filter((entry) => entry.status === "failed").length;

  const closeCompose = useCallback(() => setComposing(false), []);

  return (
    // As wide as the resting pill may grow: 80% of the window. The open room
    // keeps its own 33rem inside it.
    <div className="pointer-events-none absolute right-5 bottom-5 z-10 flex w-[min(80vw,calc(100vw-2.5rem))] flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto flex max-h-[min(44rem,78vh)] w-132 max-w-full animate-in flex-col overflow-hidden rounded-3xl bg-background/75 shadow-2xl shadow-black/6 ring-1 ring-border/50 backdrop-blur-xl fade-in slide-in-from-bottom-1 duration-200">
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
          crew={crew}
          more={more}
          bubbles={bubbles}
          bots={bots}
          rows={attention}
          count={tasks.length}
          busy={busy}
          pending={pending}
          unread={unread.length}
          failed={failed}
          composing={composing}
          onCompose={() => setComposing(true)}
          onCloseCompose={closeCompose}
          onPick={(id) => {
            setPicked(id);
            setOpen(true);
          }}
          onOpen={() => {
            // One thing to look at opens straight into its thread: a single
            // question, or with none waiting, a single answer nobody has read.
            const only = attention.length ? attention : unread;
            if (!picked && only.length === 1) setPicked(only[0].id);
            setOpen(true);
          }}
        />
      )}
    </div>
  );
});

/** Faces the row draws before the count takes over. */
const CREW_MAX = 10;
/** Stable identity for a row that can never have one up. */
const EMPTY_BUBBLES: Map<string, Handoff> = new Map();
/** How long a hand-off stays above a face, ms. */
const HANDOFF_MS = 3400;
/** A step is a glance, not a sentence. */
const WORD_MAX = 28;

/** One face in the row, and what it is doing. */
type CrewFace = {
  name: string;
  icon?: BotIcon | null;
  /** Working or waiting: both are awake. */
  awake: boolean;
  /** Waiting on an answer; carries the dot. */
  waiting: boolean;
  /** The step it is on, in the model's own words. Null when it is not working. */
  word: string | null;
  /** A stand-in for an install with no bots; dimmed with the rest. */
  standIn?: boolean;
};

/**
 * Something passed between two parties. This is what a bubble is for, and the
 * only thing: a step is the bot working alone and belongs beside its face.
 */
type Handoff = {
  /** Whose face it points at. */
  at: string;
  /** Who gave it away. Null when it was the user, who has no mark. */
  from: BotRef | null;
  text: string;
};

const clipWord = (text: string) => {
  const one = plainText(text).replace(/\s+/g, " ").trim();
  return one.length > WORD_MAX ? `${one.slice(0, WORD_MAX - 1)}…` : one;
};

/**
 * Hand-offs currently up, one per face. A second one to the same face replaces
 * it rather than queueing: the newest thing that landed there is the true one.
 * Different faces hold their own at the same time — the fan-out that would make
 * two of them collide is folded into one before it gets here (BotRoom).
 */
function useHandoffs(): [Map<string, Handoff>, (one: Handoff) => void] {
  const [up, setUp] = useState<Map<string, Handoff>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const show = useCallback((one: Handoff) => {
    setUp((was) => new Map(was).set(one.at, one));
    const held = timers.current.get(one.at);
    if (held) clearTimeout(held);
    timers.current.set(
      one.at,
      setTimeout(() => {
        timers.current.delete(one.at);
        setUp((was) => {
          const next = new Map(was);
          next.delete(one.at);
          return next;
        });
      }, HANDOFF_MS),
    );
  }, []);

  return [up, show];
}

/** The step a bot is on, as the model labelled it. */
function wordOf(line: Chatter | null): string | null {
  if (!line) return null;
  if (line.kind === "tool" && line.tool) {
    // The model's own label when it wrote one, else the raw call.
    return clipWord(line.tool.note ?? `${line.tool.name} · ${line.tool.input}`);
  }
  return line.kind === "say" ? clipWord(line.text) : null;
}

/**
 * Who is in the row, in the order it is drawn.
 *
 * Anyone moving sorts to the front, so the count at the tail only ever hides
 * idle bots — a bot with something to say always has a face to say it from,
 * which is what lets a hand-off point at one. A bot that spoke inside somebody
 * else's job is in the room too, whether or not it owns a task (latestPerBot).
 */
function crewOf(
  bots: Bot[] | undefined,
  tasks: TaskView[],
): { crew: CrewFace[]; more: number } {
  const live = new Map<string, { waiting: boolean; word: string | null }>();
  for (const entry of latestPerBot(tasks)) {
    const { task, bot, line } = entry;
    // Waiting outranks working: a bot that stopped to ask is not on a step.
    if (task.status === "waiting" && task.bot.name === bot.name) {
      live.set(bot.name, { waiting: true, word: null });
      continue;
    }
    if (task.status !== "working" || live.get(bot.name)?.waiting) continue;
    live.set(bot.name, { waiting: false, word: wordOf(line) });
  }

  const named = new Map<string, CrewFace>();
  for (const bot of bots ?? []) {
    named.set(bot.name, {
      name: bot.name,
      icon: bot.icon,
      awake: live.has(bot.name),
      waiting: live.get(bot.name)?.waiting ?? false,
      word: live.get(bot.name)?.word ?? null,
    });
  }
  // A bot that is working but not on the roster (the row-less default) still
  // has a face: the row is who is here, not who is configured.
  for (const [name, doing] of live) {
    if (named.has(name)) continue;
    named.set(name, {
      name,
      icon: null,
      awake: true,
      waiting: doing.waiting,
      word: doing.word,
    });
  }

  // A fresh install has one worker and one silhouette says "one bot", which is
  // the wrong thing to say about a room. Stand-ins fill it out and are dimmed.
  const roster = [...named.values()];
  if (!roster.length) return { crew: GHOSTS.slice(0, FLOOR), more: 0 };
  for (const ghost of GHOSTS) {
    if (roster.length >= FLOOR) break;
    if (!named.has(ghost.name)) roster.push(ghost);
  }

  const rank = (face: CrewFace) =>
    face.waiting ? 0 : face.awake ? 1 : face.standIn ? 3 : 2;
  const sorted = roster
    .map((face, at) => ({ face, at }))
    .sort((a, b) => rank(a.face) - rank(b.face) || a.at - b.at)
    .map((one) => one.face);

  return {
    crew: sorted.slice(0, CREW_MAX),
    more: Math.max(0, sorted.length - CREW_MAX),
  };
}

/** Blanks the question in the reply box when it already is the last thread line (stops the app made). */
function askFor(task: TaskView): TaskView["ask"] {
  if (!task.ask?.question) return task.ask;
  const last = task.lines.at(-1);
  return last && isOutcome(last) && last.text === task.ask.question
    ? { ...task.ask, question: "" }
    : task.ask;
}

/**
 * A task that cannot move until the user answers: a question, or a stop the app made.
 *
 * A finished job is not on this list. It has nothing for the user to do, and
 * counting it here made the chip hold itself open over an answer nobody had to
 * act on. An answer says itself once, in the sentence, and then it is a row in
 * the room like every other one.
 */
const needsYou = (task: TaskView) => task.status === "waiting";

/** An ending nobody has opened. It needs the user too, to read rather than to answer. */
const isUnread = (task: TaskView) =>
  (task.status === "done" || task.status === "failed") && !task.seen;

/**
 * What the room itself is doing, and nothing else — the right side of the pill.
 *
 * What is still moving shines, like every other running line: a wait in amber,
 * running jobs in muted ink beside the spinner. An ending does not — an answer
 * nobody has opened is something to read, not something happening.
 */
function restingState({
  count,
  busy,
  pending,
  unread,
  failed,
}: {
  count: number;
  busy: number;
  pending: number;
  /** Endings nobody has opened, failures included. */
  unread: number;
  failed: number;
}): { text: string; tone: string; shine: ShinyTone | null } {
  if (pending > 0)
    return {
      text: pending === 1 ? "waiting on you" : `${pending} waiting on you`,
      tone: WAITING_INK,
      shine: "waiting",
    };
  // Unread outranks running: a job still going will say so again, and an answer
  // left unopened will not.
  if (failed > 0)
    return {
      text: failed === 1 ? "1 failed" : `${failed} failed`,
      tone: "text-destructive",
      shine: null,
    };
  if (unread > 0)
    return {
      text: unread === 1 ? "1 new answer" : `${unread} new answers`,
      tone: WAITING_INK,
      shine: null,
    };
  if (busy > 0)
    return {
      text: busy === 1 ? "working" : `${busy} running`,
      tone: "text-muted-foreground",
      shine: "muted",
    };
  if (count > 0)
    return { text: "all done", tone: "text-muted-foreground", shine: null };
  return { text: "no jobs yet", tone: "text-muted-foreground", shine: null };
}

/**
 * The room folded into one object in the corner.
 *
 * The row carries two facts and they never take each other's place. On the
 * **left**, who is here and what each of them is doing: a face, and the shiny
 * text beside it. On the **right**, what the room itself is doing, with its
 * glyph 6px away — one fact, so nothing gets to come between them and nothing
 * takes the glyph away. Anything that passes between two parties is neither, so
 * it rides above a face in a bubble.
 *
 * While something is waiting on an answer its rows are grown in place above the
 * row. Nothing here sits behind a disclosure: they appear because there is
 * something to answer and leave when it is answered. The pill's own click opens
 * the room, to read.
 *
 * The corner radius does not animate with the height: interpolating a pill radius
 * down to a card radius while the box is also resizing warps the corners in flight.
 */
function Chip({
  crew,
  more,
  bubbles,
  bots,
  rows,
  count,
  busy,
  pending,
  unread,
  failed,
  composing,
  onCompose,
  onCloseCompose,
  onPick,
  onOpen,
}: {
  crew: CrewFace[];
  more: number;
  bubbles: Map<string, Handoff>;
  bots?: Bot[];
  /** Everything waiting on an answer, newest first. */
  rows: TaskView[];
  count: number;
  busy: number;
  pending: number;
  unread: number;
  failed: number;
  composing: boolean;
  onCompose: () => void;
  onCloseCompose: () => void;
  onPick: (id: string) => void;
  onOpen: () => void;
}) {
  const state = restingState({ count, busy, pending, unread, failed });
  const grown = composing || pending > 0;

  return (
    <div
      className={cn(
        // Not `overflow-hidden`: a hand-off bubble stands above the row, outside
        // this box. The growing part clips itself instead.
        "pointer-events-auto w-fit max-w-full bg-background/78 ring-1 ring-border/50 backdrop-blur-md transition-shadow duration-300",
        // A card with questions in it keeps the room's width: only the resting
        // row grows with the corner, and a reply's long lines would stretch it.
        grown
          ? "max-w-[min(33rem,100%)] min-w-96 rounded-3xl shadow-lg shadow-black/8"
          : "rounded-full shadow-sm shadow-black/3",
      )}
    >
      {/* One box, two heights: the rows grow out of nothing rather than appearing. */}
      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
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
          is why the well carries no box of its own. */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={onOpen}
          aria-label={count ? `Tasks (${count})` : "Bots"}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Crew crew={crew} more={more} bubbles={bubbles} />

          {/* The room's own state and its glyph: one group, and the only thing on
              the right. `ml-auto` keeps it there when the crew says nothing. */}
          <span className="ml-auto flex h-7 shrink-0 items-center gap-1.5">
            {state.shine ? (
              <ShinyText
                text={state.text}
                tone={state.shine}
                speed={2.6}
                className="block truncate text-[14px] leading-5 tracking-[-0.15px]"
              />
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
            {/* Always 16px, empty or not: a glyph that comes and goes moves the
                sentence's right end even when the sentence has not changed. */}
            <span className="grid size-4 shrink-0 place-items-center">
              {pending === 0 && unread === 0 && busy > 0 && (
                <Loader2 className="size-4 animate-spin text-muted-foreground/70" />
              )}
              {pending === 0 &&
                failed === 0 &&
                (unread > 0 || (busy === 0 && count > 0)) && (
                  <Check className="size-4 text-muted-foreground/60" />
                )}
            </span>
          </span>
        </button>

        {composing && (
          <RoundButton onClick={onCloseCompose} label="Cancel the message">
            <X className="size-3.5" />
          </RoundButton>
        )}
      </div>
    </div>
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
  // Switched-off bots are left out for the same reason no model is shown one —
  // but the fallback answers "no rows", not "every row off", so switching them
  // all off leaves nothing to pick rather than conjuring a worker.
  const roster: BotRef[] = bots?.length
    ? bots
        .filter((bot) => !bot.disabled)
        .map((bot) => ({ name: bot.name, icon: bot.icon }))
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
const GHOSTS: CrewFace[] = ["alto", "brio", "cinder", "delta"].map(
  (seed, index) => ({
    name: seed,
    icon: {
      color: MARK_PALETTE[Math.floor((index * MARK_PALETTE.length) / 4)],
      shape: MARK_SHAPES[index % MARK_SHAPES.length],
    },
    awake: false,
    waiting: false,
    word: null,
    standIn: true,
  }),
);

/** A single face reads as one worker, not as a crew; below this the row is padded out. */
const FLOOR = 3;

/** The awake halo, in the mark's own view-box units: about 2px of blur at 28px. */
const AWAKE_GLOW = 20;

/**
 * The crew, and what each of them is doing.
 *
 * Two things share this row and never take each other's place: a face says
 * **who**, and the shiny text beside it says **what**, for as long as that bot
 * is on that step. Both are derived — there is no queue and no cap, because
 * every bot that is working is saying something true at the same time.
 *
 * A face that is moving is awake: lifted, swollen a little, and glowing in its
 * own colour. That layer alone survives every collision — three bots at once
 * are three awake faces, with no order to decide.
 */
function Crew({
  crew,
  more,
  bubbles,
}: {
  crew: CrewFace[];
  more: number;
  /** Hand-offs currently up, keyed by the face they point at. */
  bubbles: Map<string, Handoff>;
}) {
  return (
    <span className="flex min-w-0 shrink items-center">
      {crew.map((face, index) => {
        const bubble = bubbles.get(face.name) ?? null;
        return (
          <Fragment key={face.name}>
            <span
              // Silhouettes overlapped, never ringed: a ring needs a circle and
              // these are not circles. Earlier faces sit on top, so the dot on a
              // waiting face is never covered by its neighbour.
              className={cn(
                "relative shrink-0 transition-[margin,transform] duration-500 ease-out",
                // A word to the left has already broken the shingle.
                index > 0 && !crew[index - 1].word && "-ml-2",
                face.standIn && "opacity-35",
                face.awake && "-translate-y-0.5 scale-110",
              )}
              style={{ zIndex: crew.length - index }}
            >
              {/* The halo is the mark's own (bot-mark `glow`), not a filter on
                  this box: a filter here also lands on the bubble above, which
                  came out tinted in the bot's colour and wearing its blur. */}
              <CrewMark face={face} />
              {bubble && <HandoffBubble handoff={bubble} />}
            </span>
            {face.word && (
              // No box: the shine is what says this is happening right now, so a
              // capsule around it was drawing a second time what the sweep says.
              <span className="mx-2.5 min-w-0 shrink truncate">
                <ShinyText
                  text={face.word}
                  speed={2.6}
                  className="truncate text-[13px] leading-5 tracking-[-0.1px]"
                />
              </span>
            )}
          </Fragment>
        );
      })}
      {more > 0 && (
        // Past CREW_MAX the row stops growing. Only idle bots are ever behind it:
        // anyone moving sorted to the front.
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-[9px] bg-muted font-mono text-[10px] text-muted-foreground ring-1 ring-border/50",
            !crew.at(-1)?.word && "-ml-2",
          )}
          title={`${more} more`}
        >
          +{more}
        </span>
      )}
    </span>
  );
}

/**
 * One crew face. Awake, it wears a halo in its own colour, so who is moving
 * reads before any word does; the options object is memoized because a new one
 * every render re-derives the silhouette behind it.
 */
function CrewMark({ face }: { face: CrewFace }) {
  const glow = useMemo(
    () => (face.awake ? { glow: AWAKE_GLOW } : undefined),
    [face.awake],
  );
  return (
    <BotMark
      size={28}
      seed={face.name}
      vary={face.name}
      color={face.icon?.color}
      shape={face.icon?.shape}
      outline={face.icon?.outline}
      notify={face.waiting}
      options={glow}
    />
  );
}

/**
 * A hand-off, over the face it landed on. The mark at its head is whoever gave
 * it away — Thursday, another bot, or nobody at all when it was you.
 *
 * It sits outside the pill's box on purpose, in space the corner is not using;
 * the chip cannot clip its own children while one is up.
 */
function HandoffBubble({ handoff }: { handoff: Handoff }) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 flex -translate-x-1/2 animate-in flex-col items-center whitespace-nowrap fade-in zoom-in-95 duration-200">
      <span className="flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-[12.5px] leading-4 tracking-[-0.1px] shadow-lg shadow-black/10 ring-1 ring-border">
        {handoff.from?.name === THURSDAY.name ? (
          <ThursdayMark size={14} className="shrink-0 opacity-75" />
        ) : (
          handoff.from && (
            <BotMark
              size={14}
              seed={handoff.from.name}
              vary={handoff.from.name}
              color={handoff.from.icon?.color}
              shape={handoff.from.icon?.shape}
              outline={handoff.from.icon?.outline}
              className="shrink-0 opacity-75"
            />
          )
        )}
        {handoff.text}
      </span>
      {/* Two triangles: the ring's, then the fill's a pixel over it. */}
      <span className="-mt-px size-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-border" />
      <span className="-mt-[6.5px] size-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-background" />
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
    task.status === "done" && task.seen
      ? "text-muted-foreground"
      : STATE_LOOK[task.status];

  if (task.status === "working") {
    return (
      <ShinyText
        text="working"
        speed={2.2}
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
  const { crew, more } = crewOf(bots, []);
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-3 pb-4 text-center">
      <Crew crew={crew} more={more} bubbles={EMPTY_BUBBLES} />
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
  // secondLine runs plainText over the whole answer. Every sync rebuilds each TaskView
  // (task.store), so depend on the fields that change the line, not on `task`.
  const last = task.lines.at(-1);
  const line = useMemo(
    () => secondLine(task),
    [task.status, task.outcome, task.seen, task.ask, last?.id],
  );
  const [answer, answering] = useAnswerTask();
  const [sending, setSending] = useState<string | null>(null);
  // Options are answered inline, without opening the thread.
  const options = task.status === "waiting" ? (task.ask?.options ?? []) : [];

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
              className="h-7 gap-1.5 rounded-full border-amber-500/35 bg-background px-3 text-[12px]"
            >
              {option === TASK_CONTINUE && (
                <ChevronsRight className="size-3.5 text-muted-foreground" />
              )}
              {option}
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
      tone: had ? "text-muted-foreground" : "text-foreground",
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
        {task.status === "working" && <NextMove task={task} />}
      </div>
    </FileViewer>
  );
}

/**
 * The foot of a running thread while nothing on it is moving: the bot is
 * writing its next step. A tool mid-call already shines on its own row, so this
 * steps aside for it.
 */
function NextMove({ task }: { task: TaskView }) {
  if (task.lines.some((line) => line.tool && line.tool.results === undefined)) {
    return null;
  }
  const last = task.lines.at(-1);
  // After a hand-off, in either direction, the move is the receiver's
  const who = last?.kind === "ask" && last.to ? last.to : last?.bot;
  return (
    <ShinyText
      text={
        who
          ? `${who.name} is on the next step…`
          : `${task.bot.name} is taking it on…`
      }
      speed={2.2}
      className="block px-1 font-mono text-[10px]"
    />
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

/**
 * Thursday's own face; she is not a bot and has no row to read one from. Also
 * who a hand-off came from when it came from the call — her mark is drawn by
 * her own domain (features/thursday), so this only has to name her.
 */
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
      {/* One cap on the turn's column, not one per block inside it: an answer and
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
          ) : run.kind === "stops" ? (
            <Stops key={run.key} lines={run.lines} />
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

  // Passing remarks are muted; the answer is the one thing here at full weight.
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
    // The answer is not a card. It sits in a thread that is already in a box,
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
          answer is where a reader is when they want either. */}
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

/** Copies the answer. The icon confirms; a toast only reports failure. */
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
      aria-label="Copy the answer"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          if (back.current) clearTimeout(back.current);
          back.current = setTimeout(() => setCopied(false), 1400);
        } catch (cause) {
          toast.add({
            type: "error",
            title: "Could not copy the answer",
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

/**
 * Where the app stopped the run (bot.runner parkTask): a failed model call, a
 * restart, a closed browser. Muted and in the bot's turn, since the bot goes on
 * from here. The same reason in a row is one line with a count; opening it lists
 * each stop by the time it happened.
 */
function Stops({ lines }: { lines: Chatter[] }) {
  return (
    <details className="group min-w-0 px-1 text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] leading-relaxed outline-none [&::-webkit-details-marker]:hidden">
        <RotateCw className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{leadOf(lines[0].text)}</span>
        {lines.length > 1 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            ×{lines.length}
          </span>
        )}
        <ChevronDown className="size-2.5 shrink-0 text-muted-foreground/70 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-1 space-y-1 pl-4.5 text-[11px] leading-relaxed">
        {lines.map((line) => (
          <p key={line.id} className="flex gap-2 break-keep">
            {line.at && (
              <span className="shrink-0 font-mono text-muted-foreground/70 tabular-nums">
                {format(toDate(line.at), "HH:mm:ss")}
              </span>
            )}
            <span className="min-w-0">{line.text}</span>
          </p>
        ))}
      </div>
    </details>
  );
}

/** What stopped it, without the words behind it: a stop names those in parentheses (bot.runner parkTask). */
const leadOf = (text: string) => text.split(" (")[0].replace(/\.$/, "");

/** Splits one speaker's lines into runs of tool calls, of stops, and of everything else. */
type Run =
  | { kind: "tools"; key: string; lines: Chatter[] }
  | { kind: "stops"; key: string; lines: Chatter[] }
  | { kind: "said"; key: string; lines: Chatter[] };

function runs(lines: Chatter[]): Run[] {
  const out: Run[] = [];
  for (const line of lines) {
    const kind =
      line.kind === "tool" && line.tool
        ? "tools"
        : line.kind === "stop"
          ? "stops"
          : "said";
    const open = out.at(-1);
    // Stops fold only while the reason repeats; another reason is a line of its own
    const same =
      open?.kind === kind &&
      (kind !== "stops" || leadOf(open.lines[0].text) === leadOf(line.text));
    if (open && same) open.lines.push(line);
    else out.push({ kind, key: line.id, lines: [line] });
  }
  return out;
}
