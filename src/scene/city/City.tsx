'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Euler, type Group, MathUtils, type Mesh, type Object3D, type PerspectiveCamera, type Texture, Vector3 } from 'three';
import { feel } from '@/lib/feel';
import { chapterState } from '@/lib/chapterRuntime';
import { CITY_ORIGIN, getRoute, SEA_LEVEL } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState } from '@/lib/motion';
import { type CityKind, cityUniforms, kindOf, patchCity } from './cityMaterials';
import { setRoadMeshes } from '@/lib/ground';
import { setCityMeshes } from '@/lib/collide';
import { disposeReflection, reflectionUniforms, renderReflection } from './cityReflection';

export const CITY_URL = '/models/city.glb';

/**
 * Everything in the city lives on its own layer: the main camera sees it, the
 * street-reflection camera sees only it (and the sky), and the car's contact-shadow pass
 * (layer 0) never has to draw the city. Layer 1 stays "main camera only" (rain, pools).
 */
export const CITY_LAYER = 3;

/** Moves everything under `ref` to the city layer (after its children have mounted). */
export function useCityLayer(ref: React.RefObject<Object3D | null>) {
  useLayoutEffect(() => {
    ref.current?.traverse((o) => {
      if (o.layers.isEnabled(1) && !o.layers.isEnabled(0)) return;
      o.layers.set(CITY_LAYER);
    });
  });
}

/**
 * The world the whole journey happens in: "city" by golukumar (CC BY 4.0), rebuilt by
 * scripts/optimize-city.mjs (metres, joined by material into tiles, meshopt + WebP).
 * Material names carry a kind ("road:", "window:", "sign:" ...): cityMaterials.ts turns
 * them into a wet city at night, and cityReflection.ts renders the street reflection
 * they share (desktop only; phones keep the environment reflections).
 */
export function City() {
  const gltf = useGLTF(CITY_URL);
  const group = useRef<Group>(null!);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const mobile = useMemo(() => isMobile(), []);
  const mats = useRef<{ mat: import('three').MeshStandardMaterial; kind: CityKind }[]>([]);
  const envMap = useRef<Texture | null>(null);
  const frames = useRef(0);
  const mirrorPoint = useRef(new Vector3());
  const mirrorUp = useRef(new Vector3(0, 1, 0));
  const mirrorEuler = useRef(new Euler());
  useCityLayer(group);

  useLayoutEffect(() => {
    // static: one matrix update, then none per frame
    gltf.scene.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      const m = o as Mesh;
      if (m.isMesh) m.receiveShadow = false;
    });
    mats.current = patchCity(gltf.scene);
    // what the wheels stand on: the road and ground surfaces only (src/lib/ground.ts)
    // and the camera's collision sphere and the debug HUD test against all of it (src/lib/collide.ts)
    const roads: Mesh[] = [];
    const all: { mesh: Mesh; road: boolean; card: boolean }[] = [];
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const kind = kindOf(mat);
      const road = kind === 'road' || kind === 'ground';
      // see-through cards: foliage, palms, trees and the cut-out plant sprites
      const card = kind === 'foliage' || kind === 'ledpalm' || kind === 'ledtree' || mat.name.includes('removebg');
      if (road) roads.push(m);
      all.push({ mesh: m, road, card });
    });
    setRoadMeshes(roads);
    setCityMeshes(all);
    return () => {
      setRoadMeshes([]);
      setCityMeshes([]);
    };
  }, [gltf.scene]);

  useEffect(() => () => disposeReflection(), []);

  useFrame((state) => {
    const e = chapterState.env;
    const c = CONFIG.city;
    const u = cityUniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uWet.value = e.wet;
    u.uSpecCap.value = CONFIG.city.specCap;
    // lane dashes light up with speed: on the runs, not through the slow zones
    u.uDash.value = MathUtils.smoothstep(Math.abs(carState.speed), 6, 17) * CONFIG.city.dashGlow * (mobile ? 0.6 : 1);
    u.uCarPos.value.copy(carState.position);
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
    if (state.scene.environment !== envMap.current) {
      envMap.current = state.scene.environment;
      for (const { mat } of mats.current) {
        mat.envMap = envMap.current;
        mat.needsUpdate = true;
      }
    }
    for (const { mat, kind } of mats.current) {
      mat.envMapIntensity = kind === 'road' || kind === 'ground' ? e.groundEnv * 1.6 : kind === 'metal' ? e.env * 0.8 : e.env * 0.35;
    }
    // the street reflection: at the road under the car, at sea level once on the bridge
    if (mobile || c.reflection <= 0) {
      reflectionUniforms.uReflOn.value = 0;
      return;
    }
    // the mirror: the road under the car, tilted with it (on its springs, so it doesn't shiver
    // with every triangle under the wheels); the sea once over the water
    const overSea = carState.s > getRoute().bridgeStart + 50;
    if (overSea) {
      mirrorPoint.current.set(carState.position.x, CITY_ORIGIN.y + SEA_LEVEL, carState.position.z);
      mirrorUp.current.set(0, 1, 0);
    } else {
      mirrorEuler.current.set(-feel.gp, carState.heading, feel.gr, 'YXZ');
      mirrorUp.current.set(0, 1, 0).applyEuler(mirrorEuler.current);
      mirrorPoint.current.set(carState.position.x, feel.gy, carState.position.z).addScaledVector(mirrorUp.current, -0.02);
    }
    // (every other frame: the texture keeps the matrix of the view it was drawn from, so a
    // frame-old reflection still lands in the right place, half the cost)
    if (++frames.current % Math.max(1, Math.round(c.reflectionEvery)) === 0) {
      renderReflection(gl, scene, state.camera as PerspectiveCamera, mirrorPoint.current, mirrorUp.current, c.reflectionScale, c.reflectionFar);
    }
  }, -0.5);

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
