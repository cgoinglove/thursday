import { PromiseChain } from "./utils";

export function createKeyedLock() {
  const lanes = new Map<string, ReturnType<typeof PromiseChain>>();

  const depth = new Map<string, number>();

  return function run<T>(key: string, work: () => Promise<T>): Promise<T> {
    let lane = lanes.get(key);
    if (!lane) {
      lane = PromiseChain();
      lanes.set(key, lane);
    }
    depth.set(key, (depth.get(key) ?? 0) + 1);

    const done = () => {
      const left = (depth.get(key) ?? 1) - 1;
      if (left > 0) {
        depth.set(key, left);
        return;
      }
      depth.delete(key);
      lanes.delete(key);
    };

    return lane(work).then(
      (value) => {
        done();
        return value;
      },
      (cause) => {
        done();
        throw cause;
      },
    );
  };
}

export type Outbox<T> = {
  /** Delivers if a listener is open, otherwise holds. */
  send(item: T): void;
  /** Attaches a listener; held items go out first, in order. */
  open(deliver: (item: T) => void): void;
  /** Detaches the listener; later sends are held. */
  close(): void;
  /** Takes and empties the held items. */
  clear(): T[];
};

/**
 * Holds items until a listener opens, so nothing sent between "connecting" and
 * a live session is lost. No size limit or expiry: callers open within seconds
 * or drop the box.
 */
export function createOutbox<T>(): Outbox<T> {
  let held: T[] = [];
  let deliver: ((item: T) => void) | null = null;

  return {
    send(item) {
      if (deliver) deliver(item);
      else held.push(item);
    },
    open(next) {
      deliver = next;
      const pending = held;
      held = [];
      for (const item of pending) next(item);
    },
    close() {
      deliver = null;
    },
    clear() {
      const pending = held;
      held = [];
      return pending;
    },
  };
}
