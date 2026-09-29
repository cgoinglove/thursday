"use client";

import { type RefObject, useEffect, useState } from "react";

// Whether an element is in the window now, for drawing nobody could see: a mark scrolled out of
// a thread or panned out of the office stops drawing until it comes back. It sees the window and
// the scrolling boxes that clip; not opacity. One observer serves every element watched.

const watched = new Map<Element, (on: boolean) => void>();
let observer: IntersectionObserver | null = null;

/** Tells `onChange` as `element` comes into the window and leaves it; the return stops it. */
export function watchOnScreen(
  element: Element,
  onChange: (on: boolean) => void,
): () => void {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries)
      watched.get(entry.target)?.(entry.isIntersecting);
  });
  watched.set(element, onChange);
  observer.observe(element);
  return () => {
    watched.delete(element);
    observer?.unobserve(element);
  };
}

/** `watchOnScreen` as state: true until the observer first says otherwise. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return watchOnScreen(element, setOn);
  }, [ref]);
  return on;
}
