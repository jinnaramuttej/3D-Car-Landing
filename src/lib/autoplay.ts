import { journeySeconds, progressAtTime as atTime, timeAtProgress as toTime } from './pacing';

/**
 * THE PLAY BUTTON
 * ===============
 * Autoplay drives the scroll itself (src/lib/useScrollTimeline.ts moves Lenis), so the
 * page behaves exactly as if someone were scrolling: every title card, billboard and panel
 * comes and goes on its own cue, and the moment the visitor scrolls (wheel, touch, keys,
 * the scrollbar, the mini-map) they have the wheel back, with the journey driver smoothing
 * the handover.
 *
 * The scroll is the journey's time axis (src/lib/pacing.ts), so Play just runs that time
 * at real time: the car drives exactly the speed curve it was planned to, fast on the runs
 * and slow through the stops, and an even scroll by hand gives the same drive.
 */

/** Total autoplay length in seconds (the planned journey). */
export const autoplayLength = () => journeySeconds();

/** Seconds into the autoplay -> journey progress. */
export const progressAtTime = (t: number) => atTime(t);

/** Journey progress -> seconds into the autoplay (to resume from wherever the page is). */
export const timeAtProgress = (p: number) => toTime(p);
