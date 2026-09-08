/**
 * Server-to-browser event bus, shared by both sides. The same bus runs on each
 * end with a connector between them (events.server, events.client); emitters
 * and handlers see only the bus. One way only.
 */

export type DefaultEvent = { type: string };

export type EventBus<E extends DefaultEvent> = {
  emit(event: E): void;
  subscribe(listener: (event: E) => void): () => void;
};

/** The listening half of a bus. */
export type EventFeed<E extends DefaultEvent> = Pick<EventBus<E>, "subscribe">;

export function createEventBus<E extends DefaultEvent>(): EventBus<E> {
  const listeners = new Set<(event: E) => void>();
  return {
    emit(event) {
      // Copy, so a listener unsubscribing mid-loop does not break the walk
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (cause) {
          console.error("event listener failed", cause);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One handler per kind, keyed by `type`. */
export type EventHandlers<E extends DefaultEvent> = {
  [K in E["type"]]?: (event: Extract<E, { type: K }>) => void;
};

/** Route one event to the handler for its kind, if there is one. */
export function dispatchEvent<E extends DefaultEvent>(
  handlers: EventHandlers<E>,
  event: E,
) {
  const handle = handlers[event.type as E["type"]] as
    | ((event: E) => void)
    | undefined;
  handle?.(event);
}
