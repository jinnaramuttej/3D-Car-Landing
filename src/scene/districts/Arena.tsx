'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  type Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Mesh,
  Plane,
  PlaneGeometry,
  Raycaster,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { getDistrictFrame } from '@/lib/chapters';
import { districtWeight } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { useDistricts } from '@/lib/districtState';
import { interaction, isUiTarget } from '@/lib/interaction';
import { DistrictSet, districtLights } from './shared';

const R = 6.6; // octagon circumradius
const SIDES = 8;
const ORANGE = '#ff6a1a';

districtLights.arena = [
  { pos: [4.5, 4.5, 4.5], color: ORANGE, intensity: 420, distance: 26 },
  { pos: [-4.5, 4.5, -4.5], color: ORANGE, intensity: 420, distance: 26 },
  { pos: [0, 7.5, 0], color: '#d9e2ff', intensity: 320, distance: 22 },
  { pos: [-5, 2.5, 7], color: '#ff8a3a', intensity: 120, distance: 16 },
];

/* ------------------------------------------------------------------ sparks */

const sparkVert = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute float aLife;
varying float vLife;
varying vec2 vUv;
void main() {
  vUv = uv;
  vLife = aLife;
  float speed = length(aVel);
  vec3 axis = speed > 1e-4 ? aVel / speed : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - aPos);
  vec3 side = normalize(cross(axis, toCam) + 1e-5);
  float len = 0.03 + speed * 0.028;
  vec3 wp = aPos + axis * position.y * len + side * position.x * 0.014;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const sparkFrag = /* glsl */ `
varying float vLife;
varying vec2 vUv;
void main() {
  if (vLife <= 0.0) discard;
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  vec3 hot = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.95, 0.75), smoothstep(0.35, 1.0, vLife));
  float a = across * smoothstep(0.0, 0.25, vLife);
  gl_FragColor = vec4(hot * 6.0 * a, a);
}
`;

function Sparks({ api }: { api: { burst?: (p: Vector3, n: number) => void } }) {
  const mobile = useMemo(() => isMobile(), []);
  const max = mobile ? 300 : 700;
  const sim = useMemo(() => {
    const geo = new InstancedBufferGeometry();
    const base = new PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const attr = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    const pos = attr(3);
    const vel = attr(3);
    const life = attr(1);
    geo.setAttribute('aPos', pos);
    geo.setAttribute('aVel', vel);
    geo.setAttribute('aLife', life);
    geo.instanceCount = max;
    const mat = new ShaderMaterial({
      vertexShader: sparkVert,
      fragmentShader: sparkFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    return { geo, mat, pos, vel, life, age: new Float32Array(max), span: new Float32Array(max), cursor: 0, alive: true };
  }, [max]);

  useEffect(() => {
    api.burst = (p: Vector3, n: number) => {
      const count = Math.round(n * (mobile ? 0.5 : 1));
      const P = sim.pos.array as Float32Array;
      const V = sim.vel.array as Float32Array;
      for (let k = 0; k < count; k++) {
        const i = sim.cursor;
        sim.cursor = (i + 1) % max;
        P.set([p.x, p.y + 0.05, p.z], i * 3);
        const a = Math.random() * Math.PI * 2;
        const up = 0.35 + Math.random() * 0.9;
        const sp = 3 + Math.random() * 7;
        V.set([Math.cos(a) * sp * (1 - up * 0.5), up * sp, Math.sin(a) * sp * (1 - up * 0.5)], i * 3);
        sim.age[i] = 0;
        sim.span[i] = 0.5 + Math.random() * 0.9;
      }
    };
    return () => {
      api.burst = undefined;
    };
  }, [api, sim, max, mobile]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const P = sim.pos.array as Float32Array;
    const V = sim.vel.array as Float32Array;
    const L = sim.life.array as Float32Array;
    const drag = Math.exp(-1.2 * dt);
    let any = false;
    for (let i = 0; i < max; i++) {
      if (sim.span[i] <= 0) {
        L[i] = 0;
        continue;
      }
      sim.age[i] += dt;
      const t = sim.age[i] / sim.span[i];
      if (t >= 1) {
        sim.span[i] = 0;
        L[i] = 0;
        continue;
      }
      any = true;
      const o = i * 3;
      V[o] *= drag;
      V[o + 2] *= drag;
      V[o + 1] = V[o + 1] * drag - 9.8 * dt;
      P[o] += V[o] * dt;
      P[o + 1] += V[o + 1] * dt;
      P[o + 2] += V[o + 2] * dt;
      if (P[o + 1] < 0.01 && V[o + 1] < 0) {
        // skitter along the steel
        P[o + 1] = 0.01;
        V[o + 1] *= -0.3;
        V[o] *= 0.6;
        V[o + 2] *= 0.6;
      }
      L[i] = 1 - t;
    }
    // upload while anything is alive, plus one frame after the last one dies
    if (any || sim.alive) {
      sim.pos.needsUpdate = true;
      sim.vel.needsUpdate = true;
      sim.life.needsUpdate = true;
    }
    sim.alive = any;
  });

  return <mesh geometry={sim.geo} material={sim.mat} frustumCulled={false} renderOrder={14} />;
}

/* ------------------------------------------------------------------- robot */

/** A combat robot from primitives: wedge chassis, four wheels, a bar spinner on top. */
function Robot({ spinRef }: { spinRef: React.RefObject<Mesh | null> }) {
  return (
    <group>
      <mesh position={[0, 0.17, 0]}>
        <boxGeometry args={[0.9, 0.22, 1.0]} />
        <meshStandardMaterial color="#2b2e33" metalness={0.75} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.11, 0.62]} rotation-x={0.42}>
        <boxGeometry args={[0.92, 0.04, 0.42]} />
        <meshStandardMaterial color="#3a3d43" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.3, -0.05]}>
        <boxGeometry args={[0.72, 0.04, 0.66]} />
        <meshStandardMaterial color="#d2551f" metalness={0.3} roughness={0.5} />
      </mesh>
      {[-0.5, 0.5].map((x) =>
        [-0.32, 0.3].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.14, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.14, 0.14, 0.1, 18]} />
            <meshStandardMaterial color="#0d0d0f" roughness={0.9} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.37, -0.05]}>
        <cylinderGeometry args={[0.09, 0.11, 0.1, 16]} />
        <meshStandardMaterial color="#5a5e66" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh ref={spinRef} position={[0, 0.44, -0.05]}>
        <boxGeometry args={[1.35, 0.05, 0.15]} />
        <meshStandardMaterial color="#9aa0a8" metalness={0.95} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.3, -0.5]}>
        <sphereGeometry args={[0.035, 10, 8]} />
        <meshStandardMaterial color="#000" emissive="#ff2a1a" emissiveIntensity={6} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ arena */

/**
 * VI Arena (Robowars): an octagonal steel cage, orange rim lights, a robot that scales
 * with the chosen weight class, and sparks wherever you click the floor.
 */
export function Arena() {
  const camera = useThree((s) => s.camera);
  const robot = useRef<Group>(null!);
  const spin = useRef<Mesh>(null);
  const sparks = useMemo(() => ({}) as { burst?: (p: Vector3, n: number) => void }, []);
  const state = useMemo(() => ({ scale: 1, hop: 0, down: 0, x: 0, y: 0 }), []);

  const apothem = R * Math.cos(Math.PI / SIDES);
  const side = 2 * R * Math.sin(Math.PI / SIDES);
  const faces = useMemo(() => Array.from({ length: SIDES }, (_, i) => (i + 0.5) * ((Math.PI * 2) / SIDES)), []);
  const corners = useMemo(() => Array.from({ length: SIDES }, (_, i) => i * ((Math.PI * 2) / SIDES)), []);

  // a class change: a little hop and a shower of sparks off the spinner
  useEffect(
    () =>
      useDistricts.subscribe((s, prev) => {
        if (s.arenaClass === prev.arenaClass) return;
        state.hop = 1;
        if (robot.current) sparks.burst?.(robot.current.getWorldPosition(new Vector3()).setY(0.4), CONFIG.districts.sparks * 0.6);
      }),
    [sparks, state],
  );

  // click the floor for sparks
  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const floor = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const onDown = (e: PointerEvent) => {
      if (isUiTarget(e.target)) return;
      state.down = performance.now();
      state.x = e.clientX;
      state.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (!state.down || isUiTarget(e.target)) return;
      const quick = performance.now() - state.down < 350 && Math.hypot(e.clientX - state.x, e.clientY - state.y) < 8;
      state.down = 0;
      if (!quick || districtWeight('arena') < 0.6) return;
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(floor, hit)) return;
      const o = getDistrictFrame('arena').origin;
      const d = Math.hypot(hit.x - o.x, hit.z - o.z);
      if (d > apothem - 0.2) hit.set(o.x + ((hit.x - o.x) / d) * (apothem - 0.4), 0, o.z + ((hit.z - o.z) / d) * (apothem - 0.4));
      sparks.burst?.(hit, CONFIG.districts.sparks);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, sparks, state, apothem]);

  const tick = () => {
    const t = performance.now() / 1000;
    const kg = useDistricts.getState().arenaClass;
    const target = 1.15 * Math.cbrt(kg / 8);
    state.scale += (target - state.scale) * 0.08;
    state.hop *= 0.9;
    const g = robot.current;
    g.scale.setScalar(state.scale);
    g.position.set(Math.sin(t * 0.7) * 0.4, Math.abs(Math.sin(state.hop * Math.PI)) * 0.25 * state.hop, Math.sin(t * 0.45) * 0.3);
    g.rotation.y = Math.sin(t * 0.5) * 0.35;
    // the spinner idles, and winds right up when the visitor revs
    if (spin.current) spin.current.rotation.y += CONFIG.districts.robotSpin * (0.35 + 0.65 * interaction.rev) * (1 / 60);
  };

  return (
    <DistrictSet id="arena" onFrame={tick}>
      {/* steel floor and plate seams */}
      <mesh position={[0, -0.15, 0]} rotation-y={Math.PI / SIDES}>
        <cylinderGeometry args={[R, R, 0.3, SIDES]} />
        <meshStandardMaterial color="#25272b" metalness={0.85} roughness={0.42} />
      </mesh>
      <gridHelper args={[R * 2, 10, '#3d4046', '#33363b']} position={[0, 0.004, 0]} />
      {/* platform out over the water */}
      <mesh position={[0, -0.8, 0]}>
        <cylinderGeometry args={[15, 15.5, 1.6, 40]} />
        <meshStandardMaterial color="#15161a" roughness={0.9} />
      </mesh>
      {/* stands: three low stepped tiers (the camera looks in over them) */}
      {[
        [8.6, 0.35],
        [9.6, 0.7],
        [10.6, 1.05],
      ].map(([r, h]) => (
        <group key={r}>
          <mesh position={[0, h / 2, 0]}>
            <cylinderGeometry args={[r, r, h, 48, 1, true]} />
            <meshStandardMaterial color="#1b1c20" roughness={0.85} side={DoubleSide} />
          </mesh>
          <mesh position={[0, h, 0]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[r, r + 1, 48]} />
            <meshStandardMaterial color="#202126" roughness={0.8} side={DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* walls: polycarbonate panels between steel posts */}
      {faces.map((a) => (
        <group key={a} rotation-y={a}>
          <mesh position={[0, 1.6, apothem]}>
            <boxGeometry args={[side, 3.2, 0.04]} />
            <meshStandardMaterial color="#9fb2c4" transparent opacity={0.07} roughness={0.1} metalness={0} depthWrite={false} />
          </mesh>
          <mesh position={[0, 3.25, apothem]}>
            <boxGeometry args={[side, 0.12, 0.12]} />
            <meshStandardMaterial color="#2f3237" metalness={0.8} roughness={0.4} />
          </mesh>
          {/* orange rim light along the foot of each wall */}
          <mesh position={[0, 0.05, apothem - 0.12]}>
            <boxGeometry args={[side * 0.96, 0.05, 0.06]} />
            <meshStandardMaterial color="#000" emissive={ORANGE} emissiveIntensity={5} />
          </mesh>
          {/* and up in the truss */}
          <mesh position={[0, 7.2, apothem * 0.75]}>
            <boxGeometry args={[side * 0.7, 0.08, 0.08]} />
            <meshStandardMaterial color="#000" emissive={ORANGE} emissiveIntensity={4} />
          </mesh>
          <mesh position={[0, 7.4, apothem * 0.75]}>
            <boxGeometry args={[side * 0.75, 0.18, 0.18]} />
            <meshStandardMaterial color="#202227" metalness={0.7} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {corners.map((a) => (
        <mesh key={a} position={[Math.sin(a) * R, 1.7, Math.cos(a) * R]}>
          <boxGeometry args={[0.18, 3.4, 0.18]} />
          <meshStandardMaterial color="#2f3237" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      <group ref={robot}>
        <Robot spinRef={spin} />
      </group>
      <Sparks api={sparks} />
    </DistrictSet>
  );
}
