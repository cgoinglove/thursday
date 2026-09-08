"use client";

import { useEffect, useRef } from "react";

/**
 * Wake-word listener built on the browser's Web Speech API (no realtime socket
 * while idle). It is a transcriber, not a KWS engine, so matching is fuzzy.
 * Chrome streams idle audio to Google; Firefox has no recognizer (onError only).
 */

/** lib.dom types the result objects but not the recognizer itself. */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: SpeechRecognitionResultList;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Default recognizer language. English keeps one spelling to compare against
 * regardless of the speaker's accent; callers with a non-English name pass
 * `lang` and `phrases` together.
 */
export const WAKE_LANG = "en-US";

/**
 * Allowed edit distance per word as a fraction of its length ("hey" = 1 edit,
 * "thursday" = 3). Lower misses accents; higher lets ordinary speech wake.
 */
const WAKE_TOLERANCE = 0.34;

/** Alternatives per result; the second-ranked guess is often the right one. */
const ALTERNATIVES = 3;

/** Delay before restarting after `onend`, so error loops do not spin. */
const RESTART_MS = 300;
/** Backoff cap while the recognition service is unreachable. */
const RESTART_MAX_MS = 10_000;

/** Errors a restart cannot fix. */
const FATAL: Record<string, string> = {
  "not-allowed": "The microphone is not allowed",
  "service-not-allowed": "The microphone is not allowed",
  "audio-capture": "There is no microphone",
  "language-not-supported": "This browser cannot listen in that language",
};

/** Case and punctuation vary per recognizer; word boundaries do not. */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);

/** Plain Levenshtein distance between two words. */
function distance(heard: string, want: string): number {
  let previous = Array.from({ length: heard.length + 1 }, (_, index) => index);
  let current = new Array<number>(heard.length + 1).fill(0);

  for (let row = 1; row <= want.length; row++) {
    current[0] = row;
    for (let column = 1; column <= heard.length; column++) {
      const substitute =
        previous[column - 1] + (want[row - 1] === heard[column - 1] ? 0 : 1);
      current[column] = Math.min(
        substitute,
        previous[column] + 1,
        current[column - 1] + 1,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[heard.length];
}

/** Within `budget` edits; the length check short-circuits most words. */
const near = (heard: string, want: string, budget: number) =>
  Math.abs(heard.length - want.length) <= budget &&
  distance(heard, want) <= budget;

/**
 * Whether `want[from..]` is spoken contiguously starting at `heard[at]`.
 * One wanted word may span two heard words ("there's day" for "thursday").
 */
function saidAt(
  heard: readonly string[],
  at: number,
  want: readonly string[],
  from: number,
  tolerance: number,
): boolean {
  if (from === want.length) return true;
  if (at >= heard.length) return false;

  const word = want[from];
  // Never 0, or "hay" for "hey" fails.
  const budget = Math.max(1, Math.round(word.length * tolerance));

  if (
    near(heard[at], word, budget) &&
    saidAt(heard, at + 1, want, from + 1, tolerance)
  ) {
    return true;
  }
  return (
    at + 1 < heard.length &&
    near(heard[at] + heard[at + 1], word, budget) &&
    saidAt(heard, at + 2, want, from + 1, tolerance)
  );
}

/**
 * Whether `heard` contains `want` as one contiguous phrase. Scoring is per
 * word, not over the joined string, so every word must be present and adjacent.
 */
function contains(
  heard: readonly string[],
  want: readonly string[],
  tolerance: number,
): boolean {
  for (let at = 0; at < heard.length; at++) {
    if (saidAt(heard, at, want, 0, tolerance)) return true;
  }
  return false;
}

type WakeOptions = {
  /** Releases the microphone when false; must be false while a call is open. */
  enabled: boolean;
  /** Receives the raw transcript that matched. */
  onWake: (heard: string) => void;
  /** Phrases to listen for, matched fuzzily. */
  phrases: readonly string[];
  lang?: string;
  /** See WAKE_TOLERANCE. */
  tolerance?: number;
  /** Unrecoverable failures only (denied or missing microphone). */
  onError?: (reason: string) => void;
};

export function useWakeWord({
  enabled,
  onWake,
  phrases,
  lang = WAKE_LANG,
  tolerance = WAKE_TOLERANCE,
  onError,
}: WakeOptions) {
  // Read at result time so re-renders and phrase changes do not restart the
  // recognizer; only `lang` must be set before start.
  const latest = useRef({ onWake, onError, phrases, tolerance });
  latest.current = { onWake, onError, phrases, tolerance };

  useEffect(() => {
    if (!enabled) return;

    const global = window as unknown as Record<string, unknown>;
    const Ctor = (global.SpeechRecognition ?? global.webkitSpeechRecognition) as
      | SpeechRecognitionCtor
      | undefined;

    if (!Ctor) {
      latest.current.onError?.("This browser cannot listen for a wake word");
      return;
    }

    const recognition = new Ctor();
    // Latched off on cleanup so late events cannot revive the recognizer.
    let alive = true;
    // Off from a match until the restart that clears the transcript.
    let armed = true;
    let restart: ReturnType<typeof setTimeout> | null = null;
    let delay = RESTART_MS;

    recognition.lang = lang;
    // Interim results are enough; waiting for isFinal loses a beat.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = ALTERNATIVES;

    const listen = () => {
      if (!alive) return;
      armed = true;
      try {
        recognition.start();
      } catch {
        // Already running (InvalidStateError).
      }
    };

    recognition.onresult = ({ resultIndex, results }) => {
      if (!alive || !armed) return;
      delay = RESTART_MS;

      const { phrases, tolerance, onWake } = latest.current;
      const targets = phrases.map(normalize).filter((words) => words.length);

      // Results before resultIndex are final and already seen.
      for (let index = resultIndex; index < results.length; index++) {
        const result = results[index];
        for (let rank = 0; rank < result.length; rank++) {
          const heard = result[rank].transcript;
          const words = normalize(heard);
          if (!targets.some((target) => contains(words, target, tolerance))) {
            continue;
          }

          // Abort before notifying: the transcript keeps growing and would
          // match again on the next event. `onend` restarts unless the caller
          // has dropped `enabled` by then.
          armed = false;
          recognition.abort();
          onWake(heard.trim());
          return;
        }
      }
    };

    recognition.onerror = ({ error }) => {
      const reason = FATAL[error];
      if (reason) {
        alive = false;
        latest.current.onError?.(reason);
      } else if (error === "network") {
        delay = Math.min(delay * 2, RESTART_MAX_MS);
      }
      // no-speech and aborted are normal for this API.
    };

    // Chrome ends a silent session after about a minute; keep restarting.
    recognition.onend = () => {
      if (!alive) return;
      restart = setTimeout(listen, delay);
    };

    listen();

    return () => {
      alive = false;
      if (restart) clearTimeout(restart);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    };
  }, [enabled, lang]);
}
