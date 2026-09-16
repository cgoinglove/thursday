"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { CALL_RELAY } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { acceptThreadRelaysAction } from "@/features/bot/bot.action";
import { type Bot, isAppStop, type Thread } from "@/features/bot/bot.schema";
import { MARK_BANDS } from "@/features/bot/mark.const";
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
import { type AudioTap, createAudioTap } from "@/lib/live/live.tap";
import { unwrapResult } from "@/lib/protocol/result";
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
  saveTurnsAction,
} from "./thursday.action";
import type {
  CallMessage,
  CallStatus,
  CallTurn,
  LiveStatus,
} from "./thursday.schema";
import { thursdaySettings, useThursdayStore } from "./thursday.store";
import { toolBot, toolLine } from "./tool-line";

/**
 * One live call, plus the thread inbox the app watches even with no call open.
 * The server opens the Live session (openCallAction) and runs the tools
 * (tool-call); the page itself only hangs up.
 */

/** Time for a tool result to reach the model before the line closes. */
const HANG_UP_DELAY_MS = 400;

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

/** Notify once about failing saves, then stay quiet for the rest of the call. */
const SAVE_FAILURE_LIMIT = 3;

/**
 * With no words from the user, no voice from her and no backend work for this
 * long, she is asked to say goodbye and end the call.
 */
const IDLE_HANG_UP_MS = 60_000;

/** If the call does not end after the goodbye, the page hangs up. */
const IDLE_GRACE_MS = 15_000;

/** The countdown shows on screen inside this window. */
const IDLE_WARN_MS = 15_000;

/**
 * The user said something and nothing came back — no voice, no backend work —
 * for this long. The line is up and the model is not on it, so there is no
 * goodbye to ask for: the page hangs up. Armed only by transcribed words, never
 * by sound on the mic: a cough is not a question.
 */
const AGENT_SILENT_MS = 30_000;

const IDLE_LINE =
  "The user has said nothing for a minute. Say a one-line goodbye and end the call.";

/**
 * A tool the model is using, as the activity line draws it. `line` is the
 * human-readable sentence (tool-line), null when none exists; `name` is the
 * tool that actually ran.
 */
export type ToolRun = {
  name: string;
  line: string | null;
  done: boolean;
  /** A relay from a bot (answer or question) rather than a tool; `name` is the thread label. */
  kind?: "tool" | "relay";
  /** The bot this names, when it names one: the row draws its face instead of a glyph. */
  bot?: string | null;
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
  const [tool, setTool] = useState<ToolRun | null>(null);
  /** When the line opened (ms). */
  const [since, setSince] = useState<number | null>(null);
  /** Seconds until idle hang-up; set only inside IDLE_WARN_MS. */
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
  /**
   * Last activity time, whether the goodbye was requested, and when an answer
   * started being owed (null once she answers or works).
   */
  const idle = useRef<{
    since: number;
    asked: boolean;
    owed: number | null;
    grace: ReturnType<typeof setTimeout> | null;
  }>({ since: 0, asked: false, owed: null, grace: null });
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the line holds a relay, so only a relay is finished by her voice. */
  const relayOpen = useRef(false);
  // Every server-run tool in this call starts with this signal, so one abort
  // reaches running browser commands. Delegated threads are server-owned and outlive the call
  const working = useRef<AbortController | null>(null);
  /** Row the turns are saved to; a ref so long-lived callbacks see it. */
  const callId = useRef<string | null>(null);
  /**
   * Open work put to her this call, by item key (openWork): how many times, and
   * when last. A key carries the job's last change, so a job that asks again is
   * new work.
   */
  const listed = useRef(new Map<string, { times: number; at: number }>());
  /** When either side's words were last transcribed: the quiet clock for relays. */
  const heard = useRef(0);
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
  const showRelay = useCallback((run: ToolRun) => {
    if (linger.current) clearTimeout(linger.current);
    relayOpen.current = true;
    setTool({ ...run, done: false });
  }, []);

  /** Tool finished; lingers, then clears. */
  const hideTool = useCallback((name: string) => {
    setTool((open) =>
      // a second tool already took the line; leave it
      open?.name === name ? { ...open, done: true } : open,
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
   * answer, `thread` `seen`, a click on screen — takes it off the next list;
   * what is left comes back after CALL_RELAY.relistMs, CALL_RELAY.tries times
   * a call.
   */
  const relayOpenWork = useCallback(() => {
    const live = session.current;
    const threads = latest.current;
    if (!live || !threads || reading.current.on || acting.current) return;
    const now = Date.now();
    if (now - heard.current < CALL_RELAY.quietMs) return;
    const due = openWork(threads)
      .filter((item) => {
        const was = listed.current.get(item.key);
        return (
          !was ||
          (item.again &&
            was.times < CALL_RELAY.tries &&
            now - was.at >= CALL_RELAY.relistMs)
        );
      })
      .slice(0, CALL_RELAY.perTurn);
    const last = due.at(-1);
    if (!last) return;

    const before = due.map((item) => listed.current.get(item.key));
    const lines = due.map((item, index) => item.line(Boolean(before[index])));
    for (const [index, item] of due.entries()) {
      listed.current.set(item.key, {
        times: (before[index]?.times ?? 0) + 1,
        at: now,
      });
    }
    readAloud();
    // On the line before it goes out, so it runs there for the whole wait
    showRelay(last.show);
    void live
      .append(
        "commentary",
        lines.length === 1
          ? lines.join("")
          : `[${lines.length} updates.]\n\n${lines.join("\n\n")}`,
      )
      .then((delivered) => {
        if (!delivered) {
          // Not in her context: as if never listed, so the next quiet moment tries again
          for (const [index, item] of due.entries()) {
            const was = before[index];
            if (was) listed.current.set(item.key, was);
            else listed.current.delete(item.key);
          }
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
  const boot = useRef<string | null>(null);
  useAppEvent({
    hello: (event) => {
      // Sent on every connect, so this is also every reconnect: nothing that
      // changed while the stream was down raised a signal anybody heard, and a
      // changed `boot` means the server restarted on top of that
      boot.current = event.boot;
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
            ? `The user sent a message on screen to ${act.recipient ?? "the coordinator"} in thread "${act.label}" (${act.id})${act.replyTo ? `, replying to ${act.replyTo}` : ""}: ${act.answer}. That participant receives it directly; do not ask the same question again.`
            : `The user stopped thread "${act.label}" on screen. It is not running any more; do not wait for it or say anything more about it.`,
        );
      }),
    [outbox],
  );

  /** Closes the session and resets state. Turns were saved during the call. */
  const hangUp = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    attempt.current += 1;
    const live = session.current;
    const call = callId.current;

    session.current = null;
    callId.current = null;
    calling.current = false;
    opening.current = false;
    // Open work is listed again next call; unsent context goes with the session
    listed.current.clear();
    outbox.close();
    outbox.clear();
    working.current?.abort();
    working.current = null;
    doneReading();
    if (linger.current) clearTimeout(linger.current);
    // a pending face timer must not fire after the call
    restFace();
    if (idle.current.grace) clearTimeout(idle.current.grace);
    idle.current = { since: 0, asked: false, owed: null, grace: null };
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
      if (idle.current.grace) clearTimeout(idle.current.grace);
      if (failedFor.current) clearTimeout(failedFor.current);
    };
  }, []);

  /**
   * Rewinds the idle clock. `user` is words transcribed from them: an answer is
   * owed from then, and a requested goodbye is off. `agent` is her voice or
   * backend work, which settles what is owed but cannot cancel its own goodbye.
   */
  const stir = useCallback((who: "user" | "agent") => {
    const now = Date.now();
    idle.current.since = now;
    if (who !== "user") {
      idle.current.owed = null;
      return;
    }
    idle.current.owed = now;
    if (idle.current.grace) clearTimeout(idle.current.grace);
    idle.current.grace = null;
    idle.current.asked = false;
  }, []);

  // Idle clock: shows the countdown, then asks for a goodbye and grants a grace period
  useEffect(() => {
    if (!onCall) return;
    stir("agent");
    const tick = setInterval(() => {
      const live = session.current;
      if (!live) return;
      const owed = idle.current.owed;
      if (owed !== null && Date.now() - owed >= AGENT_SILENT_MS) {
        // Nothing to say goodbye with; the model is what would have said it.
        toast.add({
          type: "error",
          title: "Call ended",
          description: "The model stopped answering.",
        });
        void hangUp();
        return;
      }
      const left = IDLE_HANG_UP_MS - (Date.now() - idle.current.since);
      setIdleLeft(
        left <= IDLE_WARN_MS && !idle.current.asked
          ? Math.max(0, Math.ceil(left / 1000))
          : null,
      );
      if (left > 0 || idle.current.asked) return;

      idle.current.asked = true;
      void live.append("instructions", IDLE_LINE);
      idle.current.grace = setTimeout(() => void hangUp(), IDLE_GRACE_MS);
    }, 1000);
    return () => clearInterval(tick);
  }, [onCall, stir, hangUp]);

  // The relay clock: open work goes in only while the line is quiet
  useEffect(() => {
    if (!onCall) return;
    const tick = setInterval(relayOpenWork, 1000);
    return () => clearInterval(tick);
  }, [onCall, relayOpenWork]);

  const call = useCallback(async () => {
    // Guard with a ref, not `status`: three entry points (face, wake word,
    // hotkey) can fire in one frame and both see a stale "idle", opening two sessions
    if (opening.current || ending.current) return;
    // with a line open this press hangs up; `calling` covers the gap before re-render
    if (calling.current || status !== "idle") return hangUp();

    setStatus("connecting");
    showFailed(false);
    // from here on this is a call; the outbox holds updates until the session exists
    opening.current = true;
    calling.current = true;
    finalized.current = null;
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
      /** Filled in by the handshake, read by callbacks that only run after it. */
      const line = { callId: "", opening: null as string | null };

      // one turn per id; the session reports display groups one at a time
      const turns = new Map<string, CallMessage & { seq: number }>();

      const live = await openLiveSession({
        initialize: async (sdp) => {
          const handshake = unwrapResult(await openCallAction(settings, sdp));
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
            // end_call is the page's only tool. Answer without awaiting: the line
            // goes down with the call, so this reply must go first
            if (call.name === TOOL_NAMES.end_call) {
              setTimeout(() => void hangUp(), HANG_UP_DELAY_MS);
              return "Ending the call.";
            }
            showTool(call);
            try {
              return await runRemoteTool(line.callId, call, stop.signal);
            } finally {
              hideTool(call.name);
            }
          },
          turn: (turn) => {
            stir(turn.role === "user" ? "user" : "agent");
            // New words from either side restart the relay's quiet clock; a blank fragment is not words
            if (
              turn.role !== "tool" &&
              turn.text.trim() &&
              turn.text !== turns.get(turn.id)?.text
            )
              heard.current = Date.now();
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
              persistTurn(
                line.callId,
                {
                  id: turn.id,
                  role: turn.role,
                  tool: turn.tool,
                  text: turn.text,
                  // Live orders by audio milliseconds; the row keeps a whole number
                  seq: Math.max(0, Math.round(turn.seq)),
                  fragments: turn.fragments ?? null,
                },
                saving,
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
            // Sound on the mic alone does not rewind the clock: a noisy room would
            // keep a call open forever. Her words and backend work do.
            if (activity.speaking || activity.working || activity.tools.length)
              stir("agent");
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
            toast.add({ type: "warning", title: "Call warning", description }),
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
      // nothing was put to her; the next call lists it all
      listed.current.clear();
      setStatus("idle");
    }
  }, [
    status,
    hangUp,
    showTool,
    hideTool,
    showFace,
    wearFace,
    stir,
    outbox,
    readAloud,
    doneReading,
    holdThinking,
    showFailed,
  ]);

  /**
   * Call-back: opens a call when a thread is waiting on the user and no line is
   * open. Tried once per thread (`woke`), or a failed open would redial forever;
   * threads present at app start count as already tried.
   */
  const callBack = useThursdayStore((state) => state.callBack);
  const woke = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!threads) return;
    const wants = threads.filter(
      (thread) =>
        !thread.seen &&
        !thread.ask?.auto &&
        (asksSomething(thread) ||
          (callBack === "any" && thread.status !== "running")),
    );

    if (!woke.current) {
      woke.current = new Set(wants.map((thread) => thread.id));
      return;
    }

    // forget threads that stopped waiting; a later stop counts as fresh
    const open = new Set(wants.map((thread) => thread.id));
    for (const id of woke.current) {
      if (!open.has(id)) woke.current.delete(id);
    }

    if (callBack === "off" || status !== "idle") return;
    const fresh = wants.filter((thread) => !woke.current?.has(thread.id));
    if (!fresh.length) return;

    for (const thread of wants) woke.current.add(thread.id);
    void call();
  }, [threads, callBack, status, call]);

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
    getSpectrum,
    getMicSpectrum,
    /** null when the tap is the only entry point. */
    wakePhrase: wake.enabled && !wakeBlocked ? wake.phrase : null,
    /** Key combo that opens and closes the call; null if none (use-hotkey notation). */
    hotkey: hotkey.enabled && isCombo(hotkey.combo) ? hotkey.combo : null,
  };
}

const EMPTY_BANDS = new Array<number>(MARK_BANDS).fill(0);

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
 * Fire-and-forget save: one toast after SAVE_FAILURE_LIMIT failures, then
 * silence.
 */
function persistTurn(
  callId: string,
  turn: CallTurn,
  saving: { failures: number },
) {
  if (saving.failures >= SAVE_FAILURE_LIMIT) return;
  void saveTurnsAction(callId, [turn])
    .then((result) => unwrapResult(result))
    .catch((cause) => {
      saving.failures += 1;
      if (saving.failures !== SAVE_FAILURE_LIMIT) return;
      toast.add({
        type: "warning",
        title: "This call is not being saved",
        description: errorToString(cause),
      });
    });
}

/**
 * Waiting on a real question. A job the app stopped waits in the inbox
 * instead of ringing.
 */
function asksSomething(thread: Thread) {
  if (thread.room) return thread.room.questions.length > 0;
  return thread.status === "waiting" && !isAppStop(thread.ask);
}

/** One piece of background work waiting on the user, as the relay clock puts it to her. */
type OpenWork = {
  key: string;
  /** Comes back while it stays unhandled; progress from a running job goes in once. */
  again: boolean;
  /** The relay text. `again` marks a repeat, so she can tell it from news. */
  line: (again: boolean) => string;
  /** Relay rows it covers, accepted once it lands. */
  relayIds: number[];
  /** The same item on the activity line, so the user sees where her words came from. */
  show: ToolRun;
};

const OPEN_RANK = {
  question: 0,
  stopped: 1,
  failed: 2,
  done: 3,
  progress: 4,
} as const;

/**
 * Everything in the inbox still waiting on the user, most pressing first:
 * questions, then jobs stopped, failed or finished and not yet seen, then
 * progress from jobs still running. Sent as commentary; the bracket carries
 * facts only — who, which thread, where an answer goes — because the backend
 * reads relays too and routes answers by them.
 */
function openWork(threads: Thread[]): OpenWork[] {
  const items: (OpenWork & { rank: number })[] = [];
  for (const thread of threads) {
    const relays = thread.room?.relays ?? [];
    const questions = thread.room?.questions ?? [];
    const changed = toDate(thread.updatedAt).getTime();
    const bracket = (from: string, kind: string, again: boolean, tail = "") =>
      `[${from} → Thursday, thread "${thread.label}" (${thread.id}), ${kind}${again ? ", again" : ""}.${tail}]`;
    const show = (bot: string, line: string): ToolRun => ({
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
        again: true,
        line: (again) =>
          `${bracket(question.bot, "question", again, ` Its answer goes to thread ${thread.id}, recipient ${question.bot}, replyTo ${question.id}.`)}\n${question.text}${options}`,
        relayIds: relays
          .filter((relay) => relay.messageId === question.id)
          .map((relay) => relay.id),
        show: show(question.bot, `${question.bot}: question`),
      });
    }

    // A job from before rooms asks through its own row
    const ask =
      !thread.room &&
      thread.status === "waiting" &&
      thread.ask &&
      !isAppStop(thread.ask)
        ? thread.ask
        : null;
    if (ask) {
      const options = ask.options.length
        ? ` Options: ${ask.options.join(" / ")}.`
        : "";
      items.push({
        rank: OPEN_RANK.question,
        key: `question:${thread.id}@${changed}`,
        again: true,
        line: (again) =>
          `${bracket(thread.bot, "question", again)}\n${ask.question}${options}`,
        relayIds: [],
        show: show(thread.bot, `${thread.bot} is asking`),
      });
    }

    // Relay rows that belong to no open question
    const loose = relays.filter(
      (relay) => !questions.some((question) => question.id === relay.messageId),
    );
    const ended = thread.status === "done" || thread.status === "failed";
    // A stop the app picks back up by itself is not news: it runs again in a moment
    const stopped =
      thread.status === "waiting" && isAppStop(thread.ask) && !thread.ask?.auto;

    if (ended || stopped) {
      if (thread.seen) continue;
      const kind = stopped
        ? "stopped"
        : thread.status === "failed"
          ? "failed"
          : "done";
      const said =
        kind === "stopped"
          ? `It stopped before finishing. Where it got to: ${thread.ask?.question ?? thread.outcome ?? ""}`
          : kind === "failed"
            ? `It could not finish: ${thread.outcome ?? ""}`
            : `Done. Its answer: ${thread.outcome ?? ""}`;
      items.push({
        rank: OPEN_RANK[kind],
        key: `${kind}:${thread.id}@${changed}`,
        again: true,
        line: (again) => `${bracket(thread.bot, kind, again)}\n${said}`,
        // Its ending says what its progress messages said
        relayIds: loose.map((relay) => relay.id),
        show: show(
          thread.bot,
          kind === "stopped"
            ? `${thread.bot} stopped`
            : kind === "failed"
              ? `${thread.bot} could not finish`
              : `Answer from ${thread.bot}`,
        ),
      });
      continue;
    }

    for (const relay of loose) {
      items.push({
        rank: OPEN_RANK.progress,
        key: `progress:${relay.id}`,
        again: false,
        line: () => `${bracket(relay.bot, relay.kind, false)}\n${relay.text}`,
        relayIds: [relay.id],
        show: show(relay.bot, `${relay.bot}: ${relay.kind}`),
      });
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}

export type { CallMessage, CallStatus };
