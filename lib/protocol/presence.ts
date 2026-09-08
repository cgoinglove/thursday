/**
 * Whether anyone is watching: an on/off derived from a connection count with a
 * grace period, so a reload (one connection closes, another opens a moment
 * later) does not read as leaving. Domain-agnostic; the event stream feeds
 * `track` and whoever cares subscribes.
 */

export type Presence = {
  /** True from the first connection until the last has been gone for the grace period. */
  readonly watching: boolean;
  /** Feed the current connection count. */
  track(count: number): void;
  /** Fires once when the grace period runs out with nobody connected. */
  onGone(listener: () => void): () => void;
  /** Fires once when a connection arrives after `gone`, or on the first ever. */
  onBack(listener: () => void): () => void;
};

export function createPresence(graceMs: number): Presence {
  let watching = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const gone = new Set<() => void>();
  const back = new Set<() => void>();

  const fire = (listeners: Set<() => void>) => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (cause) {
        console.error("presence listener failed", cause);
      }
    }
  };

  return {
    get watching() {
      return watching;
    },
    track(count) {
      if (count > 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        if (!watching) {
          watching = true;
          fire(back);
        }
        return;
      }
      if (timer || !watching) return;
      timer = setTimeout(() => {
        timer = null;
        watching = false;
        fire(gone);
      }, graceMs);
    },
    onGone(listener) {
      gone.add(listener);
      return () => gone.delete(listener);
    },
    onBack(listener) {
      back.add(listener);
      return () => back.delete(listener);
    },
  };
}
