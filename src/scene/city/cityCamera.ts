import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { easing } from 'maath';
import { chapterById, stageSwitchAt } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { HOLD, nearestStop } from '@/lib/cityDrive';
import { STOPS } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { carState, forwardOf, leftOf } from '@/lib/motion';
import { stopAnchor } from '@/lib/stops';

const { clamp, degToRad, lerp, smoothstep } = MathUtils;

export type CityRig = { init: boolean; pos: Vector3; look: Vector3; fov: number };
export const cityRig = (): CityRig => ({ init: false, pos: new Vector3(), look: new Vector3(), fov: 34 });

export type CityShot = { pos: Vector3; look: Vector3; fov: number; focus: Vector3; dof: number; focusRange: number; id: string };

const _f = new Vector3();
const _l = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

/** Car path frame (x left, y up, z forward) to world. */
function carLocal(x: number, y: number, z: number, out: Vector3) {
  forwardOf(carState.pathHeading, _f);
  leftOf(carState.pathHeading, _l);
  return out.copy(carState.position).addScaledVector(_l, x).addScaledVector(_f, z).setY(carState.position.y + y);
}

/**
 * The basic city camera: a chase camera on the drive, a framed shot of the billboard and
 * the car at each stop, and the descent out of the cloud at the start. Writes the shot
 * (world pose, focus, depth of field) into `out`.
 */
export function cityShot(out: CityShot) {
  const s = carState.s;
  const stop = nearestStop(s);
  const spec = STOPS[stop];
  // how much of the stop framing: up through the hold, down as the car leaves
  const hold = 1 - smoothstep(Math.abs(s - spec.s), 14, 46);

  // chase
  carLocal(0, 2.3, -8.6, out.pos);
  carLocal(0, 1.1, 7, out.look);
  out.fov = 34;
  out.focus.copy(carState.position).setY(carState.position.y + 0.7);
  out.dof = 0.6;
  out.focusRange = 5;
  out.id = 'chase';

  if (hold > 0.001) {
    const a = stopAnchor(stop);
    // across the road from the billboard, a little behind the car, low
    forwardOf(carState.pathHeading, _f);
    leftOf(carState.pathHeading, _l);
    _a.copy(carState.position)
      .addScaledVector(_l, -spec.side * 5.5)
      .addScaledVector(_f, -9)
      .setY(carState.position.y + 1.5);
    _b.copy(carState.position).setY(carState.position.y + 1).lerp(a.centre, 0.42);
    out.pos.lerp(_a, hold);
    out.look.lerp(_b, hold);
    out.fov = lerp(out.fov, 32, hold);
    out.focus.lerp(a.centre, hold);
    out.dof = lerp(out.dof, 2.4, hold);
    out.focusRange = lerp(out.focusRange, 9, hold);
    if (hold > 0.5) out.id = `stop:${stop}`;
  }

  // out of the cloud: start high above and come down onto the chase
  const arrival = chapterById('arrival');
  const p = chapterState.progress;
  const down = 1 - smoothstep(p, stageSwitchAt(), arrival.start + HOLD.arrive * (arrival.end - arrival.start));
  if (down > 0) {
    const k = down * down;
    out.pos.y += 46 * k;
    carLocal(0, 0, -26 * k, _a);
    out.pos.x += (_a.x - carState.position.x) * 1;
    out.pos.z += (_a.z - carState.position.z) * 1;
    out.look.y += 8 * k;
    out.id = 'descent';
  }
  return out;
}

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

/** Damps the rig toward the shot (snaps on the first frame and on a jump). */
export function applyCityShot(cam: PerspectiveCamera, rig: CityRig, shot: CityShot, dt: number) {
  const fov = fitLens(shot.pos, shot.look, shot.fov * CONFIG.camera.fovScale);
  if (!rig.init || chapterState.jumped || chapterState.stageChanged) {
    rig.pos.copy(shot.pos);
    rig.look.copy(shot.look);
    rig.fov = fov;
    rig.init = true;
  } else {
    easing.damp3(rig.pos, shot.pos, 0.22, dt);
    easing.damp3(rig.look, shot.look, 0.16, dt);
    easing.damp(rig, 'fov', fov, 0.3, dt);
  }
  cam.position.copy(rig.pos);
  if (cam.aspect < 1) {
    const k = Math.min(2.2, Math.pow(1 / cam.aspect, CONFIG.camera.portraitFit));
    cam.position.sub(rig.look).multiplyScalar(k).add(rig.look);
  }
  cam.position.y = Math.max(cam.position.y, carState.position.y + 0.15);
  cam.lookAt(rig.look);
  if (Math.abs(cam.fov - rig.fov) > 1e-3) {
    cam.fov = rig.fov;
    cam.updateProjectionMatrix();
  }
}
