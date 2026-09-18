"use client";

import { useSyncExternalStore } from "react";

/**
 * What the first-run intro says to the call under it. While the intro is up the call
 * keeps its wake word and hotkey off — "hey thursday" is tried out on the intro, and
 * a call must not start behind it — and the intro's last button places the first call
 * from inside its own click, which is what lets the browser play her voice.
 */
let held = false;
const holds = new Set<() => void>();
const places = new Set<() => void>();

export const callSignal = {
  hold(on: boolean) {
    if (on === held) return;
    held = on;
    for (const listener of holds) listener();
  },
  place() {
    for (const listener of places) listener();
  },
  onPlace(listener: () => void) {
    places.add(listener);
    return () => {
      places.delete(listener);
    };
  },
};

export function useCallHeld(): boolean {
  return useSyncExternalStore(
    (listener) => {
      holds.add(listener);
      return () => holds.delete(listener);
    },
    () => held,
    () => false,
  );
}
