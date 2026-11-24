import { Vector3 } from 'three';

/**
 * The car's shared state and the two little helpers the whole scene uses to turn a heading
 * into directions. Car-local convention (from the model): +Z forward, +X left, +Y up;
 * heading 0 faces +Z and positive headings turn left.
 */

/** Unit vector pointing to the left of heading ψ. */
export function leftOf(heading: number, out: Vector3) {
  return out.set(Math.cos(heading), 0, -Math.sin(heading));
}
export function forwardOf(heading: number, out: Vector3) {
  return out.set(Math.sin(heading), 0, Math.cos(heading));
}

/** A point and a heading (radians about +Y). */
export type Frame = { origin: Vector3; heading: number };

/**
 * Shared, mutable, never re-rendered. `stepCityDrive` (src/lib/cityDrive.ts, Scene at
 * priority -3) fills the kinematics; Car (priority -2) fills the world-space wheel contacts;
 * Smoke, SkidMarks and CameraRig (priority -1) read it.
 */
export const carState = {
  initialized: false,
  /** Route metres (src/lib/cityRoute.ts). */
  s: 0,
  position: new Vector3(),
  pathPoint: new Vector3(),
  pathHeading: 0,
  /** Body heading = pathHeading + driftYaw. */
  heading: 0,
  driftYaw: 0,
  /** The slide's body roll (radians); the ground's own tilt is groundRoll. */
  roll: 0,
  /** Nose up on a climb (radians), fitted to the road under the four wheels. */
  pitch: 0,
  /** Left side up (radians), fitted to the road under the four wheels. */
  groundRoll: 0,
  steer: 0,
  /** 0..1, |driftYaw| / slipRefDeg. Drives smoke, skids, shake, brake lights. */
  slip: 0,
  /** 0..1, tail-light flare: max of slip and braking. */
  brake: 0,
  /** Signed ground speed along the path, m/s (damped). */
  speed: 0,
  /** Damped change of speed, m/s^2 (the camera shakes and the brake lights flare on it). */
  accel: 0,
  frontSpin: 0,
  rearSpin: 0,
  frontSpinRate: 0,
  rearSpinRate: 0,
  frontRadius: 0.34,
  rearRadius: 0.35,
  forward: new Vector3(0, 0, 1),
  /** Unit vector toward the outside of the turn (where the tail swings). */
  outward: new Vector3(-1, 0, 0),
  /** Written by Car: rear tyre contact patches in world space [left, right]. */
  rearContacts: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  tailLight: new Vector3(),
  /** Written by Car: headlight positions, beam direction and brightness multiplier. */
  headPos: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  headDir: new Vector3(0, 0, 1),
  headLevel: 1,
  carReady: false,
};

export type CarState = typeof carState;
