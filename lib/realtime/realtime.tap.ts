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

/** What a face moves with on one frame (createVoiceFollower). */
export type VoiceFrame = {
  /** How far into its own range the voice is now, 0..1; 0 in silence. */
  level: number;
  /** `level` over about half a second: the phrase rather than the syllable. */
  phrase: number;
  /** Strength of a syllable that started on this frame; 0 when none did. */
  onset: number;
  /** Each band inside its own range, low to high; one the voice never reaches stays 0. */
  bands: number[];
};

/** Seconds, except where a line says otherwise. */
const FOLLOW = {
  /** A band's ceiling jumps to a new peak and sinks back over `ceilRelease`. */
  ceilAttack: 0.03,
  ceilRelease: 2.5,
  /** Its floor drops to the quiet between syllables and creeps back up over `floorRise`. */
  floorFall: 0.12,
  floorRise: 3,
  /** A band whose range is narrower than this (0..1) carries no shape. */
  minSpan: 0.12,
  /** Mean band level (0..1) across which silence turns into voice. */
  quietBelow: 0.03,
  voicedAbove: 0.12,
  fast: 0.05,
  mid: 0.22,
  phrase: 0.45,
  /** A syllable: the fast level rises this far over the mid one, past `onsetMin`, at most once per `onsetGap`. */
  onsetRise: 0.1,
  onsetMin: 0.3,
  onsetGap: 0.12,
};

/**
 * Reads the voice's bands the way a face needs them. A voice is loud and narrow:
 * its bands sit near the top and lean the same way for a whole sentence, so a
 * face driven by them directly stays swollen and still. Here each band is
 * followed inside its own recent range — the quiet between syllables is its
 * floor, the syllables its ceiling — so the face moves with the words whatever
 * the voice or its volume. One per face; it keeps state between frames.
 */
export function createVoiceFollower() {
  const ceil = new Array<number>(SPECTRUM_BANDS).fill(0);
  const floor = new Array<number>(SPECTRUM_BANDS).fill(0);
  const frame: VoiceFrame = {
    level: 0,
    phrase: 0,
    onset: 0,
    bands: new Array<number>(SPECTRUM_BANDS).fill(0),
  };
  let fast = 0;
  let mid = 0;
  let sinceOnset = Number.POSITIVE_INFINITY;

  const toward = (from: number, to: number, seconds: number, dt: number) =>
    from + (to - from) * Math.min(1, dt / seconds);

  return {
    /** Call once per frame with the seconds since the last call. The frame returned is reused. */
    read(input: ArrayLike<number>, dt: number): VoiceFrame {
      let total = 0;
      let within = 0;
      let ranged = 0;
      for (let k = 0; k < SPECTRUM_BANDS; k++) {
        const x = input[k] ?? 0;
        total += x;
        ceil[k] = toward(
          ceil[k],
          x,
          x > ceil[k] ? FOLLOW.ceilAttack : FOLLOW.ceilRelease,
          dt,
        );
        floor[k] = toward(
          floor[k],
          x,
          x < floor[k] ? FOLLOW.floorFall : FOLLOW.floorRise,
          dt,
        );
        const span = ceil[k] - floor[k];
        const at =
          span > FOLLOW.minSpan
            ? Math.min(1, Math.max(0, (x - floor[k]) / span))
            : 0;
        frame.bands[k] = at;
        if (span > FOLLOW.minSpan) {
          within += at;
          ranged++;
        }
      }

      const mean = total / SPECTRUM_BANDS;
      const edge = Math.min(
        1,
        Math.max(
          0,
          (mean - FOLLOW.quietBelow) / (FOLLOW.voicedAbove - FOLLOW.quietBelow),
        ),
      );
      const voiced = edge * edge * (3 - 2 * edge);
      for (let k = 0; k < SPECTRUM_BANDS; k++) frame.bands[k] *= voiced;

      frame.level = (ranged ? within / ranged : 0) * voiced;
      fast = toward(fast, frame.level, FOLLOW.fast, dt);
      mid = toward(mid, frame.level, FOLLOW.mid, dt);
      frame.phrase = toward(frame.phrase, frame.level, FOLLOW.phrase, dt);

      sinceOnset += dt;
      frame.onset = 0;
      if (
        fast > mid + FOLLOW.onsetRise &&
        fast > FOLLOW.onsetMin &&
        sinceOnset > FOLLOW.onsetGap
      ) {
        sinceOnset = 0;
        frame.onset = Math.min(1, fast);
      }
      return frame;
    },
  };
}
