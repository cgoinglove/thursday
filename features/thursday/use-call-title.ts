"use client";

import { useEffect } from "react";
import { APP_NAME } from "@/config";

// Animates the tab title as a waveform while a call is live. The frame is not
// React state: the interval writes document.title directly. Hidden tabs throttle
// timers to 1s, but audible pages escape the stronger throttle.
const SPIN = ["▁▄▇▄", "▂▆▆▂", "▄▇▄▁", "▆▆▂▂", "▇▄▁▄", "▆▂▂▆", "▄▁▄▇", "▂▂▆▆"];

/** Frame interval in ms. */
const SPIN_MS = 100;

export function useCallTitle(live: boolean) {
  useEffect(() => {
    if (!live) return;

    const was = document.title;
    let at = 0;
    document.title = `${APP_NAME} ${SPIN[at]}`;
    const tick = setInterval(() => {
      at = (at + 1) % SPIN.length;
      document.title = `${APP_NAME} ${SPIN[at]}`;
    }, SPIN_MS);

    return () => {
      clearInterval(tick);
      document.title = was;
    };
  }, [live]);
}
