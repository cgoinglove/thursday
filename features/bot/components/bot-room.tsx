"use client";

import { format, isThisYear, isToday, isYesterday } from "date-fns";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  CirclePause,
  CircleQuestionMark,
  Copy,
  Loader2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import {
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { FoldedText } from "@/components/ui/folded-text";
import { Markdown } from "@/components/ui/markdown";
import { ShinyText } from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { PAGE_SIZE, ROOM_KEEP_READ_MS } from "@/config";
import { startThreadAction } from "@/features/bot/bot.action";
import {
  type Bot,
  type BotIcon,
  DEFAULT_BOT,
  isAppStop,
  needsThreadReply,
  THREAD_CONTINUE,
  type Thread,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoster } from "@/features/bot/components/bot-roster";
import { PathChips } from "@/features/bot/components/path-chips";
import {
  ThreadReply,
  useAnswerThread,
} from "@/features/bot/components/thread-reply";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { FileViewer } from "@/features/workspace/components/file-view";
import { type DateLike, shortAgo, toDate } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import {
  type ServerPages,
  useServerPages,
} from "@/lib/protocol/use-server-pages";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import {
  cn,
  errorToString,
  formatCount,
  plainText,
  WAITING_INK,
} from "@/lib/utils";
import { MARK_PALETTE, MARK_SHAPES } from "../mark.const";
import { ROOM_THURSDAY } from "../room.schema";
import {
  type BotRef,
  botThreads,
  type Chatter,
  heardBy,
  lastSaid,
  latestPerBot,
  rosterOf,
  type ThreadItem,
  type ThreadView,
  type ThreadViewStatus,
  threadFromRow,
  threadItems,
  useBotThreads,
  useSeenOnDetail,
} from "../thread.store";
import { BotTool } from "./bot-tool";

/**
 * The thread room and inbox in the corner of the call screen: what is running, what is
 * asking, and what just finished (thread.query listInboxThreads). It only projects server
 * state.
 *
 * Folded, it is not a badge you have to open. Anything waiting on an answer is drawn
 * on the chip itself, with its buttons; what a bot is doing right now sits beside its
 * face, and what passed between two parties rides above one for a moment
 * (useHandoff). Open, a thread can be read and answered in place.
 *
 * memo: the parent re-renders per transcript chunk, and nothing here reads its props.
 */
export const BotRoom = memo(function BotRoom() {
  const threads = useBotThreads();
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const [open, setOpen] = useState(false);
  /** Open thread; null shows the list. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Writing a new job, folded or in the room. */
  const [composing, setComposing] = useState(false);
  /** The bot each thread shows, by thread id; a thread not in here is on All. */
  const [sides, setSides] = useState<Record<string, string | null>>({});
  /** The list on screen: what is current, or everything that has ended. */
  const [tab, setTab] = useState<RoomTab>("now");
  /** Where History was scrolled, kept while one of its threads is open. */
  const scroll = useRef(0);

  const newest = [...threads].reverse();
  // An ending the user has opened moves to History once it has been over for
  // ROOM_KEEP_READ_MS; until then it stays in reach on Now. A cancel is the
  // user's own stop, with nothing to read, so it goes at once.
  const moment = Date.now();
  const leavesAt = (entry: ThreadView) => {
    if (entry.status === "cancelled") return 0;
    if (entry.status !== "done" || !entry.seen) return Number.POSITIVE_INFINITY;
    return toDate(entry.updatedAt).getTime() + ROOM_KEEP_READ_MS;
  };
  const now = newest.filter((entry) => leavesAt(entry) > moment);
  // Nothing else re-renders the room when that time passes.
  const [, settle] = useState(0);
  const nextLeave = Math.min(...now.map(leavesAt));
  useEffect(() => {
    if (!Number.isFinite(nextLeave)) return;
    const timer = setTimeout(
      () => settle((count) => count + 1),
      nextLeave - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [nextLeave]);

  // Read only while History is on screen, or one of its threads is.
  const browsing = open && tab === "history";
  const history = useServerPages<Thread>({
    key: (index, previous) => {
      if (!browsing) return null;
      if (index === 0) return queryKey.threadHistory(null);
      const tail = previous?.at(-1);
      return tail
        ? queryKey.threadHistory(toDate(tail.updatedAt).toISOString())
        : null;
    },
    size: PAGE_SIZE,
  });
  // Loaded pages stay cached while the tab is away and nothing refreshes them
  // then, so opening History reads them again — unless this is the first read.
  const { refresh } = history;
  const cached = useRef(false);
  cached.current = history.items.length > 0;
  useEffect(() => {
    if (browsing && cached.current) void refresh();
  }, [browsing, refresh]);
  const past = useMemo(
    () =>
      history.items
        .filter((row) => row.status === "done" || row.status === "cancelled")
        .map((row) => threadFromRow(row, bots)),
    [history.items, bots],
  );

  // The inbox copy first: it is the one the threads signal keeps live.
  const current = picked
    ? (newest.find((entry) => entry.id === picked) ??
      past.find((entry) => entry.id === picked) ??
      null)
    : null;

  const [bubble, handoff] = useHandoff();
  const { crew, more } = useMemo(() => crewOf(bots, threads), [bots, threads]);

  // What each thread and participant was, and which lines had landed, at the
  // previous sync. Only what changed since then just happened.
  const known = useRef<Map<string, ThreadViewStatus> | null>(null);
  const standing = useRef(new Map<string, string>());
  const passed = useRef(new Set<string>());

  useEffect(() => {
    if (!botThreads.primed()) return;
    const was = known.current;
    known.current = new Map(threads.map((entry) => [entry.id, entry.status]));
    const stood = standing.current;
    standing.current = participantStates(threads);
    const had = passed.current;
    passed.current = new Set(
      threads.flatMap((thread) => thread.lines.map((line) => line.id)),
    );

    // The first list only seeds these: nothing on it just happened.
    if (!was) return;

    // One bubble at a time: of what this sync brought, the one that matters
    // most, and of equals the later.
    let top: Happening | null = null;
    for (const thread of threads) {
      const happened = happenedIn(
        thread,
        was.get(thread.id),
        had,
        stood,
        standing.current,
      );
      for (const one of happened) {
        if (!top || one.rank >= top.rank) top = one;
      }
    }
    if (top) handoff(top);
  }, [threads, handoff]);

  // Reading a thread is reading its ending; that is what clears its dot.
  useSeenOnDetail(open ? current : null);

  // Thursday put a job in front of the user (`thread` `open`): the room opens on it
  useAppEvent({
    showThread: (event) => {
      setPicked(event.threadId);
      setOpen(true);
    },
  });

  const busy = threads.filter((entry) => entry.status === "working").length;
  const pending = newest.filter(needsYou).length;
  const unread = newest.filter(isUnread);
  // In the open room the list says what each bot is on; its foot keeps the faces,
  // so a step's words never come and go under the list.
  const faces = useMemo(
    () => crew.map((face) => ({ ...face, word: null })),
    [crew],
  );

  const closeCompose = useCallback(() => setComposing(false), []);

  // The room always opens on Now. A thread left open would greet the next click
  // on the pill, and a History one would not be found once its pages stop being read.
  const fold = () => {
    setOpen(false);
    setComposing(false);
    setPicked(null);
    setTab("now");
    scroll.current = 0;
  };

  return (
    // As wide as the resting pill may grow: 80% of the window. The open room
    // keeps its own 33rem inside it.
    <div className="pointer-events-none absolute right-5 bottom-5 z-10 flex w-[min(80vw,calc(100vw-2.5rem))] flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto flex max-h-[min(44rem,78vh)] w-132 max-w-full animate-in flex-col overflow-hidden rounded-3xl bg-background/75 shadow-2xl shadow-black/6 ring-1 ring-border/50 backdrop-blur-xl fade-in slide-in-from-bottom-1 duration-200">
          {current ? (
            <>
              <ThreadHeader
                thread={current}
                onBack={() => setPicked(null)}
                onClose={fold}
              />
              <Conversation
                thread={current}
                tab={sides[current.id] ?? null}
                onTab={(bot) =>
                  setSides((was) => ({ ...was, [current.id]: bot }))
                }
                className="min-h-0 flex-1"
              />
              <ThreadReply
                thread={{
                  id: current.id,
                  label: current.label,
                  bot: current.bot.name,
                  ask: current.ask,
                  room: current.room,
                }}
                status={
                  current.status === "working" ? "running" : current.status
                }
                faces={rosterOf(current)}
                to={sides[current.id] ?? current.bot.name}
                className="mx-3 mb-2 shrink-0"
              />
            </>
          ) : (
            <>
              <ListHeader
                tab={tab}
                current={now.length}
                composing={composing}
                onTab={(next) => {
                  setComposing(false);
                  setTab(next);
                }}
                onCompose={() => setComposing(true)}
                onClose={() => (composing ? setComposing(false) : fold())}
              />
              {composing ? (
                <Compose bots={bots} onDone={closeCompose} />
              ) : tab === "history" ? (
                <HistoryList
                  pages={history}
                  threads={past}
                  scroll={scroll}
                  onPick={setPicked}
                />
              ) : now.length ? (
                <ThreadList threads={now} onPick={setPicked} />
              ) : newest.length ? (
                <Quiet />
              ) : (
                <Empty bots={bots} />
              )}
              {/* The pill's own row at the room's foot: open, it is the same object
                  grown. A hand-off speaks here rather than over the list's rows. */}
              <CrewRow
                crew={faces}
                more={more}
                bubble={null}
                label="Fold the room away"
                onClick={fold}
                side={
                  bubble ? (
                    <Moment handoff={bubble} />
                  ) : (
                    // Open, the room is the hand the pill offers.
                    <RoomState busy={busy} pending={pending} grown />
                  )
                }
              />
            </>
          )}
        </div>
      ) : (
        <Chip
          crew={crew}
          more={more}
          bubble={bubble}
          bots={bots}
          rows={newest.filter((thread) => needsYou(thread) || isUnread(thread))}
          count={threads.length}
          busy={busy}
          pending={pending}
          unread={unread.length}
          composing={composing}
          onCompose={() => setComposing(true)}
          onCloseCompose={closeCompose}
          onPick={(id) => {
            setPicked(id);
            setOpen(true);
          }}
          // Always the list: a thread opens from its row, or when Thursday opens it.
          onOpen={() => setOpen(true)}
        />
      )}
    </div>
  );
});

/** Faces the row draws before the count takes over. */
const CREW_MAX = 10;
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

/** The glyph a hand-off's words carry when they report how something stands. */
const SIGNS = {
  done: Check,
  cancelled: X,
  question: CircleQuestionMark,
  stopped: CirclePause,
  resumed: RotateCw,
} as const;

/** The one status ink a sign can take: amber, for what waits on the user. */
const SIGN_INK: Partial<Record<keyof typeof SIGNS, string>> = {
  question: WAITING_INK,
  stopped: WAITING_INK,
};

/**
 * Something that just happened: who spoke, to whom, and how it stands. A step
 * is the bot working alone and belongs beside its face, not in a bubble.
 */
type Handoff = {
  /** Whose face it points at: whoever spoke, or the bot the user reached. */
  at: string;
  /** Who spoke; Thursday stands for the user's side. */
  from: BotRef;
  /** The bots it reached, tucked behind the speaker's face. */
  to: BotRef[];
  text: string;
  sign?: keyof typeof SIGNS;
};

/** A hand-off, and how much it matters against others from the same sync. */
type Happening = Handoff & { rank: number };

const clipWord = (text: string) => {
  const one = plainText(text).replace(/\s+/g, " ").trim();
  return one.length > WORD_MAX ? `${one.slice(0, WORD_MAX - 1)}…` : one;
};

/**
 * The one hand-off up. A newer one replaces it rather than queueing: bubbles
 * over neighbouring faces would cover each other, and the newest thing is the
 * true one.
 */
function useHandoff(): [Handoff | null, (one: Handoff) => void] {
  const [up, setUp] = useState<Handoff | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((one: Handoff) => {
    setUp(one);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setUp(null);
    }, HANDOFF_MS);
  }, []);

  return [up, show];
}

/** Each room participant's state, keyed by thread and bot (one per bot: thread.query withLines). */
function participantStates(threads: ThreadView[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const thread of threads) {
    for (const one of thread.room.participants) {
      out.set(`${thread.id}\n${one.bot}`, one.state);
    }
  }
  return out;
}

/**
 * What happened in one thread since the last sync, ranked so one bubble can
 * stand for a sync: a failure, then a question, then an ending or a stop, then
 * messages, then a job arriving, an answer, a bot finishing its part or going
 * back to work.
 */
function happenedIn(
  thread: ThreadView,
  was: ThreadViewStatus | undefined,
  had: Set<string>,
  stood: Map<string, string>,
  stands: Map<string, string>,
): Happening[] {
  const out: Happening[] = [];
  const fresh = thread.lines.filter((line) => !had.has(line.id));
  const own = thread.bot;

  // Bot to bot. A giver handing work to several at once is one bubble naming them all.
  const rounds = new Map<string, Chatter[]>();
  for (const line of fresh) {
    if (line.kind === "user") {
      out.push({
        rank: 1,
        at: line.bot.name,
        from: THURSDAY,
        to: [line.bot],
        text: clipWord(line.text),
      });
    } else if (line.kind === "stop") {
      out.push({
        rank: 3,
        at: line.bot.name,
        from: line.bot,
        to: [],
        sign: "stopped",
        text: leadOf(line.text),
      });
    } else if (line.kind === "ask" && line.to?.name === THURSDAY.name) {
      out.push(
        line.question
          ? {
              rank: 4,
              at: line.bot.name,
              from: line.bot,
              to: [],
              sign: "question",
              text: `asks you · ${clipWord(line.text)}`,
            }
          : {
              rank: 2,
              at: line.bot.name,
              from: line.bot,
              to: [THURSDAY],
              text: clipWord(line.text),
            },
      );
    } else if (line.kind === "ask" && line.to) {
      rounds.set(line.bot.name, [...(rounds.get(line.bot.name) ?? []), line]);
    }
  }
  for (const [giver, round] of rounds) {
    const reached = new Map<string, BotRef>();
    for (const line of round) {
      if (line.to) reached.set(line.to.name, line.to);
    }
    out.push({
      rank: 2,
      at: giver,
      from: round[0].bot,
      to: [...reached.values()],
      text:
        round.length === 1
          ? clipWord(round[0].text)
          : `sent ${round.length} parts out`,
    });
  }

  // Another bot done with its part and no last word; the thread's own ending is the job's.
  for (const bot of rosterOf(thread)) {
    const key = `${thread.id}\n${bot.name}`;
    if (
      bot.name !== own.name &&
      stood.get(key) === "running" &&
      stands.get(key) === "done" &&
      !fresh.some(
        (line) =>
          line.bot.name === bot.name &&
          (line.kind === "ask" || line.kind === "say"),
      )
    ) {
      out.push({
        rank: 1,
        at: bot.name,
        from: bot,
        to: [],
        sign: "done",
        text: "finished its part",
      });
    }
  }

  if (!was) {
    if (thread.status === "working") {
      out.push({
        rank: 1,
        at: own.name,
        from: THURSDAY,
        to: [own],
        text: `took on “${clipWord(thread.label)}”`,
      });
    }
    return out;
  }
  if (was === thread.status) return out;
  const label = clipWord(thread.label);
  if (thread.status === "cancelled") {
    out.push({
      rank: 3,
      at: own.name,
      from: own,
      to: [],
      sign: "cancelled",
      text: `stopped · ${label}`,
    });
  } else if (thread.status === "done") {
    out.push({
      rank: 3,
      at: own.name,
      from: own,
      to: [],
      sign: "done",
      text: `done · ${label}`,
    });
  } else if (thread.status === "working") {
    // Words from the user already have their bubble.
    if (!fresh.some((line) => line.kind === "user")) {
      out.push({
        rank: 1,
        at: own.name,
        from: own,
        to: [],
        sign: "resumed",
        text: "picked it back up",
      });
    }
  } else if (
    isAppStop(thread.ask) &&
    !out.some((one) => one.sign === "question" || one.sign === "stopped")
  ) {
    // A stop with no stop line of its own: the turn limit, or a room gone idle
    out.push({
      rank: 3,
      at: own.name,
      from: own,
      to: [],
      sign: "stopped",
      text: "paused",
    });
  }
  return out;
}

/** The step a bot is on, as the model labelled it. */
function wordOf(line: Chatter | null): string | null {
  return line?.kind === "tool" || line?.kind === "say"
    ? clipWord(stepOf(line))
    : null;
}

/**
 * Who is in the row, in the order it is drawn.
 *
 * Anyone moving sorts to the front, so the count at the tail only ever hides
 * idle bots — a bot with something to say always has a face to say it from,
 * which is what lets a hand-off point at one. A bot that spoke inside somebody
 * else's job is in the room too, whether or not it owns a thread (latestPerBot).
 */
function crewOf(
  bots: Bot[] | undefined,
  threads: ThreadView[],
): { crew: CrewFace[]; more: number } {
  const live = new Map<string, { waiting: boolean; word: string | null }>();
  for (const entry of latestPerBot(threads)) {
    const { thread, bot, line } = entry;
    // Waiting outranks working: a bot that stopped to ask is not on a step.
    if (thread.status === "waiting" && thread.bot.name === bot.name) {
      live.set(bot.name, { waiting: true, word: null });
      continue;
    }
    if (thread.status !== "working" || live.get(bot.name)?.waiting) continue;
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

const needsYou = needsThreadReply;

/** An ending nobody has opened. It needs the user too, to read rather than to answer. */
const isUnread = (thread: ThreadView) =>
  thread.status === "done" && !thread.seen;

/**
 * What the room itself is doing, and nothing else — the right side of the pill.
 *
 * It says two things only, in muted ink: someone waits on the user, or work is
 * running. Endings say nothing here — a result or a failure grows a row above
 * the pill, and that row is the notice. With nothing going on and nothing
 * grown, the pill offers a hand; with a row grown and nothing going on, it is
 * quiet.
 */
function restingState({
  busy,
  pending,
  grown,
}: {
  busy: number;
  pending: number;
  grown: boolean;
}): { text: string; shine: boolean; spin?: boolean } | null {
  if (pending > 0)
    return {
      text: pending === 1 ? "waiting on you" : `${pending} waiting on you`,
      shine: true,
    };
  if (busy > 0) return { text: "working", shine: true, spin: true };
  if (!grown) return { text: "Need a hand?", shine: false };
  return null;
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
 * Questions and unread results grow above the row until answered or opened.
 * The pill's own click opens the room to read the full history.
 *
 * The corner radius does not animate with the height: interpolating a pill radius
 * down to a card radius while the box is also resizing warps the corners in flight.
 */
function Chip({
  crew,
  more,
  bubble,
  bots,
  rows,
  count,
  busy,
  pending,
  unread,
  composing,
  onCompose,
  onCloseCompose,
  onPick,
  onOpen,
}: {
  crew: CrewFace[];
  more: number;
  /** The hand-off up, if any (useHandoff). */
  bubble: Handoff | null;
  bots?: Bot[];
  /** Open questions and unread endings, newest first. */
  rows: ThreadView[];
  count: number;
  busy: number;
  pending: number;
  unread: number;
  composing: boolean;
  onCompose: () => void;
  onCloseCompose: () => void;
  onPick: (id: string) => void;
  onOpen: () => void;
}) {
  const grown = composing || rows.length > 0;

  return (
    <div
      className={cn(
        // Not `overflow-hidden`: a hand-off bubble stands above the row, outside
        // this box. The growing part clips itself instead.
        "pointer-events-auto w-fit max-w-full bg-background/78 ring-1 ring-border/50 backdrop-blur-md transition-shadow duration-300",
        // A card with questions in it keeps the room's width: only the resting
        // row grows with the corner, and a reply's long lines would stretch it.
        grown
          ? "w-132 rounded-3xl shadow-lg shadow-black/8"
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
                <span className="flex-1">
                  {[
                    pending > 0
                      ? `${pending} ${pending === 1 ? "needs" : "need"} a reply`
                      : "",
                    unread > 0
                      ? `${unread} new ${unread === 1 ? "result" : "results"}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <ComposeButton onClick={onCompose} />
              </p>
              {/* px-1: a row keeps its own 8px, so its mark lands on the rail while
                  the shape it lights up on hover stays inside the card's corners */}
              <div className="max-h-[45vh] overflow-y-auto px-1.5 pb-2">
                {rows.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    onPick={() => onPick(thread.id)}
                  />
                ))}
              </div>
              <span className="block h-1.5" />
            </>
          )}
        </div>
      </div>

      {/* The pill row. Same geometry either way, so the card shrinks into it. */}
      <CrewRow
        crew={crew}
        more={more}
        // Grown, the rows already say what needs the user, and a bubble would cover them.
        bubble={grown ? null : bubble}
        label={count ? `Threads (${count})` : "Bots"}
        onClick={onOpen}
        side={<RoomState busy={busy} pending={pending} grown={grown} />}
      >
        {composing && (
          <RoundButton onClick={onCloseCompose} label="Cancel the message">
            <X className="size-3.5" />
          </RoundButton>
        )}
      </CrewRow>
    </div>
  );
}

/**
 * The pill's row: who is here on the left, what the room is doing on the right.
 * The folded chip draws it and so does the open room's foot, so opening the room
 * reads as the pill growing rather than as a card swapped in for it.
 *
 * px-3 is the chip's one rail: the faces here, the section line and every row's
 * mark all start at 12px, and the trailing glyph ends at 12px — which is why the
 * well carries no box of its own.
 */
function CrewRow({
  crew,
  more,
  bubble,
  side,
  label,
  onClick,
  children,
}: {
  crew: CrewFace[];
  more: number;
  bubble: Handoff | null;
  /** The right side: the room's state, or what just happened. */
  side: ReactNode;
  label: string;
  onClick: () => void;
  /** Beside the row's button rather than inside it. */
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Crew crew={crew} more={more} bubble={bubble} />
        {side}
      </button>
      {children}
    </div>
  );
}

/**
 * The room's own state and its glyph: one group, and the only thing on the right.
 * `ml-auto` keeps it there when the crew says nothing.
 */
function RoomState(props: { busy: number; pending: number; grown: boolean }) {
  const state = restingState(props);
  if (!state) return null;
  return (
    <span className="ml-auto flex h-7 shrink-0 items-center gap-1.5">
      {state.shine ? (
        <ShinyText
          text={state.text}
          speed={2.6}
          className="block truncate text-[14px] leading-5 tracking-[-0.15px]"
        />
      ) : (
        <span
          key={state.text}
          className="block animate-in truncate text-[14px] leading-5 tracking-[-0.15px] text-muted-foreground fade-in duration-300"
        >
          {state.text}
        </span>
      )}
      {/* No empty slot: words without a spinner end at the pill's edge. */}
      {state.spin && (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground/70" />
      )}
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
 * (bot.action startThreadAction). The message is the whole request — there is no
 * conversation to draw the rest from, which is why the box asks for a sentence.
 *
 * Nothing announces itself from here. The job shows up as a row on the next poll
 * and the chip says the bot took it on, exactly as a delegated one does.
 */
function Compose({ bots, onDone }: { bots?: Bot[]; onDone: () => void }) {
  const [picked, setPicked] = useState<BotRef | null>(null);
  const [draft, setDraft] = useState("");
  const [start, starting] = useServerAction(startThreadAction, {
    onOk: () => {
      revalidate(queryKey.threads);
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
                color={bot.icon?.color}
                shape={bot.icon?.shape}
                outline={bot.icon?.outline}
                paint={bot.icon?.paint}
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
          color={picked.icon?.color}
          shape={picked.icon?.shape}
          outline={picked.icon?.outline}
          paint={picked.icon?.paint}
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

/**
 * The crew, and what each of them is doing.
 *
 * Two things share this row and never take each other's place: a face says
 * **who**, and the shiny text beside it says **what**, for as long as that bot
 * is on that step. Both are derived — there is no queue and no cap, because
 * every bot that is working is saying something true at the same time.
 *
 * A face that is moving is awake: lifted and swollen a little. That layer alone
 * survives every collision — three bots at once are three awake faces, with no
 * order to decide.
 */
function Crew({
  crew,
  more,
  bubble,
}: {
  crew: CrewFace[];
  more: number;
  /** The hand-off up, drawn over the face it points at. */
  bubble: Handoff | null;
}) {
  return (
    <span className="flex min-w-0 shrink items-center">
      {crew.map((face, index) => {
        return (
          <Fragment key={face.name}>
            <span
              // Silhouettes overlapped, never ringed: a ring needs a circle and
              // these are not circles. Earlier faces sit on top, so the dot on a
              // waiting face is never covered by its neighbour.
              className={cn(
                "relative shrink-0 transition-[margin] duration-500 ease-out",
                // A word to the left has already broken the shingle.
                index > 0 && !crew[index - 1].word && "-ml-2",
                face.standIn && "opacity-35",
              )}
              style={{ zIndex: crew.length - index }}
            >
              <span
                // The lift is the face's alone, so an awake face does not swell its bubble.
                className={cn(
                  "flex transition-transform duration-500 ease-out",
                  face.awake && "-translate-y-0.5 scale-110",
                )}
              >
                <CrewMark face={face} />
              </span>
              {bubble?.at === face.name && <HandoffBubble handoff={bubble} />}
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

/** One crew face. Who is moving reads from the lift its row gives it. */
function CrewMark({ face }: { face: CrewFace }) {
  return (
    <BotMark
      size={28}
      seed={face.name}
      color={face.icon?.color}
      shape={face.icon?.shape}
      outline={face.icon?.outline}
      paint={face.icon?.paint}
      notify={face.waiting}
    />
  );
}

/**
 * What just happened, over the face of whoever spoke: the faces, then the words.
 *
 * It sits outside the pill's box on purpose, in space the corner is not using;
 * the chip cannot clip its own children while one is up.
 */
function HandoffBubble({ handoff }: { handoff: Handoff }) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 flex w-max -translate-x-1/2 animate-in flex-col items-center fade-in zoom-in-95 duration-200">
      <span className="flex rounded-full bg-background py-2 pr-3.5 pl-2.5 shadow-lg shadow-black/10 ring-1 ring-border">
        <HandoffWords handoff={handoff} />
      </span>
      {/* Two triangles: the ring's, then the fill's a pixel over it. */}
      <span className="-mt-px size-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-border" />
      <span className="-mt-[7.5px] size-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-background" />
    </span>
  );
}

/** A hand-off in the open room's foot, where the room's width holds it and no bubble covers the list. */
function Moment({ handoff }: { handoff: Handoff }) {
  return (
    <span className="ml-auto flex h-7 min-w-0 shrink animate-in items-center pl-4 fade-in duration-200">
      <HandoffWords handoff={handoff} />
    </span>
  );
}

/**
 * A hand-off's faces, sign and words. A sign that waits on the user takes the
 * waiting ink, like every other status.
 */
function HandoffWords({ handoff }: { handoff: Handoff }) {
  const Sign = handoff.sign ? SIGNS[handoff.sign] : null;
  const ink = handoff.sign ? SIGN_INK[handoff.sign] : undefined;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2 text-[13px] leading-[18px] tracking-[-0.1px] whitespace-nowrap",
        ink,
      )}
    >
      <Party from={handoff.from} to={handoff.to} />
      {Sign && (
        <Sign
          className={cn(
            "size-3.5 shrink-0",
            !ink && "text-muted-foreground/70",
          )}
        />
      )}
      <span className="min-w-0 truncate">{handoff.text}</span>
    </span>
  );
}

/**
 * Whoever spoke in front and the bots it reached tucked behind, overlapped the
 * way the crew row overlaps faces. Nothing is drawn between them: the order says
 * who spoke, and a bubble's tail points at the same face.
 */
function Party({ from, to }: { from: BotRef; to: BotRef[] }) {
  const faces = [from, ...to];
  return (
    <span className="flex shrink-0 items-center">
      {faces.map((bot, index) => (
        <span
          key={bot.name}
          className={cn("relative flex", index > 0 && "-ml-1.25")}
          style={{ zIndex: faces.length - index }}
        >
          <Speaker bot={bot} />
        </span>
      ))}
    </span>
  );
}

/** A face in a bubble: Thursday's own mark for the user's side, else the bot's. */
function Speaker({ bot }: { bot: BotRef }) {
  return bot.name === THURSDAY.name ? (
    <ThursdayMark size={18} className="shrink-0" />
  ) : (
    <BotMark
      size={18}
      seed={bot.name}
      color={bot.icon?.color}
      shape={bot.icon?.shape}
      outline={bot.icon?.outline}
      paint={bot.icon?.paint}
      notify={false}
      className="shrink-0"
    />
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

/** The room's two lists. */
type RoomTab = "now" | "history";

/** The two lists as pills, drawn like a thread's bot tabs; the compose "+" and the fold beside them. */
function ListHeader({
  tab,
  current,
  composing,
  onTab,
  onCompose,
  onClose,
}: {
  tab: RoomTab;
  /** Rows on Now. */
  current: number;
  composing: boolean;
  onTab: (tab: RoomTab) => void;
  onCompose: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-3 pr-3.5 pb-1.5 pl-2.5">
      <Tabs
        value={composing ? null : tab}
        onValueChange={(value) => onTab(value as RoomTab)}
        className="gap-0"
      >
        <TabsList className="gap-1 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="now" className={TAB}>
            Now
            {current > 0 && (
              <span className="font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
                {current}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className={TAB}>
            History
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <span className="flex-1" />
      {/* Same rule as the chip: whichever list is on screen carries the "+". */}
      {!composing && <ComposeButton onClick={onCompose} />}
      <FoldButton onClick={onClose} />
    </div>
  );
}

function ThreadHeader({
  thread,
  onBack,
  onClose,
}: {
  thread: ThreadView;
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
        seed={thread.bot.name}
        color={thread.bot.icon?.color}
        shape={thread.bot.icon?.shape}
        outline={thread.bot.icon?.outline}
        paint={thread.bot.icon?.paint}
        notify={false}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {thread.label}
        <span
          title={thread.id}
          className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground/60"
        >
          {thread.id.slice(0, 8)}
        </span>
      </span>
      <ThreadFacts thread={thread} />
      <FoldButton onClick={onClose} />
    </div>
  );
}

/** Where a thread stands: tokens, the context meter, the status word. The room's header and the Threads reader draw it. */
export function ThreadFacts({ thread }: { thread: ThreadView }) {
  return (
    <>
      <Tokens usage={thread.tokens} />
      <Context thread={thread} />
      <State thread={thread} />
    </>
  );
}

/** Tokens this thread has used: the total shown, the split in the title. */
function Tokens({ usage }: { usage: ThreadView["tokens"] }) {
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
function Context({ thread }: { thread: ThreadView }) {
  const { contextTokens: used, contextBudget: budget } = thread;
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

/** Only waiting (amber) carries colour. */
const STATE_LOOK: Record<ThreadViewStatus, string> = {
  working: "text-muted-foreground",
  waiting: WAITING_INK,
  done: "text-foreground",
  cancelled: "text-muted-foreground",
};

function State({ thread }: { thread: ThreadView }) {
  const look =
    thread.status === "done" && thread.seen
      ? "text-muted-foreground"
      : STATE_LOOK[thread.status];

  if (thread.status === "working") {
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
      {thread.status}
    </span>
  );
}

/** A room that has never had a thread. The faces are already in the room's foot. */
function Empty({ bots }: { bots?: Bot[] }) {
  return (
    <p className="px-6 pt-4 pb-5 text-center text-[12px] text-muted-foreground">
      {bots?.length
        ? "Nothing handed over yet — ask for something that takes a while."
        : `Thursday hands work to ${DEFAULT_BOT.name} until you make bots of your own in Settings › Bots.`}
    </p>
  );
}

/** Now with nothing on it, when the room has had threads: what ended is one tab over. */
function Quiet() {
  return (
    <p className="px-6 pt-4 pb-5 text-center text-[12px] text-muted-foreground">
      Nothing running or waiting.
    </p>
  );
}

/**
 * Every thread that has ended, newest first, grouped by day. Pages arrive as the
 * end of the list scrolls into view (listThreadHistory).
 */
function HistoryList({
  pages,
  threads,
  scroll,
  onPick,
}: {
  pages: ServerPages<Thread>;
  /** The ended threads among the loaded pages. */
  threads: ThreadView[];
  /** Where the list was left, restored when a thread opened from it closes. */
  scroll: RefObject<number>;
  onPick: (id: string) => void;
}) {
  const restore = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.scrollTop = scroll.current;
    },
    [scroll],
  );

  const days: { day: string; rows: ThreadView[] }[] = [];
  for (const thread of threads) {
    const day = dayOf(thread.updatedAt);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(thread);
    else days.push({ day, rows: [thread] });
  }

  return (
    <div
      ref={restore}
      onScroll={(event) => {
        scroll.current = event.currentTarget.scrollTop;
      }}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2 scrollbar-none"
    >
      {pages.error ? (
        <p className="px-2.5 py-3 text-[12px] text-destructive">
          {pages.error.message}
        </p>
      ) : pages.isLoading ? (
        <>
          <GhostRow />
          <GhostRow />
          <GhostRow />
        </>
      ) : (
        <>
          {days.map((group, at) => (
            <Fragment key={group.day}>
              <p
                className={cn(
                  "px-2.5 pb-1 font-mono text-[10px] text-muted-foreground",
                  at === 0 ? "pt-1" : "pt-3",
                )}
              >
                {group.day} · {group.rows.length}
              </p>
              {group.rows.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onPick={() => onPick(thread.id)}
                />
              ))}
            </Fragment>
          ))}
          {pages.hasMore ? (
            <div ref={pages.sentinelRef}>
              <GhostRow />
            </div>
          ) : (
            days.length === 0 && (
              <p className="px-6 pt-3 pb-4 text-center text-[12px] text-muted-foreground">
                Nothing has ended yet.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

/** "today", "yesterday", "sep 14" — lower case, like the room's other group labels. */
function dayOf(value: DateLike): string {
  const date = toDate(value);
  if (isToday(date)) return "today";
  if (isYesterday(date)) return "yesterday";
  return format(date, isThisYear(date) ? "MMM d" : "MMM d, yyyy").toLowerCase();
}

/** A row's shape while its page is on the way: the face, the label, the line. */
function GhostRow() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <Skeleton className="size-8 shrink-0 rounded-[10px]" />
      <span className="flex h-9 min-w-0 flex-1 flex-col justify-center gap-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </span>
    </div>
  );
}

/** List sections in order, split by what a thread asks of the user rather than by status. First match wins. */
const GROUPS: {
  id: string;
  label: string;
  holds: (thread: ThreadView) => boolean;
}[] = [
  { id: "you", label: "needs you", holds: needsYou },
  { id: "unread", label: "new results", holds: isUnread },
  {
    id: "working",
    label: "working",
    holds: (thread) => thread.status === "working",
  },
  { id: "done", label: "done", holds: () => true },
];

function ThreadList({
  threads,
  onPick,
}: {
  threads: ThreadView[];
  onPick: (id: string) => void;
}) {
  const bucket = new Map<string, ThreadView[]>();
  for (const thread of threads) {
    const group =
      GROUPS.find((one) => one.holds(thread)) ?? GROUPS[GROUPS.length - 1];
    const rows = bucket.get(group.id);
    if (rows) rows.push(thread);
    else bucket.set(group.id, [thread]);
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
            {rows.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                onPick={() => onPick(thread.id)}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

function ThreadRow({
  thread,
  onPick,
}: {
  thread: ThreadView;
  onPick: () => void;
}) {
  const attention = needsYou(thread);
  // secondLine runs plainText over the whole answer. Every sync rebuilds each ThreadView
  // (thread.store), so depend on the fields that change the line, not on `thread`.
  const last = thread.lines.at(-1);
  const line = useMemo(
    () => secondLine(thread),
    [
      thread.status,
      thread.outcome,
      thread.seen,
      thread.ask,
      thread.room.questions,
      last?.id,
    ],
  );
  const [answer, answering] = useAnswerThread();
  const [sending, setSending] = useState<string | null>(null);
  // Options are answered inline, without opening the thread.
  const options =
    thread.status === "waiting" && isAppStop(thread.ask)
      ? (thread.ask?.options ?? [])
      : [];

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
          title={thread.bot.name}
        >
          <BotMark
            size={32}
            seed={thread.bot.name}
            color={thread.bot.icon?.color}
            shape={thread.bot.icon?.shape}
            outline={thread.bot.icon?.outline}
            paint={thread.bot.icon?.paint}
            state={thread.status === "working" ? "thinking" : "idle"}
            notify={attention}
            crossed={thread.status === "cancelled"}
          />
        </span>

        <span className="min-w-0 flex-1">
          {(attention || isUnread(thread)) && (
            <span className="block text-[10px] font-medium text-foreground">
              {thread.room.questions.length
                ? `${thread.room.questions.length === 1 ? "Question" : `${thread.room.questions.length} questions`} · ${[...new Set(thread.room.questions.map((question) => question.bot))].join(", ")}`
                : thread.status === "waiting"
                  ? isAppStop(thread.ask)
                    ? "Paused"
                    : "Question"
                  : "New result"}
            </span>
          )}
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-[14px] leading-5 tracking-[-0.15px]",
                attention ? "text-foreground" : "text-foreground/80",
              )}
            >
              {thread.label}
            </span>
            <BotRoster bots={rosterOf(thread)} />
            <span className="flex-1" />
            <span className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground/70 tabular-nums">
              {shortAgo(thread.updatedAt)}
            </span>
          </span>
          <span className="mt-px flex h-4 items-center gap-1.5">
            {thread.status === "working" && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" />
            )}
            {/* Anything still moving says so by shining, here as in the thread
                (bot-tool) and the pill (Chip). */}
            {thread.status === "working" && !attention ? (
              <ShinyText
                text={line.text}
                speed={2.2}
                // The shine brings its own ink; only the placeholder's italic carries over.
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] leading-4",
                  line.tone.includes("italic") && "italic",
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
                await answer(thread, option);
                setSending(null);
              }}
              className="h-7 gap-1.5 rounded-full border-border bg-background px-3 text-[12px]"
            >
              {option === THREAD_CONTINUE && (
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

/** Second row of a thread line: the question, the outcome, or the bot's last step. */
function secondLine(thread: ThreadView): { text: string; tone: string } {
  const question = thread.room.questions[0];
  if (question) {
    return { text: plainText(question.text), tone: "text-foreground" };
  }
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
      tone: had ? "text-muted-foreground" : "text-foreground",
    };
  }
  const last = lastSaid(thread);
  if (!last) {
    return {
      text: `${thread.bot.name} is taking it on…`,
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

/**
 * The thread as it is drawn: without the questions still waiting on the user.
 * The reply sheet holds those (ThreadReply), and each joins the thread as a record
 * once answered. A room question is matched by who asked and what, since its ID
 * names the exchange rather than the thread line.
 */
function withoutOpenQuestions(thread: ThreadView): ThreadView {
  const open = new Set(
    thread.room.questions.map(
      (question) => `${question.bot}\n${question.text.trim()}`,
    ),
  );
  if (!open.size) return thread;
  return {
    ...thread,
    lines: thread.lines.filter(
      (line) =>
        !(
          line.kind === "ask" &&
          line.question &&
          line.to?.name === THURSDAY.name &&
          open.has(`${line.bot.name}\n${line.text.trim()}`)
        ),
    ),
  };
}

/**
 * A whole thread as the conversation between its participants, from one bot's
 * tab (thread.store threadItems). Follows the newest line while the reader is at
 * the bottom. Also used by the Threads settings screen.
 */
export function Conversation({
  thread,
  tab = null,
  onTab,
  className,
  tabsClassName,
}: {
  thread: ThreadView;
  /** Another bot whose tab is open; null is the thread's own. */
  tab?: string | null;
  /** Keeps the picked tab. Without it the thread draws on its own bot's tab, with no tabs. */
  onTab?: (bot: string | null) => void;
  className?: string;
  tabsClassName?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const roster = rosterOf(thread);
  const side =
    onTab && tab !== thread.bot.name && roster.some((bot) => bot.name === tab)
      ? tab
      : null;
  const self = side ?? thread.bot.name;
  // Who is still at it says so at the end of the tab that holds them.
  const live = roster.filter(
    (bot) => (!side || bot.name === side) && standingOf(thread, bot.name),
  );
  const items = threadItems(withoutOpenQuestions(thread), self, live);

  // A different thread, or another side of it, starts at its own end.
  useEffect(() => {
    following.current = true;
  }, [thread.id, side]);

  useEffect(() => {
    const box = scroller.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [thread.lines, thread.status, side]);

  return (
    // One FileViewer per conversation, not per bubble.
    <FileViewer>
      {onTab && (
        <ThreadTabs
          thread={thread}
          roster={roster}
          side={side}
          onPick={onTab}
          className={tabsClassName}
        />
      )}
      <div
        ref={scroller}
        onScroll={(event) => {
          const box = event.currentTarget;
          following.current =
            box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        }}
        className={cn(
          "min-w-0 max-h-[64vh] space-y-3 overflow-y-auto px-4 pt-6 pb-4 mask-[linear-gradient(to_bottom,transparent,black_2rem)] scrollbar-none",
          className,
        )}
      >
        {!side && <Request thread={thread} />}
        {items.map((item) =>
          item.kind === "invite" ? (
            <Invite key={item.key} from={item.from} to={item.to} />
          ) : (
            <SpeakerTurn
              key={item.key}
              turn={item}
              thread={thread}
              self={self}
            />
          ),
        )}
      </div>
    </FileViewer>
  );
}

/**
 * The thread's own bot first, where the thread opens and always there, then each
 * bot it brought in. A running bot's tab spins and one waiting on the user
 * carries its dot, so who is busy reads before any tab is opened.
 */
function ThreadTabs({
  thread,
  roster,
  side,
  onPick,
  className,
}: {
  thread: ThreadView;
  roster: BotRef[];
  side: string | null;
  onPick: (bot: string | null) => void;
  className?: string;
}) {
  return (
    <Tabs
      value={side ?? thread.bot.name}
      onValueChange={(value) =>
        onPick(value === thread.bot.name ? null : String(value))
      }
      className={cn("shrink-0 gap-0 px-3 pt-1 pb-0.5", className)}
    >
      <TabsList className="w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 scrollbar-none group-data-horizontal/tabs:h-auto">
        {roster.map((bot) => {
          const standing = standingOf(thread, bot.name);
          return (
            <TabsTrigger
              key={bot.name}
              value={bot.name}
              className={cn(TAB, "pl-1.5")}
            >
              <BotMark
                size={16}
                seed={bot.name}
                color={bot.icon?.color}
                shape={bot.icon?.shape}
                outline={bot.icon?.outline}
                paint={bot.icon?.paint}
                notify={standing === "asking"}
                className="shrink-0"
              />
              <span className="max-w-28 truncate">{bot.name}</span>
              {standing === "running" && (
                <Loader2 className="size-3 animate-spin text-muted-foreground/70" />
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

/** A tab as a pill that fills while its side is on screen, in place of the boxed look TabsTrigger brings. */
const TAB =
  "h-7 flex-none rounded-full px-3 py-0 text-[12px] text-muted-foreground hover:bg-muted/60 data-active:bg-muted data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-muted";

/** Whether a bot is at work in this thread or waiting on the user's answer. */
function standingOf(
  thread: ThreadView,
  bot: string,
): "running" | "asking" | null {
  const { room } = thread;
  if (room.questions.some((question) => question.bot === bot)) return "asking";
  return thread.status === "working" &&
    room.participants.some((one) => one.bot === bot && one.state === "running")
    ? "running"
    : null;
}

/**
 * One speaker's entries in a row. The open tab's bot holds the left, its work in
 * full and its words on no surface; everyone else answers from the right — the
 * user's side in the dark bubble, other bots on `secondary` with their work
 * folded into rows. A message to a bot other than the tab's names it at its head,
 * once while the addressee stays the same.
 */
function SpeakerTurn({
  turn,
  thread,
  self,
}: {
  turn: Extract<ThreadItem, { kind: "turn" }>;
  thread: ThreadView;
  /** The bot whose tab is open. */
  self: string;
}) {
  const mine = turn.speaker.name === self;
  const surface: Surface = mine
    ? "none"
    : turn.speaker.name === THURSDAY.name
      ? "dark"
      : "secondary";
  let named: string | null = null;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Turn
        side={mine ? "start" : "end"}
        name={turn.speaker.name}
        mark={<TurnMark bot={turn.speaker} />}
      >
        {turn.entries.map((entry) => {
          if (entry.kind === "work") {
            return mine ? (
              <OwnWork
                key={entry.key}
                lines={entry.lines}
                trailing={entry.open}
                bot={turn.speaker}
                thread={thread}
              />
            ) : (
              <WorkRow
                key={entry.key}
                lines={entry.lines}
                trailing={entry.open}
                bot={turn.speaker}
                thread={thread}
              />
            );
          }
          const to = heardBy(entry.line);
          const mention =
            to &&
            to.name !== turn.speaker.name &&
            to.name !== self &&
            to.name !== THURSDAY.name &&
            to.name !== named
              ? to
              : null;
          if (to) named = to.name;
          return (
            <Message
              key={entry.key}
              line={entry.line}
              surface={surface}
              mention={mention}
            />
          );
        })}
      </Turn>
    </div>
  );
}

/**
 * A bot's work between its messages as one row: what it did, counted, once it
 * has moved on, and the step it is on while it is still at it. It opens in
 * place to the steps, stops and words beside them.
 */
function WorkRow({
  lines,
  trailing,
  bot,
  thread,
}: {
  lines: Chatter[];
  /** No message has followed it yet, so it may be what the bot is on now. */
  trailing: boolean;
  bot: BotRef;
  thread: ThreadView;
}) {
  const [open, setOpen] = useState(false);
  const standing = trailing ? standingOf(thread, bot.name) : null;
  const counts = countsOf(lines);
  if (!standing && !counts) return null;
  const last = lines.findLast(
    (line) => line.kind === "tool" || line.kind === "say",
  );
  const shown = open && lines.length > 0;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-2xl bg-muted/40 p-1",
        shown ? "w-full" : "w-fit max-w-full",
      )}
    >
      <button
        type="button"
        disabled={!lines.length}
        aria-expanded={shown}
        onClick={() => setOpen((was) => !was)}
        className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left outline-none transition-colors enabled:hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {standing === "running" && (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/60" />
        )}
        {standing ? (
          <ShinyText
            text={
              standing === "asking"
                ? "waiting on you"
                : last
                  ? stepOf(last)
                  : "working"
            }
            tone={standing === "asking" ? "waiting" : "muted"}
            speed={2.4}
            className="min-w-0 truncate text-[12px] leading-4"
          />
        ) : (
          <span className="min-w-0 truncate font-mono text-[10px] leading-4 text-muted-foreground">
            {counts}
          </span>
        )}
        {lines.length > 0 && (
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform",
              shown && "rotate-180",
            )}
          />
        )}
      </button>
      {shown && (
        <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
          {runs(lines).map((run) =>
            run.kind === "tools" ? (
              run.lines.map(
                (line) =>
                  line.tool && (
                    // All start collapsed; a running call expands itself (bot-tool Frame).
                    <BotTool
                      key={line.id}
                      tool={line.tool}
                      threadId={thread.id}
                      collapsed
                    />
                  ),
              )
            ) : run.kind === "stops" ? (
              <div key={run.key} className="px-1.5 py-1">
                <Stops lines={run.lines} />
              </div>
            ) : (
              run.lines.map((line) => <Line key={line.id} line={line} inset />)
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The open tab's bot's own work, in full: nobody opens a row to read what the
 * bot on screen did. While it is at it with nothing mid-call, a shining line says
 * so; a call mid-way already shines on its own row.
 */
function OwnWork({
  lines,
  trailing,
  bot,
  thread,
}: {
  lines: Chatter[];
  /** No message has followed it yet, so it may be what the bot is on now. */
  trailing: boolean;
  bot: BotRef;
  thread: ThreadView;
}) {
  const standing = trailing ? standingOf(thread, bot.name) : null;
  const calling = lines.some(
    (line) => line.tool && line.tool.results === undefined,
  );
  return (
    <>
      {runs(lines).map((run) =>
        run.kind === "tools" ? (
          <Steps key={run.key} lines={run.lines} threadId={thread.id} />
        ) : run.kind === "stops" ? (
          <Stops key={run.key} lines={run.lines} />
        ) : (
          run.lines.map((line) => <Line key={line.id} line={line} />)
        ),
      )}
      {standing && !calling && (
        <ShinyText
          text={standing === "asking" ? "waiting on you" : "on the next step…"}
          tone={standing === "asking" ? "waiting" : "muted"}
          speed={2.2}
          className="block px-1 font-mono text-[10px]"
        />
      )}
    </>
  );
}

/**
 * A run of tool calls as one box of collapsed rows, so the length costs scroll,
 * not noise. A running call opens itself (bot-tool Frame).
 */
function Steps({ lines, threadId }: { lines: Chatter[]; threadId: string }) {
  return (
    <div className="flex w-full flex-col gap-0.5 rounded-2xl bg-muted/40 p-1">
      {lines.length > 1 && (
        <p className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {lines.length} steps
        </p>
      )}
      {lines.map(
        (line) =>
          line.tool && (
            <BotTool
              key={line.id}
              tool={line.tool}
              threadId={threadId}
              collapsed
            />
          ),
      )}
    </div>
  );
}

/** "3 steps · 1 note", leaving out what did not happen; notes are the words beside a call. */
function countsOf(lines: Chatter[]): string {
  const words = [
    ["tool", "step"],
    ["say", "note"],
    ["stop", "stop"],
    ["note", "compaction"],
  ] as const;
  return words
    .map(
      ([kind, word]) =>
        [lines.filter((line) => line.kind === kind).length, word] as const,
    )
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? "" : "s"}`)
    .join(" · ");
}

/** What a line is doing in the model's own words: a step's label, or what was said. */
function stepOf(line: Chatter): string {
  if (line.kind === "tool" && line.tool) {
    return line.tool.note ?? `${line.tool.name} · ${line.tool.input}`;
  }
  return plainText(line.text).replace(/\s+/g, " ").trim();
}

/** The delegated request, folded to three lines (FoldedText). */
function Request({ thread }: { thread: ThreadView }) {
  return (
    <>
      <Invite from={THURSDAY} to={thread.bot} />
      <Turn side="end" name={THURSDAY.name} mark={<TurnMark bot={THURSDAY} />}>
        <Said dark className="py-2 pr-2 pl-3.5">
          <FoldedText
            text={thread.request}
            subject="request"
            className="wrap-anywhere"
          />
        </Said>
      </Turn>
    </>
  );
}

/**
 * The user's side of a thread, which Thursday stands for; she is not a bot and has
 * no row to read a face from. Her face is always ThursdayMark (features/thursday).
 */
const THURSDAY: BotRef = { name: ROOM_THURSDAY };

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
      {bot.name === THURSDAY.name ? (
        <ThursdayMark size={15} className="shrink-0" />
      ) : (
        <BotMark
          size={15}
          seed={bot.name}
          color={bot.icon?.color}
          shape={bot.icon?.shape}
          outline={bot.icon?.outline}
          paint={bot.icon?.paint}
          notify={false}
          className="shrink-0"
        />
      )}
      <span className="truncate">{bot.name}</span>
    </span>
  );
}

/** A turn's face: the user's side draws Thursday's, a bot its own. */
function TurnMark({ bot }: { bot: BotRef }) {
  return bot.name === THURSDAY.name ? (
    <ThursdayMark size={26} className="mt-1 shrink-0" />
  ) : (
    <BotMark
      size={26}
      seed={bot.name}
      color={bot.icon?.color}
      shape={bot.icon?.shape}
      outline={bot.icon?.outline}
      paint={bot.icon?.paint}
      notify={false}
      className="mt-1 shrink-0"
    />
  );
}

/**
 * Words from the other side of the tab. The user's side speaks in the one dark
 * bubble, whose contents take the other theme (`.inverse`, globals.css) so
 * Markdown's own surfaces — inline code, a code block, a link — stay readable on
 * it; other bots answer on `secondary`. `.inverse` is not on `BubbleContent`
 * itself, whose `bg-primary` would swap too.
 */
function Said({
  dark = false,
  children,
  className,
}: {
  dark?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Bubble
      align="end"
      variant={dark ? "default" : "secondary"}
      className="max-w-full"
    >
      <BubbleContent className={cn("rounded-tr-md px-3.5", className)}>
        <div className={cn("min-w-0", dark && "inverse")}>{children}</div>
      </BubbleContent>
    </Bubble>
  );
}

/**
 * One speaker's turn: a face, the name, and what it said and did. The start side
 * is the open tab's bot; the end side is everyone who talks with it.
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
          a one-line remark from the same speaker then end on the same edge. The
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

/** Where a message sits: the tab's bot on none, the user's side dark, other bots `secondary`. */
type Surface = "none" | "dark" | "secondary";

/**
 * A message: what passed between participants, a bot's reply, or the ending. A
 * question keeps its word as a record; the ending carries the files it names and
 * a copy.
 */
function Message({
  line,
  surface,
  mention,
}: {
  line: Chatter;
  surface: Surface;
  /** The bot it is for, named at its head (SpeakerTurn). */
  mention: BotRef | null;
}) {
  const question = Boolean(line.question);
  const ending = line.kind === "result";
  const bubble = surface !== "none";
  const words = (
    <>
      {question && <QuestionWord />}
      {mention ? (
        <Mentioned bot={mention} bubble={bubble}>
          {line.text}
        </Mentioned>
      ) : (
        <MessageText bubble={bubble} className={cn(!ending && "leading-snug")}>
          {line.text}
        </MessageText>
      )}
    </>
  );

  return (
    <>
      {bubble ? (
        <Said dark={surface === "dark"}>{words}</Said>
      ) : (
        <div className="min-w-0 max-w-full px-1">{words}</div>
      )}
      {ending && (
        // The files it names, and the copy: the end of the answer is where a
        // reader is when they want either.
        <div className="flex items-center gap-2 px-1">
          <PathChips text={line.text} className="min-w-0" />
          <CopyReport text={line.text} />
        </div>
      )}
    </>
  );
}

/**
 * Streamdown's code block as one surface inside a message bubble: its own frame
 * there would be a box in a box.
 */
const IN_BUBBLE =
  "[&_[data-streamdown=inline-code]]:text-[12px] [&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-[10px] [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-background [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:h-7 [&_[data-streamdown=code-block-header]]:px-2.5 [&_[data-streamdown=code-block-header]]:text-[11px] [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent! [&_[data-streamdown=code-block-body]]:px-2.5 [&_[data-streamdown=code-block-body]]:pt-0 [&_[data-streamdown=code-block-body]]:pb-2.5 [&_[data-streamdown=code-block-body]]:text-[12.5px] [&_[data-streamdown=code-block]_div:has(>[data-streamdown=code-block-actions])]:-mt-7 [&_[data-streamdown=code-block-actions]]:mr-1 [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent!";

function MessageText({
  children,
  bubble = false,
  className,
}: {
  children: string;
  /** Inside a message bubble (Said). */
  bubble?: boolean;
  className?: string;
}) {
  return (
    <Markdown
      className={cn(
        "min-w-0 max-w-full text-[13px] leading-relaxed wrap-anywhere break-keep [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:my-0.5 [&_table]:text-[12px] [&_table]:wrap-normal [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        bubble && IN_BUBBLE,
        className,
      )}
    >
      {children}
    </Markdown>
  );
}

/**
 * Who a message is for, at its head: the addressee's face and name. In a bubble
 * the chip takes the page's background, which stands off both bubbles in either
 * theme; on no surface it is muted.
 */
function Mention({ bot, bubble }: { bot: BotRef; bubble: boolean }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-flex h-5 max-w-full items-center gap-1 rounded-full pr-2 pl-[3px] align-[-4px] text-[12px] leading-none font-medium whitespace-nowrap text-foreground",
        bubble ? "bg-background" : "bg-muted",
      )}
    >
      <BotMark
        size={14}
        seed={bot.name}
        color={bot.icon?.color}
        shape={bot.icon?.shape}
        outline={bot.icon?.outline}
        paint={bot.icon?.paint}
        notify={false}
        className="shrink-0"
      />
      <span className="truncate">{bot.name}</span>
    </span>
  );
}

/**
 * Words that follow a mention. The Markdown box dissolves (`contents`) so its
 * first paragraph runs on from the mention; later blocks still break lines.
 */
function Mentioned({
  bot,
  bubble,
  children,
}: {
  bot: BotRef;
  bubble: boolean;
  children: string;
}) {
  return (
    <div className="min-w-0 max-w-full text-[13px] leading-snug">
      <Mention bot={bot} bubble={bubble} />
      <MessageText
        bubble={bubble}
        className="contents leading-snug [&>p:first-child]:inline"
      >
        {children}
      </MessageText>
    </div>
  );
}

/** A question kept as a record. While it waits, the reply sheet holds it in amber. */
function QuestionWord() {
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[12px] leading-4 font-medium text-muted-foreground">
      <CircleQuestionMark className="size-3.5 shrink-0" />
      Question
    </p>
  );
}

/** Work that is not a step: a compaction, or the words beside a call. */
function Line({
  line,
  inset = false,
}: {
  line: Chatter;
  /** Inside a work row, in line with its steps' labels. */
  inset?: boolean;
}) {
  // A compact summary (bot.run compact): a divider, with the summary behind it.
  if (line.kind === "note") {
    return (
      <details className="w-full px-2 py-1 text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 outline-none [&::-webkit-details-marker]:hidden">
          <span className="h-px flex-1 bg-border" />
          <span className="min-w-0 text-center font-mono text-[10px]">
            Compacted — it goes on from its summary
          </span>
          <span className="h-px flex-1 bg-border" />
        </summary>
        <MessageText className="mt-2 rounded-xl bg-muted/40 px-3 py-2 text-[11px]">
          {line.text}
        </MessageText>
      </details>
    );
  }

  return (
    <MessageText
      className={cn(
        "text-[12.5px] text-muted-foreground",
        inset ? "px-2.5 py-1" : "px-1",
      )}
    >
      {line.text}
    </MessageText>
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
 * Where the app stopped the run (room.query pauseRoom, a break the runner retries): a failed model call, a
 * restart, a closed browser. Muted and in the bot's work, since the bot goes on
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

/** What stopped it, without the words behind it: a reason may name those in parentheses. */
const leadOf = (text: string) => text.split(" (")[0].replace(/\.$/, "");

/** Splits a bot's work into runs of tool calls, of stops, and of everything else. */
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
