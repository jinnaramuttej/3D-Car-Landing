'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { type InstancedMesh, Object3D } from 'three';
import { DistrictSet, districtLights } from './shared';

const DAIS_Z = -7;

districtLights.chamber = [
  { pos: [-5, 5, -2], color: '#9a5cff', intensity: 240, distance: 20 },
  { pos: [5, 5, -2], color: '#9a5cff', intensity: 240, distance: 20 },
  { pos: [0, 4.5, DAIS_Z + 2.5], color: '#ffe3c8', intensity: 140, distance: 12 },
  { pos: [0, 3, 8], color: '#6f4ccf', intensity: 90, distance: 16 },
];

/** Desks on three tiers in a half circle facing the dais. */
function useDesks() {
  return useMemo(() => {
    const out: { x: number; y: number; z: number; yaw: number }[] = [];
    [5.2, 6.8, 8.4].forEach((r, row) => {
      const n = 9 + row * 3;
      for (let i = 0; i < n; i++) {
        const a = -1.15 + (2.3 * i) / (n - 1);
        out.push({ x: Math.sin(a) * r, y: row * 0.3, z: DAIS_Z + Math.cos(a) * r, yaw: a });
      }
    });
    return out;
  }, []);
}

/**
 * XI Chamber: a purple assembly hall for the MUN. Tiers of desks round a dais, tall
 * columns and plain banners behind it (no flags, no logos). The committee cards are DOM.
 */
export function Chamber() {
  const desks = useDesks();
  const deskMesh = useRef<InstancedMesh>(null!);
  const lampMesh = useRef<InstancedMesh>(null!);
  const tierMesh = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    const o = new Object3D();
    desks.forEach((d, i) => {
      o.position.set(d.x, d.y + 0.38, d.z);
      o.rotation.set(0, d.yaw, 0);
      o.updateMatrix();
      deskMesh.current.setMatrixAt(i, o.matrix);
      o.position.set(d.x, d.y + 0.79, d.z);
      o.updateMatrix();
      lampMesh.current.setMatrixAt(i, o.matrix);
      o.position.set(d.x, d.y / 2, d.z);
      o.scale.set(1, Math.max(0.01, d.y) / 0.3 || 0.01, 1);
      o.updateMatrix();
      tierMesh.current.setMatrixAt(i, o.matrix);
      o.scale.set(1, 1, 1);
    });
    for (const m of [deskMesh, lampMesh, tierMesh]) {
      m.current.count = desks.length;
      m.current.instanceMatrix.needsUpdate = true;
      m.current.computeBoundingSphere();
    }
  }, [desks]);

  const columns = useMemo(() => Array.from({ length: 9 }, (_, i) => -1.2 + (2.4 * i) / 8), []);

  return (
    <DistrictSet id="chamber">
      <mesh position={[0, -0.8, 0]}>
        <cylinderGeometry args={[16, 16.5, 1.6, 48]} />
        <meshStandardMaterial color="#120b18" roughness={0.35} metalness={0.35} />
      </mesh>
      <instancedMesh ref={tierMesh} args={[undefined, undefined, desks.length]}>
        <boxGeometry args={[1.3, 0.3, 1.1]} />
        <meshStandardMaterial color="#1a1222" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={deskMesh} args={[undefined, undefined, desks.length]}>
        <boxGeometry args={[1.0, 0.76, 0.5]} />
        <meshStandardMaterial color="#2a1d36" roughness={0.45} metalness={0.2} />
      </instancedMesh>
      <instancedMesh ref={lampMesh} args={[undefined, undefined, desks.length]}>
        <boxGeometry args={[0.5, 0.03, 0.06]} />
        <meshStandardMaterial color="#000" emissive="#b07aff" emissiveIntensity={3} />
      </instancedMesh>
      {/* the dais and lectern */}
      <mesh position={[0, 0.4, DAIS_Z - 0.6]}>
        <boxGeometry args={[7, 0.8, 2.4]} />
        <meshStandardMaterial color="#21152e" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 1.4, DAIS_Z]}>
        <boxGeometry args={[0.9, 1.2, 0.5]} />
        <meshStandardMaterial color="#2e1f40" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.81, DAIS_Z + 0.62]}>
        <boxGeometry args={[7, 0.02, 0.06]} />
        <meshStandardMaterial color="#000" emissive="#c79bff" emissiveIntensity={4} />
      </mesh>
      {/* columns and plain banners round the back */}
      {columns.map((a, i) => (
        <group key={a} position={[Math.sin(a) * 10.5, 0, DAIS_Z - 3.5 + (1 - Math.cos(a)) * 3]}>
          <mesh position={[0, 4.5, 0]}>
            <cylinderGeometry args={[0.32, 0.38, 9, 20]} />
            <meshStandardMaterial color="#1d1428" roughness={0.5} metalness={0.3} />
          </mesh>
          {i % 2 === 0 && (
            <mesh position={[0, 5.2, 0.45]}>
              <planeGeometry args={[1.1, 4]} />
              <meshStandardMaterial color={i % 4 === 0 ? '#5b2f99' : '#3a2a7a'} emissive="#2a1050" emissiveIntensity={0.6} roughness={0.8} side={2} />
            </mesh>
          )}
        </group>
      ))}
      <mesh position={[0, 4.5, DAIS_Z - 4.5]}>
        <boxGeometry args={[24, 9, 0.4]} />
        <meshStandardMaterial color="#0f0a15" roughness={0.8} />
      </mesh>
    </DistrictSet>
  );
}
