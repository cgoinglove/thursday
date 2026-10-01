"use client";

import { useEffect, useRef } from "react";

/** How many frames a closed layer's focus is watched for landing on the page (~half a second). */
const WATCH_FRAMES = 30;

/**
 * Puts the keyboard's focus back where it was once a layer that took it closes. A layer that
 * focuses its own field and then goes leaves the focus on the page's body, and the next Tab
 * starts again from the top of the screen (UX test: the write line, the room and a thread,
 * 6/6). What opened it is often drawn again meanwhile, so `home` names a `data-focus-home`
 * to go to when the element itself is gone. Only while the focus is on the page: a layer
 * that hands it on, or a Tab in the meantime, is left alone.
 */
export function useFocusReturn(open: boolean, home?: string) {
  const homeRef = useRef(home);
  homeRef.current = home;
  useEffect(() => {
    if (!open) return;
    const was = document.activeElement;
    const from =
      was instanceof HTMLElement && was !== document.body ? was : null;
    // As it was when the layer opened: a thread's row, not whichever is picked after
    const mark = homeRef.current;
    return () => {
      let frames = 0;
      // The layer's own nodes, and their focus, may go a few frames after it closes
      const watch = () => {
        const now = document.activeElement;
        if (!now || now === document.body) {
          const target = from?.isConnected
            ? from
            : mark
              ? document.querySelector<HTMLElement>(
                  `[data-focus-home="${CSS.escape(mark)}"]`,
                )
              : null;
          if (target) {
            target.focus({ preventScroll: true });
            return;
          }
        }
        if (++frames < WATCH_FRAMES) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    };
  }, [open]);
}
