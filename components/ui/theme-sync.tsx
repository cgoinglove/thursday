"use client";

import { useFollowSystemTheme } from "@/hooks/use-theme";

/** Renders nothing; mounts the system-theme subscription for the server layout. */
export function ThemeSync() {
  useFollowSystemTheme();
  return null;
}
