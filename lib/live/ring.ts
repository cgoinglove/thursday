/**
 * The sound of a call she places: played once, as the ring starts. The face keeps
 * ringing on screen until the call is answered or rings out; a sound on every one of
 * those rings grates. It is Android's NFCInitiated (public/sounds/NOTICE).
 *
 * A browser plays nothing before the page has been clicked or typed in; until then
 * the ring is silent and the screen alone says she is calling.
 */
const RING_SOUND = "/sounds/ring.ogg";

/** One ring of the face, start to start (thursday.tsx). */
export const RING_CYCLE_MS = 2_600;

/** Rings once; the returned function cuts it short. */
export function ringOnce() {
  const audio = new Audio(RING_SOUND);
  void audio.play().catch(() => {});
  return () => audio.pause();
}
