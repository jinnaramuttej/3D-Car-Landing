import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { CONFIG } from '@/lib/config';
import { shakeNoise } from '@/lib/feel';
import { carState } from '@/lib/motion';

const { clamp, degToRad, radToDeg } = MathUtils;

/**
 * How much of the canvas height shows: cinematic mode's 2.39:1 bars cover the rest (set by
 * CameraRig). The lens widens to match, so the strip between the bars holds the shot the
 * director framed, at the vertical angle it asked for.
 */
export const lens = { visible: 1 };

/** One frame of the camera, as the director (director.ts) asks for it. World space. */
export type CityShot = {
  pos: Vector3;
  look: Vector3;
  fov: number;
  focus: Vector3;
  dof: number;
  focusRange: number;
  /** Slow hand-held float, 0..1 (CONFIG.camera.handheld metres at 1). */
  handheld: number;
  /** Smoke puffs fade between these camera distances. */
  nearFade: [number, number];
  id: string;
  /** Shake amount, 0..1 (trauma squared times the rig's own), CONFIG.feel.shakeMax at 1. */
  shake: number;
};

export const cityShotState = (): CityShot => ({
  pos: new Vector3(),
  look: new Vector3(),
  fov: 34,
  focus: new Vector3(),
  dof: 0,
  focusRange: 4,
  handheld: 0,
  nearFade: [0.35, 2],
  id: '',
  shake: 0,
});

/**
 * Long-lens rule: the FOV stays inside [camera.fovMin, fovMax]; a wider ask pulls the
 * camera back along its line of sight instead (by tan(asked/2) / tan(clamped/2), so the
 * subject keeps its size in frame).
 */
export function fitLens(pos: Vector3, look: Vector3, fov: number) {
  const c = CONFIG.camera;
  const clamped = clamp(fov, c.fovMin, c.fovMax);
  if (clamped !== fov) {
    const k = Math.tan(degToRad(fov) / 2) / Math.tan(degToRad(clamped) / 2);
    pos.sub(look).multiplyScalar(k).add(look);
  }
  return clamped;
}

/** Puts the camera on the shot (the director has already blended and smoothed it). */
export function applyCityShot(cam: PerspectiveCamera, shot: CityShot, t: number) {
  const c = CONFIG.camera;
  const fov = fitLens(shot.pos, shot.look, shot.fov * c.fovScale);
  cam.position.copy(shot.pos);
  if (cam.aspect < 1) {
    const k = Math.min(2.2, Math.pow(1 / cam.aspect, c.portraitFit));
    cam.position.sub(shot.look).multiplyScalar(k).add(shot.look);
  }
  cam.position.y = Math.max(cam.position.y, carState.position.y + 0.15);
  cam.lookAt(shot.look);
  // slow hand-held float
  const hh = shot.handheld * c.handheld;
  if (hh > 0) {
    cam.translateX((Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.31 + 1) * 0.4) * hh);
    cam.translateY((Math.sin(t * 0.9 + 2) * 0.6 + Math.sin(t * 1.73) * 0.4) * hh * 0.7);
    cam.rotateZ(Math.sin(t * 0.43) * hh * 0.25);
  }
  // trauma shake (src/lib/feel.ts): shake = trauma squared, through layered simplex noise
  if (shot.shake > 1e-4) {
    const f = CONFIG.feel;
    const a = shot.shake;
    const ts = t * f.shakeHz;
    cam.translateX(shakeNoise(ts, 0) * a * f.shakeMax);
    cam.translateY(shakeNoise(ts, 1) * a * f.shakeMax * 0.7);
    cam.rotateZ(degToRad(f.shakeRollDeg) * a * shakeNoise(ts, 2));
  }
  const full = lens.visible < 0.999 ? radToDeg(2 * Math.atan(Math.tan(degToRad(fov) / 2) / lens.visible)) : fov;
  if (Math.abs(cam.fov - full) > 1e-3) {
    cam.fov = full;
    cam.updateProjectionMatrix();
  }
}
