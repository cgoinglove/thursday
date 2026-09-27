import { PLAN_CALL } from "@/config";
import { isResultError, isResultOk } from "@/lib/protocol/result";
import type { LiveAudio } from "./live.session";

/**
 * WebRTC media tracks and a JSON data channel. The server exchanges the SDP
 * offer (`negotiate`), so the account key never reaches this side. The far end
 * plays the answer as a track and handles barge-in itself, so nothing here
 * decodes, plays or truncates audio.
 *
 * A call on the GPT subscription's line answers with a relay as well
 * (thursday.plan): its events then come from the server, which runs her backend
 * for that voice, and go back to it, while the media stays here. The data
 * channel is opened as on any call and not read: the call is up once it opens
 * and over once it closes, as the Codex CLI's voice client holds it (codex-rs
 * voice-host transport.rs, `oai-events`).
 */

/** What the server answers an offer with: the answer, and on the plan's line where to follow the call. */
export type Negotiated = string | { sdp: string; relay: string };

/** Browser-side cleanup of the user's own microphone before it reaches the wire. */
const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** ICE gathering rarely stalls, but a stalled one would hang the call forever. */
const ICE_TIMEOUT_MS = 10_000;

export function createWebRtcTransport<Incoming, Outgoing>({
  negotiate,
  audio,
  on,
}: {
  negotiate(sdp: string): Promise<Negotiated>;
  audio: LiveAudio;
  on: {
    event(event: Incoming): void;
    dropped(message: string): void;
  };
}): {
  connect(): Promise<void>;
  send(event: Outgoing): void;
  /**
   * The largest message the data channel carries, as the two ends agreed; null before. On the
   * plan's line a picture goes to the server instead, and is held to PLAN_CALL.pictureBytes.
   */
  limit(): number | null;
  /** Whether the call's events go through the server (the plan's line). */
  relayed(): boolean;
  close(): void;
} {
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let microphone: MediaStream | null = null;
  let closed = false;
  let opened = false;
  let dropped = false;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((cause: Error) => void) | undefined;
  let cancelIce: (() => void) | undefined;
  /** The plan's line: where its events come from and go to, and whether that is followed yet. */
  let relay: string | null = null;
  let source: EventSource | null = null;
  let followed = false;
  /** What goes to the relay, one request after another, so the server hears it in order. */
  let sending: Promise<void> = Promise.resolve();
  let channelUp = false;

  const stopTracks = (stream: MediaStream | null) => {
    for (const track of stream?.getTracks() ?? []) track.stop();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    rejectReady?.(new Error("The call closed before connecting."));
    cancelIce?.();
    stopTracks(microphone);
    microphone = null;
    source?.close();
    channel?.close();
    peer?.close();
    audio.element.srcObject = null;
  };
  const gone = (message: string) => {
    if (closed || dropped) return;
    dropped = true;
    if (opened) on.dropped(message);
    else rejectReady?.(new Error(message));
  };
  /** Up once the data channel is open and, on the plan's line, the relay is followed. */
  const settle = () => {
    if (opened || !channelUp || (relay && !followed)) return;
    opened = true;
    resolveReady?.();
  };
  /** The call's events as the server relays them, for the plan's line. */
  const follow = (url: string) =>
    new Promise<void>((resolve, reject) => {
      const stream = new EventSource(url);
      source = stream;
      stream.onopen = () => resolve();
      stream.onmessage = ({ data }) => {
        if (closed || typeof data !== "string") return;
        let event: Incoming;
        try {
          event = JSON.parse(data);
        } catch {
          on.dropped("The call on the plan sent an unreadable event.");
          return;
        }
        on.event(event);
      };
      // The server ends the call when this goes, so it is never reopened
      stream.onerror = () => {
        stream.close();
        reject(new Error("Could not follow the call on the plan."));
        gone("The line to her on the plan dropped.");
      };
    });

  return {
    async connect() {
      const connection = new RTCPeerConnection();
      peer = connection;
      const events = connection.createDataChannel("oai-events");
      channel = events;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      events.onopen = () => {
        channelUp = true;
        settle();
      };
      events.onclose = () => gone("The connection to OpenAI Live closed.");
      events.onerror = () => gone("The connection to OpenAI Live dropped.");
      connection.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(connection.connectionState)) {
          gone("Could not reach OpenAI Live.");
        }
      };
      // A connection may fail while microphone permission or SDP exchange is pending.
      void ready.catch(() => {});
      events.onmessage = ({ data }) => {
        // On the plan's line the relay carries the call's events, and only those are read
        if (closed || relay || typeof data !== "string") return;
        let event: Incoming;
        try {
          event = JSON.parse(data);
        } catch {
          on.dropped("OpenAI Live sent an unreadable event.");
          return;
        }
        on.event(event);
      };
      connection.ontrack = (event) => {
        if (closed) return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        audio.element.srcObject = stream;
        audio.listen(stream);
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: MICROPHONE_CONSTRAINTS,
      });
      if (closed) {
        stopTracks(stream);
        throw new Error("The call closed before connecting.");
      }
      microphone = stream;
      audio.hear?.(stream);
      for (const track of stream.getAudioTracks())
        connection.addTrack(track, stream);
      await connection.setLocalDescription(await connection.createOffer());
      if (connection.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer);
            connection.removeEventListener("icegatheringstatechange", change);
            cancelIce = undefined;
            if (error) reject(error);
            else resolve();
          };
          const change = () => {
            if (connection.iceGatheringState === "complete") finish();
          };
          const timer = setTimeout(
            () => finish(new Error("ICE gathering timed out.")),
            ICE_TIMEOUT_MS,
          );
          cancelIce = () =>
            finish(new Error("The call closed before connecting."));
          connection.addEventListener("icegatheringstatechange", change);
          change();
        });
      }
      const offer = connection.localDescription?.sdp;
      if (!offer || closed) throw new Error("No live SDP offer is available.");
      const negotiated = await negotiate(offer);
      if (closed) throw new Error("The call closed before connecting.");
      if (typeof negotiated !== "string") {
        relay = negotiated.relay;
        // Followed before the media is up: what the line says meanwhile waits on the server
        await follow(relay);
        followed = true;
      }
      await connection.setRemoteDescription({
        type: "answer",
        sdp: typeof negotiated === "string" ? negotiated : negotiated.sdp,
      });
      settle();
      await ready;
    },
    send(event) {
      if (closed) return;
      if (relay) {
        const url = relay;
        sending = sending
          .then(async () => {
            const response = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ events: [event] }),
            });
            const result: unknown = await response.json().catch(() => null);
            if (!response.ok || !isResultOk(result))
              throw new Error(
                (isResultError(result) && result.message) ||
                  `${response.status}`,
              );
          })
          .catch((cause: unknown) => {
            gone(
              `The call on the plan did not take what was sent: ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          });
        return;
      }
      if (channel?.readyState === "open") channel.send(JSON.stringify(event));
    },
    limit() {
      if (relay) return PLAN_CALL.pictureBytes;
      return peer?.sctp?.maxMessageSize ?? null;
    },
    relayed() {
      return relay !== null;
    },
    close,
  };
}
