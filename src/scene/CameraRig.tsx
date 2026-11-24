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
import { stepCamera } from '@/lib/feel';
import { clearCamera } from '@/lib/collide';
import { layoutState, type Rect } from '@/lib/layout';
import { carState, forwardOf, leftOf } from '@/lib/motion';
import { pointer, trackPointer } from '@/lib/pointer';
import { useStore } from '@/lib/store';
import { EXTRAS, type ExtraId } from '@/lib/cityRoute';
import { type BoardId, stopAnchor } from '@/lib/stops';
import { applyCityShot, cityShotState, lens } from './city/cityCamera';
import { director, directShot } from './city/director';

/**
 * What the rest of the scene needs to know about the current shot. Written every frame by
 * CameraRig: Effects reads focus/dof/shake (0..1), Smoke and Rain read nearFade.
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

/** Cinematic mode's bars, 0..1 (eased like their CSS transition: 0.9 s, ease-in-out cubic). */
const bars = { t: 0 };
const BARS_SECONDS = 0.9;
const BARS_ASPECT = 2.39;

function updateBars(dt: number, w: number, h: number) {
  const on = useStore.getState().cinematic;
  bars.t = MathUtils.clamp(bars.t + ((on ? 1 : -1) * Math.min(dt, 0.1)) / BARS_SECONDS, 0, 1);
  const t = bars.t;
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const aspect = w / Math.max(1, h);
  // (no bars on a tall screen, as in the CSS)
  lens.visible = aspect < 1.2 ? 1 : 1 - (1 - Math.min(1, aspect / BARS_ASPECT)) * e;
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
  for (let iz = 0; iz < 2; iz++)
    for (let ix = 0; ix < 2; ix++)
      for (let iy = 0; iy < 2; iy++)
        carBox[k++]
          .copy(carState.position)
          .addScaledVector(_f, iz ? 2.35 : -2.35)
          .addScaledVector(_l, ix ? 1 : -1)
          .setY(carState.position.y + (iy ? 1.3 : 0.05));
  layoutState.car = project(cam, carBox, w, h, carRect);
  // the billboard on show: the stop's, or one the car is driving up to
  const ch = CHAPTERS[chapterState.chapter];
  layoutState.board = null;
  let board: BoardId | null = ch.stop && stopWeight(ch.stop) > 0.05 ? ch.stop : null;
  if (!board)
    for (const id of Object.keys(EXTRAS) as ExtraId[]) {
      const ahead = EXTRAS[id].s - carState.s;
      if (ahead > -10 && ahead < 130) board = id;
    }
  if (board) {
    const a = stopAnchor(board);
    _n.copy(a.normal);
    _u.set(0, 1, 0);
    const across = _l.crossVectors(_u, _n).normalize();
    k = 0;
    for (let ix = 0; ix < 2; ix++)
      for (let iy = 0; iy < 2; iy++)
        boardBox[k++]
          .copy(a.centre)
          .addScaledVector(across, (ix - 0.5) * a.width)
          .setY(a.centre.y + (iy - 0.5) * a.height);
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
    stepCamera(dt);
    directShot(shot);
    // the camera's collision sphere: never inside a wall, a pole or a barrier (pulled toward
    // what it looks at until it is clear)
    clearCamera(shot.pos, shot.look);
    updateBars(rawDt, state.size.width, state.size.height);
    applyCityShot(cam, shot, t);
    const rev = applyExtras(cam, parallax, dt, t, shot.id.startsWith('stop') ? 1 : 0.6, mobile);
    cameraState.shotId = shot.id;
    // (0..1: the trauma shake plus the rev shake, as a share of the most the lens shakes)
    cameraState.shake = shot.shake + rev / Math.max(1e-3, CONFIG.feel.shakeMax);
    cameraState.focus.copy(shot.focus);
    cameraState.dof = shot.dof * c.dofScale;
    cameraState.focusRange = shot.focusRange;
    cameraState.nearFade[0] = shot.nearFade[0];
    cameraState.nearFade[1] = shot.nearFade[1];
    publishLayout(cam, state.size.width, state.size.height);
  }, -1);

  return null;
}
