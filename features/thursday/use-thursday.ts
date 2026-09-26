"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import {
  CALL_END,
  CALL_ENDED_MS,
  CALL_IDLE,
  CALL_LINE,
  CALL_PAGE,
  CALL_RELAY,
  INBOX_POLL_MS,
  LIVE_CALL,
} from "@/config";
import { LIVE_DEFAULTS } from "@/features/ai/live.schema";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { acceptThreadRelaysAction } from "@/features/bot/bot.action";
import type { Bot, Thread } from "@/features/bot/bot.schema";
import { botThreads, screenActs } from "@/features/bot/thread.store";
import { runRemoteTool } from "@/features/thursday/tool-call";
import { askToNotify } from "@/features/workspace/components/artifact-view";
import { isCombo, useHotkey } from "@/hooks/use-hotkey";
import { useWakeWord } from "@/hooks/use-wake-word";
import type { LiveClose } from "@/lib/live/live.schema";
import {
  type LiveActivity,
  type LiveSession,
  type LiveSource,
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
import { FACE_WORD_MAX, undrawable } from "./ascii.const";
import { callSignal, useCallHeld } from "./call-signal";
import { finished, goodbye } from "./face-words";
import {
  openWork,
  startedLine,
  startedOf,
  stoodBefore,
  toldWork,
} from "./open-work";
import { screenActLine } from "./screen-act";
import {
  canShare,
  isSharing,
  onShareChange,
  stopSharing,
  takePicture,
} from "./screen-share";
import {
  endCallAction,
  openCallAction,
  saveThoughtAction,
  saveTurnsAction,
} from "./thursday.action";
import type {
  CallMessage,
  CallStatus,
  FaceWord,
  LiveStatus,
} from "./thursday.schema";
import { useThursdayStore } from "./thursday.store";
import {
  reasoningTitle,
  searchQueryOf,
  searchSourcesOf,
  toolBot,
  toolLine,
} from "./tool-line";
import { useCallRing } from "./use-call-ring";

/**
 * One live call, plus the thread inbox the app watches even with no call open.
 * The server opens the Live session (openCallAction) and runs the tools
 * (tool-call); the page itself hangs up, puts a word on the face, and takes the
 * picture of a screen the user shares (screen-share).
 */

/** Plays when the line opens. */
const CONNECTED_SOUND = "/sounds/start_voice.ogg";

/** Plays when the line closes. */
const HUNG_UP_SOUND = "/sounds/end_voice.ogg";

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

/**
 * What one data channel message may carry when the far end names no limit (the SCTP default
 * the two ends both know), for a picture taken while the connection says none it can be held
 * to (screen-share).
 */
const SCTP_DEFAULT_BYTES = 65_536;

/** Room left in that message for the event around a picture: its type, ids and fields. */
const PICTURE_ENVELOPE_BYTES = 1_024;

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
  /** A finished web search: the pages it read, drawn in place of the sentence. */
  sources?: LiveSource[];
};

/**
 * Why a call ended without the user hanging up: the line was quiet (CALL_IDLE),
 * she hung up (`end_call`), Live closed the session, or the connection dropped.
 */
export type CallEnd = "quiet" | "hungUp" | "closed" | "expired" | "dropped";

/** The one lock a spoken call holds across this app's tabs: one line open at a time (D17). */
const CALL_LOCK = "thursday-spoken-call";

/** Another tab of the app has a call on: said as that, not as a call that failed. */
class CallElsewhere extends Error {}

/**
 * Takes the call lock, or answers null when another tab of the app holds it: two tabs could
 * each open a line, billed twice and saying every update twice. Held until the call lets it
 * go or its tab closes. A browser without Web Locks guards nothing and lets the call go.
 */
function takeCallLock(): Promise<(() => void) | null> {
  if (!("locks" in navigator)) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void navigator.locks.request(CALL_LOCK, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}

export function useThursday(
  /** A call in writing holds the screen (use-text-call): nothing rings, and what comes up is told there. */
  writing = false,
) {
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
  /**
   * Why the last call ended, when the user did not end it; cleared after
   * `CALL_ENDED_MS` or by the next call, so the hint goes back to the way in.
   */
  const [ended, setEnded] = useState<CallEnd | null>(null);
  /** When the backend picked this turn up (ms); the activity line counts from it. */
  const [thinkingSince, setThinkingSince] = useState<number | null>(null);
  /** The title of the backend's latest reasoning summary in this stretch of work. */
  const [thinkingTitle, setThinkingTitle] = useState<string | null>(null);
  /** The word `emote` last put on the face. */
  const [faceWord, setFaceWord] = useState<FaceWord | null>(null);
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
  /** What waits for her to finish reading something out before it goes in (shareNews). */
  const afterReading = useRef<(() => void) | null>(null);
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
  /** Lets go of the call lock this tab holds (takeCallLock). */
  const callLock = useRef<(() => void) | null>(null);
  /** Open work already put to her while this page has been open: one set for both kinds of call (open-work). */
  const told = useRef(toldWork);
  /**
   * Keys put in this call that her voice has not carried yet: rejected, cut short
   * by a hang-up, or never spoken. Hanging up takes them out of `told`, so the
   * next call puts them in again; what she voiced stays out.
   */
  const unvoiced = useRef(new Set<string>());
  /** What already stood when this call opened, and so is not put to her (open-work). */
  const stood = useRef(new Set<string>());
  /** The keys of the update on the line now, carried once her voice starts and stops on it. */
  const onLine = useRef<string[]>([]);
  /** That update's relay rows, accepted once she has voiced it. */
  const onLineRows = useRef<number[]>([]);
  /** When her voice was last heard, for letting a goodbye finish (CALL_END). */
  const voiced = useRef(0);
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
    const bot = toolBot(call.name, call.arguments, latest.current);
    setTool({
      id: call.id,
      name: call.name,
      line: toolLine(call.name, call.arguments, bot),
      bot,
      done: false,
    });
  }, []);

  /** The tool's answer is back: a thread the page does not hold is named by it (toolBot). */
  const nameTool = useCallback((call: LiveToolCall, output: string) => {
    const bot = toolBot(call.name, call.arguments, latest.current, output);
    if (!bot) return;
    setTool((open) =>
      open?.id === call.id && open.bot !== bot
        ? { ...open, bot, line: toolLine(call.name, call.arguments, bot) }
        : open,
    );
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
      CALL_LINE.lingerMs,
    );
  }, []);

  /** The relayed update was voiced, or waited on long enough: the next can go in. */
  const doneReading = useCallback(() => {
    if (reading.current.giveUp) clearTimeout(reading.current.giveUp);
    // Her voice started and stopped on it: carried, and only now are its rows accepted.
    // Live's acknowledgement says the text arrived, not that anyone heard it
    if (reading.current.spoke) {
      for (const key of onLine.current) unvoiced.current.delete(key);
      const ids = onLineRows.current;
      if (ids.length)
        void acceptThreadRelaysAction(ids)
          .then(unwrapResult)
          .catch((cause) =>
            toast.add({
              type: "error",
              title: "Could not record relay delivery",
              description: errorToString(cause),
            }),
          );
    }
    onLineRows.current = [];
    onLine.current = [];
    reading.current = { on: false, spoke: false, giveUp: null };
    afterReading.current?.();
    if (!relayOpen.current) return;
    relayOpen.current = false;
    setTool((open) =>
      open?.kind === "relay" ? { ...open, done: true } : open,
    );
    if (linger.current) clearTimeout(linger.current);
    linger.current = setTimeout(
      () => setTool((open) => (open?.kind === "relay" ? null : open)),
      CALL_LINE.relayLingerMs,
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
    // a stretch of work that starts or ends has not said what it is about yet
    setThinkingTitle(null);
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
        }, CALL_LINE.thinkingTailMs);
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
    // The backend's answer is still on its way to her voice: an update put in now
    // comes out in the same breath as that answer
    if (thinking.current !== null) return;
    if (leaving.current) return;
    // On a call-back, why she called goes in once the opening is voiced: it is the
    // first thing they ask, and a quiet line would come too late
    const rung = rang.current;
    rang.current = false;
    if (!rung && Date.now() - heard.current < CALL_RELAY.quietMs) return;
    const open = openWork(threads).filter(
      (item) => !told.current.has(item.key) && !stood.current.has(item.key),
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
    // Finished work is good news before she says it (an item's key opens with what it is)
    if (first.key.startsWith("done:")) setFaceWord(finished());
    readAloud();
    onLine.current = due.map((item) => item.key);
    onLineRows.current = due.flatMap((item) => item.relayIds);
    // On the line before it goes out, so it runs there for the whole wait
    showRelay((due.at(-1) ?? first).show);
    void live
      .append(
        "commentary",
        lines.length === 1
          ? lines.join("")
          : `[${lines.length} updates.]\n\n${lines.join("\n\n")}`,
      )
      .then((delivered) => {
        // Refused: nothing to wait for her voice on
        if (!delivered) {
          onLineRows.current = [];
          doneReading();
        }
      });
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
    refreshInterval: INBOX_POLL_MS,
  });
  /** Whether the stream has said hello once; a later one is a reconnect. */
  const greeted = useRef(false);

  // Server event stream (app/api/events): signals revalidate their key
  useAppEvent({
    hello: () => {
      // Sent on every connect, so this is also every reconnect: nothing that
      // changed while the stream was down raised a signal anybody heard. The
      // first is this page's own, where every reader has just read — and a
      // revalidation skips the deduping window, so it would be a second round
      // of every read on the screen.
      if (!greeted.current) {
        greeted.current = true;
        return;
      }
      void revalidateAll();
    },
    threads: () => void revalidate(queryKey.threads),
    routines: () => void revalidate(queryKey.routines),
    memory: () => void revalidate(queryKey.memory),
    mcp: () => {
      void revalidate(queryKey.mcp);
      void revalidate(queryKey.mcpTools);
    },
    // A key or sign-in changed, in another tab or a sign-in's own window: the key rows and the model picker both read it
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

  const ring = useCallRing({ threads, resting: status === "idle", writing });
  const { answered, unanswered, settle } = ring;

  // The user acted on screen: context she need not say (screen-act)
  useEffect(
    () =>
      screenActs.subscribe((act) => {
        if (calling.current) outbox.send(screenActLine(act));
      }),
    [outbox],
  );

  // Sharing a screen, or stopping, is told too; while she reads the opening or an update it
  // waits: put in at once, it went in over her greeting, and on two calls she never gave it.
  // What earlier calls said about a screen is in her reading, and she answered from it with
  // a different screen shared; the fact says what is on it now is only known by looking
  const shareNews = useRef<string | null>(null);
  useEffect(() => {
    const tell = () => {
      const news = shareNews.current;
      if (!news || !calling.current || reading.current.on) return;
      shareNews.current = null;
      outbox.send(news);
    };
    afterReading.current = tell;
    const stop = onShareChange((sharing) => {
      if (!calling.current) return;
      shareNews.current = sharing
        ? "The user started sharing their screen with you. What is on it now is known only by looking at it; what was said about a screen before may not be what is there."
        : "The user stopped sharing their screen.";
      tell();
    });
    return () => {
      stop();
      afterReading.current = null;
    };
  }, [outbox]);

  /** Closes the session and resets state. Turns were saved during the call. `why` is null when the user hung up. */
  const hangUp = useCallback(
    async (why: CallEnd | null = null) => {
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
      // A screen is shared with a call, and goes with it; nothing about it is left to tell
      shareNews.current = null;
      stopSharing();
      rang.current = false;
      // What she did not voice goes in again next call; unsent context goes with the session
      for (const key of unvoiced.current) told.current.delete(key);
      unvoiced.current.clear();
      outbox.close();
      outbox.clear();
      working.current?.abort();
      working.current = null;
      // An update still being read when the line goes down was not heard to its end: it is not
      // counted as told, so its rows are not accepted and the next call has it again
      reading.current.spoke = false;
      doneReading();
      if (linger.current) clearTimeout(linger.current);
      // a pending face timer must not fire after the call
      restFace();
      // What came up on this call was this call's to tell; the call-back rings only for what comes after
      settle();
      setIdleLeft(null);
      setSince(null);
      setStatus(live ? "ending" : "idle");
      if (live) setFaceWord(goodbye());
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
      callLock.current?.();
      callLock.current = null;
      const close = finalized.current;
      finalized.current = null;
      ending.current = false;
      setStatus("idle");
      if (live) setEnded(why);
      if (call) void endCallAction(call, close);
      // only when there was a line to close
      if (live && farewell.current) {
        farewell.current.currentTime = 0;
        void farewell.current.play().catch(() => {});
      }
    },
    [outbox, restFace, doneReading, setThinking],
  );

  // A tab closing on a call ends its row by beacon (api/thursday/call/end): a server action
  // sent on the way out never arrives, and a row left live holds every desktop notice back
  useEffect(() => {
    const gone = () => {
      const call = callId.current;
      if (call) navigator.sendBeacon(queryKey.callEnd, call);
    };
    window.addEventListener("pagehide", gone);
    return () => window.removeEventListener("pagehide", gone);
  }, []);

  // Unmount during a call must release the mic and stop tools
  useEffect(() => {
    return () => {
      attempt.current += 1;
      callLock.current?.();
      callLock.current = null;
      void session.current?.close();
      session.current = null;
      // Closing only the session would leave the row live (thursday.query
      // isAnyCallLive) and finished threads unannounced (bot.runner); end the row too
      const call = callId.current;
      callId.current = null;
      calling.current = false;
      opening.current = false;
      if (call) void endCallAction(call);
      // What she did not voice goes in again on the page's next call, as after a hang-up
      for (const key of unvoiced.current) told.current.delete(key);
      unvoiced.current.clear();
      working.current?.abort();
      working.current = null;
      // clear timers so nothing sets state on an unmounted tree
      if (linger.current) clearTimeout(linger.current);
      if (faceIn.current) clearTimeout(faceIn.current);
      if (reading.current.giveUp) clearTimeout(reading.current.giveUp);
      if (thinkTail.current) clearTimeout(thinkTail.current);
      if (failedFor.current) clearTimeout(failedFor.current);
      if (leaving.current) clearInterval(leaving.current);
      // Held for the page, not this screen: left on, it would go on with no Stop in sight
      stopSharing();
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
      if (over || now - asked >= CALL_END.maxMs) void hangUp("hungUp");
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
      // An update she is reading goes on to its end first (CALL_RELAY.readMs at most): hung up
      // mid-sentence, the rest of it was lost
      if (left <= 0 && !reading.current.on) void hangUp("quiet");
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
    const calledBack = ring.isRinging;
    const rangFor = ring.ringingFor;
    // Guard with a ref, not `status`: three entry points (face, wake word,
    // hotkey) can fire in one frame and both see a stale "idle", opening two sessions
    if (opening.current || ending.current) return;
    // with a line open this press hangs up; `calling` covers the gap before re-render
    if (calling.current || status !== "idle") return hangUp();
    answered();
    askToNotify();

    setStatus("connecting");
    setEnded(null);
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
      // After the audio, which has to be opened inside the click
      const release = await takeCallLock();
      if (!release)
        throw new CallElsewhere(
          "A call is already on in another tab of this app. Hang up there, or go on there.",
        );
      callLock.current = release;

      const stop = new AbortController();
      working.current = stop;
      const saving = { failures: 0 };
      const thinkingSaves = { failures: 0 };
      /** Filled in by the handshake, read by callbacks that only run after it. */
      const line = {
        callId: "",
        opening: null as string | null,
        standing: null as string | null,
        /** The set this call's manifest was built from (thursday.schema `opened`). */
        opened: {
          webSearch: LIVE_DEFAULTS.webSearch,
          readSkills: LIVE_DEFAULTS.readSkills,
        },
      };

      // one turn per id; the session reports display groups one at a time
      const turns = new Map<string, CallMessage & { seq: number }>();

      // The backend's own web searches, by the response that ran them: its answer's
      // citations arrive after the search and fill in the pages and their titles.
      type Search = {
        /** What the activity line knows it by. */
        id: string;
        /** The tool turn it is saved under: the output item, whichever way it ran. */
        row: string;
        query: string | null;
        sources: LiveSource[];
        seq: number;
      };
      const searches = new Map<string, Search>();
      // The search whose pages are on the line until the user speaks again
      let held: string | null = null;
      /**
       * A search as it stands: into the call's record (an upsert, so pages arriving later
       * rewrite the same turn), and its pages onto the line. True when the pages are on it;
       * otherwise the line fades like any tool's, which is the caller's to start.
       */
      const keepSearch = (search: Search): boolean => {
        const said = { query: search.query, sources: search.sources };
        persist(saving, () =>
          saveTurnsAction(line.callId, [
            {
              id: search.row,
              role: "tool",
              tool: TOOL_NAMES.web_search,
              text: JSON.stringify(said),
              seq: Math.max(0, Math.round(search.seq)),
              fragments: null,
            },
          ]),
        );
        if (!search.sources.length || held !== search.id) return false;
        // Kept, not lingering: the pages are what she is answering from
        if (linger.current) clearTimeout(linger.current);
        setTool((open) =>
          !open || open.id === search.id
            ? {
                id: search.id,
                name: TOOL_NAMES.web_search,
                line: toolLine(TOOL_NAMES.web_search, JSON.stringify(said)),
                done: true,
                bot: null,
                sources: search.sources,
              }
            : open,
        );
        return true;
      };

      const live = await openLiveSession({
        initialize: async (sdp) => {
          const handshake = unwrapResult(await openCallAction(sdp, calledBack));
          if (!current()) {
            void endCallAction(handshake.callId);
            throw new Error("The call closed during startup.");
          }
          callId.current = handshake.callId;
          line.callId = handshake.callId;
          line.opening = handshake.opening;
          line.standing = handshake.standing;
          line.opened = handshake.opened;
          return handshake.sdp;
        },
        audio: tap.current,
        on: {
          // the backend calls tools; the page forwards them to the server
          runTool: async (call) => {
            // end_call and emote are the page's own tools. The line goes down once
            // her goodbye is over (leave), so this reply reaches the model first
            if (call.name === TOOL_NAMES.end_call) {
              leave();
              return "Ending the call.";
            }
            // the face draws the word; nothing runs anywhere else
            if (call.name === TOOL_NAMES.emote) {
              const { word, reply } = readFaceWord(call.arguments);
              if (word) setFaceWord({ text: word, at: Date.now() });
              return reply;
            }
            // The page holds the shared screen: the picture goes to the backend after this
            // turn's results, made to fit one message of the connection
            if (call.name === TOOL_NAMES.look_at_screen) {
              if (!isSharing())
                return canShare()
                  ? "Nothing is being shared. They can share a screen, a window or a tab with Share screen, under your face."
                  : "Nothing is being shared, and this browser cannot share a screen.";
              // A limit no picture can be held to — none yet, 0, or none at all (Infinity) —
              // is taken as the smallest one every end takes
              const limit = session.current?.messageLimit();
              const bytes =
                limit &&
                Number.isFinite(limit) &&
                limit > PICTURE_ENVELOPE_BYTES * 2
                  ? limit
                  : SCTP_DEFAULT_BYTES;
              const taken = await takePicture(bytes - PICTURE_ENVELOPE_BYTES);
              if ("failed" in taken) return taken.failed;
              return {
                output: "Their screen as it is now follows, as a picture.",
                image: taken.url,
              };
            }
            showTool(call);
            // Exa's search, while its key is set (load-tools): its pages come back with
            // the answer and stay on the line the way the hosted search's do
            const searching = call.name === TOOL_NAMES.web_search;
            if (searching) held = call.id;
            let kept = false;
            try {
              const output = await runRemoteTool(
                line.callId,
                call,
                line.opened,
                stop.signal,
              );
              nameTool(call, output);
              const started =
                call.name === TOOL_NAMES.thread_start
                  ? startedOf(output)
                  : null;
              if (started) outbox.send(startedLine(started));
              if (searching)
                kept = keepSearch({
                  id: call.id,
                  row: call.item ?? call.id,
                  query: searchQueryOf(call.arguments),
                  sources: searchSourcesOf(output),
                  // The turn is already saved from the call itself; an upsert keeps its place
                  seq: 0,
                });
              return output;
            } finally {
              if (!kept) hideTool(call.id);
            }
          },
          // The hosted web search: nothing runs here. The line says what it looks
          // for, then keeps the pages it read until the user speaks again.
          search: (found) => {
            if (!found.done) {
              held = found.id;
              showTool({
                id: found.id,
                name: TOOL_NAMES.web_search,
                arguments: JSON.stringify({ query: found.query }),
              });
              return;
            }
            const search: Search = {
              id: found.id,
              row: found.id,
              query: found.query,
              sources: found.sources,
              seq: found.seq,
            };
            searches.set(found.responseId, search);
            if (!keepSearch(search)) hideTool(search.id);
          },
          cited: (responseId, cited) => {
            const search = searches.get(responseId);
            if (!search) return;
            // A citation carries the title the item lacks; the item's order first, then new pages
            const known = new Set(search.sources.map((source) => source.url));
            search.sources = [
              ...search.sources.map(
                (source) =>
                  cited.find((one) => one.url === source.url) ?? source,
              ),
              ...cited.filter((one) => !known.has(one.url)),
            ];
            keepSearch(search);
          },
          reasoning: (part) => {
            // A summary part opens with its title in bold; the activity line says what the work is about
            const title = reasoningTitle(part.text);
            if (title) setThinkingTitle(title);
            persist(
              thinkingSaves,
              () =>
                saveThoughtAction(line.callId, {
                  ...part,
                  seq: Math.max(0, Math.round(part.seq)),
                }),
              "The backend's thinking is not being saved",
            );
          },
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
            if (fresh && turn.role === "user") {
              stirred.current = Date.now();
              // Their next words take the line back from the pages a search left there
              if (held) {
                const was = held;
                held = null;
                setTool((open) => (open?.id === was ? null : open));
              }
            }
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
                  .slice(-CALL_PAGE.scrollback),
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
            // Live says session.closed (finalized) when it closes the call itself, with why.
            // Not every close is a failure: one that ran to Live's length limit, or that Live's
            // side hung up, is said plainly, and a safety stop as a warning; only a lost line or
            // an unknown close is drawn red, with her ERROR face
            const reason = finalized.current?.reason;
            if (reason === "expired" || reason === "remote_hangup") {
              void hangUp(reason === "expired" ? "expired" : "closed");
              return;
            }
            if (reason === "content") {
              toast.add({
                type: "warning",
                title: "Live ended the call",
                description: "Its safety filter stopped the conversation.",
              });
              void hangUp("closed");
              return;
            }
            toast.add({ type: "error", title: "Call failed", description });
            showFailed(true);
            void hangUp(finalized.current ? "closed" : "dropped");
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
      stood.current = calledBack
        ? new Set()
        : stoodBefore(latest.current ?? []);
      // Context is not gated: held lines first, then each as it comes
      outbox.open((text) => void live.append("thinking", text));
      // The quiet clock starts with the line, so nothing is put to her the moment it opens
      heard.current = Date.now();

      if (line.opening) {
        // The greeting goes first; open work waits until she has said it. The room is kept
        // from her until she starts it, or she waits on it (config LIVE_CALL.openingHoldMs)
        readAloud();
        live.holdInput(LIVE_CALL.openingHoldMs);
        void live.append("instructions", line.opening).then(unless);
      }
      // What is already open is the backend's to know and nobody's to hear: it waits there
      // for the first turn the voice hands over (ai/prompts/call-standing)
      if (line.standing) live.brief(line.standing);

      wearFace("listening");
      setSince(Date.now());
      // a rejected chime is not worth a message
      void chime.play().catch(() => {});
    } catch (cause) {
      callLock.current?.();
      callLock.current = null;
      // Hanging up while the line was going up is not a failure to report
      if (current() && cause instanceof CallElsewhere)
        toast.add({
          type: "warning",
          title: "One call at a time",
          description: cause.message,
        });
      else if (current()) {
        toast.add({
          type: "error",
          title: "Could not start the call",
          description: errorToString(cause),
        });
        showFailed(true);
        // Answering took the ring down; it comes back as missed, since nothing was told
        if (calledBack) unanswered(rangFor);
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
    nameTool,
    hideTool,
    showFace,
    wearFace,
    outbox,
    readAloud,
    doneReading,
    holdThinking,
    showFailed,
    leave,
    ring.isRinging,
    ring.ringingFor,
    answered,
    unanswered,
  ]);

  // Why the last call ended is news for a moment, not the idle screen's one line
  useEffect(() => {
    if (!ended) return;
    const out = setTimeout(() => setEnded(null), CALL_ENDED_MS);
    return () => clearTimeout(out);
  }, [ended]);

  /** Read by the face once per animation frame, outside React state. */
  const getSpectrum = useCallback(() => tap.current?.read() ?? EMPTY_BANDS, []);
  /** The same, for the user's own mic: what the listening meter draws. */
  const getMicSpectrum = useCallback(
    () => tap.current?.readMic() ?? EMPTY_BANDS,
    [],
  );
  // Wake word while no line is open; the recognizer cannot share its raw audio.
  // The seam is `enabled` and `onWake` / `onError` only, so the recognizer can be swapped
  const wake = useThursdayStore((state) => state.wake);
  const [wakeBlocked, setWakeBlocked] = useState(false);
  // The first-run intro holds both ways in off while it is up, and places the first call itself
  const held = useCallHeld();
  useEffect(() => callSignal.onPlace(() => void call()), [call]);
  useWakeWord({
    enabled: status === "idle" && wake.enabled && !wakeBlocked && !held,
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
    enabled: hotkey.enabled && !busy && !held,
    combo: hotkey.enabled && isCombo(hotkey.combo) ? hotkey.combo : null,
    onPress: () => void call(),
  });

  return {
    status,
    /** A call just failed to open or dropped; true for a few seconds after. */
    failed,
    messages,
    tool,
    /** Why the last call ended, when the user did not end it; null during a call. */
    ended,
    /** When the backend picked the turn up (ms); null when it is not working. */
    thinkingSince,
    /** What the backend's latest reasoning summary says it is doing; null before one arrives. */
    thinkingTitle,
    /** The word `emote` last put on the face; null before one. */
    faceWord,
    /** Seconds until idle hang-up; null outside the warning window. */
    idleLeft,
    /** When the line opened (ms); null without a call. */
    since,
    call,
    /** A call-back ringing; null when none is. Any way of placing a call answers it. */
    ringing: ring.ringing,
    /** Stops the ringing without answering. */
    decline: ring.decline,
    getSpectrum,
    getMicSpectrum,
    /** null when the tap is the only entry point. */
    wakePhrase: wake.enabled && !wakeBlocked ? wake.phrase : null,
    /** Key combo that opens and closes the call; null if none (use-hotkey notation). */
    hotkey: hotkey.enabled && isCombo(hotkey.combo) ? hotkey.combo : null,
  };
}

const EMPTY_BANDS = new Array<number>(SPECTRUM_BANDS).fill(0);

/** What `emote` asked the face to show, and the line the model reads back; `word` is null when nothing is shown. */
function readFaceWord(args: string): { word: string | null; reply: string } {
  let text = "";
  try {
    const parsed: unknown = JSON.parse(args);
    if (parsed && typeof parsed === "object" && "text" in parsed) {
      text = String(parsed.text ?? "").trim();
    }
  } catch {
    text = "";
  }
  const length = Array.from(text).length;
  if (!length)
    return { word: null, reply: "Nothing was shown: text is empty." };
  if (length > FACE_WORD_MAX) {
    return {
      word: null,
      reply: `Too long: ${length} characters, ${FACE_WORD_MAX} at most. Nothing was shown.`,
    };
  }
  const bad = undrawable(text);
  if (bad) {
    return {
      word: null,
      reply: `Cannot draw "${bad}"; use only the characters \`text\` lists. Nothing was shown.`,
    };
  }
  return { word: text.toUpperCase(), reply: "Shown." };
}

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
    return activity.tools.includes(TOOL_NAMES.thread_start)
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

/** Fire-and-forget save; after CALL_PAGE.saveFailures failures of this kind it stops and says so once. */
function persist(
  saving: { failures: number },
  save: () => Promise<Result<unknown>>,
  stopped = "This call is not being saved",
) {
  if (saving.failures >= CALL_PAGE.saveFailures) return;
  void save()
    .then((result) => unwrapResult(result))
    .catch((cause) => {
      saving.failures += 1;
      if (saving.failures !== CALL_PAGE.saveFailures) return;
      toast.add({
        type: "warning",
        title: stopped,
        description: errorToString(cause),
      });
    });
}
