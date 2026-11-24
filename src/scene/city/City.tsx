'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { type Group, MathUtils, type Mesh, type PerspectiveCamera, type Texture } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { CITY_ORIGIN, getRoute, SEA_LEVEL } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState } from '@/lib/motion';
import { type CityKind, cityUniforms, patchCity } from './cityMaterials';
import { disposeReflection, reflectionUniforms, renderReflection } from './cityReflection';

export const CITY_URL = '/models/city.glb';

/** Draw the city stage only while it is the one on screen (and through the cloud). */
export function useCityStage(ref: React.RefObject<Group | null>) {
  useFrame(() => {
    if (ref.current) ref.current.visible = chapterState.stage === 'city' || chapterState.cloud > 0.2;
  }, -1);
}

/**
 * The city of chapters V onwards: "city" by golukumar (CC BY 4.0), rebuilt by
 * scripts/optimize-city.mjs (metres, joined by material into tiles, meshopt + WebP).
 * Material names carry a kind ("road:", "window:", "sign:" ...): cityMaterials.ts turns
 * them into a wet city at night, and cityReflection.ts renders the street reflection
 * they share (desktop only; phones keep the environment reflections).
 */
export function City() {
  const gltf = useGLTF(CITY_URL);
  const group = useRef<Group>(null!);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const mobile = useMemo(() => isMobile(), []);
  const mats = useRef<{ mat: import('three').MeshStandardMaterial; kind: CityKind }[]>([]);
  const envMap = useRef<Texture | null>(null);
  useCityStage(group);

  useLayoutEffect(() => {
    // static: one matrix update, then none per frame
    gltf.scene.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      const m = o as Mesh;
      if (m.isMesh) m.receiveShadow = false;
    });
    mats.current = patchCity(gltf.scene);
  }, [gltf.scene]);

  useEffect(() => () => disposeReflection(), []);

  useFrame((state) => {
    const on = chapterState.stage === 'city';
    const e = chapterState.env;
    const c = CONFIG.city;
    const u = cityUniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uWet.value = e.wet;
    u.uCity.value = e.city;
    u.uNight.value = MathUtils.lerp(c.nightAlbedo, 0.95, 1 - MathUtils.clamp(e.city, 0, 1));
    u.uPuddles.value = c.puddles;
    u.uWindowGlow.value = c.windowGlow;
    u.uSignGlow.value = c.signGlow;
    u.uLedGlow.value = c.ledGlow;
    u.uReflStrength.value = c.reflection;
    // three ignores envMapIntensity for materials that fall back to scene.environment, so
    // hand the map over explicitly: wet ground gets a faint sky (the street reflection does
    // the rest), facades a little more
    if (on && state.scene.environment !== envMap.current) {
      envMap.current = state.scene.environment;
      for (const { mat } of mats.current) {
        mat.envMap = envMap.current;
        mat.needsUpdate = true;
      }
    }
    if (on) {
      for (const { mat, kind } of mats.current) {
        mat.envMapIntensity = kind === 'road' || kind === 'ground' ? e.groundEnv * 1.6 : kind === 'metal' ? e.env * 0.8 : e.env * 0.35;
      }
    }
    // the street reflection: at the road under the car, at sea level once on the bridge
    if (!on || mobile || c.reflection <= 0) {
      reflectionUniforms.uReflOn.value = 0;
      return;
    }
    const overSea = carState.s > getRoute().bridgeStart + 50;
    const planeY = overSea ? CITY_ORIGIN.y + SEA_LEVEL : carState.position.y - 0.02;
    renderReflection(gl, scene, state.camera as PerspectiveCamera, planeY, c.reflectionScale, 420);
  }, -0.5);

  // compile the city's shaders while the waterfront plays, not at the switch
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const was = g.visible;
    g.visible = true;
    void gl.compileAsync(g, camera).finally(() => {
      g.visible = was;
    });
  }, [gl, camera, gltf.scene]);

  return (
    <group ref={group} position={CITY_ORIGIN}>
      <primitive object={gltf.scene} />
      {/* dark ground under and around the model, so nothing ever floats over a void */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -3.4, -300]}>
        <planeGeometry args={[2600, 1400]} />
        <meshStandardMaterial color="#07080a" roughness={0.9} />
      </mesh>
    </group>
  );
}

useGLTF.preload(CITY_URL);
