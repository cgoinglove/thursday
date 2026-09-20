"use client";

import { useEffect } from "react";
import { queryKey } from "@/app/api/query-key";
import { createEventBus, type EventHandlers } from "@/lib/protocol/events";
import { fromEventSource, useEventFeed } from "@/lib/protocol/events.client";
import type { AppEvent } from "./app-event";

/** Browser-side bus. Only server events flow here; `emit` is not exported. */
const bus = createEventBus<AppEvent>();

/** Subscribes to server events; pass handlers for the types you care about. */
export function useAppEvent(handlers: EventHandlers<AppEvent>) {
  useEventFeed(bus, handlers);
}

/**
 * Opens the one connection per tab, from the app's own screen (app/page) and
 * nowhere else — not from the root layout, which would open one on the file
 * viewer's tabs too, where nothing listens. A stream is a connection held open
 * and a browser allows an origin only six of them, so a few files left open for
 * reading would take every one and the app's own reads would simply queue. The
 * count is also what says a browser is there at all (presence): a viewer tab
 * would keep jobs running with the app closed, and take the desktop
 * notification that a job finishing is owed.
 */
export function AppEventSource() {
  useEffect(() => fromEventSource(queryKey.events, bus), []);
  return null;
}
