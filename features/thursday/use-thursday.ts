"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  type Bot,
  isAppStop,
  TASK_CONTINUE,
  type Task,
} from "@/features/bot/bot.schema";
import { MARK_BANDS } from "@/features/bot/mark.const";
import { botTasks, screenActs } from "@/features/bot/task.store";
import { runRemoteTool } from "@/features/thursday/tool-call";
import { isCombo, useHotkey } from "@/hooks/use-hotkey";
import { useWakeWord } from "@/hooks/use-wake-word";
import { toDate } from "@/lib/date-like";
import { unwrapResult } from "@/lib/protocol/result";
import {
  revalidate,
  revalidateAll,
  useServerRoute,
} from "@/lib/protocol/use-server-route";
import { createOutbox, type Outbox } from "@/lib/queue";
import { openRealtimeSession } from "@/lib/realtime/open-session";
import type {
  RealtimeActivity,
  RealtimeSession,
  RealtimeToolCall,
} from "@/lib/realtime/realtime.session";
import { type AudioTap, createAudioTap } from "@/lib/realtime/realtime.tap";
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
 * One live call, plus the task inbox the app watches even with no call open.
 * The server picks the provider (openCallAction) and runs the tools (tool-call);
 * the page itself only hangs up.
 */

/** Time for a tool result to reach the model before the socket closes. */
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
 * The face lags the activity line: only a tool held longer than this switches
 * to the working face. Shorter tools show on the line only.
 */
const FACE_TOOL_MS = 800;

/**
 * Gap between the last tool answer and the first audio. The listening face
 * waits this long before showing.
 */
const FACE_SETTLE_MS = 600;

/** Scrollback for the side-by-side layout; the call view shows at most three. */
const KEEP_MESSAGES = 24;

/** Safety net only; the event stream revalidates tasks as they change. */
const TASK_POLL_FALLBACK_MS = 30_000;

/** Notify once about failing saves, then stay quiet for the rest of the call. */
const SAVE_FAILURE_LIMIT = 3;

/**
 * With no user speech, agent speech, or tool for this long, the model is asked
 * to say goodbye and call end_call.
 */
const IDLE_HANG_UP_MS = 60_000;

/** If end_call does not follow the goodbye, the page hangs up. */
const IDLE_GRACE_MS = 15_000;

/** The countdown shows on screen inside this window. */
const IDLE_WARN_MS = 15_000;

/**
 * The user finished a turn and nothing came back — no words, no tool — for this
 * long. The line is up and the model is not on it, so there is no goodbye to
 * ask for: the page hangs up. Only armed while an answer is owed, so a quiet
 * line still ends the slow way (IDLE_HANG_UP_MS).
 */
const AGENT_SILENT_MS = 30_000;

const IDLE_LINE =
  "The user has said nothing for a minute. Say a one-line goodbye, then call end_call.";

/**
 * Upper bound on the mic staying muted for a relayed line the model never
 * voices (the response can be rejected).
 */
const RELAY_MIC_MS = 15_000;

/** A line queued for the model. */
type Said = {
  line: string;
  /** Shown on the activity line when the line is sent. */
  show?: ToolRun;
};

/**
 * A tool the model is using, as the activity line draws it. `line` is the
 * human-readable sentence (tool-line), null when none exists; `name` is the
 * tool that actually ran.
 */
export type ToolRun = {
  name: string;
  line: string | null;
  done: boolean;
  /** A relay from a bot (answer or question) rather than a tool; `name` is the task label. */
  kind?: "tool" | "relay";
  /** The bot this names, when it names one: the row draws its face instead of a glyph. */
  bot?: string | null;
};

export function useThursday() {
  const session = useRef<RealtimeSession | null>(null);
  // created on the first call: `new Audio()` cannot run during SSR
  const tap = useRef<AudioTap | null>(null);
  /** Created inside the call-starting click; hang-up may come from a tool or a disconnect with no gesture. */
  const farewell = useRef<HTMLAudioElement | null>(null);

  const [status, setStatus] = useState<CallStatus>("idle");
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [tool, setTool] = useState<ToolRun | null>(null);
  /** When the line opened (ms). */
  const [since, setSince] = useState<number | null>(null);
  /** Seconds until idle hang-up; set only inside IDLE_WARN_MS. */
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  /**
   * Mic is muted while a tool runs and while a relayed line is being read.
   * The effect below applies it to the session.
   */
  const [micOff, setMicOff] = useState(false);
  /** The two mute reasons, and whether the relayed line has produced audio yet. */
  const mic = useRef<{
    tool: boolean;
    reading: boolean;
    spoke: boolean;
    giveUp: ReturnType<typeof setTimeout> | null;
  }>({ tool: false, reading: false, spoke: false, giveUp: null });
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
  // Every server-run tool in this call starts with this signal, so one abort
  // reaches running browser commands. Delegated tasks are server-owned and outlive the call
  const working = useRef<AbortController | null>(null);
  /** Row the turns are saved to; a ref so long-lived callbacks see it. */
  const callId = useRef<string | null>(null);
  /**
   * Relays sent this call, keyed by relayKey (id + updatedAt): an answered task
   * can stop to ask again, so the id alone would silence its second question.
   */
  const relayed = useRef(new Set<string>());
  /** When this call was placed. An ending from before it is already in her prompt. */
  const placedAt = useRef(0);
  /**
   * Lines for the model, including ones raised before the line opens. Held
   * until the session exists, which is also what lets a call-back queue its
   * line first.
   */
  const outboxRef = useRef<Outbox<Said> | null>(null);
  const outbox = (outboxRef.current ??= createOutbox<Said>());
  /**
   * Sends what piled up while she was reading the last line, as one line. Set
   * for the length of a session; null between calls.
   */
  const resumeRelay = useRef<(() => void) | null>(null);
  /** Wants a call, including while connecting. */
  const calling = useRef(false);
  /**
   * Opening the line: true only between the click and the session. Distinct
   * from `calling` (true for the whole call), which cannot be the first guard
   * in `call` or the hang-up press is swallowed too.
   */
  const opening = useRef(false);

  const showTool = useCallback((call: RealtimeToolCall) => {
    if (linger.current) clearTimeout(linger.current);
    setTool({
      name: call.name,
      line: toolLine(call.name, call.arguments),
      bot: toolBot(call.name, call.arguments),
      done: false,
    });
  }, []);

  /** A relay takes the tool line and stays long enough to read. */
  const showRelay = useCallback((run: ToolRun) => {
    if (linger.current) clearTimeout(linger.current);
    setTool(run);
    linger.current = setTimeout(
      () => setTool((open) => (open?.kind === "relay" ? null : open)),
      RELAY_LINGER_MS,
    );
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

  /** The effect below is the only place that touches the session mute. */
  const syncMic = useCallback(() => {
    setMicOff(mic.current.tool || mic.current.reading);
  }, []);

  const openMic = useCallback(() => {
    if (mic.current.giveUp) clearTimeout(mic.current.giveUp);
    mic.current.giveUp = null;
    mic.current.reading = false;
    mic.current.spoke = false;
    syncMic();
  }, [syncMic]);

  /** A relayed line is on the wire; the mic stays muted until it is read. */
  const readAloud = useCallback(() => {
    if (mic.current.giveUp) clearTimeout(mic.current.giveUp);
    mic.current.reading = true;
    mic.current.spoke = false;
    mic.current.giveUp = setTimeout(() => {
      openMic();
      // a line she never voiced must not strand the ones queued behind it
      resumeRelay.current?.();
    }, RELAY_MIC_MS);
    syncMic();
  }, [openMic, syncMic]);

  // muting at the track level also clears the browser's recording indicator (realtime.audio setMuted)
  useEffect(() => {
    session.current?.mute(micOff);
  }, [micOff]);

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

  const onCall = status !== "idle" && status !== "connecting";

  // Inbox, with or without a call. Revalidated on server events; polling is the safety net
  const { data: tasks } = useServerRoute<Task[]>(queryKey.tasks, {
    refreshInterval: TASK_POLL_FALLBACK_MS,
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
    tasks: () => void revalidate(queryKey.tasks),
    memory: () => void revalidate(queryKey.memory),
    mcp: () => {
      void revalidate(queryKey.mcp);
      void revalidate(queryKey.mcpTools);
    },
  });

  // faces come from the bot list
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  useEffect(() => {
    if (tasks) botTasks.sync(tasks, bots);
  }, [tasks, bots]);

  // A question is relayed on every call, because it still needs an answer. An
  // ending is relayed only on the call it happened during: one from before is
  // already in her prompt, on the `delegate` line that opened it. Telling is not
  // seeing — the badge clears when the user opens the job. Sending while the
  // line is still opening is fine: the outbox holds the line. `status` is in
  // deps because the guard is a ref; without it a list that arrived before the
  // line opened would wait for the next tasks change
  useEffect(() => {
    if (!tasks || !calling.current) return;
    for (const task of tasks) {
      if (task.status === "running") continue;
      // A stop the app picks back up by itself is not news: it runs again in a moment
      if (task.ask?.auto) continue;
      if (
        task.status !== "waiting" &&
        toDate(task.updatedAt).getTime() < placedAt.current
      )
        continue;
      const key = relayKey(task);
      if (relayed.current.has(key)) continue;
      relayed.current.add(key);
      outbox.send({ line: relayLine(task), show: relayShow(task) });
    }
  }, [tasks, outbox, status]);

  // The user acted on a task on screen; the model may have just read that question and must not ask again
  useEffect(
    () =>
      screenActs.subscribe((act) => {
        if (!calling.current) return;
        outbox.send({
          line:
            act.kind === "answered"
              ? `The user answered task "${act.label}" on screen: ${act.answer}. The bot is going on with that — do not ask again.`
              : `The user stopped task "${act.label}" on screen. It is not running any more — do not wait for it or say anything more about it.`,
        });
      }),
    [outbox],
  );

  /** Closes the session and resets state. Turns were saved during the call. */
  const hangUp = useCallback(async () => {
    const live = session.current;
    const call = callId.current;

    session.current = null;
    callId.current = null;
    calling.current = false;
    opening.current = false;
    relayed.current.clear();
    // unsent lines go: a question is relayed again next call, an ending is in her prompt
    outbox.close();
    outbox.clear();
    // holds the closed session; the next call sets its own
    resumeRelay.current = null;
    working.current?.abort();
    working.current = null;
    mic.current.tool = false;
    openMic();
    if (linger.current) clearTimeout(linger.current);
    // a pending face timer must not fire after the call
    restFace();
    if (idle.current.grace) clearTimeout(idle.current.grace);
    idle.current = { since: 0, asked: false, owed: null, grace: null };
    setIdleLeft(null);
    setSince(null);
    setStatus("idle");
    setMessages([]);
    setTool(null);
    // the room is not cleared: tasks outlive the call

    // closing finalizes a mid-speech turn, so its save is queued first
    live?.close();
    if (call) void endCallAction(call);
    // only when there was a line to close
    if (live && farewell.current) {
      farewell.current.currentTime = 0;
      void farewell.current.play().catch(() => {});
    }
  }, [outbox, restFace, openMic]);

  // Unmount during a call must release the mic and stop tools
  useEffect(() => {
    return () => {
      session.current?.close();
      session.current = null;
      // Closing only the session would leave the row live (thursday.query
      // isAnyCallLive) and finished tasks unannounced (bot.runner); end the row too
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
      if (mic.current.giveUp) clearTimeout(mic.current.giveUp);
      if (idle.current.grace) clearTimeout(idle.current.grace);
    };
  }, []);

  /**
   * Rewinds the idle clock. User activity also cancels a requested goodbye;
   * agent activity does not, so the goodbye cannot cancel itself.
   */
  const stir = useCallback((who: "user" | "agent") => {
    const now = Date.now();
    idle.current.since = now;
    if (who !== "user") {
      // Words or a tool: she is on the line, so nothing is owed.
      idle.current.owed = null;
      return;
    }
    // Rewound by anything the user does, transcript deltas included, so a long
    // turn is never mistaken for a line that stopped answering; it runs from the
    // moment they stopped rather than from the moment they started.
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
      live.say(IDLE_LINE);
      idle.current.grace = setTimeout(() => void hangUp(), IDLE_GRACE_MS);
    }, 1000);
    return () => clearInterval(tick);
  }, [onCall, stir, hangUp]);

  const call = useCallback(async () => {
    // Guard with a ref, not `status`: three entry points (face, wake word,
    // hotkey) can fire in one frame and both see a stale "idle", opening two sessions
    if (opening.current) return;
    // with a line open this press hangs up; `calling` covers the gap before re-render
    if (calling.current || status !== "idle") return hangUp();

    setStatus("connecting");
    // from here on this is a call; the outbox holds lines until the session exists
    opening.current = true;
    calling.current = true;
    placedAt.current = Date.now();
    outbox.clear();
    try {
      const handshake = unwrapResult(await openCallAction(thursdaySettings()));
      callId.current = handshake.callId;

      const stop = new AbortController();
      working.current = stop;
      const saving = { failures: 0 };

      tap.current ??= createAudioTap();
      // Inside the gesture: an AudioContext created elsewhere starts suspended.
      // Calls from the wake word or a call-back have no gesture; armAudioUnlock handles those
      armAudioUnlock(tap.current.open().context);
      const chime = new Audio(CONNECTED_SOUND);
      farewell.current ??= new Audio(HUNG_UP_SOUND);

      // one turn per seq; the session reports turns one at a time
      const turns: CallMessage[] = [];

      const live = await openRealtimeSession({
        provider: handshake.provider,
        credential: handshake.credential,
        setup: handshake.session,
        audio: tap.current,
        on: {
          // the session calls tools; the page forwards them to the server
          runTool: async (call) => {
            // end_call is the page's only tool. Answer without awaiting: the socket
            // goes down with the call, so this reply must go first
            if (call.name === TOOL_NAMES.end_call) {
              setTimeout(() => void hangUp(), HANG_UP_DELAY_MS);
              return "Ending the call.";
            }
            showTool(call);
            try {
              return await runRemoteTool(handshake.callId, call, stop.signal);
            } finally {
              hideTool(call.name);
            }
          },
          turn: (turn) => {
            stir(turn.role === "user" ? "user" : "agent");
            // tool turns are saved but not shown
            if (turn.role !== "tool") {
              turns[turn.seq] = {
                id: turn.id,
                role: turn.role,
                text: turn.text,
              };
              // holes are turns whose text has not arrived
              setMessages(turns.filter(Boolean).slice(-KEEP_MESSAGES));
            }
            if (turn.done) {
              const { id, role, tool, text, seq } = turn;
              persistTurn(
                handshake.callId,
                { id, role, tool, text, seq },
                saving,
              );
            }
          },
          // session facts drive the face through showFace; the tool line is drawn by the tool itself
          activity: (activity) => {
            showFace(statusOf(activity));
            if (activity.hearing) stir("user");
            else if (activity.speaking || activity.tools.length) stir("agent");
            // Tool mute is the live fact. Relay mute ends once playback has started and
            // stopped: turn text is finalized before audio (realtime.session), so playback is what counts
            mic.current.tool = activity.tools.length > 0;
            if (mic.current.reading) {
              if (activity.speaking) mic.current.spoke = true;
              else if (mic.current.spoke) {
                mic.current.reading = false;
                // she has finished reading; whatever landed meanwhile goes now
                resumeRelay.current?.();
              }
            }
            if (!mic.current.reading) openMic();
            else syncMic();
          },
          warn: (description) =>
            toast.add({ type: "warning", title: "Call warning", description }),
          failed: (description) => {
            toast.add({ type: "error", title: "Call failed", description });
            void hangUp();
          },
        },
      });

      /**
       * One line at a time. Three jobs landing together used to be three
       * system items and three turns in a row, which the user hears
       * as her talking to herself; the box stays closed while she reads one,
       * and whatever arrived meanwhile goes out merged, as one thing to say.
       */
      const flush = (queued: Said[]) => {
        if (!queued.length) return;
        // not the user's turn while the model reads this
        readAloud();
        live.say(queued.length === 1 ? queued[0].line : mergedRelay(queued));
        const last = queued.at(-1)?.show;
        if (last) showRelay(last);
        outbox.close();
      };

      resumeRelay.current = () => {
        const held = outbox.clear();
        outbox.open((one) => flush([one]));
        flush(held);
      };

      // line open: flush held lines first
      outbox.open((one) => flush([one]));

      // First call: the opening system entry makes the model speak first, on the same path as a relay
      if (handshake.opening) {
        readAloud();
        live.say(handshake.opening);
      }

      session.current = live;
      opening.current = false;
      wearFace("listening");
      setSince(Date.now());
      // a rejected chime is not worth a message
      void chime.play().catch(() => {});
    } catch (cause) {
      toast.add({
        type: "error",
        title: "Could not start the call",
        description: errorToString(cause),
      });
      // a call that never opened still has a row; close it
      if (callId.current) void endCallAction(callId.current);
      callId.current = null;
      opening.current = false;
      calling.current = false;
      outbox.clear();
      // nothing was delivered; forget so the next call resends
      relayed.current.clear();
      setStatus("idle");
    }
  }, [
    status,
    hangUp,
    showTool,
    hideTool,
    showRelay,
    showFace,
    wearFace,
    stir,
    outbox,
    readAloud,
    openMic,
    syncMic,
  ]);

  /**
   * Call-back: opens a call when a task is waiting on the user and no line is
   * open. Tried once per task (`woke`), or a failed open would redial forever;
   * tasks present at app start count as already tried.
   */
  const callBack = useThursdayStore((state) => state.callBack);
  const woke = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!tasks) return;
    const wants = tasks.filter(
      (task) =>
        !task.seen &&
        !task.ask?.auto &&
        (asksSomething(task) ||
          (callBack === "any" && task.status !== "running")),
    );

    if (!woke.current) {
      woke.current = new Set(wants.map((task) => task.id));
      return;
    }

    // forget tasks that stopped waiting; a later stop counts as fresh
    const open = new Set(wants.map((task) => task.id));
    for (const id of woke.current) {
      if (!open.has(id)) woke.current.delete(id);
    }

    if (callBack === "off" || status !== "idle") return;
    const fresh = wants.filter((task) => !woke.current?.has(task.id));
    if (!fresh.length) return;

    for (const task of wants) woke.current.add(task.id);
    void call();
  }, [tasks, callBack, status, call]);

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
    onError: () => setWakeBlocked(true),
  });

  // Hotkey presses `call` like the face tap, so it hangs up during a call; disabled while the line goes up or down
  const hotkey = useThursdayStore((state) => state.hotkey);
  const busy = status === "connecting";
  useHotkey({
    enabled: hotkey.enabled && !busy,
    combo: hotkey.enabled && isCombo(hotkey.combo) ? hotkey.combo : null,
    onPress: () => void call(),
  });

  return {
    status,
    messages,
    tool,
    /** Seconds until idle hang-up; null outside the warning window. */
    idleLeft,
    /** Mic muted: a tool is running or a relay is being read. */
    micOff,
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

/** Relay dedup key: task id plus its last state change. */
const relayKey = (task: Task) =>
  `${task.id}@${toDate(task.updatedAt).getTime()}`;

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

/** Tools win over speech; delegate gets its own face. */
function statusOf(activity: RealtimeActivity): LiveStatus {
  if (activity.tools.length) {
    return activity.tools.includes(TOOL_NAMES.delegate)
      ? "delegating"
      : "working";
  }
  return activity.speaking ? "speaking" : "listening";
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
function asksSomething(task: Task) {
  return task.status === "waiting" && !isAppStop(task.ask);
}

/**
 * Sent as a system entry (realtime.driver say); the first sentence names
 * sender and recipient or the model answers it as user speech.
 */
function relayLine(task: Task) {
  // The label travels with the answer: what the user says next about this job
  // is a word to it, and the task tool takes it by that name
  const from = `[${task.bot} → you, about "${task.label}" — not the user speaking; they have not heard this. Anything more on this job goes to the task tool as "${task.label}", never a new job.]`;
  switch (task.status) {
    case "waiting": {
      // a stop is told, not read as a question
      const options = task.ask?.options ?? [];
      const said = task.ask?.question ?? task.outcome ?? "";
      if (isAppStop(task.ask)) {
        return `${from} It stopped before finishing. Where it got to: ${said} Ask whether to keep going; if yes, send "${TASK_CONTINUE}" with the task tool.`;
      }
      const list = options.length ? ` Options: ${options.join(" / ")}.` : "";
      return `${from} It asks: ${said}${list} Answer with the task tool if you can; otherwise ask the user and send back what they say.`;
    }
    case "failed":
      return `${from} It could not finish: ${task.outcome ?? ""}`;
    default:
      return `${from} Done. Its answer: ${task.outcome ?? ""}`;
  }
}

/**
 * Lines that piled up while she was reading, as one system entry. The header
 * is what stops it becoming one turn per job: they arrived together and the
 * user has heard none of them.
 */
function mergedRelay(queued: Said[]) {
  return `[${queued.length} jobs came back at once — not the user speaking; they have heard none of this. Tell them in one turn, not ${queued.length}.]

${queued.map((one) => one.line).join("\n\n")}`;
}

/** The same relay on the activity line, so the user sees where the model's line came from. */
function relayShow(task: Task): ToolRun {
  const line =
    task.status === "waiting"
      ? isAppStop(task.ask)
        ? `${task.bot} stopped`
        : `${task.bot} is asking`
      : task.status === "failed"
        ? `${task.bot} could not finish`
        : `Answer from ${task.bot}`;
  return { kind: "relay", name: task.label, line, done: true, bot: task.bot };
}

export type { CallMessage, CallStatus };
