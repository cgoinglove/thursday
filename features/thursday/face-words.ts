import type { FaceWord } from "./thursday.schema";

/**
 * The words the app puts on her face by itself, apart from what she shows with `emote`:
 * HI as she wakes on the intro, a goodbye as a call ends, OK as finished work comes in. As the
 * app opens she says nothing: she opens her eyes (ascii-orb).
 * Only the ascii orb draws a word (face.tsx), so on the drawn mark these pass unseen.
 * Every word fits FACE_WORD_MAX. The hold is the drawing's own time, like the ring's.
 */

/**
 * A goodbye, from a pool by the hour: pools open at an hour, latest first. None is a single word of
 * eight letters, which is drawn at half the size of seven; two words go on two lines, larger.
 */
const NIGHT = ["NIGHT", "G'NIGHT", "NITE", "SLEEP ♥", "ZZZ", "BYE"];
const GOODBYES: [from: number, words: string[]][] = [
  [22, NIGHT],
  [17, ["BYE", "SEE YA", "LATER", "SO LONG", "BYE ♥", "CIAO"]],
  [11, ["BYE", "SEE YA", "LATER", "CIAO", "BYE BYE", "PEACE"]],
  [5, ["ENJOY!", "SEE YA", "BYE", "LATER", "CIAO"]],
  [0, NIGHT],
];

const pick = (words: string[]) =>
  words[Math.floor(Math.random() * words.length)];

const word = (text: string, hold: number): FaceWord => ({
  text,
  at: Date.now(),
  hold,
});

/** As a voice key is saved on the first-run intro and she wakes. */
export const awake = (): FaceWord => word("HI", 1.6);

/** As a call ends: one of a few, by the hour. Held long enough for seven letters to be read. */
export function goodbye(now = new Date()): FaceWord {
  const hour = now.getHours();
  const pool = GOODBYES.find(([from]) => hour >= from)?.[1] ?? ["BYE"];
  return word(pick(pool), 1.6);
}

/** As a finished thread's answer comes into the call, just before she says it. */
export const finished = (): FaceWord => word("OK", 1);
