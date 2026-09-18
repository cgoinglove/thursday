import type { FaceWord } from "./thursday.schema";

/**
 * The words the app puts on her face by itself, apart from what she shows with `emote`:
 * a greeting as the app opens, a goodbye as a call ends, OK as finished work comes in.
 * Only the ascii orb draws a word (face.tsx), so on the drawn mark these pass unseen.
 * Every word fits FACE_WORD_MAX. The hold is the drawing's own time, like the ring's.
 */

/** Hours of the day a pool opens at, latest first. */
const GREETINGS: [from: number, words: string[]][] = [
  [22, ["HELLO", "HI", "HEY"]],
  [17, ["EVENING", "HELLO", "HI"]],
  [11, ["HELLO", "HI", "HEY"]],
  [5, ["MORNING", "HELLO", "HI"]],
  [0, ["HELLO", "HI", "HEY"]],
];

const pick = (words: string[]) =>
  words[Math.floor(Math.random() * words.length)];

const word = (text: string, hold: number): FaceWord => ({
  text,
  at: Date.now(),
  hold,
});

/** As the app opens: one of a few, by the hour. */
export function greeting(now = new Date()): FaceWord {
  const hour = now.getHours();
  const pool = GREETINGS.find(([from]) => hour >= from)?.[1] ?? ["HI"];
  return word(pick(pool), 1.6);
}

/** As a call ends; late at night it may say so. */
export function goodbye(now = new Date()): FaceWord {
  const hour = now.getHours();
  const late = hour >= 22 || hour < 5;
  return word(late ? pick(["NIGHT", "BYE"]) : "BYE", 1.2);
}

/** As a finished thread's answer comes into the call, just before she says it. */
export const finished = (): FaceWord => word("OK", 1);
