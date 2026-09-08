import { errorToString } from "@/lib/utils";
import type {
  RealtimeFunctionTool,
  RealtimeResponse,
  RealtimeServerEvent,
  SessionUpdateEvent,
} from "./realtime.protocol";
import type { RealtimeCredential, ToolManifest } from "./realtime.schema";
import type {
  RealtimeActivity,
  RealtimeAudio,
  RealtimeSessionFactory,
  RealtimeSessionSetup,
  RealtimeTurn,
} from "./realtime.session";
import type { RealtimeTransport, TransportEvents } from "./realtime.transport";

/**
 * Session driver for the OpenAI Realtime protocol, which xAI's API also speaks.
 * A RealtimeDialect (openai, xai) supplies only the transport and the
 * `session.update` payload.
 *
 * Turns are ordered by item announcement, not by word arrival: the user's
 * transcript can land after the assistant's answer started. Tool outputs are
 * sent as each finishes; the follow-up `response.create` goes out once, after
 * all outputs are in and playback ended. `say()` text is queued until the line
 * is quiet, since the API refuses a second response while one runs.
 */

export type RealtimeDialect = {
  /** Open the wire with this credential. */
  transport(options: {
    credential: RealtimeCredential;
    setup: RealtimeSessionSetup;
    audio: RealtimeAudio;
    on: TransportEvents;
  }): RealtimeTransport;
  /** What the session should be, in the shape sent the moment the wire opens. */
  sessionUpdate(setup: RealtimeSessionSetup): SessionUpdateEvent;
};

/** Function-tool shape for `session.update`; schemas pass through untouched. */
export const toFunctionTools = (
  tools: ToolManifest[],
): RealtimeFunctionTool[] =>
  tools.map(({ name, description, parameters }) => ({
    type: "function",
    name,
    description,
    parameters,
  }));

/** Longest wait for `session.updated` before the session counts as open. */
const SESSION_ACK_MS = 5000;

/**
 * After speech stops the server creates its own response; a `response.create`
 * in that gap is refused as a duplicate. Wait this long for it to appear.
 */
const SERVER_TURN_MS = 1500;

/**
 * A sent `response.create` counts as active until `response.created` or
 * `error`. If neither arrives within this, the claim is dropped so `say()` is
 * not blocked for the rest of the call.
 */
const RESPONSE_ACK_MS = 5000;

type Turn = {
  id: string;
  role: RealtimeTurn["role"];
  tool?: string;
  text: string;
};

export function realtimeSession(
  dialect: RealtimeDialect,
): RealtimeSessionFactory {
  return ({ credential, setup, audio, on }) => {
    let hungUp = false;
    /** Pending while waiting for `session.updated`. Null once the session is open. */
    let opening: {
      resolve: () => void;
      reject: (cause: Error) => void;
    } | null = null;
    let ackTimer: ReturnType<typeof setTimeout> | null = null;

    const turns: Turn[] = [];
    const slot = new Map<string, number>();
    const finalized = new Set<string>();

    /** Claims an item's place the moment it is announced. */
    const reserve = (id: string, role: Turn["role"]) => {
      if (slot.has(id)) return;
      slot.set(id, turns.length);
      turns.push({ id, role, text: "" });
    };

    const report = (index: number, done: boolean) => {
      const turn = turns[index];
      // An item with no words yet is a place, not a turn
      if (!turn.text.trim()) return;
      on.turn({ ...turn, seq: index, done });
    };

    const write = (
      id: string,
      role: Turn["role"],
      text: string,
      how: "append" | "replace",
    ) => {
      reserve(id, role);
      const index = slot.get(id) as number;
      const was = turns[index].text;
      const now = how === "append" ? was + text : text;
      if (now === was) return;
      turns[index] = { ...turns[index], text: now };
      if (!finalized.has(id)) report(index, false);
    };

    /**
     * Reports unfinalized user turns as `done` once without marking them final.
     * `input_audio_transcription.completed` does not always arrive, and `close`
     * does not run on a refreshed tab; a later `completed` re-reports the same
     * seq and the store upserts over it.
     */
    const flushSpoken = () => {
      for (const [index, turn] of turns.entries()) {
        if (turn.role !== "user" || finalized.has(turn.id)) continue;
        report(index, true);
      }
    };

    /** Reports the turn once as `done` and marks it final. */
    const finish = (id: string) => {
      const index = slot.get(id);
      if (index === undefined || finalized.has(id)) return;
      if (!turns[index].text.trim()) return;
      finalized.add(id);
      report(index, true);
    };

    let playing = false;
    let userSpeaking = false;
    /** From `response.created` to `response.done`, or from our unconfirmed `response.create`. */
    let responseActive = false;
    /** We asked for the active response and have not seen created yet. */
    let requested = false;
    /** Set while the server is expected to create its own response (SERVER_TURN_MS). */
    let serverTurn: ReturnType<typeof setTimeout> | null = null;
    /** Armed while a `response.create` is unconfirmed (RESPONSE_ACK_MS). */
    let requestAck: ReturnType<typeof setTimeout> | null = null;
    /** Tool calls announced but not yet answered with an output. call_id → name. */
    const outstanding = new Map<string, string>();
    /** How many outputs have been sent since the last follow-up was asked for. */
    let answered = 0;
    /** A follow-up was asked for and the model has not started it yet. */
    let awaiting = false;
    /** Tool names in the current episode; kept until the follow-up starts so activity does not blink. */
    let episode: string[] = [];
    /** What say() queued for the next quiet gap. */
    const queue: string[] = [];
    let shown = "";

    const clearServerTurn = () => {
      if (serverTurn) clearTimeout(serverTurn);
      serverTurn = null;
    };

    const expectServerTurn = () => {
      clearServerTurn();
      serverTurn = setTimeout(() => {
        serverTurn = null;
        settle();
      }, SERVER_TURN_MS);
    };

    /** Stops waiting for confirmation of our `response.create`. */
    const clearRequestAck = () => {
      if (requestAck) clearTimeout(requestAck);
      requestAck = null;
    };

    /** Drops the optimistic claim if no confirmation arrives (RESPONSE_ACK_MS). */
    const expectRequestAck = () => {
      clearRequestAck();
      requestAck = setTimeout(() => {
        requestAck = null;
        if (!requested) return;
        requested = false;
        responseActive = false;
        on.warn("The voice API never answered a response we asked for.");
        settle();
      }, RESPONSE_ACK_MS);
    };

    /** Reports changed activity and, when the line is quiet, sends what is pending. */
    const settle = () => {
      if (hungUp) return;

      // `answered > 0` keeps the episode alive between a tool output and the
      // follow-up request, when nothing is outstanding or awaited yet.
      const busy = outstanding.size > 0 || awaiting || answered > 0;
      const activity: RealtimeActivity = {
        speaking: playing,
        hearing: userSpeaking,
        tools: busy ? episode : [],
      };
      const key = JSON.stringify(activity);
      if (key !== shown) {
        shown = key;
        on.activity(activity);
      }

      // Nothing is requested while anyone speaks, a response runs, or a tool is out.
      if (
        userSpeaking ||
        responseActive ||
        serverTurn ||
        playing ||
        outstanding.size > 0
      ) {
        return;
      }
      const continuing = answered > 0;
      if (!continuing && queue.length === 0) return;

      for (const text of queue.splice(0)) {
        transport.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text }],
          },
        });
      }
      answered = 0;
      awaiting = continuing;
      // Counted as active until confirmed or refused.
      responseActive = true;
      requested = true;
      expectRequestAck();
      transport.send({ type: "response.create" });
    };

    const onToolCall = (call: {
      call_id: string;
      name: string;
      arguments: string;
    }) => {
      // A new episode does not inherit the last one's names.
      if (outstanding.size === 0 && !awaiting) episode = [];
      episode = [...episode, call.name];
      outstanding.set(call.call_id, call.name);

      void on
        .runTool({
          id: call.call_id,
          name: call.name,
          arguments: call.arguments,
        })
        // A throwing runner must not stall the session.
        .catch((cause) => `Error: ${errorToString(cause)}`)
        .then((output) => {
          if (hungUp) return;
          // Sent immediately; only the follow-up waits.
          transport.send({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: call.call_id,
              output,
            },
          });
          outstanding.delete(call.call_id);
          answered += 1;
          settle();
        });
    };

    const handle = (event: RealtimeServerEvent) => {
      switch (event.type) {
        case "session.updated":
          opening?.resolve();
          break;

        case "error": {
          const message =
            event.error?.message ?? "The voice API reported an error";
          // Whatever was refused, our response request is no longer pending.
          if (requested) {
            requested = false;
            responseActive = false;
            clearRequestAck();
          }
          if (opening) opening.reject(new Error(message));
          else on.warn(message);
          break;
        }

        case "input_audio_buffer.speech_started":
          userSpeaking = true;
          clearServerTurn();
          break;

        case "input_audio_buffer.speech_stopped":
          userSpeaking = false;
          expectServerTurn();
          break;

        case "input_audio_buffer.committed":
          reserve(event.item_id, "user");
          break;

        case "conversation.item.added":
        case "conversation.item.created":
          if (event.item.type === "message" && event.item.role !== "system") {
            reserve(event.item.id, event.item.role);
          }
          break;

        case "response.output_item.added":
          if (event.item.type === "message") {
            reserve(event.item.id, "assistant");
          } else if (event.item.type === "function_call") {
            // A tool call holds a turn slot too (arguments instead of words).
            reserve(event.item.id, "tool");
          }
          break;

        case "conversation.item.input_audio_transcription.delta":
          write(event.item_id, "user", event.delta ?? "", "append");
          break;

        case "conversation.item.input_audio_transcription.updated":
          write(event.item_id, "user", event.transcript, "replace");
          break;

        case "conversation.item.input_audio_transcription.completed":
          write(event.item_id, "user", event.transcript ?? "", "replace");
          finish(event.item_id);
          break;

        case "response.output_audio_transcript.delta":
          write(event.item_id, "assistant", event.delta, "append");
          break;

        case "response.output_audio_transcript.done":
          // Replace with the full transcript in case a delta was lost.
          if (event.transcript) {
            write(event.item_id, "assistant", event.transcript, "replace");
          }
          finish(event.item_id);
          break;

        case "response.created":
          responseActive = true;
          requested = false;
          clearRequestAck();
          clearServerTurn();
          break;

        case "response.done":
          responseActive = false;
          awaiting = false;
          if (event.response.status === "failed") {
            on.warn(describeFailure(event.response));
          }
          // An interrupted answer never gets its transcript `done`.
          for (const item of event.response.output ?? []) {
            if (item.type === "message") finish(item.id);
          }
          flushSpoken();
          break;

        case "response.function_call_arguments.done":
          // Complete arguments make the tool turn final.
          reserve(event.item_id, "tool");
          {
            const index = slot.get(event.item_id) as number;
            turns[index] = {
              ...turns[index],
              tool: event.name,
              text: event.arguments || "{}",
            };
          }
          finish(event.item_id);
          onToolCall(event);
          break;
      }
      settle();
    };

    const transport = dialect.transport({
      credential,
      setup,
      audio,
      on: {
        event: handle,
        playing: (next) => {
          playing = next;
          if (next) awaiting = false;
          settle();
        },
        dropped: (message) => {
          if (opening) opening.reject(new Error(message));
          else on.failed(message);
        },
      },
    });

    return {
      async connect() {
        await transport.connect();
        if (hungUp) throw new Error("Hung up before the session opened.");

        transport.send(dialect.sessionUpdate(setup));
        await new Promise<void>((resolve, reject) => {
          opening = { resolve, reject };
          // A server that never acknowledges is let through.
          ackTimer = setTimeout(resolve, SESSION_ACK_MS);
        }).finally(() => {
          opening = null;
          if (ackTimer) clearTimeout(ackTimer);
          ackTimer = null;
        });
      },

      close() {
        // Finalize whatever is still open.
        for (const turn of turns) finish(turn.id);
        hungUp = true;
        clearServerTurn();
        clearRequestAck();
        opening?.reject(new Error("Hung up before the session opened."));
        transport.close();
      },

      mute: (muted) => transport.mute(muted),

      say(text) {
        if (hungUp) return;
        queue.push(text);
        settle();
      },
    };
  };
}

function describeFailure(response: RealtimeResponse) {
  return (
    response.status_details?.error?.message ??
    "The model could not finish answering"
  );
}
