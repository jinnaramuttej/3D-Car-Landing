'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type PointLight, Vector3 } from 'three';
import { theme } from '@/content';
import { BEATS, getParkedFrame } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { forwardOf, leftOf } from '@/lib/motion';

/** Parked-car-local (x left, y up, z forward) to world. */
function parkedToWorld(x: number, y: number, z: number) {
  const f = getParkedFrame();
  const fwd = forwardOf(f.heading, new Vector3());
  const left = leftOf(f.heading, new Vector3());
  return f.origin.clone().addScaledVector(left, x).addScaledVector(fwd, z).setY(y);
}

/**
 * An accent rim light behind the parked car (chapters IV, V and the finale). The lights
 * stay mounted at 0 the rest of the time: hiding a light recompiles every material.
 */
export function ChapterProps() {
  const rimL = useRef<PointLight>(null!);
  const rimR = useRef<PointLight>(null!);
  const accent = useMemo(() => new Color(theme.accent), []);
  const rimPos = useMemo(() => [parkedToWorld(2.4, 1.5, -3.8), parkedToWorld(-2.4, 1.5, -3.8)] as const, []);

  useFrame(() => {
    const b = chapterState.beat >= 0 ? BEATS[chapterState.beat] : null;
    const rim = b && b.frame === 'parked' ? chapterState.look.accent * 5 : 0;
    rimL.current.intensity = rimR.current.intensity = rim;
  }, -1);

  return (
    <group>
      <pointLight ref={rimL} position={rimPos[0]} color={accent} distance={10} decay={2} intensity={0} />
      <pointLight ref={rimR} position={rimPos[1]} color={accent} distance={10} decay={2} intensity={0} />
    </group>
  );
}
