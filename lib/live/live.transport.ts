import type { LiveAudio } from "./live.session";

/**
 * WebRTC media tracks and a JSON data channel. The server exchanges the SDP
 * offer (`negotiate`), so the account key never reaches this side. The far end
 * plays the answer as a track and handles barge-in itself, so nothing here
 * decodes, plays or truncates audio.
 */

/** Browser-side cleanup of the user's own microphone before it reaches the wire. */
export const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
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
  negotiate(sdp: string): Promise<string>;
  audio: LiveAudio;
  on: {
    event(event: Incoming): void;
    dropped(message: string): void;
  };
}): {
  connect(): Promise<void>;
  send(event: Outgoing): void;
  close(): void;
} {
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let microphone: MediaStream | null = null;
  let closed = false;
  let opened = false;
  let dropped = false;
  let rejectReady: ((cause: Error) => void) | undefined;
  let cancelIce: (() => void) | undefined;

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
    channel?.close();
    peer?.close();
    audio.element.srcObject = null;
  };

  return {
    async connect() {
      const connection = new RTCPeerConnection();
      peer = connection;
      const events = connection.createDataChannel("oai-events");
      channel = events;
      const ready = new Promise<void>((resolve, reject) => {
        rejectReady = reject;
        const gone = (message: string) => {
          if (closed || dropped) return;
          dropped = true;
          if (opened) on.dropped(message);
          else reject(new Error(message));
        };
        events.onopen = () => {
          opened = true;
          resolve();
        };
        events.onclose = () => gone("The connection to OpenAI Live closed.");
        events.onerror = () => gone("The connection to OpenAI Live dropped.");
        connection.onconnectionstatechange = () => {
          if (["failed", "closed"].includes(connection.connectionState)) {
            gone("Could not reach OpenAI Live.");
          }
        };
      });
      // A connection may fail while microphone permission or SDP exchange is pending.
      void ready.catch(() => {});
      events.onmessage = ({ data }) => {
        if (closed || typeof data !== "string") return;
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
      const answer = await negotiate(offer);
      if (closed) throw new Error("The call closed before connecting.");
      await connection.setRemoteDescription({ type: "answer", sdp: answer });
      await ready;
    },
    send(event) {
      if (!closed && channel?.readyState === "open")
        channel.send(JSON.stringify(event));
    },
    close,
  };
}
