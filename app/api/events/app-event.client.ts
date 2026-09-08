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
 * Opens the one connection per tab, from the root layout. EventSource
 * reconnects on its own and replays the on-connect events.
 */
export function AppEventSource() {
  useEffect(() => fromEventSource(queryKey.events, bus), []);
  return null;
}
