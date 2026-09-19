"use client";

import { useSyncExternalStore } from "react";
import {
  FACE_DEFAULT,
  type ThursdayFace,
  ThursdayFaceSchema,
} from "./thursday.schema";

// Face settings live in localStorage: the server never reads them. Parsed on
// read, and every field has a default so older stored objects still parse.

const KEY = "thursday.icon";

function read(): ThursdayFace {
  if (typeof window === "undefined") return FACE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    return ThursdayFaceSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return FACE_DEFAULT;
  }
}

// The snapshot must be referentially stable or useSyncExternalStore loops.
let face = read();
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

export function setThursdayFace(next: ThursdayFace) {
  face = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked or full; the in-memory face still changes.
  }
  announce();
}

export function useThursdayFace(): ThursdayFace {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      // Another tab changed the face.
      const sync = (event: StorageEvent) => {
        if (event.key !== KEY) return;
        face = read();
        announce();
      };
      window.addEventListener("storage", sync);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", sync);
      };
    },
    () => face,
    () => FACE_DEFAULT,
  );
}
