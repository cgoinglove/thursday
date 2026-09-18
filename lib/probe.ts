/**
 * TEMPORARY test instrumentation — remove in one pass: delete this file and
 * `app/api/probe/`, then every `probe(` call and `createProbe` import.
 *
 * A probe records what the database does not keep: when something was put into a
 * call, what Live answered, when the page decided to hang up. Lines go to
 * `probe.local.jsonl` in the data folder. Outside development it does nothing.
 */
const ON = process.env.NODE_ENV === "development";
const URL = "/api/probe";
const FLUSH_MS = 1_000;

type Line = { at: number; scope: string; event: string; data?: unknown };

const queue: Line[] = [];
let pending = false;

const flush = () => {
  pending = false;
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0));
  // keepalive, so lines written as the page goes away still arrive
  void fetch(URL, { method: "POST", body, keepalive: true }).catch(() => {});
};

if (ON && typeof window !== "undefined")
  window.addEventListener("pagehide", flush);

export const createProbe =
  (scope: string) =>
  (event: string, data?: unknown): void => {
    if (!ON || typeof window === "undefined") return;
    queue.push({ at: Date.now(), scope, event, data });
    if (pending) return;
    pending = true;
    setTimeout(flush, FLUSH_MS);
  };

/** One Live event, without its payload: enough to rebuild the order of a call. */
export const briefLiveEvent = (event: any) => ({
  type: event.type,
  nested: event.event?.type,
  response: event.event?.response?.id ?? event.event?.response_id,
  status: event.event?.response?.status,
  item: event.event?.item && {
    type: event.event.item.type,
    name: event.event.item.name,
    call: event.event.item.call_id,
    status: event.event.item.status,
  },
  delegation: event.delegation_id,
  client: event.client_event_id,
  error: event.error?.message ?? event.event?.response?.error?.message,
  ms: event.offset_ms ?? event.start_ms,
});
