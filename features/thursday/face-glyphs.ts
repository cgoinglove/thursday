"use client";

import { useSyncExternalStore } from "react";

/**
 * What she is drawn in: Apple's emoji where the system has them — a Mac, an iPhone, an iPad — and
 * her letters everywhere else. Other systems draw emoji in their own hand, the newest ones as empty
 * boxes where the system font is older, and colour emoji cost more to draw than letters on the
 * machines least able to spare it. The system decides, not a setting: she looks the same on every
 * Apple device, and the same on every other one.
 */
export type FaceGlyphs = "emoji" | "letters";

let here: FaceGlyphs | undefined;

/** What this browser draws her in. Browser only: it reads the platform, once. */
export function faceGlyphs(): FaceGlyphs {
  if (here) return here;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  // Chromium names the system in userAgentData ("macOS"); Safari has only `platform`, which an
  // iPad asking for desktop pages gives as "MacIntel"
  const platform = nav.userAgentData?.platform || nav.platform || "";
  here = /mac|iphone|ipad|ipod/i.test(platform) ? "emoji" : "letters";
  return here;
}

const noChange = () => () => {};

/**
 * For a picture the server draws first (ThursdayMark): emoji on the server, which cannot know the
 * system, and this browser's own from hydration on.
 */
export function useFaceGlyphs(): FaceGlyphs {
  return useSyncExternalStore(noChange, faceGlyphs, () => "emoji");
}
