import { logger } from "../logger";
import type { DefaultEvent, EventBus } from "./events";

/**
 * Server end of the event wire: a bus carried over server-sent events, plus
 * what belongs to the connection (opening snapshot, coalescing, heartbeat,
 * watcher count). One `data:` line per event; the JSON carries its own `type`.
 */

export type EventStreamOptions<E extends DefaultEvent> = {
  /** Events sharing a key within `ms` send only the last. A null key sends immediately. */
  coalesce?: { ms: number; keyOf: (event: E) => string | null };
  /** How often a comment line holds the line open when nothing happens. */
  heartbeatMs?: number;
  /** Called with the new count whenever a browser connects or leaves. */
  onWatchers?: (count: number) => void;
};

export type EventStream<E extends DefaultEvent> = {
  /**
   * One response per browser. `opening` goes out first; bus events that fire
   * while it is being read wait, so a stale snapshot never lands on a newer event.
   * Both `signal` abort and stream `cancel` end it: behind a dev server only the second arrives.
   */
  respond(signal: AbortSignal, opening?: () => E[] | Promise<E[]>): Response;
  /** Open tabs. A tab that vanished silently is counted until its heartbeat fails. */
  readonly watchers: number;
};

export function createEventStream<E extends DefaultEvent>(
  bus: EventBus<E>,
  options: EventStreamOptions<E> = {},
): EventStream<E> {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  let watchers = 0;

  const respond: EventStream<E>["respond"] = (signal, opening) => {
    let stop = () => {};

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const pending = new Map<string, ReturnType<typeof setTimeout>>();
        /** Bus events that arrived before the opening snapshot went out. */
        let held: E[] | null = [];

        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // The reader left
            stop();
          }
        };
        const send = (event: E) => write(`data: ${JSON.stringify(event)}\n\n`);

        const queue = (event: E) => {
          const key = options.coalesce?.keyOf(event) ?? null;
          if (key === null) return send(event);
          const timer = pending.get(key);
          if (timer) clearTimeout(timer);
          pending.set(
            key,
            setTimeout(() => {
              pending.delete(key);
              send(event);
            }, options.coalesce?.ms),
          );
        };

        const unsubscribe = bus.subscribe((event) =>
          held ? held.push(event) : queue(event),
        );
        const heartbeat = setInterval(() => write(": ping\n\n"), heartbeatMs);
        watchers += 1;
        options.onWatchers?.(watchers);

        stop = () => {
          if (closed) return;
          closed = true;
          watchers -= 1;
          options.onWatchers?.(watchers);
          unsubscribe();
          clearInterval(heartbeat);
          for (const timer of pending.values()) clearTimeout(timer);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        };
        signal.addEventListener("abort", stop);

        try {
          for (const event of (await opening?.()) ?? []) send(event);
        } catch (cause) {
          // A failed snapshot is a connection that never opened; the browser reconnects
          logger.error("event stream opening failed", cause);
          stop();
          return;
        }
        const missed = held;
        held = null;
        for (const event of missed) queue(event);
      },
      cancel() {
        stop();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        // Nothing between here and the browser may hold the line
        "X-Accel-Buffering": "no",
      },
    });
  };

  return {
    respond,
    get watchers() {
      return watchers;
    },
  };
}
