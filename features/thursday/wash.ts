// Now and then part of her face is briefly made of something else. One file, because the whole
// feature is here — which sets she washes to, when it happens, and the test a renderer asks per
// cell — and it comes out again by deleting this and the lines in ascii-orb that call it.
//
// It is not a band crossing her and it is not a change of colour: the glyphs themselves change,
// in a patch that spreads. It starts at a few points, grows out of them behind a front made of
// noise, sits a while, and lets go in a different order than it came. Inside the reach only some
// cells are taken, fewer the further from where it started, so it reads as something spreading
// rather than as a shape being painted on.

import { fbm, ihash } from "./field";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * What she washes to. Four sets, and the one she uses changes every time. They carry almost no
 * colour, so a face that is otherwise every colour there is goes grey, or lunar, or wet, for a few
 * seconds.
 */
export const WASH_SETS = [
  ["🤍", "🖤", "⚪", "⚫", "☁️", "🦢", "🐧", "🐼", "🎱", "🕊️"],
  ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘", "🌙", "🌚"],
  ["❄️", "🫧", "💧", "🌊", "🧊", "🐳", "🐟", "🪸", "🌌", "🔮"],
  ["🗿", "💬", "🖨️", "📀", "🗝️", "🧷", "📎", "🖇️", "🧮", "🔭"],
] as const;

/**
 * Which set has taken this cell, 1-based, or 0 for none. `dx`/`dy` are from the face's centre in
 * reference units; `every` is about how often it happens and `hold` about how long one sits, both
 * in seconds — both are only about, since each wash draws its own timings.
 */
export function washAt(
  dx: number,
  dy: number,
  t: number,
  every: number,
  hold: number,
) {
  const slot = Math.floor(t / every);
  const start = slot * every + 0.6 + ihash(slot, 11, 5) * every * 0.45;
  // most sit a few seconds, and now and then one stays a long while
  const dur = hold * (0.6 + 3.4 * ihash(slot, 17, 9) ** 2);
  return washOnce(dx, dy, t, start, dur, slot);
}

/**
 * A slot, from `from` on, whose wash is one patch of moons or of water that grows quickly: the
 * wash that goes through her as she wakes on the first run, where a patch reads as passing
 * through her and more of them read as her turning into something else.
 */
export function wakingSlot(from: number) {
  let slot = from;
  for (let tries = 0; tries < 400; tries++, slot++) {
    const set = 1 + (slot % WASH_SETS.length);
    if (
      ihash(slot, 19, 7) < 0.25 &&
      (set === 2 || set === 3) &&
      ihash(slot, 3, 2) < 0.35
    )
      break;
  }
  return slot;
}

/** One wash, drawn from `slot`, that starts at `start` and sits `dur` seconds; the test is washAt's. */
export function washOnce(
  dx: number,
  dy: number,
  t: number,
  start: number,
  dur: number,
  slot: number,
) {
  const age = t - start;
  if (age < 0 || age > dur) return 0;
  const grow = smoothstep(0, 1.7 + ihash(slot, 3, 2) * 2.6, age);
  const back = smoothstep(dur - (1.5 + ihash(slot, 4, 3) * 2.8), dur, age);
  const seeds = 1 + ((ihash(slot, 19, 7) * 4) | 0);
  for (let k = 0; k < seeds; k++) {
    const sx = (ihash(slot * 7 + k, 23, 1) - 0.5) * 300;
    const sy = (ihash(slot * 7 + k, 29, 2) - 0.5) * 300;
    const ex = dx - sx;
    const ey = dy - sy;
    const d = Math.hypot(ex, ey);
    // the front is noise, so it does not go out as a circle
    const reach =
      grow * 470 * (0.4 + 1.1 * fbm(ex * 0.011 + slot, ey * 0.011, k * 3.3, 3));
    if (d >= reach) continue;
    // and it lets go patch by patch, in an order of its own
    if (back > fbm(ex * 0.016 - 4, ey * 0.016 + 6, k * 5.1 + 1, 2) * 0.85 + 0.1)
      continue;
    // never solid: thinner the further it has got from where it started
    const dens = 1 - d / Math.max(1, reach);
    if (fbm(dx * 0.05 + k, dy * 0.05, slot * 2.7, 2) > dens * 0.95 + 0.34)
      continue;
    return 1 + ((slot + k) % WASH_SETS.length);
  }
  return 0;
}
