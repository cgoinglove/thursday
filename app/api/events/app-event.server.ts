import { BROWSER_GONE_MS, SIGNAL_PACE_MS } from "@/config";
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
};
const pinned = globalThis as Pinned;

export const appEvents: EventBus<AppEvent> = (pinned.__appEvents ??=
  createEventBus<AppEvent>());

/**
 * Whether a browser is on the stream. When the last one has been gone for
 * BROWSER_GONE_MS the calls its tabs held close; work runs on. What reads it is
 * wired at boot (instrumentation), not here.
 */
export const presence: Presence = (pinned.__presence ??=
  createPresence(BROWSER_GONE_MS));

/**
 * A signal goes out at once and then at most every SIGNAL_PACE_MS; data
 * events pass through. A bot at work raises one per row it writes, several in
 * the same millisecond at the end of a step — the pacing is what keeps that
 * from being one read of the inbox each, and the leading edge is what keeps a
 * single change from waiting on it.
 */
export const appEventStream: EventStream<AppEvent> =
  (pinned.__appEventStream ??= createEventStream(appEvents, {
    coalesce: {
      ms: SIGNAL_PACE_MS,
      keyOf: (event) => (isSignal(event) ? event.type : null),
    },
    onWatchers: presence.track,
  }));
