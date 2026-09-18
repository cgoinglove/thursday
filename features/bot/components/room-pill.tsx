"use client";
import {
  Check,
  CirclePause,
  CircleQuestionMark,
  Loader2,
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
import { type Bot, type BotIcon, isAppStop } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { cn, plainText, WAITING_INK } from "@/lib/utils";
import { MARK_PALETTE, MARK_SHAPES } from "../mark.const";
import {
  type BotRef,
  type Chatter,
  latestPerBot,
  rosterOf,
  type ThreadView,
  type ThreadViewStatus,
} from "../thread.store";

import { Compose, ComposeButton, RoundButton } from "./room-compose";
import { leadOf, stepOf, THURSDAY } from "./room-conversation";
import { ThreadRow } from "./room-list";

/** The room folded: the pill at the foot of the call screen, the faces on it, and what passed between two parties riding above one for a moment. Split out of bot-room by subject; see it for the room as a whole. */

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
    const note = thread.room.deliveries.find((one) => !one.delivered);
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
 */
export function happenedIn(
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
export function crewOf(
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
export function Chip({
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
export function CrewRow({
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
export function RoomState(props: {
  busy: number;
  pending: number;
  grown: boolean;
}) {
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
