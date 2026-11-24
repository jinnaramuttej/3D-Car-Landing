import type { Vector3 } from 'three';

/**
 * A line-of-sight test against the city model, for code that has no scene to hand (the
 * director placing a stop camera). City.tsx registers it once the model is in; until then
 * everything counts as in sight. It raycasts the whole city, so it is for one-off choices
 * (a few rays while a stop's place is worked out), never per frame.
 */
let test: ((from: Vector3, to: Vector3) => boolean) | null = null;

export function setSightTest(fn: ((from: Vector3, to: Vector3) => boolean) | null) {
  test = fn;
}

/** Nothing of the city between `from` and `to` (the last half metre at `to` is not tested). */
export function inSight(from: Vector3, to: Vector3) {
  return test ? test(from, to) : true;
}
