'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Group, type InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { barrierBlocks, BLOCK } from '@/lib/corridorBlocks';
import { leftOf } from '@/lib/motion';
import { hasRoad, roadHeight } from '@/lib/ground';
import { useCityLayer } from './City';

/**
 * Concrete barriers just outside the car's corridor where the asset pipeline cut a kerb or a
 * median's nose back to clear it (scripts/clear-corridor.ts writes where, in
 * src/lib/corridor.data.ts): the street reads as closed off there rather than as a kerb that
 * stops short, and nothing stands in the corridor. Each block's inner face is on the line
 * the sweep laid, an amber reflector on it facing the road.
 */
export function CorridorBarriers() {
  const group = useRef<Group>(null!);
  useCityLayer(group);
  const blocks = useRef<InstancedMesh>(null!);
  const marks = useRef<InstancedMesh>(null!);

  const list = useMemo(() => barrierBlocks(), []);

  const reflector = useMemo(() => new MeshStandardMaterial({ color: '#1a1000', emissive: new Color('#ffab2e'), emissiveIntensity: 2.2 }), []);
  const placed = useRef(false);

  const place = (conform: boolean) => {
    const o = new Object3D();
    const l = new Vector3();
    list.forEach((b, i) => {
      const y = conform ? (roadHeight(b.pos.x, b.pos.z, b.pos.y) ?? b.pos.y) : b.pos.y;
      o.position.set(b.pos.x, y + BLOCK.h / 2, b.pos.z);
      o.rotation.set(0, b.yaw, 0);
      o.updateMatrix();
      blocks.current.setMatrixAt(i, o.matrix);
      // the reflector on the face toward the road
      leftOf(b.yaw, l);
      o.position.set(b.pos.x, y + BLOCK.h * 0.72, b.pos.z).addScaledVector(l, -b.side * (BLOCK.w / 2 + 0.005));
      o.updateMatrix();
      marks.current.setMatrixAt(i, o.matrix);
    });
    for (const im of [blocks, marks]) {
      im.current.count = list.length;
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
  };

  useLayoutEffect(() => {
    if (list.length) place(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // once the road is in: stand each block on the road under it
  useFrame(() => {
    if (placed.current || !list.length || !hasRoad()) return;
    placed.current = true;
    place(true);
  });

  if (!list.length) return null;
  return (
    <group ref={group}>
      <instancedMesh ref={blocks} args={[undefined, undefined, list.length]} castShadow={false}>
        <boxGeometry args={[BLOCK.w, BLOCK.h, BLOCK.l]} />
        <meshStandardMaterial color="#8e8f93" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={marks} args={[undefined, undefined, list.length]} material={reflector}>
        <boxGeometry args={[0.02, 0.12, 0.5]} />
      </instancedMesh>
    </group>
  );
}
