'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  Vector3,
} from 'three';
import { schedule, theme } from '@/content';
import { forwardOf, leftOf } from '@/lib/motion';
import { sectionState } from '@/lib/sectionRuntime';
import { getParkedFrame, SCHEDULE_POSTS } from '@/lib/sections';
import { createGlowTexture } from '@/lib/textures';

/** Parked-car-local (x left, y up, z forward) to world. */
function parkedToWorld(x: number, y: number, z: number) {
  const f = getParkedFrame();
  const fwd = forwardOf(f.heading, new Vector3());
  const left = leftOf(f.heading, new Vector3());
  return f.origin.clone().addScaledVector(left, x).addScaledVector(fwd, z).setY(y);
}

function Post({ index, accent }: { index: number; accent: Color }) {
  const z = SCHEDULE_POSTS.firstZ + index * SCHEDULE_POSTS.spacing;
  const x = SCHEDULE_POSTS.x;
  const base = useMemo(() => parkedToWorld(x, 0, z), [x, z]);
  const heading = getParkedFrame().heading;
  const strip = useRef<MeshStandardMaterial>(null!);
  const cap = useRef<MeshStandardMaterial>(null!);
  const pool = useRef<MeshBasicMaterial>(null!);
  const light = useRef<PointLight>(null!);
  const glowTex = useMemo(() => createGlowTexture(), []);
  const poolMesh = useRef<Mesh>(null!);
  const meshes = useRef<Group>(null!);

  useLayoutEffect(() => {
    poolMesh.current.layers.set(1); // keep the decal out of the ground reflection
  }, []);

  useFrame(() => {
    const lit = sectionState.scheduleLit[index] ?? 0;
    // Only meshes are hidden during the drift. Lights stay mounted at 0: hiding a light
    // changes the light count and recompiles every material (a visible hitch).
    meshes.current.visible = sectionState.active;
    strip.current.emissiveIntensity = 0.3 + lit * 9;
    cap.current.emissiveIntensity = 0.5 + lit * 14;
    pool.current.opacity = lit * 0.45;
    light.current.intensity = sectionState.active ? lit * 14 : 0;
  }, -1);

  return (
    <group position={base} rotation-y={heading}>
      <group ref={meshes} visible={false}>
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.06, 0.09, 5, 10]} />
        <meshStandardMaterial color="#15161a" metalness={0.7} roughness={0.4} />
      </mesh>
      {/* neon strip faces the road (+x = toward the track for a right-hand post) */}
      <mesh position={[0.08, 2.65, 0]}>
        <boxGeometry args={[0.07, 4.3, 0.07]} />
        <meshStandardMaterial ref={strip} color="#000" emissive={accent} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 5.05, 0]}>
        <sphereGeometry args={[0.11, 16, 12]} />
        <meshStandardMaterial ref={cap} color="#000" emissive={accent} emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={poolMesh} position={[1.5, 0.025, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[7, 7]} />
        <meshBasicMaterial
          ref={pool}
          map={glowTex}
          color={accent}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      </group>
      <pointLight ref={light} position={[0.8, 2.2, 0]} color={accent} distance={14} decay={2} intensity={0} />
    </group>
  );
}

/**
 * Things that only exist after the drift: one neon post per schedule day down the
 * track, and a neon rim light behind the parked car. Hidden during the drift scene.
 */
export function SectionProps() {
  const rimL = useRef<PointLight>(null!);
  const rimR = useRef<PointLight>(null!);
  const accent = useMemo(() => new Color(theme.accent), []);
  const rimPos = useMemo(() => [parkedToWorld(2.4, 1.5, -3.8), parkedToWorld(-2.4, 1.5, -3.8)] as const, []);

  useFrame(() => {
    const rim = sectionState.active ? sectionState.look.accent * 5 : 0;
    rimL.current.intensity = rimR.current.intensity = rim;
  }, -1);

  return (
    <group>
      {schedule.days.map((_, i) => (
        <Post key={i} index={i} accent={accent} />
      ))}
      <pointLight ref={rimL} position={rimPos[0]} color={accent} distance={10} decay={2} intensity={0} />
      <pointLight ref={rimR} position={rimPos[1]} color={accent} distance={10} decay={2} intensity={0} />
    </group>
  );
}
