import type { RealtimeAudio } from "./realtime.session";

/**
 * RealtimeAudio implementation that puts both the remote voice and the
 * microphone on analysers and folds their spectra into bands.
 */

/** FFT bin edges splitting 90Hz-6kHz roughly logarithmically (speech range). */
const BAND_EDGES = [1, 3, 5, 8, 13, 21, 34, 55, 90];
/** Per-band gain; a voice weakens as frequency rises. */
const BAND_GAIN = [1, 1.1, 1.25, 1.45, 1.7, 2, 2.4, 2.9];

/** Number of bands `read` and `readMic` return; derived from the tables above. */
export const SPECTRUM_BANDS = BAND_GAIN.length;

const EMPTY_BANDS = new Array<number>(SPECTRUM_BANDS).fill(0);

export type AudioTap = ReturnType<typeof createAudioTap>;

/** Folds one analyser's bins into the bands. */
function bandsOf(
  analyser: AnalyserNode,
  bins: Uint8Array<ArrayBuffer>,
  out: number[],
) {
  analyser.getByteFrequencyData(bins);
  for (let k = 0; k < SPECTRUM_BANDS; k++) {
    let sum = 0;
    const from = BAND_EDGES[k];
    const to = Math.min(BAND_EDGES[k + 1], bins.length);
    for (let i = from; i < to; i++) sum += bins[i];
    const mean = to > from ? sum / (to - from) / 255 : 0;
    out[k] = Math.min(1, mean * BAND_GAIN[k]);
  }
  return out;
}

/**
 * WebRTC: `listen` observes the remote MediaStream via createMediaStreamSource
 * (createMediaElementSource would divert the element's output, and Chrome
 * feeds it silence for a remote stream). WebSocket: `speaker` puts the
 * analyser on the output since we play the PCM ourselves. `hear` puts the
 * microphone on a separate analyser so the two spectra do not add up.
 */
export function createAudioTap(): RealtimeAudio & {
  open(): { context: AudioContext; analyser: AnalyserNode };
  read(): number[];
  readMic(): number[];
} {
  // Owned here so it can be routed through the graph.
  const audio = new Audio();
  audio.autoplay = true;
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let bins = new Uint8Array(0);
  // The tap outlives a call; a second call brings a second stream.
  let heard: MediaStreamAudioSourceNode | null = null;
  const out = new Array<number>(SPECTRUM_BANDS).fill(0);

  // Separate analyser for the microphone.
  let mic: AnalyserNode | null = null;
  let micBins = new Uint8Array(0);
  let heardMic: MediaStreamAudioSourceNode | null = null;
  const micOut = new Array<number>(SPECTRUM_BANDS).fill(0);

  /** Call inside a user gesture; an AudioContext starts suspended. */
  function open() {
    if (context && analyser) return { context, analyser };

    const created = new AudioContext();
    const node = created.createAnalyser();
    node.fftSize = 512;
    node.smoothingTimeConstant = 0.55;
    bins = new Uint8Array(node.frequencyBinCount);
    // Refused without a user gesture; the caller recovers from that.
    void created.resume().catch(() => {});

    context = created;
    analyser = node;
    return { context: created, analyser: node };
  }

  return {
    /** The element the WebRTC transport plays into. */
    element: audio,

    open,

    /** Watch a stream something else is already playing. */
    listen(stream: MediaStream) {
      if (heard?.mediaStream === stream) return;
      // Drop the previous call's dead stream so sources do not pile up.
      heard?.disconnect();
      const graph = open();
      heard = graph.context.createMediaStreamSource(stream);
      heard.connect(graph.analyser);
      void graph.context.resume();
    },

    /** Output path for audio we decode ourselves. */
    speaker() {
      const graph = open();
      graph.analyser.connect(graph.context.destination);
      return graph;
    },

    /** Watch the microphone; the analyser needs no downstream output. */
    hear(stream: MediaStream) {
      if (heardMic?.mediaStream === stream) return;
      heardMic?.disconnect();
      const graph = open();
      if (!mic) {
        mic = graph.context.createAnalyser();
        mic.fftSize = 512;
        mic.smoothingTimeConstant = 0.6;
        micBins = new Uint8Array(mic.frequencyBinCount);
      }
      heardMic = graph.context.createMediaStreamSource(stream);
      heardMic.connect(mic);
      void graph.context.resume();
    },

    read(): number[] {
      if (!analyser) return EMPTY_BANDS;
      return bandsOf(analyser, bins, out);
    },

    readMic(): number[] {
      if (!mic) return EMPTY_BANDS;
      return bandsOf(mic, micBins, micOut);
    },
  };
}
