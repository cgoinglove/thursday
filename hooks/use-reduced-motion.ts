"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the computer asks for less motion, kept current; a server render counts as not. */
export function useReducedMotion() {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(QUERY);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
