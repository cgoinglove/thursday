"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CALL_BACK } from "@/config";
import type { Thread } from "@/features/bot/bot.schema";
import { ringingThreads } from "@/features/bot/thread.store";
import { useEscape } from "@/hooks/use-hotkey";
import { toDate } from "@/lib/date-like";
import { createRing } from "@/lib/live/ring";
import type { CallBack } from "./thursday.schema";
import { useThursdayStore } from "./thursday.store";

/** One thread a call-back is about, as the screen names it. */
export type Rung = {
  id: string;
  /** The bot whose work rang: the one asking, else the thread's own. */
  bot: string;
  kind: "question" | "done" | "stopped";
  label: string;
  /** What it is about: the question, else how the work ended or where it stopped. */
  text: string;
  /** The answers the bot offered with its question. */
  options: string[];
};

/** A call-back ringing: one call for everything that waits, told one by one once it is answered. */
export type Ringing = {
  /** The first thread that rang, shown whole. */
  first: Rung;
  /** The threads ringing with it, in the order they rang. */
  others: Rung[];
  /** When it rang out unanswered, from when it waits under her face as a missed list; null while it rings. */
  missedAt: number | null;
};

/**
 * Call-back: rings when a thread is waiting on the user and no line is open,
 * only for threads that changed after `ringAfter`. What came up during a call
 * was that call's to tell, and the next call tells what it left unsaid. Ringing
 * never opens the line; answering does (`call`). A thread handled meanwhile, on
 * screen or by the setting going off, stops ringing for itself.
 */
export function useCallRing({
  threads,
  resting,
  writing,
}: {
  threads: Thread[] | undefined;
  /** No spoken line is open or going up or down: the only time it starts ringing. */
  resting: boolean;
  /** A call in writing holds the screen (use-text-call): nothing rings meanwhile. */
  writing: boolean;
}) {
  /**
   * The call-back rings only for threads that changed after this: the last call's
   * end, the last ring, or the page opening.
   */
  const ringAfter = useRef(Date.now());
  /** The threads a call-back is up for, until it is answered or dismissed. */
  const [ringingFor, setRingingFor] = useState<string[]>([]);
  /** When they rang out: it stays on screen as a missed list from then, but nothing rings any more. */
  const [rangOutAt, setRangOutAt] = useState<number | null>(null);
  const isRinging = ringingFor.length > 0;

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
    if (!resting || writing) return;
    const after = ringAfter.current;
    const fresh = threads.filter(
      (thread) =>
        wanted.has(thread.id) && toDate(thread.updatedAt).getTime() > after,
    );
    if (!fresh.length) return;

    // The newest change this list brought, never the clock: a job that ended
    // while the read was on its way is older than "now" by the time it lands,
    // and would never ring at all.
    ringAfter.current = Math.max(
      ...fresh.map((thread) => toDate(thread.updatedAt).getTime()),
    );
    // Work that is new to it rings again, even if it had rung out
    setRangOutAt(null);
    setRingingFor((ids) => [
      ...ids,
      ...fresh.map((thread) => thread.id).filter((id) => !ids.includes(id)),
    ]);
  }, [threads, callBack, resting, writing]);

  // Writing to her answers a ring as calling her does, and what came up while they wrote
  // was that call's to tell: nothing from before its end rings afterwards
  useEffect(() => {
    if (writing) {
      setRingingFor([]);
      setRangOutAt(null);
    } else ringAfter.current = Date.now();
  }, [writing]);

  /**
   * While it rings: it stops ringing by itself after CALL_BACK.ringMs and stays on
   * the screen as a missed call until the user answers or dismisses it, so stepping
   * away does not lose it (canvas "Thursday 콜백 알림" B, user 09-17). Esc dismisses.
   * A thread added to a ring already going does not restart the clock.
   */
  const decline = useCallback(() => {
    setRingingFor([]);
    setRangOutAt(null);
  }, []);

  // One Esc does one thing: a line or a room already up keeps its own, and this
  // takes the next (use-hotkey useEscape).
  useEscape(isRinging, decline);
  useEffect(() => {
    if (!isRinging || rangOutAt !== null) return;
    const out = setTimeout(() => setRangOutAt(Date.now()), CALL_BACK.ringMs);
    return () => clearTimeout(out);
  }, [isRinging, rangOutAt]);
  // It rings out loud for as long as the screen rings: a call nobody hears is a notice
  useEffect(() => {
    if (!isRinging || rangOutAt !== null) return;
    const ring = createRing();
    ring.start();
    return () => ring.stop();
  }, [isRinging, rangOutAt]);

  /** What the ringing screen names: every thread that rang, the first one whole. */
  const ringing = useMemo((): Ringing | null => {
    const [first, ...others] = ringingFor.flatMap((id): Rung[] => {
      const thread = threads?.find((one) => one.id === id);
      if (!thread) return [];
      const question = thread.room.questions[0];
      return [
        {
          id: thread.id,
          bot: question?.bot ?? thread.bot,
          kind: question
            ? "question"
            : thread.status === "done"
              ? "done"
              : "stopped",
          label: thread.label,
          text:
            question?.text ??
            thread.outcome ??
            thread.ask?.question ??
            thread.label,
          options: question?.options ?? [],
        },
      ];
    });
    return first ? { first, others, missedAt: rangOutAt } : null;
  }, [ringingFor, threads, rangOutAt]);

  // The screen under her face has these threads, so the room's pill leaves their rows to it
  useEffect(() => {
    ringingThreads.set(ringingFor);
  }, [ringingFor]);

  /** The call that answers it takes the ring down. */
  const answered = useCallback(() => {
    setRingingFor([]);
    setRangOutAt(null);
  }, []);

  /** A call ended: what came up during it was that call's to tell, and only what comes after rings. */
  const settle = useCallback(() => {
    ringAfter.current = Date.now();
  }, []);

  return { ringing, isRinging, ringingFor, answered, settle, decline };
}

/**
 * Whether a thread is one the call-back rings for: a real question, or with
 * "any" every ending.
 */
const ringsFor = (thread: Thread, callBack: CallBack) =>
  callBack !== "off" &&
  !thread.seen &&
  (thread.room.questions.length > 0 ||
    (callBack === "any" && thread.status !== "running"));
