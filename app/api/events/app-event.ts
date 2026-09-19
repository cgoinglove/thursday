/**
 * Every event the server sends the browser. Two kinds: a signal carries no data
 * and the receiver revalidates the matching GET; a data event is the value
 * itself. A new signal must also be added to `SIGNALS` below.
 */
export type AppEvent =
  /** Sent on connect. A changed `boot` means the server restarted; re-read everything. */
  | { type: "hello"; boot: string }
  /** Signal: a thread changed (every write in thread.query and room.query). */
  | { type: "threads" }
  /** Signal: a routine was made, changed, removed, or moved on to its next time. */
  | { type: "routines" }
  /** Signal: a note or fact changed. */
  | { type: "memory" }
  /** Signal: a server was registered, removed, synced, or finished OAuth. */
  | { type: "mcp" }
  /** Signal: a sign-in was written away from the settings screen (ai/chatgpt's sign-in answer). */
  | { type: "config" }
  /** Signal: who may write from a phone changed, or someone is asking to (features/reach). */
  | { type: "reach" }
  /** Signal: a sign-in was kept, lent, asked for or removed (features/signins). */
  | { type: "signins" }
  /**
   * Data: a job finished. `words` opens its answer as plain text; `paths` are the
   * files it named, workspace-relative with the one worth reading first at the
   * head, and empty when it answered in words alone.
   */
  | {
      type: "finished";
      threadId: string;
      label: string;
      bot: string;
      words: string;
      paths: string[];
    }
  /** Data: Thursday puts a job in front of the user (`thread` `open` on a call). */
  | { type: "showThread"; threadId: string }
  /** Data: Thursday puts what a job made in front of the user; `paths` as in `finished`. */
  | { type: "showFile"; paths: string[] };

/** Union members carrying nothing but `type`. */
type Signal<E = AppEvent> = E extends AppEvent
  ? keyof E extends "type"
    ? E["type"]
    : never
  : never;

/**
 * Signals are coalesced before sending (app-event.server). The `Record` type
 * makes a signal missing here a compile error.
 */
export const SIGNALS: Record<Signal, true> = {
  threads: true,
  routines: true,
  memory: true,
  mcp: true,
  config: true,
  reach: true,
  signins: true,
};

export const isSignal = (
  event: AppEvent,
): event is Extract<AppEvent, { type: Signal }> => event.type in SIGNALS;
