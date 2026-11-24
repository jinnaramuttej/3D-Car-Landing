'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type Group, type MeshStandardMaterial, Vector2 } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { CITY_ORIGIN, SEA_LEVEL } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { createWaveNormalTexture } from '@/lib/textures';
import { patchCityMaterial } from './cityMaterials';

/** The city's southern edge (city-local z), where the land stops and the sea starts. */
const SHORE_Z = 353;

/**
 * The night sea south of the city: dark water whose slow swell (a scrolling wave normal
 * map) bends the street reflection (cityReflection.ts drops to sea level once the car is
 * on the bridge), so the bridge lamps and the city's windows lie on it in long streaks.
 * A sea wall closes the edge of the model above the water.
 */
export function Sea() {
  const group = useRef<Group>(null!);
  const mat = useRef<MeshStandardMaterial>(null!);
  const waves = useMemo(() => {
    const t = createWaveNormalTexture();
    t.repeat.set(260, 180);
    return t;
  }, []);
  const normalScale = useMemo(() => new Vector2(0.32, 0.32), []);

  useFrame(({ scene }, dt) => {
    const on = chapterState.stage === 'city';
    group.current.visible = on || chapterState.cloud > 0.2;
    if (!on) return;
    const m = mat.current;
    // three ignores envMapIntensity for materials that fall back to scene.environment
    if (scene.environment && m.envMap !== scene.environment) {
      m.envMap = scene.environment;
      m.needsUpdate = true;
    }
    m.envMapIntensity = chapterState.env.seaEnv;
    waves.offset.x += CONFIG.coast.waveSpeed * dt;
    waves.offset.y += CONFIG.coast.waveSpeed * 0.6 * dt;
  }, -1);

  return (
    <group ref={group} position={CITY_ORIGIN}>
      <mesh rotation-x={-Math.PI / 2} position={[0, SEA_LEVEL, SHORE_Z - 20 + 1800]}>
        <planeGeometry args={[6000, 3600]} />
        <meshStandardMaterial
          ref={(m) => {
            mat.current = m!;
            if (m) patchCityMaterial(m);
          }}
          name="sea:water"
          color="#04080c"
          roughness={0.1}
          metalness={0}
          normalMap={waves}
          normalScale={normalScale}
        />
      </mesh>
      {/* the sea wall under the southern edge of the city */}
      <mesh position={[0, (SEA_LEVEL - 4 + 22) / 2, SHORE_Z + 1.5]}>
        <boxGeometry args={[880, 22 - (SEA_LEVEL - 4), 3]} />
        <meshStandardMaterial color="#26272b" roughness={0.85} />
      </mesh>
    </group>
  );
}
