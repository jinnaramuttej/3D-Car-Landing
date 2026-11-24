'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type PerspectiveCamera, Vector2, Vector3 } from 'three';
import { easing } from 'maath';
import { BEATS, type FrameKind } from '@/lib/chapters';
import {
  type BeatTarget,
  chapterState,
  frameFor,
  frameToWorld,
  localPose,
  beatCameraTarget,
  worldToFrame,
} from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { interaction } from '@/lib/interaction';
import { carState, forwardOf, getAnchorFrame, leftOf, shakeAmount, type Frame } from '@/lib/motion';
import { pointer, trackPointer } from '@/lib/pointer';
import { type Ease, SHOTS, type Shot, shotIndexAt } from '@/lib/script';
import { applyCityShot, cityRig, cityShotState } from './city/cityCamera';
import { directShot } from './city/director';

const { clamp, degToRad, lerp, smootherstep } = MathUtils;

const DEFAULT_NEAR_FADE: readonly [number, number] = [0.35, 2];

/**
 * What the rest of the scene needs to know about the current shot. Written every
 * frame by CameraRig: Effects reads focus/dof/shake/mode, Smoke reads nearFade.
 */
export const cameraState = {
  /** 'drift' = the shot script (chapter III), 'beat' = chapter camera beats, 'city' = V on. */
  mode: 'beat' as 'drift' | 'beat' | 'city',
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

/**
 * Long-lens rule: vertical FOV stays inside [camera.fovMin, camera.fovMax]. If a shot
 * asks for wider, narrow it and pull the camera back along its line of sight by
 * tan(asked/2) / tan(clamped/2), so the subject keeps its size in frame.
 */
function fitLens(pos: Vector3, look: Vector3, fov: number) {
  const c = CONFIG.camera;
  const clamped = clamp(fov, c.fovMin, c.fovMax);
  if (clamped !== fov) {
    const k = Math.tan(degToRad(fov) / 2) / Math.tan(degToRad(clamped) / 2);
    pos.sub(look).multiplyScalar(k).add(look);
  }
  return clamped;
}

/** The drift camera for progress p (script pose + long-lens fit, before portrait fit). */
function driftPose(p: number, cur: Pose, prev: Pose) {
  const i = shotIndexAt(p);
  const shot = SHOTS[i];
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
  // Long lens only: clamp the FOV and back the camera off to keep the framing
  cur.fov = fitLens(cur.pos, cur.look, cur.fov * CONFIG.camera.fovScale);
  return { i, shot, dof, focusRange };
}

function portraitFit(cam: PerspectiveCamera, pos: Vector3, look: Vector3) {
  if (cam.aspect < 1) {
    const k = Math.min(2.2, Math.pow(1 / cam.aspect, CONFIG.camera.portraitFit));
    pos.sub(look).multiplyScalar(k).add(look);
  }
  pos.y = Math.max(pos.y, 0.15);
}

/** Mouse parallax and the rev shake, on top of either camera. */
function applyExtras(cam: PerspectiveCamera, parallax: Vector2, dt: number, t: number, amount: number, mobile: boolean) {
  const c = CONFIG.camera;
  if (!mobile) {
    easing.damp2(parallax, [pointer.x, pointer.y], 0.35, dt);
    const k = c.parallax * amount;
    cam.translateX(parallax.x * k);
    cam.translateY(parallax.y * k * 0.5);
    cam.rotateY(-parallax.x * k * 0.02);
  }
  const rev = interaction.rev * CONFIG.interaction.revShake;
  if (rev > 1e-5) {
    cam.translateX((Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.1 + 1) * 0.4) * rev);
    cam.translateY((Math.sin(t * 37.9 + 2) * 0.6 + Math.sin(t * 67.7) * 0.4) * rev);
    cam.rotateZ(Math.sin(t * 29.3) * rev * 0.15);
  }
  return rev;
}

type BeatRig = {
  init: boolean;
  frame: FrameKind;
  /** Damped pose in the beat's frame (so a camera riding with the car never lags it). */
  pos: Vector3;
  look: Vector3;
  fov: number;
  target: BeatTarget;
  world: { pos: Vector3; look: Vector3 };
};

const _dir = new Vector3();
const _w = new Vector3();
const _up = new Vector3(0, 1, 0);
const _right = new Vector3();

/**
 * Chapter camera: the beat's waypoints (src/lib/chapters.ts) give a target in the beat's
 * frame, maath damps toward it in that frame. The launch beat hands over to the drift's
 * first frame; a dissolve beat (or a mini-map jump) snaps and lets the frame dissolve.
 */
function runBeatCamera(cam: PerspectiveCamera, dt: number, rig: BeatRig, mobile: boolean, drift: Pose, prev: Pose) {
  const c = CONFIG.camera;
  const t = beatCameraTarget(mobile, rig.target);
  const pose = t.pose;
  // screen shift: slide the look target sideways (frame axes are right-handed like the world's)
  if (pose.shift) {
    _right.subVectors(pose.look, pose.pos).normalize().cross(_up).normalize();
    pose.look.addScaledVector(_right, -pose.shift);
  }
  pose.fov = fitLens(pose.pos, pose.look, pose.fov * c.fovScale);
  const frame = frameFor(t.frame);

  if (chapterState.cut) {
    rig.pos.copy(pose.pos);
    rig.look.copy(pose.look);
    rig.fov = pose.fov;
    rig.frame = t.frame;
    rig.init = true;
  } else if (!rig.init) {
    // pick up exactly where the drift camera left off
    worldToFrame(frame, cam.position, rig.pos);
    worldToFrame(frame, _w.copy(cam.position).add(cam.getWorldDirection(_dir).multiplyScalar(10)), rig.look);
    rig.fov = cam.fov;
    rig.frame = t.frame;
    rig.init = true;
  } else if (rig.frame !== t.frame) {
    // carry the damped pose over into the new frame
    const old = frameFor(rig.frame);
    frameToWorld(old, rig.pos, rig.world.pos);
    frameToWorld(old, rig.look, rig.world.look);
    const now = frameFor(t.frame);
    worldToFrame(now, rig.world.pos, rig.pos);
    worldToFrame(now, rig.world.look, rig.look);
    rig.frame = t.frame;
  }
  easing.damp3(rig.pos, pose.pos, c.sectionSmooth, dt);
  easing.damp3(rig.look, pose.look, c.sectionSmooth * 0.8, dt);
  easing.damp(rig, 'fov', pose.fov, c.sectionSmooth, dt);

  const wp = frameToWorld(frameFor(rig.frame), rig.pos, rig.world.pos);
  const wl = frameToWorld(frameFor(rig.frame), rig.look, rig.world.look);
  let fov = rig.fov;
  let dof = t.dof;
  let focusRange = t.focusRange;

  // the end of the launch: become the drift's first frame
  if (t.toDrift > 0) {
    const d = driftPose(Math.max(0, carState.progress), drift, prev);
    wp.lerp(drift.pos, t.toDrift);
    wl.lerp(drift.look, t.toDrift);
    fov = lerp(fov, drift.fov, t.toDrift);
    dof = lerp(dof, d.dof, t.toDrift);
    focusRange = lerp(focusRange, d.focusRange, t.toDrift);
  }

  cam.position.copy(wp);
  portraitFit(cam, cam.position, wl);
  cam.lookAt(wl);
  if (Math.abs(cam.fov - fov) > 1e-3) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  const b = BEATS[Math.max(0, chapterState.beat)];
  cameraState.mode = 'beat';
  cameraState.shot = -1;
  cameraState.shotId = `beat:${b.id}`;
  cameraState.focus.copy(wl);
  cameraState.dof = dof * c.dofScale;
  cameraState.focusRange = focusRange;
  cameraState.nearFade[0] = DEFAULT_NEAR_FADE[0];
  cameraState.nearFade[1] = DEFAULT_NEAR_FADE[1];
}

/**
 * Chapter III plays the shot script (src/lib/script.ts) against the damped scroll
 * progress: cuts are instant because nothing there is damped. Every other chapter runs
 * the beat camera. Mouse parallax and the rev shake sit on top of both.
 */
export function CameraRig() {
  const pose = useMemo(
    () => ({
      cur: { pos: new Vector3(), look: new Vector3(), fov: 40 } as Pose,
      prev: { pos: new Vector3(), look: new Vector3(), fov: 40 } as Pose,
      parallax: new Vector2(),
    }),
    [],
  );
  const mobile = useMemo(() => isMobile(), []);
  const rig = useMemo<BeatRig>(
    () => ({
      init: false,
      frame: 'start',
      pos: new Vector3(),
      look: new Vector3(),
      fov: 40,
      target: { pose: localPose(), frame: 'start', dof: 0, focusRange: 3, toDrift: 0 },
      world: { pos: new Vector3(), look: new Vector3() },
    }),
    [],
  );

  const city = useMemo(() => ({ rig: cityRig(), shot: cityShotState() }), []);

  useEffect(() => trackPointer(), []);

  useFrame((state, rawDt) => {
    const cam = state.camera as PerspectiveCamera;
    const c = CONFIG.camera;
    const dt = Math.min(rawDt, 1 / 20);
    const t = state.clock.elapsedTime;

    if (chapterState.stage === 'city') {
      rig.init = false;
      const shot = directShot(city.shot);
      applyCityShot(cam, city.rig, shot, dt, t);
      cameraState.mode = 'city';
      cameraState.shot = -1;
      cameraState.shotId = shot.id;
      cameraState.focus.copy(shot.focus);
      cameraState.dof = shot.dof * c.dofScale;
      cameraState.focusRange = shot.focusRange;
      cameraState.nearFade[0] = DEFAULT_NEAR_FADE[0];
      cameraState.nearFade[1] = DEFAULT_NEAR_FADE[1];
      cameraState.shake = shot.shake + applyExtras(cam, pose.parallax, dt, t, 0.6, mobile);
      return;
    }
    city.rig.init = false;

    if (!chapterState.drift) {
      runBeatCamera(cam, dt, rig, mobile, pose.cur, pose.prev);
      cameraState.shake = applyExtras(cam, pose.parallax, dt, t, 1, mobile);
      return;
    }
    rig.init = false;

    const p = carState.progress;
    const { cur, prev } = pose;
    const { i, shot, dof, focusRange } = driftPose(p, cur, prev);

    portraitFit(cam, cur.pos, cur.look);
    cam.position.copy(cur.pos);
    cam.lookAt(cur.look);

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
    const rev = applyExtras(cam, pose.parallax, dt, t, CONFIG.interaction.parallaxDrift, mobile);

    if (Math.abs(cam.fov - cur.fov) > 1e-3) {
      cam.fov = cur.fov;
      cam.updateProjectionMatrix();
    }

    cameraState.mode = 'drift';
    cameraState.shot = i;
    cameraState.shotId = shot.id;
    cameraState.shake = amp + rev;
    cameraState.focus.copy(cur.look);
    cameraState.dof = dof * c.dofScale;
    cameraState.focusRange = focusRange;
    const nf = shot.nearFade ?? DEFAULT_NEAR_FADE;
    cameraState.nearFade[0] = nf[0];
    cameraState.nearFade[1] = nf[1];
  }, -1);

  return null;
}
