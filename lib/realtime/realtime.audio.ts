import type { RealtimeAudio } from "./realtime.session";

/**
 * PCM16 microphone capture, playback and base64 codec for the WebSocket
 * transport. WebRTC handles audio as tracks and uses none of this.
 */

/** Both providers are configured with this value. */
export const PCM_SAMPLE_RATE = 24000;

export type PcmPlayer = ReturnType<typeof createPcmPlayer>;

/**
 * Plays PCM chunks scheduled against a moving play head; chunks arrive faster
 * than they play. A play head that fell behind is pushed forward.
 */
export function createPcmPlayer(
  audio: RealtimeAudio,
  /** Called when the queue empties. */
  onDrained: () => void,
) {
  const { context, analyser } = audio.speaker();
  let playHead = 0;
  const scheduled = new Set<AudioBufferSourceNode>();

  return {
    /** Queue one little-endian PCM16 chunk at PCM_SAMPLE_RATE. */
    push(samples: Int16Array) {
      if (samples.length === 0) return;

      const buffer = context.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        scheduled.delete(source);
        if (scheduled.size === 0) onDrained();
      };

      // Slightly ahead of now so scheduling jitter never lands in the past.
      playHead = Math.max(playHead, context.currentTime + 0.06);
      source.start(playHead);
      playHead += buffer.duration;
      scheduled.add(source);
    },

    /** Barge-in: drop everything queued but not yet heard. */
    stop() {
      for (const source of scheduled) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already finished.
        }
      }
      scheduled.clear();
      playHead = 0;
    },

    get speaking() {
      return scheduled.size > 0;
    },
  };
}

export type Microphone = Awaited<ReturnType<typeof openMicrophone>>;

/** Echo cancellation is required or the model hears itself and interrupts its own turn. */
export const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Opens the mic as PCM16 chunks; the AudioContext resamples to PCM_SAMPLE_RATE. */
export async function openMicrophone(onChunk: (samples: Int16Array) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: MICROPHONE_CONSTRAINTS,
  });

  // The mic is on from here and only this scope holds it: a failure below must
  // release it itself or the recording indicator stays lit.
  const context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
  try {
    await context.audioWorklet.addModule(captureWorkletUrl());
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, CAPTURE_PROCESSOR);

    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const frame = event.data;
      const samples = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i++) {
        const clamped = Math.max(-1, Math.min(1, frame[i]));
        samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      onChunk(samples);
    };

    source.connect(capture);
    // A worklet with nothing downstream can be garbage collected; a silent gain keeps it alive.
    const silence = context.createGain();
    silence.gain.value = 0;
    capture.connect(silence).connect(context.destination);
    await context.resume();

    return microphone(stream, context, capture);
  } catch (cause) {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw cause;
  }
}

function microphone(
  stream: MediaStream,
  context: AudioContext,
  capture: AudioWorkletNode,
) {
  return {
    /** The raw stream, for level metering. */
    stream,
    /** Mutes at the track so the browser's recording indicator goes out too. */
    setMuted(muted: boolean) {
      for (const track of stream.getAudioTracks()) track.enabled = !muted;
    },
    close() {
      capture.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

const CAPTURE_PROCESSOR = "voice-capture";

/** Samples per message (about 43ms); posting every 128-sample block would flood the socket. */
const CAPTURE_FRAME = 1024;

const CAPTURE_WORKLET = `
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${CAPTURE_FRAME});
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.frame[this.filled++] = input[i];
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("${CAPTURE_PROCESSOR}", VoiceCapture);
`;

let workletUrl: string | null = null;

/** Inline blob URL so the processor lives next to the code reading its messages. */
function captureWorkletUrl() {
  workletUrl ??= URL.createObjectURL(
    new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
  );
  return workletUrl;
}

/** PCM16 to base64. Chunked: spreading a whole buffer into String.fromCharCode overflows the stack. */
export function encodePcm(samples: Int16Array): string {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodePcm(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Drop a trailing half sample.
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}
