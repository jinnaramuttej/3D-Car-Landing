import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { CONFIG } from '@/lib/config';
import { carState } from '@/lib/motion';

const { clamp, degToRad } = MathUtils;

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
  /** Metres of shake to add after the look. */
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
  // acceleration and slides shake the lens (a few layered sines, no randomness)
  if (shot.shake > 1e-4) {
    const a = shot.shake;
    const ts = t * c.shakeSpeed;
    cam.translateX((Math.sin(ts * 23.1) * 0.5 + Math.sin(ts * 37.7 + 1.3) * 0.3 + Math.sin(ts * 61.3 + 2.1) * 0.2) * a);
    cam.translateY((Math.sin(ts * 19.7 + 0.7) * 0.5 + Math.sin(ts * 41.9 + 2.6) * 0.3 + Math.sin(ts * 67.1) * 0.2) * a * 0.7);
    cam.rotateZ(degToRad(c.shakeRollDeg) * (a / Math.max(1e-3, c.shakePeak)) * Math.sin(ts * 13.3));
  }
  if (Math.abs(cam.fov - fov) > 1e-3) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
}
