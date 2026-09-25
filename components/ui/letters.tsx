"use client";

import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** From one letter to the next, in ms; how each arrives is `letter` in globals.css. */
const LETTER_MS = 25;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Text letter by letter: each new one comes out of a blur a beat after the one
 * before it, and what is already drawn stays put. The letters stay inline, so
 * the lines break where plain text would.
 */
export function Letters({
  text,
  wraps = [],
}: {
  text: string;
  /**
   * Runs of letters drawn inside something of their own (a link), by grapheme index,
   * `to` exclusive. Their letters keep their place in the one run, so a link arrives in
   * turn with the words around it rather than all at once.
   */
  wraps?: LetterWrap[];
}) {
  const letters = useMemo(
    () => Array.from(graphemes.segment(text), (part) => part.segment),
    [text],
  );
  // What the last commit drew. The wait counts from where the text stopped
  // matching it, so new words start their own run and a revised tail comes again
  const drawn = useRef<string[]>([]);
  let from = 0;
  while (from < letters.length && letters[from] === drawn.current[from]) from++;
  useEffect(() => {
    drawn.current = letters;
  }, [letters]);

  // letter + index: one already drawn keeps its key and never arrives twice
  const letter = (at: number) => (
    <Letter
      key={`${letters[at]}${at}`}
      wait={Math.max(0, at - from) * LETTER_MS}
    >
      {letters[at]}
    </Letter>
  );
  const drawnLetters: ReactNode[] = [];
  for (let at = 0; at < letters.length; ) {
    const wrap = wraps.find((one) => one.from === at && one.to > at);
    if (!wrap) {
      drawnLetters.push(letter(at));
      at += 1;
      continue;
    }
    const end = Math.min(wrap.to, letters.length);
    const inside: ReactNode[] = [];
    for (let each = at; each < end; each++) inside.push(letter(each));
    drawnLetters.push(
      <Fragment key={`wrap${at}`}>{wrap.render(inside)}</Fragment>,
    );
    at = end;
  }

  // The letters are wrapped, not returned loose: dropped straight into a flex row
  // (the call screen's idle line) every letter would become an item of its own and
  // stand apart by that row's gap. Inline, so text still wraps where it would.
  return <span>{drawnLetters}</span>;
}

/** A run of `Letters` drawn inside `render`'s element; indices are graphemes, `to` exclusive. */
export type LetterWrap = {
  from: number;
  to: number;
  render: (letters: ReactNode) => ReactNode;
};

function Letter({ wait, children }: { wait: number; children: string }) {
  // The wait it mounts with is the one it keeps: the next fragment moves everyone's
  const [delay] = useState(wait);
  return (
    <span
      style={{ animationDelay: `${delay}ms` }}
      className="animate-letter motion-reduce:animate-none"
    >
      {children}
    </span>
  );
}
