import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The crew's body language: what a face does when something happens to the bot behind it.
 *
 * At rest every face breathes and nothing else moves. A gesture then plays ONCE, on the ONE face
 * the event belongs to, over the breath — so the pill says what happened where it happened,
 * instead of leaving it to the bubble that only has room for one thing at a time.
 *
 * A jump reads as weight only when the body and the shape run on different curves, so a face is a
 * stack of layers (room-pill `Crew`) and a gesture names which of them it takes: `body` moves it
 * through the air, `shape` presses and flattens it, `turn` rotates it. A layer a gesture does not
 * name keeps doing what it was: the shape layer goes back to breathing.
 *
 * The keyframes are in `app/globals.css`; every duration here is the length that file cuts them to.
 */

/** What a face can be doing. `wave` is the whole row arriving; every other one happens to one bot. */
export type Gesture =
  | "wave"
  | "done"
  | "ask"
  | "took"
  | "give"
  | "take"
  | "stop"
  | "read";

/** One bot, and what its face should do. */
export type BotGesture = { bot: string; gesture: Gesture };

/** How long each runs, ms. */
const GESTURE_MS: Record<Gesture, number> = {
  wave: 740,
  done: 740,
  ask: 820,
  took: 740,
  give: 900,
  take: 520,
  stop: 1150,
  read: 560,
};

/** The wave walks along the row: a face's own start is its place times this. */
const WAVE_STEP_MS = 70;

/** Which layer takes which animation. */
const LAYERS: Record<
  Gesture,
  { body?: string; shape?: string; turn?: string }
> = {
  wave: { body: "animate-crew-hop", shape: "animate-crew-hop-shape" },
  took: { body: "animate-crew-hop", shape: "animate-crew-hop-shape" },
  done: {
    body: "animate-crew-hop",
    shape: "animate-crew-hop-shape",
    turn: "animate-crew-spin",
  },
  // The same jump every other gesture is built from, with the head going over in the air instead
  // of a somersault: a question is the one thing here that has to catch the eye across a room, and
  // the hop it had rose five pixels (the user's pick).
  ask: {
    body: "animate-crew-hop",
    shape: "animate-crew-hop-shape",
    turn: "animate-crew-ask-turn",
  },
  give: { turn: "animate-crew-give" },
  take: { body: "animate-crew-take", shape: "animate-crew-take-shape" },
  stop: { body: "animate-crew-sink", shape: "animate-crew-sink-shape" },
  read: { body: "animate-crew-nod", shape: "animate-crew-nod-shape" },
};

/** A gesture on a face, and the token that makes React start it over rather than let it run on. */
export type Playing = { gesture: Gesture; id: number };

/** What each face is in the middle of, by bot name. */
export type CrewPlaying = Map<string, Playing>;

/** What each face's layers wear this render. */
export type CrewMotion = {
  /** Changes with every gesture, so the layers remount and the animation restarts. */
  key: number;
  body: string;
  shape: string;
  turn: string;
  /** Only the wave staggers; everything else starts at once on the face it belongs to. */
  delayMs: number;
};

/** The resting state, which a gesture borrows a layer from and gives back. */
const RESTING: CrewMotion = {
  key: 0,
  body: "",
  shape: "animate-crew-breath",
  turn: "",
  delayMs: 0,
};

/**
 * What one face is doing. `at` is its place in the row, which only the wave reads; a face's breath
 * takes its phase from the same number, so a row at rest ripples instead of pulsing as one object.
 */
export function motionOf(playing: Playing | undefined, at: number): CrewMotion {
  if (!playing) return { ...RESTING, delayMs: at * -370 };
  const layers = LAYERS[playing.gesture];
  return {
    key: playing.id,
    body: layers.body ?? "",
    shape: layers.shape ?? "animate-crew-breath",
    turn: layers.turn ?? "",
    delayMs: playing.gesture === "wave" ? at * WAVE_STEP_MS : 0,
  };
}

/**
 * The gestures playing right now, and how to start more.
 *
 * One at a time per bot: a second event on the same face replaces the first rather than queueing,
 * because two gestures are two layers fighting over the same transform, and the newer thing is the
 * true one. A gesture clears itself when it is over, which is what puts the face back to resting.
 */
export function useCrewGestures(): [
  CrewPlaying,
  (played: BotGesture[]) => void,
] {
  const [playing, setPlaying] = useState<CrewPlaying>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const token = useRef(0);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const timer of held.values()) clearTimeout(timer);
      held.clear();
    };
  }, []);

  const play = useCallback((played: BotGesture[]) => {
    if (!played.length) return;
    setPlaying((was) => {
      const now = new Map(was);
      for (const { bot, gesture } of played) {
        token.current += 1;
        now.set(bot, { gesture, id: token.current });
        const running = timers.current.get(bot);
        if (running) clearTimeout(running);
        timers.current.set(
          bot,
          setTimeout(
            () => {
              timers.current.delete(bot);
              setPlaying((held) => {
                const next = new Map(held);
                next.delete(bot);
                return next;
              });
              // The wave's last face starts a row-length after the first one does.
            },
            GESTURE_MS[gesture] + (gesture === "wave" ? WAVE_STEP_MS * 20 : 0),
          ),
        );
      }
      return now;
    });
  }, []);

  return [playing, play];
}
