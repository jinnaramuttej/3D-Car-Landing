'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BoxGeometry, Color, EdgesGeometry, type Group, ShaderMaterial } from 'three';
import { EXPO } from '@/content';
import { districtWeight } from '@/lib/chapterRuntime';
import { useDistricts } from '@/lib/districtState';
import { createHologramMaterial, DistrictSet, districtLights, tickHolograms } from './shared';

export const PEDESTAL_X = [-9, -3, 3, 9];

districtLights.expo = [
  { pos: [-6, 4, 3], color: '#5fe8ff', intensity: 150, distance: 16 },
  { pos: [6, 4, 3], color: '#5fe8ff', intensity: 150, distance: 16 },
  { pos: [0, 6, -4], color: '#b8d6ff', intensity: 140, distance: 18 },
];

type Holo = { mat: ShaderMaterial };

/** Unitree-style humanoid mid-stride, one arm up. */
function Humanoid({ mat }: Holo) {
  const cap = (r: number, l: number) => <capsuleGeometry args={[r, l, 4, 10]} />;
  return (
    <group position={[0, 0.1, 0]} scale={1.05}>
      <mesh material={mat} position={[0, 1.25, 0]}>
        <boxGeometry args={[0.38, 0.5, 0.22]} />
      </mesh>
      <mesh material={mat} position={[0, 0.92, 0]}>
        <boxGeometry args={[0.3, 0.16, 0.18]} />
      </mesh>
      <mesh material={mat} position={[0, 1.66, 0.02]}>
        <sphereGeometry args={[0.13, 20, 14]} />
      </mesh>
      <mesh material={mat} position={[0, 1.66, 0.12]}>
        <boxGeometry args={[0.16, 0.05, 0.04]} />
      </mesh>
      {/* arms: left raised, right swinging back */}
      <group position={[0.26, 1.45, 0]} rotation={[0, 0, 2.4]}>
        <mesh material={mat} position={[0, -0.17, 0]}>{cap(0.05, 0.26)}</mesh>
        <mesh material={mat} position={[0.06, -0.47, 0]} rotation-z={-0.4}>{cap(0.045, 0.24)}</mesh>
      </group>
      <group position={[-0.26, 1.45, 0]} rotation={[0.5, 0, -0.25]}>
        <mesh material={mat} position={[0, -0.17, 0]}>{cap(0.05, 0.26)}</mesh>
        <mesh material={mat} position={[0, -0.46, 0.08]} rotation-x={-0.5}>{cap(0.045, 0.24)}</mesh>
      </group>
      {/* legs mid-stride */}
      <group position={[0.1, 0.86, 0]} rotation-x={-0.35}>
        <mesh material={mat} position={[0, -0.22, 0]}>{cap(0.065, 0.3)}</mesh>
        <mesh material={mat} position={[0, -0.6, -0.06]} rotation-x={0.4}>{cap(0.055, 0.3)}</mesh>
      </group>
      <group position={[-0.1, 0.86, 0]} rotation-x={0.3}>
        <mesh material={mat} position={[0, -0.22, 0]}>{cap(0.065, 0.3)}</mesh>
        <mesh material={mat} position={[0, -0.6, 0.02]} rotation-x={-0.1}>{cap(0.055, 0.3)}</mesh>
      </group>
    </group>
  );
}

/** Three-legged hopper: a body on three springy legs. */
function Hopper({ mat }: Holo) {
  return (
    <group position={[0, 0.9, 0]}>
      <mesh material={mat}>
        <icosahedronGeometry args={[0.34, 1]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <group key={i} rotation-y={(i / 3) * Math.PI * 2}>
          <group position={[0.2, -0.1, 0]} rotation-z={0.9}>
            <mesh material={mat} position={[0, -0.25, 0]}>
              <capsuleGeometry args={[0.04, 0.4, 4, 8]} />
            </mesh>
            <group position={[0, -0.5, 0]} rotation-z={-1.5}>
              <mesh material={mat} position={[0, -0.25, 0]}>
                <capsuleGeometry args={[0.035, 0.42, 4, 8]} />
              </mesh>
            </group>
          </group>
        </group>
      ))}
    </group>
  );
}

/** Free-flyer cube with its two side propulsion modules and a little arm. */
function FreeFlyer({ mat }: Holo) {
  return (
    <group position={[0, 1.5, 0]}>
      <mesh material={mat}>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.38, 0, 0]}>
          <mesh material={mat}>
            <boxGeometry args={[0.14, 0.62, 0.62]} />
          </mesh>
          <mesh material={mat} position={[s * 0.08, 0, 0]} rotation-z={Math.PI / 2}>
            <torusGeometry args={[0.18, 0.02, 8, 24]} />
          </mesh>
        </group>
      ))}
      <mesh material={mat} position={[0, -0.38, 0.2]} rotation-x={0.6}>
        <capsuleGeometry args={[0.03, 0.25, 4, 8]} />
      </mesh>
    </group>
  );
}

/** A hologram booth: an outlined box with a life-size figure standing in it. */
function Booth({ mat }: Holo) {
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(1.0, 2.1, 0.6)), []);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group position={[0, 1.1, 0]}>
      <lineSegments geometry={edges} material={mat} />
      <group position={[0, -0.95, 0]} scale={0.95}>
        <mesh material={mat} position={[0, 1.25, 0]}>
          <capsuleGeometry args={[0.17, 0.42, 4, 10]} />
        </mesh>
        <mesh material={mat} position={[0, 1.72, 0]}>
          <sphereGeometry args={[0.12, 16, 12]} />
        </mesh>
        {[-0.08, 0.08].map((x) => (
          <mesh key={x} material={mat} position={[x, 0.5, 0]}>
            <capsuleGeometry args={[0.06, 0.62, 4, 8]} />
          </mesh>
        ))}
        {[-0.24, 0.24].map((x) => (
          <mesh key={x} material={mat} position={[x, 1.2, 0]} rotation-z={x > 0 ? 0.15 : -0.15}>
            <capsuleGeometry args={[0.045, 0.5, 4, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const EXHIBITS = [Humanoid, Hopper, FreeFlyer, Booth];

const beamMaterial = () =>
  new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#5fe8ff') }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = position.y + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBoost;
      varying float vY;
      void main() {
        float a = 0.12 * (1.0 - vY) * (1.0 + uBoost);
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: 2,
  });

/**
 * IX Expo: four holographic pedestals in a dark hall; the camera dollies along them.
 * Click a pedestal (or its hologram) to open its detail panel.
 */
export function Expo() {
  const holos = useMemo(() => EXPO.exhibits.map(() => createHologramMaterial('#5fe8ff')), []);
  const beams = useMemo(() => EXPO.exhibits.map(() => beamMaterial()), []);
  const spin = useRef<(Group | null)[]>([]);
  const hover = useRef<number | null>(null);
  useEffect(
    () => () => {
      holos.forEach((m) => m.dispose());
      beams.forEach((m) => m.dispose());
    },
    [holos, beams],
  );

  const tick = () => {
    const t = performance.now() / 1000;
    tickHolograms(holos, t);
    const open = useDistricts.getState().expoOpen;
    holos.forEach((m, i) => {
      const boost = (hover.current === i ? 0.6 : 0) + (open === i ? 0.9 : 0);
      m.uniforms.uBoost.value += (boost - m.uniforms.uBoost.value) * 0.15;
      beams[i].uniforms.uBoost.value = m.uniforms.uBoost.value;
    });
    spin.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y = t * 0.35 + i;
      if (i === 1) g.position.y = 0.95 + Math.abs(Math.sin(t * 2.2)) * 0.35; // the hopper hops
      if (i === 2) g.position.y = 0.95 + Math.sin(t * 1.3) * 0.08;
    });
  };

  const choose = (i: number) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (districtWeight('expo') < 0.6) return;
    const s = useDistricts.getState();
    s.setExpoOpen(s.expoOpen === i ? null : i);
  };

  return (
    <DistrictSet id="expo" onFrame={tick}>
      <mesh position={[0, -0.8, 0]}>
        <boxGeometry args={[34, 1.6, 22]} />
        <meshStandardMaterial color="#06090c" roughness={0.3} metalness={0.6} />
      </mesh>
      {/* back wall with thin light lines */}
      <mesh position={[0, 4, -6]}>
        <boxGeometry args={[34, 8, 0.3]} />
        <meshStandardMaterial color="#070b10" roughness={0.7} />
      </mesh>
      {[-12, -6, 0, 6, 12].map((x) => (
        <mesh key={x} position={[x, 4, -5.83]}>
          <boxGeometry args={[0.04, 7, 0.02]} />
          <meshStandardMaterial color="#000" emissive="#2fb8d8" emissiveIntensity={2.5} />
        </mesh>
      ))}
      {PEDESTAL_X.map((x, i) => {
        const Exhibit = EXHIBITS[i];
        return (
          <group key={i} position={[x, 0, 0]}>
            <group
              onClick={choose(i)}
              onPointerOver={(e) => {
                e.stopPropagation();
                hover.current = i;
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                hover.current = null;
                document.body.style.cursor = '';
              }}
            >
              <mesh position={[0, 0.45, 0]}>
                <cylinderGeometry args={[0.85, 1, 0.9, 40]} />
                <meshStandardMaterial color="#0d1318" metalness={0.8} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.91, 0]} rotation-x={-Math.PI / 2}>
                <ringGeometry args={[0.6, 0.8, 64]} />
                <meshBasicMaterial color="#5fe8ff" toneMapped={false} />
              </mesh>
              <mesh position={[0, 2.15, 0]} material={beams[i]}>
                <cylinderGeometry args={[0.95, 0.62, 2.5, 40, 1, true]} />
              </mesh>
              {/* invisible hit volume round the hologram */}
              <mesh position={[0, 2.1, 0]}>
                <cylinderGeometry args={[0.9, 0.9, 2.4, 16]} />
                <meshBasicMaterial colorWrite={false} depthWrite={false} />
              </mesh>
            </group>
            <group
              position={[0, 0.95, 0]}
              ref={(g) => {
                spin.current[i] = g;
              }}
            >
              <Exhibit mat={holos[i]} />
            </group>
          </group>
        );
      })}
    </DistrictSet>
  );
}
