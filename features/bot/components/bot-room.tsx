"use client";

import { ArrowRight } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { INBOX_FINISHED, PAGE_SIZE } from "@/config";
import { type Bot, type Thread } from "@/features/bot/bot.schema";
import {
  type BotGesture,
  useCrewGestures,
} from "@/features/bot/components/crew-motion";
import { ThreadReply } from "@/features/bot/components/thread-reply";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { useEscape, windowKey } from "@/hooks/use-hotkey";
import { toDate } from "@/lib/date-like";
import { useServerPages } from "@/lib/protocol/use-server-pages";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import {
  botThreads,
  roomOpen,
  roomOpens,
  type ThreadViewStatus,
  threadFromRow,
  useBotThreads,
  useCallWaits,
  useRingingThreads,
  useSeenOnDetail,
  writeLine,
} from "../thread.store";
import { Conversation, ThreadHeader } from "./room-conversation";
import {
  Empty,
  HistoryList,
  ListHeader,
  needsYou,
  Quiet,
  RoomTab,
  ThreadList,
  ThreadLoading,
} from "./room-list";
import {
  Chip,
  CrewRow,
  crewOf,
  Happening,
  happenedIn,
  Moment,
  participantStates,
  RoomState,
  useHandoff,
  waitingStepIn,
} from "./room-pill";

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
  /** On the call-back card, so the pill does not ask for them a second time. */
  const rung = useRingingThreads();
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const [open, setOpen] = useState(false);
  /** Open thread; null shows the list. */
  const [picked, setPicked] = useState<string | null>(null);
  // A thread is read at nearly the window's height and lies over the call; only the write
  // line steps aside for it. The list is a short card in the corner
  const reading = open && picked !== null;
  // The write line is put away while anything stands open here (thread.store roomOpen)
  useEffect(() => {
    roomOpen.set(open ? (reading ? "thread" : "list") : null);
    return () => roomOpen.set(null);
  }, [open, reading]);
  /** The bot each thread shows, by thread id; a thread not in here is on All. */
  const [sides, setSides] = useState<Record<string, string | null>>({});
  /** The list on screen: what is current, or everything that has ended. */
  const [tab, setTab] = useState<RoomTab>("now");
  /** Where History was scrolled, kept while one of its threads is open. */
  const scroll = useRef(0);

  const newest = [...threads].reverse();
  // Endings stay on Now by count, never by time or by being read: the newest
  // INBOX_FINISHED, plus any the user has not had yet however many there are.
  // A cancel is the user's own stop, with nothing to read, so it goes at once.
  let endings = 0;
  const now = newest.filter((entry) => {
    if (entry.status === "cancelled") return false;
    if (entry.status !== "done") return true;
    endings += 1;
    return endings <= INBOX_FINISHED || !entry.seen;
  });

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

  // An open thread is read whole by its id, whether or not a list holds it: the
  // inbox leaves an ended thread's lines out (thread.query listInboxThreads).
  // The key sits under the inbox's, so the `threads` signal keeps it live too.
  const listed = picked
    ? (newest.find((entry) => entry.id === picked) ??
      past.find((entry) => entry.id === picked) ??
      null)
    : null;
  const { data: lone, isLoading: fetching } = useServerRoute<Thread | null>(
    picked ? queryKey.thread(picked) : null,
  );
  const alone = useMemo(
    () => (lone && lone.id === picked ? threadFromRow(lone, bots) : null),
    [lone, picked, bots],
  );
  // A listed thread that carries its lines opens at once and the whole one
  // takes over; one that does not waits, rather than flashing an empty room.
  const current = alone ?? (listed?.lines.length ? listed : null);

  const [moment, handoff] = useHandoff();
  // A moment passes; words that wait on a bot stay up under it until they are read
  const bubble = useMemo(
    () =>
      moment ??
      waitingStepIn(threads, (name) => ({
        name,
        icon: bots?.find((bot) => bot.name === name)?.icon ?? null,
      })),
    [moment, threads, bots],
  );
  const { crew, more } = useMemo(() => crewOf(bots, threads), [bots, threads]);
  const [playing, play] = useCrewGestures();

  // The crew arriving is the one thing the whole row answers, and it answers once:
  // before the bots are read the row is stand-ins, and a wave on those would be a
  // greeting from nobody.
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || !bots?.length) return;
    greeted.current = true;
    play(bots.map((bot) => ({ bot: bot.name, gesture: "wave" as const })));
  }, [bots, play]);

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
    // most, and of equals the later. Every gesture it turned up plays, though —
    // each sits on its own face, so they never cover one another.
    let top: Happening | null = null;
    const felt: BotGesture[] = [];
    for (const thread of threads) {
      const { moments, gestures } = happenedIn(
        thread,
        was.get(thread.id),
        had,
        stood,
        standing.current,
      );
      felt.push(...gestures);
      for (const one of moments) {
        if (!top || one.rank >= top.rank) top = one;
      }
    }
    if (top) handoff(top);
    play(felt);
  }, [threads, handoff, play]);

  // Reading a thread is reading its ending; that is what clears its dot.
  useSeenOnDetail(open ? current : null);

  // Thursday put a job in front of the user (`thread` `open`): the room opens on it
  useAppEvent({
    showThread: (event) => {
      setPicked(event.threadId);
      setOpen(true);
    },
  });

  // "Open thread" on the call-back card: the same, asked for by the screen
  useEffect(
    () =>
      roomOpens.subscribe((id) => {
        setPicked(id);
        setOpen(true);
      }),
    [],
  );

  const busy = threads.filter((entry) => entry.status === "working").length;
  const pending = newest.filter(needsYou).length;
  // In the open room the list says what each bot is on; its foot keeps the faces,
  // so a step's words never come and go under the list.
  const faces = useMemo(
    () => crew.map((face) => ({ ...face, word: null })),
    [crew],
  );

  // The room always opens on Now. A thread left open would greet the next click
  // on the pill, and a History one would not be found once its pages stop being read.
  const fold = () => {
    setOpen(false);
    setPicked(null);
    setTab("now");
    scroll.current = 0;
  };

  // Her call in writing is still on behind the room, its line put away (write-line)
  const callWaits = useCallWaits();

  // Esc walks back the way the header's own two buttons do: a thread returns to the
  // list it was picked from, and the list folds away.
  useEscape(open, () => (reading ? setPicked(null) : fold()));

  // Asking for the write line folds the room, whoever asks: its own "+", `/`, a file put
  // down elsewhere. The two never share the screen.
  const foldRef = useRef(fold);
  foldRef.current = fold;
  useEffect(() => writeLine.subscribe(() => foldRef.current()), []);

  // With a thread open `/` is still the way to the message box, and the one on screen is
  // this thread's. A thread with no box to write in (a bot on a step) leaves the key alone.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reading) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (!windowKey(event)) return;
      const box = panel.current?.querySelector<HTMLTextAreaElement>(
        "textarea:not(:disabled)",
      );
      if (!box) return;
      event.preventDefault();
      box.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reading]);

  return (
    // Two places, one for each state (thursday CallFoot). Folded, the pill is a fixture at
    // the right end of the rail and stays there whatever else is on screen. Open, the room
    // is not a fixture: it takes the row above the rail, all the height the rail leaves and
    // none of its width, and is read there files and all, over the right of the call (which
    // does not move for it).
    <div
      className={cn(
        "pointer-events-none flex min-h-0 items-end justify-end",
        // stretched to the row, so the room's own `max-h-full` has a height to be full of:
        // left to its content, a long list grows straight past the top of the window
        open
          ? "col-span-3 row-start-1 self-stretch"
          : "col-start-3 row-start-2",
      )}
    >
      {open ? (
        <div
          ref={panel}
          // what is dropped on the room is the open thread's (given-files roomDrop)
          data-room
          className="pointer-events-auto flex max-h-full w-160 max-w-full animate-in flex-col overflow-hidden rounded-3xl bg-background/75 shadow-2xl shadow-black/6 ring-1 ring-border/50 backdrop-blur-xl fade-in slide-in-from-bottom-1 duration-200"
        >
          {callWaits && <CallWaits onBack={fold} />}
          {!current && picked && fetching ? (
            <ThreadLoading onBack={() => setPicked(null)} onClose={fold} />
          ) : current ? (
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
                faces={current.roster}
                to={sides[current.id] ?? current.bot.name}
                className="mx-3 mb-2 shrink-0"
              />
            </>
          ) : (
            <>
              <ListHeader
                tab={tab}
                current={now.length}
                onTab={setTab}
                onClose={fold}
              />
              {tab === "history" ? (
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
                playing={playing}
                label="Fold the room away"
                onClick={fold}
                onWrite={writeLine.open}
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
          playing={playing}
          // What waits on the user and nothing else: a finished job's result is the left
          // corner's card (artifact-view), and one notice is enough
          rows={newest.filter(
            (thread) => !rung.includes(thread.id) && needsYou(thread),
          )}
          count={threads.length}
          busy={busy}
          pending={pending}
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

/**
 * Said at the head of the open room while a call in writing waits behind it. The room has
 * the foot, so the line that would say the call is on is not drawn: without this, opening
 * a thread mid-conversation looks like the conversation ended. It is her face and a way
 * back in one press, since Esc from a thread takes two.
 */
function CallWaits({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="group/waits flex shrink-0 items-center gap-2.5 bg-brand/8 py-2.5 pr-3 pl-4 text-left outline-none transition-colors hover:bg-brand/12 focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-brand/14 dark:hover:bg-brand/20"
    >
      <ThursdayMark size={22} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[13px] leading-5">
        <span className="font-medium">Thursday is still on the line</span>
        <span className="text-muted-foreground">
          {" "}
          — in writing. She is here when this closes.
        </span>
      </span>
      <span className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 font-medium text-[12.5px] text-brand ring-1 ring-brand/40 transition-colors group-hover/waits:bg-brand/10">
        Back to her
        <ArrowRight className="size-3.5" />
      </span>
    </button>
  );
}
