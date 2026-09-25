"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, THEMES, type Theme } from "@/lib/theme";

/**
 * Theme preference stored in localStorage and applied as the `dark` class on
 * `<html>`. The boot script in app/layout reads the same key before hydration;
 * this store only follows changes after that.
 */

const isTheme = (value: unknown): value is Theme =>
  (THEMES as readonly unknown[]).includes(value);

function read(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

let theme = read();
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

/** Actual brightness the setting resolves to. */
function resolveTheme(value: Theme): "light" | "dark" {
  if (value !== "system") return value;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Applies to `<html>`; touches exactly what the boot script touches. */
function applyTheme(value: Theme) {
  const dark = resolveTheme(value) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(next: Theme) {
  theme = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage; the in-memory value still changes.
  }
  applyTheme(next);
  announce();
}

// The boot script sets `dark` on <html> before hydration (app/layout), and applyTheme keeps it
// since, so the class is right on a client mount, where a media-query effect would first say light
const subscribeToDark = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
};
const drawsDark = () => document.documentElement.classList.contains("dark");

/** Whether the page is drawing dark right now, `system` resolved: the `dark` class on `<html>`. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeToDark, drawsDark, () => false);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      // Another tab changed it.
      const sync = (event: StorageEvent) => {
        if (event.key !== THEME_STORAGE_KEY) return;
        theme = read();
        applyTheme(theme);
        announce();
      };
      window.addEventListener("storage", sync);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", sync);
      };
    },
    () => theme,
    // Server snapshot; hydration swaps in the stored value.
    () => "system",
  );
}

/** Re-applies "system" when the OS theme changes. Mount once, in the layout. */
export function useFollowSystemTheme() {
  const current = useTheme();
  useEffect(() => {
    if (current !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [current]);
}
