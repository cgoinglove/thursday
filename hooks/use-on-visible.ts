"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Calls `onVisible` when the attached element scrolls into view (infinite
 * lists). The callback lives in a ref: rebuilding the observer on an element
 * already in view would fire it again.
 */
export function useOnVisible(
  onVisible: () => void,
  options: {
    /** False stops observing (nothing left, or a request in flight). */
    enabled?: boolean;
    /**
     * Bump to rebuild the observer, which re-fires if the element is still in
     * view. Observers report crossings, not states: a list shorter than the
     * viewport would otherwise stop after one page.
     */
    revision?: unknown;
    /** IntersectionObserver rootMargin; fires before the element appears. */
    margin?: string;
  } = {},
) {
  const { enabled = true, margin = "600px", revision } = options;

  const callback = useRef(onVisible);
  callback.current = onVisible;

  const node = useRef<HTMLElement | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);

  const attach = useCallback((next: HTMLElement | null) => {
    node.current = next;
  }, []);

  useEffect(() => {
    observer.current?.disconnect();
    const target = node.current;
    if (!target || !enabled) return;

    observer.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) callback.current();
      },
      { root: scrollParent(target), rootMargin: margin },
    );
    observer.current.observe(target);
    return () => observer.current?.disconnect();
  }, [enabled, margin, revision]);

  return attach;
}

/**
 * Nearest scrolling ancestor, or null for the window. With the default root an
 * ancestor's overflow clips the sentinel and it never intersects.
 */
function scrollParent(node: HTMLElement): Element | null {
  let parent = node.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}
