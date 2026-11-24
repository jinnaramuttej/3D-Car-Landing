'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type PerspectiveCamera, Vector2, Vector3 } from 'three';
import { easing } from 'maath';
import { CHAPTERS } from '@/lib/chapters';
import { chapterState, stopWeight } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { interaction } from '@/lib/interaction';
import { layoutState, type Rect } from '@/lib/layout';
import { carState, forwardOf, leftOf } from '@/lib/motion';
import { pointer, trackPointer } from '@/lib/pointer';
import { stopAnchor } from '@/lib/stops';
import { applyCityShot, cityShotState } from './city/cityCamera';
import { director, directShot } from './city/director';

/**
 * What the rest of the scene needs to know about the current shot. Written every frame by
 * CameraRig: Effects reads focus/dof/shake, Smoke and Rain read nearFade.
 */
export const cameraState = {
  shotId: '',
  shake: 0,
  focus: new Vector3(),
  dof: 0,
  focusRange: 3,
  nearFade: [0.35, 2] as [number, number],
};

/** Mouse parallax and the rev shake, on top of the director's camera. */
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

const _p = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _n = new Vector3();
const _u = new Vector3();

/** Screen rect (CSS px) of a set of world points, or null if any is behind the camera. */
function project(cam: PerspectiveCamera, pts: Vector3[], w: number, h: number, out: Rect): Rect | null {
  out.x0 = Infinity;
  out.y0 = Infinity;
  out.x1 = -Infinity;
  out.y1 = -Infinity;
  for (const p of pts) {
    _p.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (_p.z > -0.2) return null;
    _p.applyMatrix4(cam.projectionMatrix);
    const x = (_p.x * 0.5 + 0.5) * w;
    const y = (0.5 - _p.y * 0.5) * h;
    out.x0 = Math.min(out.x0, x);
    out.x1 = Math.max(out.x1, x);
    out.y0 = Math.min(out.y0, y);
    out.y1 = Math.max(out.y1, y);
  }
  if (out.x1 < 0 || out.x0 > w || out.y1 < 0 || out.y0 > h) return null;
  return out;
}

const carBox = Array.from({ length: 8 }, () => new Vector3());
const boardBox = Array.from({ length: 4 }, () => new Vector3());
const carRect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
const boardRect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

/** Where the car and the billboard on show are on screen, for the DOM layout solver. */
function publishLayout(cam: PerspectiveCamera, w: number, h: number) {
  cam.updateMatrixWorld();
  forwardOf(carState.heading, _f);
  leftOf(carState.heading, _l);
  let k = 0;
  for (const z of [-2.35, 2.35]) for (const x of [-1, 1]) for (const y of [0.05, 1.3]) carBox[k++].copy(carState.position).addScaledVector(_f, z).addScaledVector(_l, x).setY(carState.position.y + y);
  layoutState.car = project(cam, carBox, w, h, carRect);
  // the billboard of the stop on screen
  const ch = CHAPTERS[chapterState.chapter];
  layoutState.board = null;
  if (ch.stop && stopWeight(ch.stop) > 0.05) {
    const a = stopAnchor(ch.stop);
    _n.copy(a.normal);
    _u.set(0, 1, 0);
    const across = _l.crossVectors(_u, _n).normalize();
    k = 0;
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) boardBox[k++].copy(a.centre).addScaledVector(across, sx * a.width).setY(a.centre.y + sy * a.height);
    layoutState.board = project(cam, boardBox, w, h, boardRect);
  }
  layoutState.w = w;
  layoutState.h = h;
  layoutState.s = carState.s;
  layoutState.speed = Math.abs(carState.speed);
  layoutState.calm = 1 - MathUtils.smoothstep(layoutState.speed, 26, 42);
  layoutState.atStop = director.current.startsWith('stop') && director.blend >= 1 && director.settled > 0.15;
}

/**
 * The camera: the director (city/director.ts) picks and blends the rigs, cityCamera puts the
 * result on the lens, and mouse parallax and the rev shake sit on top. Then it tells the
 * DOM where the car and the billboard ended up on screen.
 */
export function CameraRig() {
  const mobile = useMemo(() => isMobile(), []);
  const parallax = useMemo(() => new Vector2(), []);
  const shot = useMemo(() => cityShotState(), []);

  useEffect(() => trackPointer(), []);

  useFrame((state, rawDt) => {
    const cam = state.camera as PerspectiveCamera;
    const c = CONFIG.camera;
    const dt = Math.min(rawDt, 1 / 20);
    const t = state.clock.elapsedTime;
    directShot(shot);
    applyCityShot(cam, shot, t);
    const rev = applyExtras(cam, parallax, dt, t, shot.id.startsWith('stop') ? 1 : 0.6, mobile);
    cameraState.shotId = shot.id;
    cameraState.shake = shot.shake + rev;
    cameraState.focus.copy(shot.focus);
    cameraState.dof = shot.dof * c.dofScale;
    cameraState.focusRange = shot.focusRange;
    cameraState.nearFade[0] = shot.nearFade[0];
    cameraState.nearFade[1] = shot.nearFade[1];
    publishLayout(cam, state.size.width, state.size.height);
  }, -1);

  return null;
}
