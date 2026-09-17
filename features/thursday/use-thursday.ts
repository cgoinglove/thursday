"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { CALL_BACK, CALL_END, CALL_IDLE, CALL_RELAY } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { acceptThreadRelaysAction } from "@/features/bot/bot.action";
import { type Bot, isAppStop, type Thread } from "@/features/bot/bot.schema";
import { botThreads, screenActs } from "@/features/bot/thread.store";
import { runRemoteTool } from "@/features/thursday/tool-call";
import { isCombo, useHotkey } from "@/hooks/use-hotkey";
import { useWakeWord } from "@/hooks/use-wake-word";
import { toDate } from "@/lib/date-like";
import type { LiveClose } from "@/lib/live/live.schema";
import {
  type LiveActivity,
  type LiveSession,
  type LiveToolCall,
  openLiveSession,
} from "@/lib/live/live.session";
import {
  type AudioTap,
  createAudioTap,
  SPECTRUM_BANDS,
} from "@/lib/live/live.tap";
import { type Result, unwrapResult } from "@/lib/protocol/result";
import {
  revalidate,
  revalidateAll,
  useServerRoute,
} from "@/lib/protocol/use-server-route";
import { createOutbox, type Outbox } from "@/lib/queue";
import { errorToString } from "@/lib/utils";
import {
  endCallAction,
  openCallAction,
  saveThoughtAction,
  saveTurnsAction,
} from "./thursday.action";
import type {
  CallBack,
  CallMessage,
  CallStatus,
  LiveStatus,
} from "./thursday.schema";
import { thursdaySettings, useThursdayStore } from "./thursday.store";
import { toolBot, toolLine } from "./tool-line";

/**
 * One live call, plus the thread inbox the app watches even with no call open.
 * The server opens the Live session (openCallAction) and runs the tools
 * (tool-call); the page itself only hangs up.
 */

/** Plays when the line opens. */
const CONNECTED_SOUND = "/sounds/start_voice.ogg";

/** Plays when the line closes. */
const HUNG_UP_SOUND = "/sounds/end_voice.ogg";

/**
 * How long a finished tool stays on the activity line. A tool starting inside
 * this window swaps the text instead of re-showing the line.
 */
const TOOL_LINGER_MS = 2500;
/** A relay from a bot carries more to read than a tool line. */
const RELAY_LINGER_MS = 5000;

/**
 * Once the backend's turn is over, how long the activity line keeps saying it is
 * working while it waits for her voice. Her first word is what normally ends it;
 * this is only for a turn that never reaches one.
 */
const THINKING_TAIL_MS = 6000;

/**
 * The face lags the activity line: only a tool held longer than this switches
 * to the working face. Shorter tools show on the line only.
 */
const FACE_TOOL_MS = 800;

/**
 * Gap between the last tool answer and the first audio. The listening face
 * waits this long before showing.
 */
const FACE_SETTLE_MS = 600;

/**
 * How long the face says a call failed to open or dropped before it rests: long
 * enough for the orb to spell its ERROR out. The toast carries the reason.
 */
const FAILED_FACE_MS = 6000;

/** Scrollback for the side-by-side layout; the call view shows at most three. */
const KEEP_MESSAGES = 24;

/** Safety net only; the event stream revalidates threads as they change. */
const THREAD_POLL_FALLBACK_MS = 30_000;

/** Failed saves of one kind before the call stops saving that kind and says so, once. */
const SAVE_FAILURE_LIMIT = 3;

/**
 * Put in as trusted behaviour just ahead of the first relay of a call. The relay
 * itself carries facts only, since the backend reads relays too and routes answers
 * by them.
 */
const RELAY_NOTE =
  "An update from background work follows. If you have already told the user what it says, it need not be said again.";

/**
 * What the activity line draws: a tool the model is using, or a relay. `line` is
 * the human-readable sentence (tool-line), null when none exists; `name` is the
 * tool that actually ran.
 */
export type ActivityLine = {
  name: string;
  line: string | null;
  done: boolean;
  /** The tool call this is, so one call finishing never ends another's line. */
  id?: string;
  /** A relay from a bot (answer or question) rather than a tool; `name` is the thread label. */
  kind?: "relay";
  /** The bot this names, when it names one: the row draws its face instead of a glyph. */
  bot?: string | null;
};

/** A call-back ringing, as the screen names it. */
export type Ringing = {
  /** The bot whose work rang: the one asking, else the thread's own. */
  bot: string;
  kind: "question" | "done" | "stopped";
  label: string;
  /** Other threads ringing with it. */
  more: number;
};

export function useThursday() {
  const session = useRef<LiveSession | null>(null);
  // created on the first call: `new Audio()` cannot run during SSR
  const tap = useRef<AudioTap | null>(null);
  /** Created inside the call-starting click; hang-up may come from a tool or a disconnect with no gesture. */
  const farewell = useRef<HTMLAudioElement | null>(null);

  const [status, setStatus] = useState<CallStatus>("idle");
  /** A call just failed to open or dropped; the face says so for FAILED_FACE_MS. */
  const [failed, setFailed] = useState(false);
  const failedFor = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFailed = useCallback((on: boolean) => {
    if (failedFor.current) clearTimeout(failedFor.current);
    failedFor.current = on
      ? setTimeout(() => setFailed(false), FAILED_FACE_MS)
      : null;
    setFailed(on);
  }, []);
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [tool, setTool] = useState<ActivityLine | null>(null);
  /** When the line opened (ms). */
  const [since, setSince] = useState<number | null>(null);
  /** Seconds until idle hang-up; set only inside CALL_IDLE.warnMs. */
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  /** When the backend picked this turn up (ms); the activity line counts from it. */
  const [thinkingSince, setThinkingSince] = useState<number | null>(null);
  /** The same value where callbacks can read it, and the timer that ends it. */
  const thinking = useRef<number | null>(null);
  const thinkTail = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A relayed update is out and has not been voiced yet: nothing else goes in
   * until her voice has started and stopped.
   */
  const reading = useRef<{
    on: boolean;
    spoke: boolean;
    giveUp: ReturnType<typeof setTimeout> | null;
  }>({ on: false, spoke: false, giveUp: null });
  /** What `session.closed` confirmed for the call being ended; recorded on its row. */
  const finalized = useRef<LiveClose | null>(null);
  /** When the line last had new words from the user, her voice or backend work: the idle clock. */
  const stirred = useRef(0);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the line holds a relay, so only a relay is finished by her voice. */
  const relayOpen = useRef(false);
  // Every server-run tool in this call starts with this signal, so one abort
  // reaches running browser commands. Delegated threads are server-owned and outlive the call
  const working = useRef<AbortController | null>(null);
  /** Row the turns are saved to; a ref so long-lived callbacks see it. */
  const callId = useRef<string | null>(null);
  /**
   * Open work put to her while this page has been open, by item key (openWork):
   * each goes in once a call. A key carries its job's last change, so a job that
   * asks or ends again is new work.
   */
  const told = useRef(new Set<string>());
  /**
   * The call-back rings only for threads that changed after this: the last call's
   * end, the last ring, or the page opening.
   */
  const ringAfter = useRef(Date.now());
  /** The threads a call-back is ringing for, until it is answered, declined or rings out. */
  const [ringingFor, setRingingFor] = useState<string[]>([]);
  const isRinging = ringingFor.length > 0;
  /**
   * Keys put in this call that her voice has not carried yet: rejected, cut short
   * by a hang-up, or never spoken. Hanging up takes them out of `told`, so the
   * next call puts them in again; what she voiced stays out.
   */
  const unvoiced = useRef(new Set<string>());
  /** The keys of the update on the line now, carried once her voice starts and stops on it. */
  const onLine = useRef<string[]>([]);
  /** When her voice was last heard, for letting a goodbye finish (CALL_END). */
  const voiced = useRef(0);
  /** The relay note went in on this call (RELAY_NOTE). */
  const relayNoted = useRef(false);
  /** The hang-up waiting on her goodbye once the backend called end_call. */
  const leaving = useRef<ReturnType<typeof setInterval> | null>(null);
  /** When either side's words were last transcribed: the quiet clock for relays. */
  const heard = useRef(0);
  /**
   * The call-back placed this call and its first relay has not gone in yet: that one
   * goes in once she has voiced the opening rather than waiting for a quiet line.
   */
  const rang = useRef(false);
  /** Backend work or a call tool is running, as the last activity said. */
  const acting = useRef(false);
  /** The inbox as last fetched, read by the relay clock. */
  const latest = useRef<Thread[] | undefined>(undefined);
  /**
   * Context she need not say (screen acts), including what arrives before the
   * line opens. Held until the session exists.
   */
  const outboxRef = useRef<Outbox<string> | null>(null);
  const outbox = (outboxRef.current ??= createOutbox<string>());
  /** Wants a call, including while connecting. */
  const calling = useRef(false);
  /**
   * Opening the line: true only between the click and the session. Distinct
   * from `calling` (true for the whole call), which cannot be the first guard
   * in `call` or the hang-up press is swallowed too.
   */
  const opening = useRef(false);
  const ending = useRef(false);
  /**
   * Which attempt owns the line. A hang-up during startup moves it on, so an
   * attempt still connecting cannot come up after a newer call has been placed.
   */
  const attempt = useRef(0);

  const showTool = useCallback((call: LiveToolCall) => {
    if (linger.current) clearTimeout(linger.current);
    relayOpen.current = false;
    setTool({
      id: call.id,
      name: call.name,
      line: toolLine(call.name, call.arguments),
      bot: toolBot(call.name, call.arguments),
      done: false,
    });
  }, []);

  /**
   * A relay takes the tool line and runs there like a tool does: while it goes in,
   * and while she voices it. Her voice finishing it is what stops the motion
   * (doneReading); after that it stays long enough to read.
   */
  const showRelay = useCallback((run: ActivityLine) => {
    if (linger.current) clearTimeout(linger.current);
    relayOpen.current = true;
    setTool({ ...run, done: false });
  }, []);

  /** Tool finished; lingers, then clears. */
  const hideTool = useCallback((id: string) => {
    setTool((open) =>
      // a second tool already took the line; leave it
      open?.id === id ? { ...open, done: true } : open,
    );
    if (linger.current) clearTimeout(linger.current);
    linger.current = setTimeout(
      () => setTool((open) => (open?.done ? null : open)),
      TOOL_LINGER_MS,
    );
  }, []);

  /** The relayed update was voiced, or waited on long enough: the next can go in. */
  const doneReading = useCallback(() => {
    if (reading.current.giveUp) clearTimeout(reading.current.giveUp);
    // Her voice started and stopped on it: carried
    if (reading.current.spoke) {
      for (const key of onLine.current) unvoiced.current.delete(key);
    }
    onLine.current = [];
    reading.current = { on: false, spoke: false, giveUp: null };
    if (!relayOpen.current) return;
    relayOpen.current = false;
    setTool((open) =>
      open?.kind === "relay" ? { ...open, done: true } : open,
    );
    if (linger.current) clearTimeout(linger.current);
    linger.current = setTimeout(
      () => setTool((open) => (open?.kind === "relay" ? null : open)),
      RELAY_LINGER_MS,
    );
  }, []);

  /** An update is on the wire: nothing else goes in until she has voiced it. */
  const readAloud = useCallback(() => {
    if (reading.current.giveUp) clearTimeout(reading.current.giveUp);
    reading.current = {
      on: true,
      spoke: false,
      giveUp: setTimeout(doneReading, CALL_RELAY.readMs),
    };
  }, [doneReading]);

  const setThinking = useCallback((at: number | null) => {
    thinking.current = at;
    setThinkingSince(at);
  }, []);

  /**
   * What the activity line says about the backend. It starts when the backend takes the
   * turn and ends on her first word, not on the response: a turn that calls two
   * tools settles for a moment between them, and the wait before she speaks is
   * still the same stretch of work. Both would otherwise read as the call stalling.
   */
  const holdThinking = useCallback(
    (busy: boolean, speaking: boolean) => {
      const dropTail = () => {
        if (thinkTail.current) clearTimeout(thinkTail.current);
        thinkTail.current = null;
      };
      // Her voice always wins: it is the answer the work was for
      if (speaking) {
        dropTail();
        if (thinking.current !== null) setThinking(null);
        return;
      }
      if (busy) {
        dropTail();
        if (thinking.current === null) setThinking(Date.now());
        return;
      }
      if (thinking.current !== null && !thinkTail.current) {
        thinkTail.current = setTimeout(() => {
          thinkTail.current = null;
          setThinking(null);
        }, THINKING_TAIL_MS);
      }
    },
    [setThinking],
  );

  /**
   * Puts to her what background work still waits on the user, once neither
   * side's words have been transcribed for CALL_RELAY.quietMs and nothing is
   * running: questions not answered, jobs ended or stopped and not yet seen,
   * and progress from jobs still running. Live never speaks unprompted, so
   * nothing reaches the user unless this puts it in. Handling an item — an
   * answer, `thread` `seen`, a click on screen — takes it off the list. Each
   * item goes in once a call, and once her voice has carried it, not on later
   * calls either (`told`, `unvoiced`). One append holds one kind, so an ending
   * is never lost among questions. Nothing goes in once the call is ending.
   */
  const relayOpenWork = useCallback(() => {
    const live = session.current;
    const threads = latest.current;
    if (!live || !threads || reading.current.on || acting.current) return;
    if (leaving.current) return;
    // On a call-back, why she called goes in once the opening is voiced: it is the
    // first thing they ask, and a quiet line would come too late
    const rung = rang.current;
    rang.current = false;
    if (!rung && Date.now() - heard.current < CALL_RELAY.quietMs) return;
    const open = openWork(threads).filter(
      (item) => !told.current.has(item.key),
    );
    const first = open[0];
    if (!first) return;
    const due = open
      .filter((item) => item.kind === first.kind)
      .slice(0, CALL_RELAY.perTurn);
    const lines = due.map((item) => item.line);

    // Told as it goes out, even if Live refuses it: a refusal is tried again on the next
    // call (unvoiced), never in a loop on this one
    for (const item of due) {
      told.current.add(item.key);
      unvoiced.current.add(item.key);
    }
    readAloud();
    onLine.current = due.map((item) => item.key);
    // On the line before it goes out, so it runs there for the whole wait
    showRelay((due.at(-1) ?? first).show);
    // Appends go out in order, so the note is in her context before the first update
    if (!relayNoted.current) {
      relayNoted.current = true;
      void live.append("instructions", RELAY_NOTE);
    }
    void live
      .append(
        "commentary",
        lines.length === 1
          ? lines.join("")
          : `[${lines.length} updates.]\n\n${lines.join("\n\n")}`,
      )
      .then((delivered) => {
        if (!delivered) {
          doneReading();
          return;
        }
        const ids = due.flatMap((item) => item.relayIds);
        if (ids.length) return acceptThreadRelaysAction(ids).then(unwrapResult);
      })
      .catch((cause) =>
        toast.add({
          type: "error",
          title: "Could not record relay delivery",
          description: errorToString(cause),
        }),
      );
  }, [readAloud, doneReading, showRelay]);

  /**
   * One timer; when it fires it wears the last wanted face, so a tool shorter
   * than FACE_TOOL_MS never shows the working face.
   */
  const shownFace = useRef<CallStatus>(status);
  // Set after commit: concurrent rendering may discard a render, and a ref
  // written during render would keep the discarded value
  useEffect(() => {
    shownFace.current = status;
  }, [status]);
  const wantedFace = useRef<LiveStatus>("listening");
  const faceIn = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restFace = useCallback(() => {
    if (faceIn.current) clearTimeout(faceIn.current);
    faceIn.current = null;
  }, []);

  const wearFace = useCallback((next: CallStatus) => {
    shownFace.current = next;
    setStatus(next);
  }, []);

  const showFace = useCallback(
    (live: LiveStatus) => {
      wantedFace.current = live;
      const now = shownFace.current;

      // voice does not wait
      if (live === "speaking") {
        restFace();
        wearFace(live);
        return;
      }

      const busy = live === "working" || live === "delegating";
      const wasBusy = now === "working" || now === "delegating";
      // already busy: switch kind without a new wait
      if (busy && wasBusy) {
        restFace();
        wearFace(live);
        return;
      }
      // already listening: cancel any pending switch (this keeps short tools off the face)
      if (!busy && now === "listening") {
        restFace();
        return;
      }
      if (faceIn.current) return;
      faceIn.current = setTimeout(
        () => {
          faceIn.current = null;
          wearFace(wantedFace.current);
        },
        busy ? FACE_TOOL_MS : FACE_SETTLE_MS,
      );
    },
    [restFace, wearFace],
  );

  const onCall =
    status !== "idle" && status !== "connecting" && status !== "ending";

  // Inbox, with or without a call. Revalidated on server events; polling is the safety net
  const { data: threads } = useServerRoute<Thread[]>(queryKey.threads, {
    refreshInterval: THREAD_POLL_FALLBACK_MS,
  });

  // Server event stream (app/api/events): signals revalidate their key
  useAppEvent({
    hello: () => {
      // Sent on every connect, so this is also every reconnect: nothing that
      // changed while the stream was down raised a signal anybody heard
      void revalidateAll();
    },
    threads: () => void revalidate(queryKey.threads),
    memory: () => void revalidate(queryKey.memory),
    mcp: () => {
      void revalidate(queryKey.mcp);
      void revalidate(queryKey.mcpTools);
    },
    // A sign-in finished in its own window (ai/chatgpt): the key rows and the model picker both read it
    config: () => {
      void revalidate(queryKey.config);
      void revalidate(queryKey.llmModel);
    },
  });

  // faces come from the bot list
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  useEffect(() => {
    if (threads) botThreads.sync(threads, bots);
  }, [threads, bots]);

  useEffect(() => {
    latest.current = threads;
  }, [threads]);

  // The user acted on a thread on screen; she may have just read that question and must not ask again
  useEffect(
    () =>
      screenActs.subscribe((act) => {
        if (!calling.current) return;
        outbox.send(
          act.kind === "answered"
            ? `The user sent a message on screen to ${act.recipient ?? "the coordinator"} in thread "${act.label}" (${act.id})${act.replyTo ? `, replying to ${act.replyTo}` : ""}: ${act.answer}. It has reached that participant.`
            : `The user stopped thread "${act.label}" on screen. It is no longer running.`,
        );
      }),
    [outbox],
  );

  /** Closes the session and resets state. Turns were saved during the call. */
  const hangUp = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    if (leaving.current) clearInterval(leaving.current);
    leaving.current = null;
    attempt.current += 1;
    const live = session.current;
    const call = callId.current;

    session.current = null;
    callId.current = null;
    calling.current = false;
    opening.current = false;
    relayNoted.current = false;
    rang.current = false;
    // What she did not voice goes in again next call; unsent context goes with the session
    for (const key of unvoiced.current) told.current.delete(key);
    unvoiced.current.clear();
    outbox.close();
    outbox.clear();
    working.current?.abort();
    working.current = null;
    doneReading();
    if (linger.current) clearTimeout(linger.current);
    // a pending face timer must not fire after the call
    restFace();
    // What came up on this call was this call's to tell; the call-back rings only for what comes after
    ringAfter.current = Date.now();
    setIdleLeft(null);
    setSince(null);
    setStatus(live ? "ending" : "idle");
    setMessages([]);
    setTool(null);
    setThinking(null);
    if (thinkTail.current) clearTimeout(thinkTail.current);
    thinkTail.current = null;
    relayOpen.current = false;
    // the room is not cleared: threads outlive the call

    // Waits (bounded) for session.closed, which saves the last turns and says
    // what was billed; the row is ended with that, after the saves it queued
    await live?.close();
    const close = finalized.current;
    finalized.current = null;
    ending.current = false;
    setStatus("idle");
    if (call) void endCallAction(call, close);
    // only when there was a line to close
    if (live && farewell.current) {
      farewell.current.currentTime = 0;
      void farewell.current.play().catch(() => {});
    }
  }, [outbox, restFace, doneReading, setThinking]);

  // Unmount during a call must release the mic and stop tools
  useEffect(() => {
    return () => {
      attempt.current += 1;
      void session.current?.close();
      session.current = null;
      // Closing only the session would leave the row live (thursday.query
      // isAnyCallLive) and finished threads unannounced (bot.runner); end the row too
      const call = callId.current;
      callId.current = null;
      calling.current = false;
      opening.current = false;
      if (call) void endCallAction(call);
      working.current?.abort();
      working.current = null;
      // clear timers so nothing sets state on an unmounted tree
      if (linger.current) clearTimeout(linger.current);
      if (faceIn.current) clearTimeout(faceIn.current);
      if (reading.current.giveUp) clearTimeout(reading.current.giveUp);
      if (thinkTail.current) clearTimeout(thinkTail.current);
      if (failedFor.current) clearTimeout(failedFor.current);
      if (leaving.current) clearInterval(leaving.current);
    };
  }, []);

  /**
   * The backend ended the call: hang up once her goodbye is over. She says it while
   * the backend works, so it may be done already, still going, or yet to start;
   * CALL_END bounds each case. The tool's own result always gets `quietMs` to go out.
   */
  const leave = useCallback(() => {
    if (leaving.current) return;
    const asked = Date.now();
    leaving.current = setInterval(() => {
      const now = Date.now();
      // A goodbye heard just before the backend ended the call counts as said
      const said = voiced.current > asked - CALL_END.unsaidMs;
      const over = said
        ? now - Math.max(voiced.current, asked) >= CALL_END.quietMs
        : now - asked >= CALL_END.unsaidMs;
      if (over || now - asked >= CALL_END.maxMs) void hangUp();
    }, 100);
  }, [hangUp]);

  // Idle clock: shows the countdown, then hangs up. The page ends a quiet line itself;
  // a goodbye would leave the ending to the model
  useEffect(() => {
    if (!onCall) return;
    stirred.current = Date.now();
    const tick = setInterval(() => {
      if (!session.current) return;
      const left = CALL_IDLE.hangUpMs - (Date.now() - stirred.current);
      setIdleLeft(
        left <= CALL_IDLE.warnMs ? Math.max(0, Math.ceil(left / 1000)) : null,
      );
      if (left <= 0) void hangUp();
    }, 1000);
    return () => clearInterval(tick);
  }, [onCall, hangUp]);

  // The relay clock: open work goes in only while the line is quiet
  useEffect(() => {
    if (!onCall) return;
    const tick = setInterval(relayOpenWork, 1000);
    return () => clearInterval(tick);
  }, [onCall, relayOpenWork]);

  const call = useCallback(async () => {
    // Every way in answers a ringing call-back: the face, the wake word, the hotkey
    const calledBack = isRinging;
    // Guard with a ref, not `status`: three entry points (face, wake word,
    // hotkey) can fire in one frame and both see a stale "idle", opening two sessions
    if (opening.current || ending.current) return;
    // with a line open this press hangs up; `calling` covers the gap before re-render
    if (calling.current || status !== "idle") return hangUp();
    setRingingFor([]);

    setStatus("connecting");
    showFailed(false);
    // from here on this is a call; the outbox holds updates until the session exists
    opening.current = true;
    calling.current = true;
    finalized.current = null;
    relayNoted.current = false;
    outbox.clear();
    attempt.current += 1;
    const mine = attempt.current;
    const current = () => calling.current && attempt.current === mine;
    try {
      // Inside the gesture, before anything awaits: an AudioContext created later
      // starts suspended. Calls from the wake word or a call-back have no gesture;
      // armAudioUnlock handles those
      tap.current ??= createAudioTap();
      armAudioUnlock(tap.current.open().context);
      const chime = new Audio(CONNECTED_SOUND);
      farewell.current ??= new Audio(HUNG_UP_SOUND);

      const settings = thursdaySettings();
      const stop = new AbortController();
      working.current = stop;
      const saving = { failures: 0 };
      const thinkingSaves = { failures: 0 };
      /** Filled in by the handshake, read by callbacks that only run after it. */
      const line = { callId: "", opening: null as string | null };

      // one turn per id; the session reports display groups one at a time
      const turns = new Map<string, CallMessage & { seq: number }>();

      const live = await openLiveSession({
        initialize: async (sdp) => {
          const handshake = unwrapResult(
            await openCallAction(settings, sdp, calledBack),
          );
          if (!current()) {
            void endCallAction(handshake.callId);
            throw new Error("The call closed during startup.");
          }
          callId.current = handshake.callId;
          line.callId = handshake.callId;
          line.opening = handshake.opening;
          return handshake.sdp;
        },
        audio: tap.current,
        on: {
          // the backend calls tools; the page forwards them to the server
          runTool: async (call) => {
            // end_call is the page's only tool. The line goes down once her
            // goodbye is over (leave), so this reply reaches the model first
            if (call.name === TOOL_NAMES.end_call) {
              leave();
              return "Ending the call.";
            }
            showTool(call);
            try {
              return await runRemoteTool(line.callId, call, stop.signal);
            } finally {
              hideTool(call.id);
            }
          },
          reasoning: (part) =>
            persist(
              thinkingSaves,
              () =>
                saveThoughtAction(line.callId, {
                  ...part,
                  seq: Math.max(0, Math.round(part.seq)),
                }),
              "The backend's thinking is not being saved",
            ),
          turn: (turn) => {
            // New words, not a checkpoint of the same ones. A cough or a sigh is not words:
            // it neither holds the line open nor holds an update back
            const words = turn.role === "tool" ? "" : spokenWords(turn.text);
            const fresh =
              Boolean(words) &&
              words !== spokenWords(turns.get(turn.id)?.text ?? "");
            // New words from either side restart the relay's quiet clock
            if (fresh) heard.current = Date.now();
            // Her voice and backend work rewind the idle clock from activity, where an
            // update she reads out is told apart; transcripts lag the audio and cannot
            if (fresh && turn.role === "user") stirred.current = Date.now();
            // Tool turns are saved but not shown. Hanging up clears the screen
            // before `close()` checkpoints open groups, so only the live call draws.
            if (turn.role !== "tool" && callId.current === line.callId) {
              turns.set(turn.id, {
                seq: turn.seq,
                id: turn.id,
                role: turn.role,
                text: turn.text,
              });
              setMessages(
                [...turns.values()]
                  .sort((a, b) => a.seq - b.seq)
                  .slice(-KEEP_MESSAGES),
              );
            }
            if (turn.done) {
              persist(saving, () =>
                saveTurnsAction(line.callId, [
                  {
                    id: turn.id,
                    role: turn.role,
                    tool: turn.tool,
                    text: turn.text,
                    // Live orders by audio milliseconds; the row keeps a whole number
                    seq: Math.max(0, Math.round(turn.seq)),
                    fragments: turn.fragments ?? null,
                  },
                ]),
              );
            }
          },
          // session facts drive the face through showFace; the tool line is drawn by the tool itself
          activity: (activity) => {
            showFace(statusOf(activity));
            const busy = activity.working || activity.tools.length > 0;
            acting.current = busy;
            // From the moment the backend picks the turn up until her first word
            holdThinking(busy, activity.speaking);
            if (activity.speaking) voiced.current = Date.now();
            // Sound on the mic alone does not rewind the clock: a noisy room would
            // keep a call open forever. Her words and backend work do, except an
            // update she voices on her own: waiting results must not hold a call open.
            if (
              (activity.speaking && !reading.current.on) ||
              activity.working ||
              activity.tools.length
            )
              stirred.current = Date.now();
            // An update counts as voiced once her voice has started and stopped
            if (reading.current.on) {
              if (activity.speaking) reading.current.spoke = true;
              else if (reading.current.spoke) doneReading();
            }
          },
          finalized: (close) => {
            finalized.current = close;
          },
          warn: (description) =>
            toast.add({
              type: "warning",
              title: "Call warning",
              description,
            }),
          failed: (description) => {
            toast.add({ type: "error", title: "Call failed", description });
            showFailed(true);
            void hangUp();
          },
        },
      });

      if (!current()) {
        // Hung up while the line was going up; hangUp already ended the row
        await live.close();
        return;
      }

      /** An opening that never landed leaves nothing to wait for. */
      const unless = (delivered: boolean) => {
        if (!delivered) doneReading();
      };

      session.current = live;
      opening.current = false;
      rang.current = calledBack;
      // Context is not gated: held lines first, then each as it comes
      outbox.open((text) => void live.append("thinking", text));
      // The quiet clock starts with the line, so nothing is put to her the moment it opens
      heard.current = Date.now();

      if (line.opening) {
        // The greeting goes first; open work waits until she has said it
        readAloud();
        void live.append("instructions", line.opening).then(unless);
      }

      wearFace("listening");
      setSince(Date.now());
      // a rejected chime is not worth a message
      void chime.play().catch(() => {});
    } catch (cause) {
      // Hanging up while the line was going up is not a failure to report
      if (current()) {
        toast.add({
          type: "error",
          title: "Could not start the call",
          description: errorToString(cause),
        });
        showFailed(true);
      }
      if (attempt.current !== mine) return;
      // a call that never opened still has a row; close it
      if (callId.current) void endCallAction(callId.current);
      callId.current = null;
      opening.current = false;
      calling.current = false;
      working.current = null;
      outbox.clear();
      setStatus("idle");
    }
  }, [
    status,
    hangUp,
    showTool,
    hideTool,
    showFace,
    wearFace,
    outbox,
    readAloud,
    doneReading,
    holdThinking,
    showFailed,
    leave,
    isRinging,
  ]);

  /**
   * Call-back: rings when a thread is waiting on the user and no line is open,
   * only for threads that changed after `ringAfter`. What came up during a call
   * was that call's to tell, and the next call tells what it left unsaid. Ringing
   * never opens the line; answering does (`call`). A thread handled meanwhile, on
   * screen or by the setting going off, stops ringing for itself.
   */
  const callBack = useThursdayStore((state) => state.callBack);
  useEffect(() => {
    if (!threads) return;
    const wanted = new Set(
      threads
        .filter((thread) => ringsFor(thread, callBack))
        .map((thread) => thread.id),
    );
    setRingingFor((ids) =>
      ids.every((id) => wanted.has(id))
        ? ids
        : ids.filter((id) => wanted.has(id)),
    );
    if (status !== "idle") return;
    const after = ringAfter.current;
    const fresh = threads.filter(
      (thread) =>
        wanted.has(thread.id) && toDate(thread.updatedAt).getTime() > after,
    );
    if (!fresh.length) return;

    ringAfter.current = Date.now();
    setRingingFor((ids) => [
      ...ids,
      ...fresh.map((thread) => thread.id).filter((id) => !ids.includes(id)),
    ]);
  }, [threads, callBack, status]);

  // While ringing: it stops by itself after CALL_BACK.ringMs, and Esc declines.
  // A thread added to a ring already going does not restart the clock
  useEffect(() => {
    if (!isRinging) return;
    const out = setTimeout(() => setRingingFor([]), CALL_BACK.ringMs);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setRingingFor([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(out);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isRinging]);

  const decline = useCallback(() => setRingingFor([]), []);
  /** What the ringing screen names: the first thread that rang, and how many rang with it. */
  const ringing = useMemo((): Ringing | null => {
    const rung = ringingFor.flatMap(
      (id) => threads?.find((thread) => thread.id === id) ?? [],
    );
    const first = rung[0];
    if (!first) return null;
    const question = first.room.questions[0];
    return {
      bot: question?.bot ?? first.bot,
      kind: question
        ? "question"
        : first.status === "done"
          ? "done"
          : "stopped",
      label: first.label,
      more: rung.length - 1,
    };
  }, [ringingFor, threads]);

  /** Read by the face once per animation frame, outside React state. */
  const getSpectrum = useCallback(() => tap.current?.read() ?? EMPTY_BANDS, []);
  /** The same, for the user's own mic: what the listening meter draws. */
  const getMicSpectrum = useCallback(
    () => tap.current?.readMic() ?? EMPTY_BANDS,
    [],
  );
  // Wake word while no line is open; the mic belongs to the call once it opens.
  // The seam is `enabled` and `onWake` / `onError` only, so the recognizer can be swapped
  const wake = useThursdayStore((state) => state.wake);
  const [wakeBlocked, setWakeBlocked] = useState(false);
  useWakeWord({
    enabled: status === "idle" && wake.enabled && !wakeBlocked,
    phrases: [wake.phrase],
    onWake: () => void call(),
    onError: (reason) => {
      setWakeBlocked(true);
      toast.add({ type: "error", title: "Wake word off", description: reason });
    },
  });

  // Hotkey presses `call` like the face tap, so it hangs up during a call; disabled while the line goes up or down
  const hotkey = useThursdayStore((state) => state.hotkey);
  const busy = status === "connecting" || status === "ending";
  useHotkey({
    enabled: hotkey.enabled && !busy,
    combo: hotkey.enabled && isCombo(hotkey.combo) ? hotkey.combo : null,
    onPress: () => void call(),
  });

  return {
    status,
    /** A call just failed to open or dropped; true for a few seconds after. */
    failed,
    messages,
    tool,
    /** When the backend picked the turn up (ms); null when it is not working. */
    thinkingSince,
    /** Seconds until idle hang-up; null outside the warning window. */
    idleLeft,
    /** When the line opened (ms); null without a call. */
    since,
    call,
    /** A call-back ringing; null when none is. Any way of placing a call answers it. */
    ringing,
    /** Stops the ringing without answering. */
    decline,
    getSpectrum,
    getMicSpectrum,
    /** null when the tap is the only entry point. */
    wakePhrase: wake.enabled && !wakeBlocked ? wake.phrase : null,
    /** Key combo that opens and closes the call; null if none (use-hotkey notation). */
    hotkey: hotkey.enabled && isCombo(hotkey.combo) ? hotkey.combo : null,
  };
}

const EMPTY_BANDS = new Array<number>(SPECTRUM_BANDS).fill(0);

/**
 * Calls opened without a gesture (wake word, call-back) get a suspended
 * AudioContext. Resume on the next pointer or key event and say so on screen.
 */
/** Waiting for a gesture; one per tab. */
let armed = false;

function armAudioUnlock(context: AudioContext) {
  if (context.state !== "suspended") return;
  // one listener pair per tab; a second gestureless call must not add another pair or toast
  if (armed) return;
  armed = true;

  const resume = () => {
    armed = false;
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    void context.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);

  toast.add({
    type: "warning",
    title: "Tap anywhere to hear her",
    description:
      "This call opened on its own, so the browser is holding the audio.",
  });
}

/** Voice wins over work; delegate gets its own face. */
function statusOf(activity: LiveActivity): LiveStatus {
  if (activity.speaking) return "speaking";
  if (activity.working || activity.tools.length) {
    return activity.tools.includes(TOOL_NAMES.delegate)
      ? "delegating"
      : "working";
  }
  return "listening";
}

/**
 * The words in a transcript, without the sounds Live writes in brackets ("[clear throat]",
 * "[sigh]"); a bracket may close in the next group ("] okay"). Empty when nothing was said.
 */
function spokenWords(text: string) {
  const words = text.replace(/\[[^\]]*\]?|\]/g, "").trim();
  return /[\p{L}\p{N}]/u.test(words) ? words : "";
}

/** Fire-and-forget save; after SAVE_FAILURE_LIMIT failures of this kind it stops and says so once. */
function persist(
  saving: { failures: number },
  save: () => Promise<Result<unknown>>,
  stopped = "This call is not being saved",
) {
  if (saving.failures >= SAVE_FAILURE_LIMIT) return;
  void save()
    .then((result) => unwrapResult(result))
    .catch((cause) => {
      saving.failures += 1;
      if (saving.failures !== SAVE_FAILURE_LIMIT) return;
      toast.add({
        type: "warning",
        title: stopped,
        description: errorToString(cause),
      });
    });
}

/**
 * Whether a thread is one the call-back rings for: a real question, or with
 * "any" every ending. A job the app stops and picks up by itself never rings.
 */
const ringsFor = (thread: Thread, callBack: CallBack) =>
  callBack !== "off" &&
  !thread.seen &&
  !thread.ask?.auto &&
  (thread.room.questions.length > 0 ||
    (callBack === "any" && thread.status !== "running"));

/** One piece of background work waiting on the user, as the relay clock puts it to her. */
type OpenWork = {
  key: string;
  /** What it is, so one append holds one kind. */
  kind: "question" | "ending" | "progress";
  /** The relay text. */
  line: string;
  /** Relay rows it covers, accepted once it lands. */
  relayIds: number[];
  /** The same item on the activity line, so the user sees where her words came from. */
  show: ActivityLine;
};

const OPEN_RANK = {
  question: 0,
  stopped: 1,
  done: 2,
  progress: 3,
} as const;

/**
 * Everything in the inbox still waiting on the user, most pressing first:
 * questions, then jobs stopped or finished and not yet seen, then
 * progress from jobs still running. Sent as commentary; the bracket carries
 * facts only — who, which thread, where an answer goes — because the backend
 * reads relays too and routes answers by them.
 */
function openWork(threads: Thread[]): OpenWork[] {
  const items: (OpenWork & { rank: number })[] = [];
  for (const thread of threads) {
    const { relays, questions } = thread.room;
    const changed = toDate(thread.updatedAt).getTime();
    const bracket = (from: string, kind: string, tail = "") =>
      `[${from} → Thursday, thread "${thread.label}" (${thread.id}), ${kind}.${tail}]`;
    const show = (bot: string, line: string): ActivityLine => ({
      kind: "relay",
      name: thread.label,
      line,
      done: true,
      bot,
    });

    for (const question of questions) {
      const options = question.options?.length
        ? ` Options: ${question.options.join(" / ")}.`
        : "";
      items.push({
        rank: OPEN_RANK.question,
        key: `question:${question.id}`,
        kind: "question",
        line: `${bracket(question.bot, "question", ` Its answer goes to thread ${thread.id}, recipient ${question.bot}, replyTo ${question.id}.`)}\n${question.text}${options}`,
        relayIds: relays
          .filter((relay) => relay.messageId === question.id)
          .map((relay) => relay.id),
        show: show(question.bot, `${question.bot}: question`),
      });
    }

    // Relay rows that belong to no open question
    const loose = relays.filter(
      (relay) => !questions.some((question) => question.id === relay.messageId),
    );
    // A cancel is the user's own and already seen; nothing about it is news
    const ended = thread.status === "done";
    // A stop the app picks back up by itself is not news: it runs again in a moment
    const stopped =
      thread.status === "waiting" && isAppStop(thread.ask) && !thread.ask?.auto;

    if (ended || stopped) {
      if (thread.seen) continue;
      const kind = stopped ? "stopped" : "done";
      const said =
        kind === "stopped"
          ? `It stopped before finishing. Where it got to: ${thread.ask?.question ?? thread.outcome ?? ""}`
          : `Done. Its answer: ${thread.outcome ?? ""}`;
      items.push({
        rank: OPEN_RANK[kind],
        key: `${kind}:${thread.id}@${changed}`,
        kind: "ending",
        line: `${bracket(thread.bot, kind)}\n${said}`,
        // Its ending says what its progress messages said
        relayIds: loose.map((relay) => relay.id),
        show: show(
          thread.bot,
          kind === "stopped"
            ? `${thread.bot} stopped`
            : `Answer from ${thread.bot}`,
        ),
      });
      continue;
    }

    for (const relay of loose) {
      items.push({
        rank: OPEN_RANK.progress,
        key: `progress:${relay.id}`,
        kind: "progress",
        line: `${bracket(relay.bot, relay.kind)}\n${relay.text}`,
        relayIds: [relay.id],
        show: show(relay.bot, `${relay.bot}: ${relay.kind}`),
      });
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}
