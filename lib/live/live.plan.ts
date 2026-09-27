import { appendChunks } from "./live.session";

/**
 * The control side of a voice call on a ChatGPT plan, held by the server while the browser
 * holds the media. The Codex CLI joins a call it made the same way: a WebSocket to the call by
 * its id, sent the sign-in's own headers (codex-rs codex-api endpoint/realtime_websocket:
 * the `FramelessBidi` parser in protocol_frameless_bidi.rs, its writer in
 * methods_frameless_bidi.rs, the address in methods.rs `websocket_url_from_api_url_for_call`).
 * It is not the wire a key opens (live.server, live.session): this voice has no backend of the
 * provider's. It hands work to whoever holds this socket (`delegated`), who answers into the
 * voice's own context.
 */

/** Where a call on the plan is joined, by its id: api.openai.com whatever made it (codex-rs methods.rs `webrtc_frameless_sideband_ignores_provider_base_url`). */
const PLAN_LINE_URL = "wss://api.openai.com/v1/live";

/** What the voice's side says, as the app reads it. */
export type PlanEvent =
  | { type: "started" }
  /** Words transcribed as they come, the user's or hers: each a piece that follows the last. */
  | { type: "heard"; role: "user" | "assistant"; text: string }
  /** A turn over, with the whole of what was said in it. */
  | { type: "turn"; role: "user" | "assistant"; text: string }
  /** Work the voice hands over, in its own words, under the id its answer goes back to. */
  | { type: "delegated"; id: string; text: string }
  | { type: "error"; message: string };

/**
 * Where words put into the voice's context go: `speakable` is hers to say in her own words,
 * `commentary` is background she keeps and does not read out (codex-rs protocol.rs
 * `RealtimeContextAppendChannel`; an append without one is speakable).
 */
export type PlanChannel = "speakable" | "commentary";

export type PlanWire = {
  /** Words into the voice's context; false when the socket was not there to carry them. */
  say(text: string, channel: PlanChannel): boolean;
  /** What came of work the voice handed over, bound to its delegation. */
  answer(delegation: string, text: string, channel: PlanChannel): boolean;
  /** Ends the call from this side: the voice is told first, then the socket goes. */
  close(): void;
};

/** A provider call id as Codex takes one: `rtc_…` or a UUID (codex-api realtime_call.rs `is_realtime_call_id_segment`). */
export const isPlanCallId = (value: string) =>
  /^rtc_[\w-]+$/.test(value) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type Frame = {
  type?: unknown;
  item?: {
    type?: unknown;
    target?: unknown;
    id?: unknown;
    text?: unknown;
    content?: unknown;
  };
  turn?: { role?: unknown; transcript?: unknown };
  message?: unknown;
  error?: unknown;
};

const roleOf = (value: unknown) =>
  value === "user" || value === "assistant" ? value : null;

/** One frame from the voice's side, as `parse_frameless_bidi_event` reads it; null for what the app does not use. */
export function readPlanEvent(data: unknown): PlanEvent | null {
  if (!data || typeof data !== "object") return null;
  const frame = data as Frame;
  switch (frame.type) {
    case "session.started":
    case "session.updated":
      return { type: "started" };
    case "input_transcript.added":
    case "output_transcript.added": {
      const text = frame.item?.text;
      if (typeof text !== "string" || !text) return null;
      return {
        type: "heard",
        role: frame.type === "input_transcript.added" ? "user" : "assistant",
        text,
      };
    }
    case "turn.done": {
      const role = roleOf(frame.turn?.role);
      const text = frame.turn?.transcript;
      return role && typeof text === "string"
        ? { type: "turn", role, text }
        : null;
    }
    case "delegation.created": {
      const item = frame.item;
      if (
        item?.type !== "delegation" ||
        item.target !== "client" ||
        typeof item.id !== "string" ||
        !item.id
      )
        return null;
      const text = (Array.isArray(item.content) ? item.content : [])
        .filter(
          (part): part is { type: string; text: string } =>
            part?.type === "input_text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("");
      return { type: "delegated", id: item.id, text };
    }
    case "error": {
      const error = frame.error as { message?: unknown } | undefined;
      const message =
        typeof frame.message === "string"
          ? frame.message
          : typeof error?.message === "string"
            ? error.message
            : JSON.stringify(frame.error ?? "The voice reported an error.");
      return { type: "error", message };
    }
    default:
      return null;
  }
}

/** Node's WebSocket (undici) takes headers in its second argument, which the DOM's type does not know. */
type HeaderedWebSocket = new (
  url: string,
  init: { headers: Record<string, string> },
) => WebSocket;

/**
 * Joins a call on the plan by its id. Resolves once the socket is open, with what speaks
 * into it; `closed` is heard once, however it closes after that.
 */
export function joinPlanLine(options: {
  callId: string;
  headers: Record<string, string>;
  on: {
    event(event: PlanEvent): void;
    closed(code: number, reason: string): void;
  };
  /** Where calls are joined; a test points it at its own server. */
  url?: string;
}): Promise<PlanWire> {
  const { callId, headers, on, url = PLAN_LINE_URL } = options;
  if (!isPlanCallId(callId))
    return Promise.reject(new Error(`Not a call id: ${callId}`));
  return new Promise((resolve, reject) => {
    const socket = new (WebSocket as unknown as HeaderedWebSocket)(
      `${url}/${callId}`,
      { headers },
    );
    let open = false;
    let over = false;
    const send = (message: object) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    };
    // Each piece is one append: the wire takes 500 bytes at most (codex-rs
    // methods_frameless_bidi.rs `CONTEXT_APPEND_MAX_BYTES`), and a piece of the page's size fits
    const content = (text: string) => [{ type: "input_text", text }];
    const wire: PlanWire = {
      say: (text, channel) =>
        appendChunks(text).every((piece) =>
          send({
            type: "session.context.append",
            channel,
            content: content(piece),
          }),
        ),
      answer: (delegation, text, channel) =>
        appendChunks(text).every((piece) =>
          send({
            type: "delegation.context.append",
            delegation_item_id: delegation,
            channel,
            content: content(piece),
          }),
        ),
      close: () => {
        send({ type: "session.close" });
        socket.close(1000, "session closed");
      },
    };

    socket.addEventListener("open", () => {
      open = true;
      resolve(wire);
    });
    socket.addEventListener("message", (message) => {
      let data: unknown;
      try {
        data = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const event = readPlanEvent(data);
      if (event) on.event(event);
    });
    // `close` follows an error and carries the code; before `open` there is nothing to join
    socket.addEventListener("error", () => {
      if (!open && !over) {
        over = true;
        reject(new Error("Could not join the call on the GPT Subscription."));
      }
    });
    socket.addEventListener("close", (closed) => {
      if (!open) {
        if (!over) {
          over = true;
          reject(
            new Error(
              `The call on the GPT Subscription refused its line (${closed.code}${closed.reason ? `: ${closed.reason}` : ""}).`,
            ),
          );
        }
        return;
      }
      if (over) return;
      over = true;
      on.closed(closed.code, closed.reason);
    });
  });
}
