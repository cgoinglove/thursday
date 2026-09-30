"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/lib/locale";

/**
 * App language, stored in localStorage like the theme (use-theme). Client
 * only: the boot script in app/layout sets `<html lang>` before hydration;
 * this store follows changes after that.
 */

function read(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

let locale = read();
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

function applyLocale(value: Locale) {
  document.documentElement.setAttribute("lang", value);
}

export function setLocale(next: Locale) {
  locale = next;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage; the in-memory value still changes.
  }
  applyLocale(next);
  announce();
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      // Another tab changed it.
      const sync = (event: StorageEvent) => {
        if (event.key !== LOCALE_STORAGE_KEY) return;
        locale = read();
        applyLocale(locale);
        announce();
      };
      window.addEventListener("storage", sync);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", sync);
      };
    },
    () => locale,
    // Server snapshot; hydration swaps in the stored value.
    () => DEFAULT_LOCALE,
  );
}
