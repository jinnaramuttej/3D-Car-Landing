import { MathUtils } from 'three';

/**
 * The cold open, the three seconds after the loader (ColdOpen.tsx draws the black, Car.tsx
 * the lights, engineAudio the sound):
 *
 *   0.0  black
 *   0.8  the engine wakes: tail lights up, an exhaust pop, a jolt (and the starter, if the
 *        sound is on)
 *   1.2  the headlights flicker on as the black lifts (gone by 2.0)
 *   2.2  the title and the controls come in
 *   3.0  done: the lights ease back to the parked car's (the real ignition is chapter II)
 */
export const COLD = { wake: 0.8, lights: 1.2, lift: 2.0, title: 2.2, end: 3.0, settle: 1.6 };

export const coldOpen = {
  /** Seconds since it started; -1 before, and stays past the end once over. */
  t: -1,
  /** The engine-wake moment fired (the pop and the jolt, once). */
  woke: false,
};

export function startColdOpen() {
  coldOpen.t = 0;
  coldOpen.woke = false;
}

export function stepColdOpen(dt: number) {
  if (coldOpen.t < 0 || coldOpen.t > COLD.end + COLD.settle) return;
  coldOpen.t += dt;
}

/** True from the start until the lights have settled back. */
export const coldOpenRunning = () => coldOpen.t >= 0 && coldOpen.t <= COLD.end + COLD.settle;

/** The headlights the cold open asks for (0..1), or -1 when it has nothing to say. */
export function coldHeadlights() {
  const t = coldOpen.t;
  if (t < 0 || t > COLD.end + COLD.settle) return -1;
  if (t < COLD.lights) return 0;
  // a cold start: a few uneven flickers, then steady
  if (t < COLD.lights + 0.45) return Math.sin(t * 61) + Math.sin(t * 23.3) > -0.2 ? 1 : 0.15;
  if (t < COLD.end) return 1;
  return 1 - MathUtils.smootherstep(t, COLD.end, COLD.end + COLD.settle);
}

/** The tail lights the cold open asks for (0..1), or -1. */
export function coldTailLights() {
  const t = coldOpen.t;
  if (t < 0 || t > COLD.end + COLD.settle) return -1;
  if (t < COLD.end) return MathUtils.smoothstep(t, COLD.wake, COLD.wake + 0.25);
  return 1 - MathUtils.smootherstep(t, COLD.end, COLD.end + COLD.settle);
}
