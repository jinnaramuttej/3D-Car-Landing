'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type PerspectiveCamera, Vector2, Vector3 } from 'three';
import { easing } from 'maath';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState, forwardOf, getAnchorFrame, leftOf, shakeAmount, type Frame } from '@/lib/motion';
import { pointer, trackPointer } from '@/lib/pointer';
import { type CameraTarget, sectionCameraTarget, sectionState } from '@/lib/sectionRuntime';
import { SECTIONS } from '@/lib/sections';
import { type Ease, SHOTS, type Shot, shotIndexAt } from '@/lib/script';

const { clamp, degToRad, lerp, smootherstep } = MathUtils;

const DEFAULT_NEAR_FADE: readonly [number, number] = [0.35, 2];

/**
 * What the rest of the scene needs to know about the current shot. Written every
 * frame by CameraRig: Effects reads focus/dof/shake, Smoke reads nearFade.
 */
export const cameraState = {
  shot: 0,
  shotId: SHOTS[0].id,
  shake: 0,
  focus: new Vector3(),
  dof: 0,
  focusRange: 3,
  nearFade: [...DEFAULT_NEAR_FADE] as [number, number],
};

const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => t * t * (3 - 2 * t),
};

/** pos.xyz, look.xyz, fov */
type Flat = [number, number, number, number, number, number, number];
const flatten = (k: Shot['keys'][number]): Flat => [...k.pos, ...k.look, k.fov] as Flat;

/** Cubic Hermite through the shot's keys (Catmull-Rom tangents), so multi-key moves don't stop at keys. */
function sampleKeys(shot: Shot, t: number, out: Flat) {
  const keys = shot.keys;
  const n = keys.length;
  if (n === 1) {
    out.splice(0, 7, ...flatten(keys[0]));
    return out;
  }
  const times = keys.map((k, i) => k.t ?? i / (n - 1));
  let i = 0;
  while (i < n - 2 && t > times[i + 1]) i++;
  const i0 = Math.max(0, i - 1);
  const i2 = i + 1;
  const i3 = Math.min(n - 1, i + 2);
  const span = times[i2] - times[i];
  const u = clamp((t - times[i]) / span, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const k0 = flatten(keys[i0]);
  const k1 = flatten(keys[i]);
  const k2 = flatten(keys[i2]);
  const k3 = flatten(keys[i3]);
  for (let c = 0; c < 7; c++) {
    const m1 = i0 === i ? (k2[c] - k1[c]) / span : (k2[c] - k0[c]) / (times[i2] - times[i0]);
    const m2 = i3 === i2 ? (k2[c] - k1[c]) / span : (k3[c] - k1[c]) / (times[i3] - times[i]);
    out[c] = h00 * k1[c] + h10 * span * m1 + h01 * k2[c] + h11 * span * m2;
  }
  return out;
}

const _f = new Vector3();
const _l = new Vector3();
const carFrame: Frame = { origin: new Vector3(), heading: 0 };

function frameOf(kind: Shot['frame']): Frame {
  if (kind === 'anchor') return getAnchorFrame();
  carFrame.origin.copy(carState.position);
  carFrame.heading = kind === 'body' ? carState.heading : carState.pathHeading;
  return carFrame;
}

/** Frame-local (x left, y up, z forward) to world. */
function toWorld(frame: Frame, x: number, y: number, z: number, out: Vector3) {
  forwardOf(frame.heading, _f);
  leftOf(frame.heading, _l);
  return out.copy(frame.origin).addScaledVector(_l, x).addScaledVector(_f, z).setY(frame.origin.y + y);
}

type Pose = { pos: Vector3; look: Vector3; fov: number };
const flat: Flat = [0, 0, 0, 0, 0, 0, 0];

function evalShot(shot: Shot, p: number, out: Pose) {
  const raw = clamp((p - shot.from) / Math.max(1e-6, shot.to - shot.from), 0, 1);
  sampleKeys(shot, EASE[shot.ease ?? 'inOut'](raw), flat);
  const frame = frameOf(shot.frame);
  toWorld(frame, flat[0], flat[1], flat[2], out.pos);
  toWorld(frame, flat[3], flat[4], flat[5], out.look);
  out.fov = flat[6];
  return out;
}

type SectionRig = {
  init: boolean;
  pos: Vector3;
  look: Vector3;
  fov: number;
  parallax: Vector2;
  target: CameraTarget;
};

const _dir = new Vector3();

/**
 * Sections camera: the target comes from sections.ts (waypoints interpolated around the
 * parked car), then maath damps position, look target and FOV so moves between
 * sections ease instead of snapping. Mouse parallax on top (desktop only).
 */
function runSectionCamera(cam: PerspectiveCamera, dt: number, rig: SectionRig, mobile: boolean) {
  const c = CONFIG.camera;
  const t = sectionCameraTarget(mobile, rig.target);

  if (!rig.init) {
    // Pick up exactly where the drift scene's camera left off
    rig.pos.copy(cam.position);
    rig.look.copy(cam.position).add(cam.getWorldDirection(_dir).multiplyScalar(10));
    rig.fov = cam.fov;
    rig.init = true;
  }
  easing.damp3(rig.pos, t.pos, c.sectionSmooth, dt);
  easing.damp3(rig.look, t.look, c.sectionSmooth * 0.8, dt);
  easing.damp(rig, 'fov', t.fov, c.sectionSmooth, dt);

  cam.position.copy(rig.pos);
  if (cam.aspect < 1) {
    const k = Math.min(2.2, Math.pow(1 / cam.aspect, c.portraitFit));
    cam.position.sub(rig.look).multiplyScalar(k).add(rig.look);
  }
  cam.position.y = Math.max(cam.position.y, 0.15);
  cam.lookAt(rig.look);

  if (!mobile) {
    easing.damp2(rig.parallax, [pointer.x, pointer.y], 0.35, dt);
    cam.translateX(rig.parallax.x * c.parallax);
    cam.translateY(rig.parallax.y * c.parallax * 0.5);
    cam.rotateY(-rig.parallax.x * c.parallax * 0.02);
  }

  const fov = rig.fov * c.fovScale;
  if (Math.abs(cam.fov - fov) > 1e-3) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  cameraState.shot = -1;
  cameraState.shotId = `section:${SECTIONS[Math.max(0, sectionState.index)].id}`;
  cameraState.shake = 0;
  cameraState.focus.copy(t.focus);
  cameraState.dof = t.dof * c.dofScale;
  cameraState.focusRange = t.focusRange;
  cameraState.nearFade[0] = DEFAULT_NEAR_FADE[0];
  cameraState.nearFade[1] = DEFAULT_NEAR_FADE[1];
}

/**
 * Plays the shot script (src/lib/script.ts) against the damped scroll progress.
 * Cuts are instant because nothing here is damped: smoothness comes from the damped
 * progress and from the car itself, so a cut lands on exactly one frame.
 */
export function CameraRig() {
  const pose = useMemo(
    () => ({
      cur: { pos: new Vector3(), look: new Vector3(), fov: 40 } as Pose,
      prev: { pos: new Vector3(), look: new Vector3(), fov: 40 } as Pose,
    }),
    [],
  );
  const mobile = useMemo(() => isMobile(), []);
  const sec = useMemo(
    () => ({
      init: false,
      pos: new Vector3(),
      look: new Vector3(),
      fov: 40,
      parallax: new Vector2(),
      target: { pos: new Vector3(), look: new Vector3(), focus: new Vector3(), fov: 40, dof: 0, focusRange: 3 } as CameraTarget,
    }),
    [],
  );

  useEffect(() => trackPointer(), []);

  useFrame((state, rawDt) => {
    const cam = state.camera as PerspectiveCamera;
    const c = CONFIG.camera;

    // After the drift: damp toward the current section's waypoint (sections.ts)
    if (sectionState.active) {
      runSectionCamera(cam, Math.min(rawDt, 1 / 20), sec, mobile);
      return;
    }
    sec.init = false;

    const p = carState.progress;
    const i = shotIndexAt(p);
    const shot = SHOTS[i];
    const { cur, prev } = pose;

    evalShot(shot, p, cur);
    let dof = shot.dof ?? 0;
    let focusRange = shot.focusRange ?? 3;

    // Blend-in shots ease over from wherever the previous shot ends up
    if (shot.enter === 'blend' && i > 0 && shot.blend) {
      const b = (p - shot.from) / shot.blend;
      if (b < 1) {
        const before = SHOTS[i - 1];
        evalShot(before, p, prev);
        const w = smootherstep(b, 0, 1);
        cur.pos.lerpVectors(prev.pos, cur.pos, w);
        cur.look.lerpVectors(prev.look, cur.look, w);
        cur.fov = lerp(prev.fov, cur.fov, w);
        dof = lerp(before.dof ?? 0, dof, w);
        focusRange = lerp(before.focusRange ?? 3, focusRange, w);
      }
    }

    // Portrait screens see far less sideways: back off from the subject
    if (cam.aspect < 1) {
      const k = Math.min(2.2, Math.pow(1 / cam.aspect, c.portraitFit));
      cur.pos.sub(cur.look).multiplyScalar(k).add(cur.look);
    }
    cur.pos.y = Math.max(cur.pos.y, 0.15);

    cam.position.copy(cur.pos);
    cam.lookAt(cur.look);

    const t = state.clock.elapsedTime;

    // Slow hand-held float
    const hh = (shot.handheld ?? 0) * c.handheld;
    if (hh > 0) {
      cam.translateX((Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.31 + 1) * 0.4) * hh);
      cam.translateY((Math.sin(t * 0.9 + 2) * 0.6 + Math.sin(t * 1.73) * 0.4) * hh * 0.7);
      cam.rotateZ(Math.sin(t * 0.43) * hh * 0.25);
    }

    // Drift shake: bell around camera.shakeAt, scaled by slip and by the shot
    const amp = shakeAmount(p, carState.slip) * (shot.shake ?? 0);
    if (amp > 1e-5) {
      const ts = t * c.shakeSpeed;
      const sx = Math.sin(ts * 23.1) * 0.5 + Math.sin(ts * 37.7 + 1.3) * 0.3 + Math.sin(ts * 61.3 + 2.1) * 0.2;
      const sy = Math.sin(ts * 19.7 + 0.7) * 0.5 + Math.sin(ts * 41.9 + 2.6) * 0.3 + Math.sin(ts * 67.1) * 0.2;
      cam.translateX(sx * amp);
      cam.translateY(sy * amp);
      cam.rotateZ(degToRad(c.shakeRollDeg) * (amp / Math.max(1e-3, c.shakePeak)) * Math.sin(ts * 13.3));
    }

    const fov = cur.fov * c.fovScale;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    cameraState.shot = i;
    cameraState.shotId = shot.id;
    cameraState.shake = amp;
    cameraState.focus.copy(cur.look);
    cameraState.dof = dof * c.dofScale;
    cameraState.focusRange = focusRange;
    const nf = shot.nearFade ?? DEFAULT_NEAR_FADE;
    cameraState.nearFade[0] = nf[0];
    cameraState.nearFade[1] = nf[1];
  }, -1);

  return null;
}
