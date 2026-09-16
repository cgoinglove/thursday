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
  /** Signal: a note or fact changed. */
  | { type: "memory" }
  /** Signal: a server was registered, removed, synced, or finished OAuth. */
  | { type: "mcp" }
  /** Signal: a sign-in was written away from the settings screen (ai/chatgpt's sign-in answer). */
  | { type: "config" }
  /** Data: a finished job produced a document; `path` is workspace-relative. */
  | { type: "artifact"; threadId: string; label: string; path: string }
  /** Data: Thursday puts a job in front of the user (`thread` `open` on a call). */
  | { type: "showThread"; threadId: string };

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
  memory: true,
  mcp: true,
  config: true,
};

export const isSignal = (
  event: AppEvent,
): event is Extract<AppEvent, { type: Signal }> => event.type in SIGNALS;
