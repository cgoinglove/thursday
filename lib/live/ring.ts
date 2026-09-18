/**
 * The sound of a call she places: made here rather than played from a file, so it
 * ships no recording and carries no licence. Two soft bursts, a pause, again — the
 * cadence of a phone, quiet enough for a room with other people in it.
 *
 * A browser plays nothing before the page has been clicked or typed in; until then
 * the ring is silent and the screen alone says she is calling.
 */
const TONES = [620, 775];
/** Seconds: a burst, the gap inside a pair, and one whole cycle. */
const BURST = 0.34;
const GAP = 0.16;
const CYCLE = 2.6;
const LEVEL = 0.05;

export function createRing() {
  let context: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const burst = (audio: AudioContext, at: number) => {
    const gain = audio.createGain();
    // Eased in and out: a tone switched on at full level clicks
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(LEVEL, at + 0.03);
    gain.gain.setValueAtTime(LEVEL, at + BURST - 0.08);
    gain.gain.linearRampToValueAtTime(0, at + BURST);
    gain.connect(audio.destination);
    for (const frequency of TONES) {
      const tone = audio.createOscillator();
      tone.type = "sine";
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(at);
      tone.stop(at + BURST);
    }
  };
  const pair = () => {
    if (!context || context.state !== "running") return;
    const at = context.currentTime + 0.02;
    burst(context, at);
    burst(context, at + BURST + GAP);
  };

  return {
    start() {
      if (timer || typeof AudioContext === "undefined") return;
      context ??= new AudioContext();
      void context
        .resume()
        .then(pair)
        .catch(() => {});
      timer = setInterval(pair, CYCLE * 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      void context?.close().catch(() => {});
      context = null;
    },
  };
}
