'use client';

import { useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { Color, FogExp2 } from 'three';
import { CONFIG } from '@/lib/config';
import { stepDrive } from '@/lib/motion';
import { sectionState, stepSections } from '@/lib/sectionRuntime';
import { driftLocal } from '@/lib/sections';
import { useStore } from '@/lib/store';
import { Car } from './Car';
import { CameraRig } from './CameraRig';
import { Cityscape } from './Cityscape';
import { Effects } from './Effects';
import { Rain } from './Rain';
import { SectionProps } from './SectionProps';
import { SkidMarks } from './SkidMarks';
import { Smoke } from './Smoke';
import { Track } from './Track';

/** Night waterfront street (Shanghai Bund, Poly Haven, CC0): the closest free stand-in for a Mumbai seafront. */
export const NIGHT_HDRI = '/hdri/shanghai_bund_1k.hdr';

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
  const gl = useThree((s) => s.gl);
  const background = useMemo(() => new Color(CONFIG.look.background), []);
  const fog = useMemo(() => new FogExp2(CONFIG.look.background, CONFIG.look.fogDensity), []);

  useLayoutEffect(() => {
    // Layer 1 holds things the main camera sees but the ground reflection skips.
    camera.layers.enable(1);
  }, [camera]);

  useLayoutEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __gt3rScene?: unknown; __gt3rCamera?: unknown; __gt3rGl?: unknown; __THREE?: unknown };
    w.__gt3rScene = scene;
    w.__gt3rCamera = camera;
    w.__gt3rGl = gl;
    w.__THREE = THREE;
    return () => {
      delete w.__gt3rScene;
      delete w.__gt3rCamera;
      delete w.__gt3rGl;
      delete w.__THREE;
    };
  }, [scene, camera, gl]);

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
    fog.color.set(l.fogColor);
    fog.density = sl ? sl.fog : l.fogDensity;
    scene.environmentIntensity = sl ? sl.env : l.envIntensity;
  }, -3);

  return (
    <>
      <primitive attach="background" object={background} />
      <primitive attach="fog" object={fog} />

      {/* Night street HDRI for reflections, plus soft boxes standing in for sodium
          street lamps (warm streaks on the paint) and a cool sea-side fill (teal/orange) */}
      <Environment files={NIGHT_HDRI} resolution={256} environmentIntensity={CONFIG.look.envIntensity}>
        <Lightformer form="rect" intensity={1.5} color="#ffa24d" position={[0, 16, 0]} rotation-x={Math.PI / 2} scale={[50, 2.5, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#ff9440" position={[-24, 8, -8]} rotation-y={Math.PI / 2} scale={[36, 1.6, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#5fb4c9" position={[24, 6, 8]} rotation-y={-Math.PI / 2} scale={[36, 3, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ff2bd6" position={[0, 4, -40]} scale={6} />
      </Environment>

      <hemisphereLight args={['#4b6378', '#120c08', 0.3]} />
      <directionalLight position={[-30, 40, -20]} intensity={0.25} color="#9fc2d6" />

      <Cityscape />
      <Track />
      <Car />
      <SkidMarks />
      <Smoke />
      <Rain />
      <SectionProps />
      <CameraRig />
      <Effects />
    </>
  );
}
