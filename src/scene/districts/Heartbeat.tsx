'use client';

import { useMemo, useRef } from 'react';
import type { Mesh, MeshStandardMaterial } from 'three';
import { districtWeight } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { districtFx } from '@/lib/districtState';
import { engine } from '@/lib/engineAudio';
import { useStore } from '@/lib/store';
import { DistrictSet, districtLights, glowMaterial } from './shared';

const WARM = '#ff7a52';

const lights = [
  { pos: [0, 1.6, 0.8] as [number, number, number], color: WARM, intensity: 60, distance: 14 },
  { pos: [0, 4, 4] as [number, number, number], color: '#ffb48a', intensity: 50, distance: 16 },
];
districtLights.heartbeat = lights;

/** Lub-dub: two soft bells per beat, the second smaller. 0..1. */
function pulse(phase: number) {
  const a = Math.exp(-((phase - 0.04) ** 2) / 0.0016);
  const b = 0.6 * Math.exp(-((phase - 0.3) ** 2) / 0.0022);
  return Math.min(1, a + b);
}

/**
 * X Heartbeat: a warm, quiet room and one slow pulse in light (and, with sound on, a
 * soft heartbeat). The 3-minute ring timer and the copy are in the DOM.
 */
export function Heartbeat() {
  const orb = useRef<Mesh>(null!);
  const orbMat = useRef<MeshStandardMaterial>(null!);
  const halo = useMemo(() => glowMaterial(WARM, 0.3), []);
  const haloMesh = useRef<Mesh>(null!);
  const state = useMemo(() => ({ lastBeat: -1 }), []);

  const tick = () => {
    const t = performance.now() / 1000;
    const period = 60 / CONFIG.districts.heartbeatBpm;
    const beat = Math.floor(t / period);
    const e = pulse((t % period) / period);
    districtFx.heartbeat = e;
    const k = CONFIG.districts.heartbeatLight;
    orb.current.scale.setScalar(1 + 0.06 * e * k);
    orbMat.current.emissiveIntensity = 0.45 + 0.9 * e * k;
    haloMesh.current.scale.setScalar(2.6 + 0.6 * e * k);
    halo.uniforms.uOpacity.value = 0.22 + 0.25 * e;
    lights[0].intensity = 40 + 70 * e * k;
    // the sound, once per beat, only while this room is the one on screen
    if (beat !== state.lastBeat) {
      state.lastBeat = beat;
      if (districtWeight('heartbeat') > 0.7 && !useStore.getState().muted) engine.heartbeat();
    }
  };

  return (
    <DistrictSet id="heartbeat" onFrame={tick}>
      <mesh position={[0, -0.8, 0]}>
        <cylinderGeometry args={[13, 13.5, 1.6, 48]} />
        <meshStandardMaterial color="#1a0d0a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.6, 1.64, 96]} />
        <meshBasicMaterial color="#ff8a62" transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh ref={orb} position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.42, 48, 32]} />
        <meshStandardMaterial ref={orbMat} color="#ff9a80" emissive="#ff4a30" emissiveIntensity={0.45} roughness={0.35} />
      </mesh>
      <mesh ref={haloMesh} position={[0, 1.5, -0.01]} material={halo}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </DistrictSet>
  );
}
