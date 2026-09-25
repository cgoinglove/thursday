"use client";
import {
  Check,
  CirclePause,
  CircleQuestionMark,
  Loader2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ShinyText } from "@/components/ui/shiny-text";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type Bot,
  type BotIcon,
  isAppStop,
  isUnread,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotTip } from "@/features/bot/components/bot-tip";
import {
  type BotGesture,
  type CrewMotion,
  type CrewPlaying,
  motionOf,
} from "@/features/bot/components/crew-motion";
import { WriteOrb } from "@/features/bot/components/write-orb";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { cn, plainText, WAITING_INK } from "@/lib/utils";
import { MARK_PALETTE, MARK_SHAPES } from "../mark.const";
import {
  type BotRef,
  type Chatter,
  type ThreadView,
  type ThreadViewStatus,
  useWriteLineUp,
  writeLine,
} from "../thread.store";

import { leadOf, stepOf, THURSDAY } from "./room-conversation";
import { ThreadRow } from "./room-list";

/** The room folded: the pill at the foot of the call screen, the faces on it, and what passed between two parties riding above one for a moment. Split out of bot-room by subject; see it for the room as a whole. */

/** Faces the row draws before it starts hiding them (the user's pick). */
const CREW_MAX = 14;

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
  /** Waiting on an answer; carries the amber dot. */
  waiting: boolean;
  /** A result of its nobody has opened; carries the blue one. */
  unread: boolean;
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
  /** Still moving: the words shine, as every line that is does. */
  shine?: boolean;
};

/**
 * Words the user stepped in with that a bot has not read yet, as the line the
 * pill holds by that bot's face until it does. It waits on the bot, not on the
 * user, so it takes no sign and no amber; it shines.
 */
export function waitingStepIn(
  threads: ThreadView[],
  faceOf: (name: string) => BotRef,
): Handoff | null {
  for (const thread of threads) {
    if (thread.status !== "working") continue;
    // Words to an idle bot start it at once, and their own bubble says they arrived
    const note = thread.room.deliveries.find(
      (one) =>
        !one.delivered &&
        thread.room.participants.some(
          (who) => who.bot === one.bot && who.state === "running",
        ),
    );
    if (note)
      return {
        at: note.bot,
        from: faceOf(note.bot),
        to: [],
        text: "Step-in · waits for its next step",
        shine: true,
      };
  }
  return null;
}

/** A hand-off, and how much it matters against others from the same sync. */
export type Happening = Handoff & { rank: number };

const clipWord = (text: string) => {
  const one = plainText(text).replace(/\s+/g, " ").trim();
  return one.length > WORD_MAX ? `${one.slice(0, WORD_MAX - 1)}…` : one;
};

/**
 * The one hand-off up. A newer one replaces it rather than queueing: bubbles
 * over neighbouring faces would cover each other, and the newest thing is the
 * true one.
 */
export function useHandoff(): [Handoff | null, (one: Handoff) => void] {
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
export function participantStates(threads: ThreadView[]): Map<string, string> {
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
 *
 * The same pass says what each face should do about it (`crew-motion`). One sync
 * shows one bubble but every gesture it turned up, because a gesture sits on the
 * face it belongs to and two of them never cover each other.
 */
export function happenedIn(
  thread: ThreadView,
  was: ThreadViewStatus | undefined,
  had: Set<string>,
  stood: Map<string, string>,
  stands: Map<string, string>,
): { moments: Happening[]; gestures: BotGesture[] } {
  const own = thread.bot;
  const felt: BotGesture[] = [];
  // A thread this sync is the first to see — just opened, or back in the inbox
  // after dropping out of it — has no history here, so every line in it would
  // read as having just happened. Being taken on is the news; nothing else is.
  if (!was) {
    return thread.status === "working"
      ? {
          moments: [
            {
              rank: 1,
              at: own.name,
              from: THURSDAY,
              to: [own],
              text: `took on “${clipWord(thread.label)}”`,
            },
          ],
          gestures: [{ bot: own.name, gesture: "took" }],
        }
      : { moments: [], gestures: [] };
  }

  const out: Happening[] = [];
  const fresh = thread.lines.filter((line) => !had.has(line.id));

  // Bot to bot. A giver handing work to several at once is one bubble naming them all.
  const rounds = new Map<string, Chatter[]>();
  for (const line of fresh) {
    if (line.kind === "user") {
      if (line.steppedIn) felt.push({ bot: line.bot.name, gesture: "read" });
      else felt.push({ bot: line.bot.name, gesture: "took" });
      out.push(
        line.steppedIn
          ? // the words were up while they waited (waitingStepIn); read, the bot says so
            {
              rank: 1,
              at: line.bot.name,
              from: line.bot,
              to: [],
              text: "Step-in · read",
            }
          : {
              rank: 1,
              at: line.bot.name,
              from: THURSDAY,
              to: [line.bot],
              text: clipWord(line.text),
            },
      );
    } else if (line.kind === "stop") {
      felt.push({ bot: line.bot.name, gesture: "stop" });
      out.push({
        rank: 3,
        at: line.bot.name,
        from: line.bot,
        to: [],
        sign: "stopped",
        text: leadOf(line.text),
      });
    } else if (line.kind === "ask" && line.to?.name === THURSDAY.name) {
      if (line.question) felt.push({ bot: line.bot.name, gesture: "ask" });
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
    felt.push({ bot: giver, gesture: "give" });
    for (const bot of reached.values())
      felt.push({ bot: bot.name, gesture: "take" });
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
  for (const bot of thread.roster) {
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
      felt.push({ bot: bot.name, gesture: "done" });
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

  if (was === thread.status) return { moments: out, gestures: felt };
  const label = clipWord(thread.label);
  if (thread.status === "cancelled") {
    felt.push({ bot: own.name, gesture: "stop" });
    out.push({
      rank: 3,
      at: own.name,
      from: own,
      to: [],
      sign: "cancelled",
      text: `stopped · ${label}`,
    });
  } else if (thread.status === "done") {
    // A job's own ending is the card in the screen's left corner (artifact-view); the pill
    // keeps its bubbles for what is still going on. The face still says it happened — a
    // somersault is on the bot, not over it, so it never stands where the card's notice would.
    felt.push({ bot: own.name, gesture: "done" });
  } else if (thread.status === "working") {
    // Words from the user already have their bubble.
    if (!fresh.some((line) => line.kind === "user")) {
      felt.push({ bot: own.name, gesture: "took" });
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
    felt.push({ bot: own.name, gesture: "stop" });
    out.push({
      rank: 3,
      at: own.name,
      from: own,
      to: [],
      sign: "stopped",
      text: "paused",
    });
  }
  return { moments: out, gestures: felt };
}

/** The step a bot is on, as the model labelled it. */
function wordOf(line: Chatter | null): string | null {
  return line?.kind === "tool" || line?.kind === "say"
    ? clipWord(stepOf(line))
    : null;
}

/**
 * What each bot is doing, read off its own row in each thread rather than off
 * the thread's status. A thread is working while any one participant runs, so
 * the bots it handed work to rest inside a thread that is still working, and
 * only the one on a step is up.
 *
 * Waiting outranks working: a bot that stopped to ask is not on a step. A
 * question names the bot that asked it; a stop the app made has no question of
 * its own, so that one waits on the thread's own bot.
 */
function standingsOf(
  threads: ThreadView[],
): Map<string, { waiting: boolean; word: string | null }> {
  const out = new Map<string, { waiting: boolean; word: string | null }>();
  for (const thread of threads) {
    const asking = new Set(thread.room.questions.map((one) => one.bot));
    if (thread.status === "waiting" && !asking.size)
      asking.add(thread.bot.name);
    for (const one of thread.room.participants) {
      if (asking.has(one.bot)) {
        out.set(one.bot, { waiting: true, word: null });
        continue;
      }
      if (out.get(one.bot)?.waiting) continue;
      if (one.state !== "running" && one.state !== "queued") continue;
      // A turn in line is not a step: the face is up with nothing to say.
      const line =
        one.state === "running"
          ? thread.lines.findLast(
              (item) =>
                item.bot.name === one.bot &&
                item.kind !== "user" &&
                item.kind !== "note" &&
                item.kind !== "stop",
            )
          : null;
      out.set(one.bot, { waiting: false, word: wordOf(line ?? null) });
    }
  }
  return out;
}

/**
 * Who is in the row, in the order it is drawn.
 *
 * Anyone moving sorts to the front, so the mark at the tail only ever hides
 * idle bots — a bot with something to say always has a face to say it from,
 * which is what lets a hand-off point at one. A bot at work inside somebody
 * else's job is in the room too, whether or not it owns a row of its own.
 */
export function crewOf(
  bots: Bot[] | undefined,
  threads: ThreadView[],
): { crew: CrewFace[]; more: number } {
  // What is finished and unopened is the other thing a face can carry (the user's pick)
  const unread = new Set(
    threads.filter(isUnread).map((thread) => thread.bot.name),
  );
  const live = standingsOf(threads);

  const named = new Map<string, CrewFace>();
  for (const bot of bots ?? []) {
    named.set(bot.name, {
      name: bot.name,
      icon: bot.icon,
      awake: live.has(bot.name),
      waiting: live.get(bot.name)?.waiting ?? false,
      unread: unread.has(bot.name),
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
      unread: unread.has(name),
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

  // Who needs the user first, then who is moving, then who left something to read
  const rank = (face: CrewFace) =>
    face.waiting ? 0 : face.awake ? 1 : face.unread ? 2 : face.standIn ? 4 : 3;
  const sorted = roster
    .map((face, at) => ({ face, at }))
    .sort((a, b) => rank(a.face) - rank(b.face) || a.at - b.at)
    .map((one) => one.face);

  return {
    crew: sorted.slice(0, CREW_MAX),
    more: Math.max(0, sorted.length - CREW_MAX),
  };
}

/**
 * What the room itself is doing, and nothing else — the right side of the pill.
 *
 * It says two things only, in muted ink: someone waits on the user, or work is
 * running. Endings say nothing here: a finished job's result is the left
 * corner's card. With nothing going on and nothing grown, the pill offers a
 * hand; with a row grown and nothing going on, it is quiet.
 *
 * The write line takes nothing away from this: the line has a track of its own
 * and stands in it whatever the pill is saying (thursday CallFoot).
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
 * Questions and stops grow above the row until answered; a finished job's
 * result is the left corner's card, never a row here. The pill's own click
 * opens the room to read the full history.
 *
 * The corner radius does not animate with the height: interpolating a pill radius
 * down to a card radius while the box is also resizing warps the corners in flight.
 */
export function Chip({
  crew,
  more,
  bubble,
  rows,
  count,
  busy,
  pending,
  playing,
  onPick,
  onOpen,
}: {
  crew: CrewFace[];
  more: number;
  /** The hand-off up, if any (useHandoff). */
  bubble: Handoff | null;
  /** Open questions and stops, newest first. */
  rows: ThreadView[];
  count: number;
  busy: number;
  pending: number;
  /** The gesture each face is in the middle of, by bot name (crew-motion). */
  playing: CrewPlaying;
  onPick: (id: string) => void;
  onOpen: () => void;
}) {
  // A grown card is the room's width, and with the line up the rail leaves the pill half
  // of what is beside it (thursday CallFoot): the card would open narrower than it closes.
  // It stays a pill instead, and its rows stand on the line itself (write-line).
  const lineUp = useWriteLineUp();
  const grown = rows.length > 0 && !lineUp;

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
      {/* One box, two heights: the rows grow out of nothing rather than appearing.
          Folded they are still laid out, so their width is contained: the pill is as
          wide as its own row, not as the card it folded from. */}
      <div
        className={cn(
          "grid overflow-hidden contain-inline-size transition-[grid-template-rows] duration-300 ease-out",
          grown ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* Collapsed, this is still in the tree so the height can animate — inert
            keeps it out of the tab order and out of the way of a click. */}
        <div className="min-h-0 overflow-hidden" inert={!grown}>
          <p className="px-3 py-2 font-mono text-[10px] tracking-wide text-muted-foreground">
            {pending} {pending === 1 ? "needs" : "need"} a reply
          </p>
          {/* px-1: a row keeps its own 8px, so its mark lands on the rail while
              the shape it lights up on hover stays inside the card's corners */}
          {/* about three rows, the rest a scroll away: the count above says how many */}
          <div className="max-h-[34vh] overflow-y-auto px-1.5 pb-2">
            {/* Keyed on growing, so the rows rise in after the card each time it opens */}
            <div key={String(grown)}>
              {rows.map((thread, index) => (
                <div
                  key={thread.id}
                  style={{ animationDelay: `${120 + index * 60}ms` }}
                  className="animate-in duration-300 fill-mode-backwards fade-in slide-in-from-bottom-1"
                >
                  <ThreadRow thread={thread} onPick={() => onPick(thread.id)} />
                </div>
              ))}
            </div>
          </div>
          <span className="block h-1.5" />
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
        playing={playing}
        side={<RoomState busy={busy} pending={pending} grown={grown} />}
        onWrite={writeLine.open}
        writing={lineUp}
      />
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
export function CrewRow({
  crew,
  more,
  bubble,
  playing,
  side,
  label,
  onClick,
  onWrite,
  writing,
}: {
  crew: CrewFace[];
  more: number;
  bubble: Handoff | null;
  /** The gesture each face is in the middle of, by bot name (crew-motion). */
  playing: CrewPlaying;
  /** The right side: the room's state, or what just happened. */
  side: ReactNode;
  label: string;
  onClick: () => void;
  /** Opens the write line: the pill's own "+", at its left end rather than loose beside it. */
  onWrite: () => void;
  /** The line that button opens is up. */
  writing?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 py-1.5 pr-3 pl-1.5">
      {/* The tip names the key too: `/` is the way in that nothing else on screen shows */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onWrite}
              aria-label="Write to Thursday or a bot"
              aria-pressed={writing}
              className={cn(
                "relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full outline-none transition-[background-color,box-shadow] duration-300 focus-visible:ring-3 focus-visible:ring-ring/50",
                // While the line it opens stands above, the button is the line: smoke turning
                // over in the glass (write-orb), lifted a little off the pill. It keeps its box
                // either way, so the pill is the same pill, and pressing it again puts the
                // caret back.
                writing
                  ? "shadow-[0_6px_14px_-7px_color-mix(in_oklab,var(--brand)_60%,transparent)]"
                  : "bg-muted text-foreground hover:bg-accent",
              )}
            />
          }
        >
          <WriteOrb on={Boolean(writing)} />
          <Plus
            className={cn(
              "size-3.5 transition-opacity duration-200",
              writing ? "opacity-0" : "opacity-100",
            )}
          />
        </TooltipTrigger>
        <TooltipContent>
          Write to Thursday or a bot
          <kbd
            data-slot="kbd"
            className="bg-background/20 px-1.5 font-mono text-[10px]"
          >
            /
          </kbd>
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Crew crew={crew} more={more} bubble={bubble} playing={playing} />
        {side}
      </button>
    </div>
  );
}

/**
 * The room's own state and its glyph: one group, and the only thing on the right.
 * `ml-auto` keeps it there when the crew says nothing.
 */
export function RoomState(props: {
  busy: number;
  pending: number;
  grown: boolean;
}) {
  const state = restingState(props);
  if (!state) return null;
  return (
    // Shrinks before the faces do: a crowded row has no space for words, and what
    // the words say is already on the faces (a dot, a word beside the one moving).
    <span className="ml-auto flex h-7 min-w-0 shrink items-center gap-1.5">
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

/** Stand-in faces for an install with no bots. Fixed, not random: this renders on the server too and Math.random would break hydration. */
const GHOSTS: CrewFace[] = ["alto", "brio", "cinder", "delta"].map(
  (seed, index, seeds) => ({
    name: seed,
    icon: {
      color:
        MARK_PALETTE[Math.floor((index * MARK_PALETTE.length) / seeds.length)],
      shape: MARK_SHAPES[index % MARK_SHAPES.length],
    },
    awake: false,
    waiting: false,
    unread: false,
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
 * order to decide, and it sits outside the gesture layers so a bot at work is
 * still lifted while it jumps.
 *
 * Under that, a face is three layers and a mark (`crew-motion`): the body through
 * the air, the shape pressing and flattening, the turn. At rest the shape layer
 * breathes. They are keyed on the gesture, so a second event on one face starts
 * over rather than landing mid-way through the first.
 */
/**
 * What a face says when the pointer rests on it: the same state its dot and lift already show.
 * A stand-in speaks only for a crew of stand-ins; beside real bots it is no bot, and has
 * nothing true to say.
 */
function tipOf(face: CrewFace, crew: CrewFace[]): string | null {
  if (face.standIn)
    return crew.every((one) => one.standIn) ? "No bots yet" : null;
  if (face.waiting) return "Waiting on you";
  if (face.word) return face.word;
  if (face.unread) return "Left you a result";
  return face.awake ? "Working" : "Idle";
}

function Crew({
  crew,
  more,
  bubble,
  playing,
}: {
  crew: CrewFace[];
  more: number;
  /** The hand-off up, drawn over the face it points at. */
  bubble: Handoff | null;
  playing: CrewPlaying;
}) {
  return (
    <span className="flex min-w-0 shrink items-center">
      {crew.map((face, index) => {
        const tip = tipOf(face, crew);
        const body = (
          <span
            // The lift is the face's alone, so an awake face does not swell its bubble.
            className={cn(
              "flex transition-transform duration-500 ease-out",
              face.awake && "-translate-y-0.5 scale-110",
            )}
          >
            <CrewBody
              face={face}
              motion={motionOf(playing.get(face.name), index)}
            />
          </span>
        );
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
              {tip === null ? (
                // The span a tip's trigger would be, so the face sits where it does with one
                <span>{body}</span>
              ) : (
                <BotTip bot={face.name} icon={face.icon} line={tip}>
                  {body}
                </BotTip>
              )}
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
        // Past CREW_MAX the row stops growing. Only idle bots are ever behind it —
        // anyone moving sorted to the front — so the tail says there are more and not
        // how many (the user's pick): a count nobody can act on is a number to read.
        <span
          className="ml-2 flex h-[18px] shrink-0 items-center rounded-full bg-brand/10 px-2 font-mono text-[10.5px] leading-none font-medium text-brand"
          title={`${more} more`}
        >
          +
        </span>
      )}
    </span>
  );
}

/**
 * A face's moving parts: the body, the shape and the turn, outermost first.
 *
 * Each layer animates one thing, because one element can only animate `transform`
 * once and a jump needs its height and its squash on different curves. `data-crew-motion`
 * is what a machine asked to hold still switches off (app/globals.css).
 */
function CrewBody({ face, motion }: { face: CrewFace; motion: CrewMotion }) {
  const delay = motion.delayMs
    ? { animationDelay: `${motion.delayMs}ms` }
    : undefined;
  return (
    <span
      key={motion.key}
      data-crew-motion
      className={cn("flex", motion.body)}
      style={delay}
    >
      <span
        data-crew-motion
        className={cn("flex origin-bottom", motion.shape)}
        style={delay}
      >
        <span
          data-crew-motion
          className={cn("flex", motion.turn)}
          style={delay}
        >
          <CrewMark face={face} />
        </span>
      </span>
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
      notify={face.waiting || face.unread}
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
export function Moment({ handoff }: { handoff: Handoff }) {
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
      {handoff.shine ? (
        <ShinyText
          text={handoff.text}
          speed={2.2}
          className="min-w-0 truncate"
        />
      ) : (
        <span className="min-w-0 truncate">{handoff.text}</span>
      )}
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
