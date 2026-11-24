'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Group, Mesh } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { CITY_ORIGIN } from '@/lib/cityRoute';

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
 * Material names carry a kind ("road:", "window:", "sign:" ...) for the night look.
 */
export function City() {
  const gltf = useGLTF(CITY_URL);
  const group = useRef<Group>(null!);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useCityStage(group);

  useLayoutEffect(() => {
    // static: one matrix update, then none per frame
    gltf.scene.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      const m = o as Mesh;
      if (m.isMesh) m.receiveShadow = false;
    });
  }, [gltf.scene]);

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
