'use client';

import { useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Color, FogExp2 } from 'three';
import { CONFIG } from '@/lib/config';
import { stepDrive } from '@/lib/motion';
import { sectionState, stepSections } from '@/lib/sectionRuntime';
import { driftLocal } from '@/lib/sections';
import { useStore } from '@/lib/store';
import { Car } from './Car';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { SectionProps } from './SectionProps';
import { SkidMarks } from './SkidMarks';
import { Smoke } from './Smoke';
import { Track } from './Track';

export const NIGHT_HDRI = '/hdri/dikhololo_night_1k.hdr';

/**
 * Frame order (lower priority runs first; none are > 0, so R3F still owns the loop
 * and the EffectComposer renders):
 *   -3  Scene      global progress -> sectionState (stepSections), then the drift
 *                  scene's own progress -> carState kinematics (stepDrive)
 *   -2  Car        applies carState, publishes wheel contacts
 *   -1  Smoke, SkidMarks, SectionProps, CameraRig
 */
export function Scene() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const background = useMemo(() => new Color(CONFIG.look.background), []);
  const fog = useMemo(() => new FogExp2(CONFIG.look.background, CONFIG.look.fogDensity), []);

  useLayoutEffect(() => {
    // Layer 1 holds things the main camera sees but the ground reflection skips.
    camera.layers.enable(1);
  }, [camera]);

  useLayoutEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __gt3rScene?: unknown; __gt3rCamera?: unknown };
    w.__gt3rScene = scene;
    w.__gt3rCamera = camera;
    return () => {
      delete w.__gt3rScene;
      delete w.__gt3rCamera;
    };
  }, [scene, camera]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const global = useStore.getState().progress;
    stepSections(global, dt, state.camera.position);
    // The drift scene keeps its own 0..1 timeline; it holds at DRIFT.localEnd once the
    // sections take over, and the finale adds its launch distance on top.
    stepDrive(driftLocal(global), dt, sectionState.launchS, sectionState.burnout);

    const l = CONFIG.look;
    const sl = sectionState.active ? sectionState.look : null;
    background.set(l.background);
    fog.color.set(l.background);
    fog.density = sl ? sl.fog : l.fogDensity;
    scene.environmentIntensity = sl ? sl.env : l.envIntensity;
  }, -3);

  return (
    <>
      <primitive attach="background" object={background} />
      <primitive attach="fog" object={fog} />

      {/* Night HDRI plus a few soft boxes so the paint has floodlight streaks to reflect */}
      <Environment files={NIGHT_HDRI} resolution={256} environmentIntensity={CONFIG.look.envIntensity}>
        <Lightformer form="rect" intensity={2.2} color="#ffd9a8" position={[0, 16, 0]} rotation-x={Math.PI / 2} scale={[50, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#c4d4ff" position={[-24, 7, -8]} rotation-y={Math.PI / 2} scale={[36, 2, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#ffe4c0" position={[24, 7, 8]} rotation-y={-Math.PI / 2} scale={[36, 2, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ff3b30" position={[0, 4, -40]} scale={8} />
      </Environment>

      <hemisphereLight args={['#5a6a8f', '#050505', 0.35]} />
      <directionalLight position={[-30, 40, -20]} intensity={0.35} color="#a9bcff" />

      <Track />
      <Car />
      <SkidMarks />
      <Smoke />
      <SectionProps />
      <CameraRig />
      <Effects />
    </>
  );
}
