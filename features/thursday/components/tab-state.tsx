"use client";

import { useEffect } from "react";
import { APP_NAME } from "@/config";
import { markAtRest } from "@/features/bot/components/bot-mark";
import { useTaskReport } from "@/features/bot/components/task-badge";
import {
  type SectionAlert,
  useSectionAlerts,
  worstAlert,
} from "@/features/settings/settings.alert";
import { THURSDAY_SEED } from "./thursday-mark";

// A live call's title is a waveform. The frame is not React state: the interval
// writes document.title directly. Hidden tabs throttle timers to 1s, but audible
// pages escape the stronger throttle.
const SPIN = ["▁▄▇▄", "▂▆▆▂", "▄▇▄▁", "▆▆▂▂", "▇▄▁▄", "▆▂▂▆", "▄▁▄▇", "▂▂▆▆"];

/** Frame interval in ms. */
const SPIN_MS = 100;

/**
 * The dot, in the icon's view-box units: bottom right, where a face wears it,
 * with a ring cut out of the mark so the two stay apart at 16px.
 */
const DOT = { cx: 200, cy: 200, r: 46, ring: 20 };

/**
 * The icon sits on the browser's own light or dark bar, not on the app's theme,
 * so its colours follow the SVG's media query. The hex values of the corner
 * dot's tokens: amber-600 / amber-400 and destructive.
 */
const ICON_STYLE =
  ".ink{fill:#0a0a0a}.amber{fill:#e17100}.red{fill:#e7000b}" +
  "@media (prefers-color-scheme:dark){.ink{fill:#fafafa}.amber{fill:#ffb900}.red{fill:#ff6467}}";

/** Thursday's mark at rest, wearing the dot for `alert` when there is one. */
export function tabIconSvg(alert: SectionAlert): string {
  const { head, eyes } = markAtRest(THURSDAY_SEED);
  const cut = alert
    ? `<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r + DOT.ring}"/>`
    : "";
  const dot = alert
    ? `<circle class="${alert}" cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 252 252"><style>${ICON_STYLE}</style><mask id="m" maskUnits="userSpaceOnUse"><path d="${head}" fill="#fff"/><path d="${eyes[0]}"/><path d="${eyes[1]}"/>${cut}</mask><path class="ink" d="${head}" mask="url(#m)"/>${dot}</svg>`;
}

/**
 * The tab, for when the app is not the window in front. The title leads with
 * what is owed — the Tasks badge's count — and a live call keeps its waveform at
 * the end, so neither takes the other's place. The icon wears the settings
 * corner's dot: amber waits on the user, red is broken, and a section with
 * nothing to count still gets the dot.
 *
 * Draws nothing. A component rather than a hook in the call screen, so a report
 * changing re-renders only this.
 */
export function TabState({ live }: { live: boolean }) {
  const { owed } = useTaskReport();
  const alerts = useSectionAlerts();
  const alert = worstAlert(Object.values(alerts).map((each) => each ?? null));

  useEffect(() => {
    const head = owed > 0 ? `(${owed}) ${APP_NAME}` : APP_NAME;
    if (!live) {
      document.title = head;
      return;
    }
    let at = 0;
    document.title = `${head} ${SPIN[at]}`;
    const tick = setInterval(() => {
      at = (at + 1) % SPIN.length;
      document.title = `${head} ${SPIN[at]}`;
    }, SPIN_MS);
    return () => clearInterval(tick);
  }, [live, owed]);

  useEffect(() => {
    // A link of its own after the layout's, changed in place: browsers redraw
    // the tab when an icon link's href changes, and React does not manage it.
    let link = document.head.querySelector<HTMLLinkElement>(
      "link[data-tab-icon]",
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.setAttribute("sizes", "any");
      link.dataset.tabIcon = "";
      document.head.append(link);
    }
    link.href = `data:image/svg+xml,${encodeURIComponent(tabIconSvg(alert))}`;
  }, [alert]);

  return null;
}
