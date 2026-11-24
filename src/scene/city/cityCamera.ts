import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { easing } from 'maath';
import { chapterState } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { carState } from '@/lib/motion';

const { clamp, degToRad } = MathUtils;

export type CityRig = { init: boolean; pos: Vector3; look: Vector3; fov: number };
export const cityRig = (): CityRig => ({ init: false, pos: new Vector3(), look: new Vector3(), fov: 34 });

/** One frame of the city camera, as the director (director.ts) asks for it. */
export type CityShot = {
  pos: Vector3;
  look: Vector3;
  fov: number;
  focus: Vector3;
  dof: number;
  focusRange: number;
  id: string;
  /** Seconds of damping toward this pose (0 = bolted to the car). */
  damp: number;
  /** A hard cut this frame: the rig snaps. */
  cut: boolean;
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
  id: '',
  damp: 0.2,
  cut: false,
  shake: 0,
});

/**
 * Long-lens rule (as on the waterfront): the FOV stays inside [camera.fovMin, fovMax]; a
 * wider ask pulls the camera back along its line of sight instead.
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

/** Puts the camera on the shot: snaps on a cut (or a jump), otherwise damps by the shot's own amount. */
export function applyCityShot(cam: PerspectiveCamera, rig: CityRig, shot: CityShot, dt: number, t: number) {
  const fov = fitLens(shot.pos, shot.look, shot.fov * CONFIG.camera.fovScale);
  const snap = !rig.init || shot.cut || chapterState.jumped || chapterState.stageChanged;
  if (snap || shot.damp <= 0) {
    rig.pos.copy(shot.pos);
    rig.look.copy(shot.look);
    if (snap) rig.fov = fov;
    rig.init = true;
  } else {
    easing.damp3(rig.pos, shot.pos, shot.damp, dt);
    easing.damp3(rig.look, shot.look, shot.damp * 0.7, dt);
  }
  easing.damp(rig, 'fov', fov, 0.25, dt);
  cam.position.copy(rig.pos);
  if (cam.aspect < 1) {
    const k = Math.min(2.2, Math.pow(1 / cam.aspect, CONFIG.camera.portraitFit));
    cam.position.sub(rig.look).multiplyScalar(k).add(rig.look);
  }
  cam.position.y = Math.max(cam.position.y, carState.position.y + 0.15);
  cam.lookAt(rig.look);
  // acceleration and slides shake the lens (a few layered sines, no randomness)
  if (shot.shake > 1e-4) {
    const a = shot.shake;
    cam.translateX((Math.sin(t * 27.1) * 0.6 + Math.sin(t * 43.7 + 1.1) * 0.4) * a);
    cam.translateY((Math.sin(t * 31.3 + 2.2) * 0.6 + Math.sin(t * 57.9) * 0.4) * a * 0.7);
    cam.rotateZ(Math.sin(t * 19.3) * a * 0.12);
  }
  if (Math.abs(cam.fov - rig.fov) > 1e-3) {
    cam.fov = rig.fov;
    cam.updateProjectionMatrix();
  }
}
