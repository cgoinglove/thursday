import { BROWSER_GONE_MS } from "@/config";
import { createEventBus, type EventBus } from "@/lib/protocol/events";
import {
  createEventStream,
  type EventStream,
} from "@/lib/protocol/events.server";
import { createPresence, type Presence } from "@/lib/protocol/presence";
import { type AppEvent, isSignal } from "./app-event";

/**
 * Server-side bus and the stream that carries it to the browser. Pinned on
 * globalThis because next dev reloads this module while open streams still
 * subscribe to the first bus.
 */
type Pinned = {
  __appEvents?: EventBus<AppEvent>;
  __appEventStream?: EventStream<AppEvent>;
  __presence?: Presence;
  __bootId?: string;
};
const pinned = globalThis as Pinned;

export const appEvents: EventBus<AppEvent> = (pinned.__appEvents ??=
  createEventBus<AppEvent>());

/**
 * Whether a browser is on the stream. The app stops what it is doing when the
 * last one has been gone for BROWSER_GONE_MS; who stops what is wired at boot
 * (instrumentation), not here.
 */
export const presence: Presence = (pinned.__presence ??=
  createPresence(BROWSER_GONE_MS));

/** Signals coalesce over 150ms; data events pass through. */
export const appEventStream: EventStream<AppEvent> =
  (pinned.__appEventStream ??= createEventStream(appEvents, {
    coalesce: {
      ms: 150,
      keyOf: (event) => (isSignal(event) ? event.type : null),
    },
    onWatchers: presence.track,
  }));

/** Identifies this server process; changes on restart. */
export const BOOT_ID: string = (pinned.__bootId ??= crypto.randomUUID());
