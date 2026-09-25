import { SPECTRUM_BANDS } from "@/lib/live/live.tap";

/**
 * A voice nobody hears: the bands her face moves to while her words are drawn rather than
 * spoken — the first run's silent loop, an answer arriving on a call in writing. Slow sines,
 * a little apart per band, in the range a quiet voice fills.
 */
export function silentVoice(): number[] {
  const t = performance.now() / 1000;
  return Array.from(
    { length: SPECTRUM_BANDS },
    (_, band) => 0.18 + 0.16 * Math.sin(t * (5 + band * 0.9) + band * 1.7) ** 2,
  );
}
