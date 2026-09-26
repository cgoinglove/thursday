"use client";

import { useSyncExternalStore } from "react";

/**
 * The screen the user shares with a spoken call, held in the page until they stop or the call
 * ends. Nothing is sent while it is shared: a picture of it is taken only when the backend asks
 * for one (`look_at_screen`, use-thursday), and goes to the backend alone. The browser asks
 * which screen, window or tab, and only from a press: `share` is called from a click.
 */

type Shared = { stream: MediaStream; video: HTMLVideoElement };

let shared: Shared | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

/** The shared screen's stream, for the preview; null while nothing is shared. */
export function useSharedScreen(): MediaStream | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shared?.stream ?? null,
    () => null,
  );
}

export const isSharing = () => shared !== null;

/** Hears sharing start or stop; the call tells her (use-thursday). */
export function onShareChange(listener: (sharing: boolean) => void) {
  const heard = () => listener(shared !== null);
  listeners.add(heard);
  return () => {
    listeners.delete(heard);
  };
}

/** Whether this browser can share a screen at all. */
export const canShare = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getDisplayMedia === "function";

/**
 * Asks the browser to share a screen, window or tab. A refusal is not an error: the person
 * chose not to. Stopping from the browser's own bar ends it here too.
 */
export async function share(): Promise<void> {
  if (shared) return;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // A still is all that is ever taken; a low rate keeps the capture light
      video: { frameRate: 5 },
      audio: false,
    });
  } catch {
    return;
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  for (const track of stream.getVideoTracks())
    track.addEventListener("ended", stopSharing);
  shared = { stream, video };
  changed();
}

export function stopSharing(): void {
  if (!shared) return;
  for (const track of shared.stream.getTracks()) track.stop();
  shared.video.srcObject = null;
  shared = null;
  changed();
}

/** The longest side a picture is taken at, before it is made smaller to fit. */
const LONGEST = 1600;

/**
 * The screen as it is now, as a JPEG data URL of at most `bytes`: a data channel carries one
 * message up to its limit and no more, so the picture is made smaller, then plainer, until it
 * fits. What went wrong otherwise, said as the backend will read it.
 */
export function takePicture(
  bytes: number,
): { url: string } | { failed: string } {
  const video = shared?.video;
  if (!video) return { failed: "Nothing is being shared." };
  if (!video.videoWidth || !video.videoHeight)
    return { failed: "The shared screen has not shown anything yet." };
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return { failed: "This browser could not take the picture." };
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    const ratio = Math.min(
      1,
      (LONGEST * scale) / Math.max(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.45]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= bytes) return { url };
    }
  }
  return {
    failed: `The picture of the shared screen would not fit the ${Math.round(bytes / 1024)} KB this connection carries.`,
  };
}
