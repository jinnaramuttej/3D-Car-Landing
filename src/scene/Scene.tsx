'use client';

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { Color, type DirectionalLight, FogExp2, type HemisphereLight, type Texture, Vector3 } from 'three';
import { chapterById, type Env } from '@/lib/chapters';
import { chapterState, stepChapters, sunDirection } from '@/lib/chapterRuntime';
import { stepCityDrive } from '@/lib/cityDrive';
import { CONFIG } from '@/lib/config';
import { carState, stepDrive } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { Car } from './Car';
import { CameraRig } from './CameraRig';
import { ChapterProps } from './ChapterProps';
import { Billboards } from './city/Billboards';
import { Bridge } from './city/Bridge';
import { City } from './city/City';
import { RouteDebug } from './city/RouteDebug';
import { Sea } from './city/Sea';
import { StreetLights } from './city/StreetLights';
import './fogLayers';
import { Cityscape } from './Cityscape';
import { createDayEnvironment } from './dayEnvironment';
import { Effects } from './Effects';
import { Interaction } from './Interaction';
import { Rain } from './Rain';
import { SkidMarks } from './SkidMarks';
import { Sound } from './Sound';
import { Smoke } from './Smoke';
import { Track } from './Track';

/** Night waterfront street (Shanghai Bund, Poly Haven, CC0), for reflections. */
export const NIGHT_HDRI = '/hdri/shanghai_bund_1k.hdr';

const _sun = new Vector3();

/**
 * Frame order (lower priority runs first; none are > 0, so R3F still owns the loop
 * and the EffectComposer renders):
 *   -3  Scene      global progress -> chapterState (stepChapters), then the car's
 *                  kinematics (stepDrive), then the chapter's light, fog and env map
 *   -2  Car        applies carState, publishes wheel contacts and headlight beams
 *   -1  Smoke, Rain, SkidMarks, ChapterProps, the city, CameraRig, Interaction
 */
export function Scene() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const background = useMemo(() => new Color(CONFIG.look.background), []);
  const fog = useMemo(() => new FogExp2('#0c1016', 0.009), []);
  const sun = useRef<DirectionalLight>(null!);
  const hemi = useRef<HemisphereLight>(null!);
  const envs = useRef<{ night: Texture | null; day: Texture | null }>({ night: null, day: null });
  const sunTarget = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    // Layer 1 holds things the main camera sees but the ground reflection skips.
    camera.layers.enable(1);
  }, [camera]);

  useLayoutEffect(() => {
    sun.current.target = sunTarget;
  }, [sunTarget]);

  useEffect(() => {
    // the dawn over the sea (finale), generated once
    const fin = chapterById('finale');
    const dawn = { ...fin.env, ...fin.envEnd } as Env;
    const day = createDayEnvironment(gl, dawn, sunDirection(dawn.sunAzimuth, dawn.sunElevation, new Vector3(), 'city'));
    envs.current.day = day;
    return () => {
      day.dispose();
      envs.current.day = null;
    };
  }, [gl]);

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
    const raw = useStore.getState().progress;
    stepChapters(raw, dt, state.camera.position);
    // land exactly where a jump (or the other stage) puts the car
    if (chapterState.jumped || chapterState.stageChanged) carState.initialized = false;
    if (chapterState.stage === 'city') stepCityDrive(chapterState.progress, dt, chapterState.jumped);
    else stepDrive(chapterState.driftRaw, dt, chapterState.extraS);

    const e = chapterState.env;
    background.set(CONFIG.look.background);
    fog.color.copy(e.fogColor);
    fog.density = e.fog;

    // night HDRI (drei sets it), the generated dawn sky once the sun is up on the bridge
    const E = envs.current;
    if (!E.night && scene.environment && scene.environment !== E.day) E.night = scene.environment;
    const want = e.day > 0.5 && E.day ? E.day : E.night;
    if (want && scene.environment !== want) scene.environment = want;
    scene.environmentIntensity = e.env;

    // sun (moonlight at night), aimed at the car
    sunTarget.position.copy(carState.position);
    sunTarget.updateMatrixWorld();
    sunDirection(e.sunAzimuth, e.sunElevation, _sun);
    const s = sun.current;
    s.position.copy(sunTarget.position).addScaledVector(_sun, 120);
    s.color.copy(e.sun);
    s.intensity = e.sunIntensity;
    hemi.current.color.copy(e.hemiSky);
    hemi.current.groundColor.copy(e.hemiGround);
    hemi.current.intensity = e.hemi;
  }, -3);

  return (
    <>
      <primitive attach="background" object={background} />
      <primitive attach="fog" object={fog} />

      {/* Night street HDRI for reflections, plus soft boxes standing in for sodium
          street lamps (warm streaks on the paint) and a cool sea-side fill (teal/orange) */}
      <Environment files={NIGHT_HDRI} resolution={256}>
        <Lightformer form="rect" intensity={1.5} color="#ffa24d" position={[0, 16, 0]} rotation-x={Math.PI / 2} scale={[50, 2.5, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#ff9440" position={[-24, 8, -8]} rotation-y={Math.PI / 2} scale={[36, 1.6, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#5fb4c9" position={[24, 6, 8]} rotation-y={-Math.PI / 2} scale={[36, 3, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ff2bd6" position={[0, 4, -40]} scale={6} />
      </Environment>

      <hemisphereLight ref={hemi} args={['#4b6378', '#120c08', 0.3]} />
      <directionalLight ref={sun} intensity={0.25} color="#9fc2d6" />
      <primitive object={sunTarget} />

      <Cityscape />
      <Track />
      <Car />
      <SkidMarks />
      <Smoke />
      <Rain />
      <ChapterProps />
      {/* chapters V on: the city, the sea and the bridge (src/scene/city) */}
      <Suspense fallback={null}>
        <City />
        <StreetLights />
        <Billboards />
        <Sea />
        <Bridge />
        <RouteDebug />
      </Suspense>
      <CameraRig />
      <Sound />
      <Interaction />
      <Effects />
    </>
  );
}
