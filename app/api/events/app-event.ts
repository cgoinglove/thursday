/**
 * Every event the server sends the browser. Two kinds: a signal carries no data
 * and the receiver revalidates the matching GET; a data event is the value
 * itself. A new signal must also be added to `SIGNALS` below.
 */
export type AppEvent =
  /** Sent on connect. A changed `boot` means the server restarted; re-read everything. */
  | { type: "hello"; boot: string }
  /** Signal: a task changed (every write in bot.query). */
  | { type: "tasks" }
  /** Signal: a note or fact changed. */
  | { type: "memory" }
  /** Signal: a server was registered, removed, synced, or finished OAuth. */
  | { type: "mcp" }
  /** Signal: a read-back started or ended (memory/tidy.query). */
  | { type: "memory-tidy" }
  /** Data: a read-back ended on its own. `tally` is one line of what changed, or why it failed. */
  | { type: "memory-tidied"; failed: boolean; tally: string }
  /** Data: show this note on screen, or hide it when null (memory.tool). */
  | { type: "memory-view"; path: string | null }
  /** Data: a finished job produced a document; `path` is workspace-relative. */
  | { type: "artifact"; taskId: string; label: string; path: string };

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
  tasks: true,
  memory: true,
  mcp: true,
  "memory-tidy": true,
};

export const isSignal = (
  event: AppEvent,
): event is Extract<AppEvent, { type: Signal }> => event.type in SIGNALS;
