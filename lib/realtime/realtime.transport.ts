import {
  createPcmPlayer,
  decodePcm,
  encodePcm,
  MICROPHONE_CONSTRAINTS,
  type Microphone,
  openMicrophone,
  PCM_SAMPLE_RATE,
  type PcmPlayer,
} from "./realtime.audio";
import type {
  RealtimeClientEvent,
  RealtimeServerEvent,
} from "./realtime.protocol";
import type { RealtimeAudio } from "./realtime.session";

/**
 * Transports own the audio and report events plus whether output audio is
 * playing. WebRTC carries audio as tracks and the server handles barge-in
 * truncation; WebSocket carries PCM16 in JSON and this side plays, stops and
 * truncates by hand.
 */

export type TransportEvents = {
  event: (event: RealtimeServerEvent) => void;
  /** Output audio started or stopped playing. */
  playing: (playing: boolean) => void;
  /** The wire went away on its own. Fatal, reported once. */
  dropped: (message: string) => void;
};

export type RealtimeTransport = {
  /** Resolves once events can be sent. Rejects if the wire never opens. */
  connect(): Promise<void>;
  /** Silently dropped while the wire is not open. */
  send(event: RealtimeClientEvent): void;
  close(): void;
  mute(muted: boolean): void;
};

type TransportOptions = {
  /** Provider name for user-facing messages. */
  label: string;
  audio: RealtimeAudio;
  on: TransportEvents;
};

/**
 * WebRTC: mic as a track, SDP offer POSTed with the ephemeral secret, remote
 * audio to `audio.element` and `audio.listen`, events on the "oai-events" channel.
 */
export function createWebRtcTransport({
  url,
  secret,
  label,
  audio,
  on,
}: TransportOptions & {
  /** Where the offer is POSTed. */
  url: string;
  secret: string;
}): RealtimeTransport {
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let microphone: MediaStream | null = null;
  let closed = false;
  let opened = false;
  let dropped = false;
  let playing = false;

  const setPlaying = (next: boolean) => {
    if (playing === next) return;
    playing = next;
    on.playing(next);
  };

  const drop = (message: string) => {
    if (closed || dropped) return;
    dropped = true;
    on.dropped(message);
  };

  const stopTracks = (stream: MediaStream | null) => {
    for (const track of stream?.getTracks() ?? []) track.stop();
  };

  const close = () => {
    closed = true;
    stopTracks(microphone);
    microphone = null;
    channel?.close();
    channel = null;
    peer?.close();
    peer = null;
    // The element outlives the call; a dead stream keeps the speaker indicator lit.
    audio.element.srcObject = null;
  };

  return {
    async connect() {
      const connection = new RTCPeerConnection();
      peer = connection;
      const events = connection.createDataChannel("oai-events");
      channel = events;

      // Before the channel opens a failure rejects connect; after, it is a drop.
      const ready = new Promise<void>((resolve, reject) => {
        const gone = (message: string) =>
          opened ? drop(message) : reject(new Error(message));
        events.onopen = () => {
          opened = true;
          resolve();
        };
        events.onclose = () => gone(`The connection to ${label} closed`);
        events.onerror = () => gone(`The connection to ${label} dropped`);
        connection.onconnectionstatechange = () => {
          const state = connection.connectionState;
          if (state === "failed" || state === "closed") {
            gone(`Could not reach ${label}`);
          }
        };
      });

      events.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let event: RealtimeServerEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          // One unreadable frame is not worth ending a call over.
          return;
        }
        // The server plays the audio, so it reports playback state.
        switch (event.type) {
          case "output_audio_buffer.started":
            setPlaying(true);
            break;
          case "output_audio_buffer.stopped":
          case "output_audio_buffer.cleared":
            setPlaying(false);
            break;
        }
        on.event(event);
      };

      connection.ontrack = (event) => {
        const [stream] = event.streams;
        audio.element.srcObject = stream;
        audio.listen(stream);
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: MICROPHONE_CONSTRAINTS,
      });
      if (closed) {
        // Hung up while the mic permission was pending.
        stopTracks(stream);
        throw new Error("Hung up before the call opened.");
      }
      microphone = stream;
      audio.hear?.(stream);
      connection.addTrack(stream.getAudioTracks()[0], stream);

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const response = await fetch(url, {
        method: "POST",
        body: offer.sdp,
        headers: {
          "Content-Type": "application/sdp",
          Authorization: `Bearer ${secret}`,
        },
      });
      if (!response.ok) throw new Error(await describeRefusal(response, label));
      await connection.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });

      await ready;
    },

    send(event) {
      if (channel?.readyState !== "open") return;
      channel.send(JSON.stringify(event));
    },

    close,

    mute(muted) {
      for (const track of microphone?.getAudioTracks() ?? []) {
        track.enabled = !muted;
      }
    },
  };
}

/**
 * WebSocket: audio deltas are decoded and played here. On barge-in the player
 * stops and `conversation.item.truncate` tells the model how much was heard,
 * or it continues as if the whole answer was said.
 */
export function createSocketTransport({
  url,
  protocols,
  label,
  audio,
  on,
}: TransportOptions & {
  url: string;
  /** Carries the secret; a browser cannot set WebSocket headers. */
  protocols: string[];
}): RealtimeTransport {
  let socket: WebSocket | null = null;
  let microphone: Microphone | null = null;
  let player: PcmPlayer | null = null;
  let closed = false;
  let dropped = false;
  /** Before `open` a failure rejects connect; after, it is a drop. */
  let opened = false;
  let playing = false;
  /** Item being played and how much has arrived; what a truncate measures against. */
  let current: {
    itemId: string;
    contentIndex: number;
    startedAt: number;
    receivedMs: number;
  } | null = null;

  const setPlaying = (next: boolean) => {
    if (playing === next) return;
    playing = next;
    on.playing(next);
  };

  const drop = (message: string) => {
    if (closed || dropped) return;
    dropped = true;
    on.dropped(message);
  };

  const send = (event: RealtimeClientEvent) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(event));
  };

  /** Stops playback and tells the model where the user stopped listening. */
  const bargeIn = () => {
    if (!player?.speaking || !current) return;
    const heardMs = Math.min(
      current.receivedMs,
      performance.now() - current.startedAt,
    );
    send({
      type: "conversation.item.truncate",
      item_id: current.itemId,
      content_index: current.contentIndex,
      audio_end_ms: Math.max(0, Math.floor(heardMs)),
    });
    player.stop();
    current = null;
    setPlaying(false);
  };

  const handle = (event: RealtimeServerEvent) => {
    switch (event.type) {
      case "response.output_audio.delta": {
        if (!player || !event.delta) break;
        const samples = decodePcm(event.delta);
        if (current?.itemId !== event.item_id) {
          current = {
            itemId: event.item_id,
            contentIndex: event.content_index ?? 0,
            startedAt: performance.now(),
            receivedMs: 0,
          };
        }
        current.receivedMs += (samples.length / PCM_SAMPLE_RATE) * 1000;
        player.push(samples);
        setPlaying(true);
        break;
      }
      case "input_audio_buffer.speech_started":
        bargeIn();
        break;
    }
    on.event(event);
  };

  const close = () => {
    closed = true;
    player?.stop();
    player = null;
    microphone?.close();
    microphone = null;
    const live = socket;
    socket = null;
    live?.close();
  };

  return {
    async connect() {
      player = createPcmPlayer(audio, () => {
        current = null;
        setPlaying(false);
      });

      const opening = new Promise<WebSocket>((resolve, reject) => {
        const live = new WebSocket(url, protocols);
        socket = live;
        live.onopen = () => {
          opened = true;
          resolve(live);
        };
        // Attached before any await: the socket can open and die while the mic
        // permission dialog is still up. A refused socket fires onerror then onclose.
        const gone = (message: string) =>
          opened ? drop(message) : reject(new Error(message));
        live.onerror = () => gone(`Could not reach ${label}`);
        live.onclose = (event) =>
          gone(
            event.reason || `The connection to ${label} closed (${event.code})`,
          );
      });

      // Requested in parallel with the socket handshake.
      const granting = openMicrophone((samples) =>
        send({ type: "input_audio_buffer.append", audio: encodePcm(samples) }),
      ).then(
        (granted) => {
          // Hung up while the mic permission was pending.
          if (closed) granted.close();
          else {
            microphone = granted;
            audio.hear?.(granted.stream);
          }
        },
        (cause) => {
          throw new Error(
            cause instanceof Error
              ? `Microphone unavailable — ${cause.message}`
              : "Microphone unavailable",
          );
        },
      );

      const [live] = await Promise.all([opening, granting]);
      if (closed) throw new Error("Hung up before the call opened.");

      live.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let event: RealtimeServerEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          // One unreadable frame is not worth ending a call over.
          return;
        }
        handle(event);
      };
      // onerror/onclose stay as set above; with `opened` true they route to `drop`.
    },

    send,

    close,

    mute(muted) {
      microphone?.setMuted(muted);
    },
  };
}

/** Error message from the body when there is one. */
async function describeRefusal(response: Response, label: string) {
  const text = await response.text().catch(() => "");
  try {
    const message = JSON.parse(text)?.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON; the status code is all there is.
  }
  return `${label} refused the call (${response.status})`;
}
