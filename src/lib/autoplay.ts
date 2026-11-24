import { CHAPTERS, type ChapterId } from './chapters';
import { CONFIG } from './config';

/**
 * THE PLAY BUTTON
 * ===============
 * Autoplay drives the scroll itself (src/lib/useScrollTimeline.ts moves Lenis), so the
 * page behaves exactly as if someone were scrolling at a steady cinematic pace: every
 * title card, billboard and panel comes and goes on its own cue, and the moment the
 * visitor scrolls (wheel, touch, keys, the scrollbar, the mini-map) they have the wheel
 * back, with the journey driver smoothing the handover.
 *
 * The pace is set per chapter (seconds at the default 150 s total, scaled to
 * CONFIG.autoplay.seconds): the drives are brisk, the stops long enough to read.
 */
const SECONDS: Record<ChapterId, number> = {
  stillness: 7,
  ignition: 8,
  turn: 10,
  wake: 9,
  arrival: 10,
  robowars: 13,
  competitions: 15,
  speakers: 13,
  expo: 13,
  dkms: 13,
  twmun: 12,
  finale: 27,
};
const BASE = Object.values(SECONDS).reduce((a, b) => a + b, 0);

const scale = () => CONFIG.autoplay.seconds / BASE;

/** Total autoplay length in seconds. */
export const autoplayLength = () => BASE * scale();

/** Seconds into the autoplay -> journey progress (linear inside each chapter). */
export function progressAtTime(t: number) {
  const k = scale();
  let at = 0;
  for (const c of CHAPTERS) {
    const d = SECONDS[c.id] * k;
    if (t <= at + d) return c.start + ((t - at) / d) * (c.end - c.start);
    at += d;
  }
  return 1;
}

/** Journey progress -> seconds into the autoplay (to resume from wherever the page is). */
export function timeAtProgress(p: number) {
  const k = scale();
  let at = 0;
  for (const c of CHAPTERS) {
    const d = SECONDS[c.id] * k;
    if (p <= c.end) return at + ((p - c.start) / (c.end - c.start)) * d;
    at += d;
  }
  return at;
}
