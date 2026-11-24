'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { type PerspectiveCamera, Vector2, Vector3 } from 'three';
import { easing } from 'maath';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { interaction } from '@/lib/interaction';
import { pointer, trackPointer } from '@/lib/pointer';
import { applyCityShot, cityShotState } from './city/cityCamera';
import { directShot } from './city/director';

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

/**
 * The camera: the director (city/director.ts) picks and blends the rigs, cityCamera puts the
 * result on the lens, and mouse parallax and the rev shake sit on top.
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
  }, -1);

  return null;
}
