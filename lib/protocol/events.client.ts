"use client";

import { useEffect, useRef } from "react";
import {
  type DefaultEvent,
  dispatchEvent,
  type EventBus,
  type EventFeed,
  type EventHandlers,
} from "./events";

/** How long a line that failed outright waits before it is opened again, ms. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 8_000;

/**
 * Browser end of the event wire: server-sent events pumped into a bus. Open
 * once per tab.
 *
 * EventSource reconnects on its own, but only while it takes the endpoint for
 * an event stream: a reconnect answered with anything else — a dev server's
 * error page mid-rebuild, a proxy's 502, a restart caught half-way — fails the
 * connection for good. Nothing reopens it then, so the tab hears nothing until
 * it is reloaded while the server reads the missing stream as nobody watching
 * and parks what was running. So the line is supervised: a source that has
 * closed is opened again, backing off to RETRY_MAX_MS, and the server's opening
 * snapshot brings the tab back up to date.
 */
export function fromEventSource<E extends DefaultEvent>(
  url: string,
  bus: EventBus<E>,
): () => void {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let wait = RETRY_MIN_MS;
  let stopped = false;

  const open = () => {
    const opened = new EventSource(url);
    source = opened;
    opened.onopen = () => {
      wait = RETRY_MIN_MS;
    };
    opened.onmessage = (raw: MessageEvent) => {
      let event: E;
      try {
        event = JSON.parse(raw.data);
      } catch {
        // One half-written frame is no reason to drop the line
        return;
      }
      bus.emit(event);
    };
    opened.onerror = () => {
      // Still connecting: EventSource is retrying by itself, which is the
      // healthy path and the one this must not race.
      if (stopped || opened.readyState !== EventSource.CLOSED) return;
      opened.close();
      if (retry) clearTimeout(retry);
      retry = setTimeout(open, wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    source?.close();
  };
}

/** Listen on a bus, one handler per kind. Subscribes once and always calls the latest handlers. */
export function useEventFeed<E extends DefaultEvent>(
  feed: EventFeed<E>,
  handlers: EventHandlers<E>,
) {
  // Written after commit, not during render: concurrent rendering may discard a
  // render, and a ref written in one would keep the discarded handlers.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(
    () => feed.subscribe((event) => dispatchEvent(latest.current, event)),
    [feed],
  );
}
