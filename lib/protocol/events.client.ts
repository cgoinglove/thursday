"use client";

import { useEffect, useRef } from "react";
import {
  type DefaultEvent,
  dispatchEvent,
  type EventBus,
  type EventFeed,
  type EventHandlers,
} from "./events";

/**
 * Browser end of the event wire: server-sent events pumped into a bus. Open
 * once per tab. EventSource reconnects on its own and the server resends its
 * opening snapshot on every (re)connect.
 */
export function fromEventSource<E extends DefaultEvent>(
  url: string,
  bus: EventBus<E>,
): () => void {
  const source = new EventSource(url);
  source.onmessage = (raw: MessageEvent) => {
    let event: E;
    try {
      event = JSON.parse(raw.data);
    } catch {
      // One half-written frame is no reason to drop the line
      return;
    }
    bus.emit(event);
  };
  return () => source.close();
}

/** Listen on a bus, one handler per kind. Subscribes once and always calls the latest handlers. */
export function useEventFeed<E extends DefaultEvent>(
  feed: EventFeed<E>,
  handlers: EventHandlers<E>,
) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(
    () => feed.subscribe((event) => dispatchEvent(latest.current, event)),
    [feed],
  );
}
