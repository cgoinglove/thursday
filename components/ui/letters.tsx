"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** From one letter to the next, in ms; how each arrives is `letter` in globals.css. */
const LETTER_MS = 25;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Text letter by letter: each new one comes out of a blur a beat after the one
 * before it, and what is already drawn stays put. The letters stay inline, so
 * the lines break where plain text would.
 */
export function Letters({ text }: { text: string }) {
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

  // The letters are wrapped, not returned loose: dropped straight into a flex row
  // (the call screen's idle line) every letter would become an item of its own and
  // stand apart by that row's gap. Inline, so text still wraps where it would.
  return (
    <span>
      {letters.map((letter, at) => (
        // letter + index: one already drawn keeps its key and never arrives twice
        <Letter
          key={`${letter}${at}`}
          wait={Math.max(0, at - from) * LETTER_MS}
        >
          {letter}
        </Letter>
      ))}
    </span>
  );
}

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
