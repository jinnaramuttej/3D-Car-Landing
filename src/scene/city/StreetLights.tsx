'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, type Group, type InstancedMesh, MathUtils, type MeshStandardMaterial, Object3D, type PointLight, Vector3 } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { getRoute, sampleRoute } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState, leftOf } from '@/lib/motion';
import { createGlowTexture } from '@/lib/textures';

/**
 * Every sodium lamp head in the city stage (world space): the route's lamps from here,
 * the bridge's from Bridge.tsx. The real lights follow the nearest of these.
 */
export const lampHeads: Vector3[] = [];
export const registerLamps = (heads: Vector3[]) => {
  for (const h of heads) lampHeads.push(h);
};

const SPACING = 26;
const MAX = 80;

type Lamp = { base: Vector3; head: Vector3; yaw: number; road: number };

/**
 * Sodium street lamps along the city route: instanced posts, arms and heads, a soft
 * orange pool on the wet road under each, and a handful of real point lights that follow
 * the camera from lamp to lamp (lights cost every material on screen, so the far lamps
 * are emissive and their pools only).
 */
export function StreetLights() {
  const mobile = useMemo(() => isMobile(), []);
  const count = mobile ? 2 : 6;
  const group = useRef<Group>(null!);
  const poles = useRef<InstancedMesh>(null!);
  const arms = useRef<InstancedMesh>(null!);
  const heads = useRef<InstancedMesh>(null!);
  const pools = useRef<InstancedMesh>(null!);
  const headMat = useRef<MeshStandardMaterial>(null!);
  const lights = useRef<(PointLight | null)[]>([]);
  const glow = useMemo(() => createGlowTexture(), []);
  const sodium = useMemo(() => new Color(CONFIG.coast.sodium), []);

  const lamps = useMemo(() => {
    const r = getRoute();
    const out: Lamp[] = [];
    const p = new Vector3();
    const l = new Vector3();
    let side = 1;
    for (let s = 14; s < r.bridgeStart - 12 && out.length < MAX; s += SPACING) {
      const h = sampleRoute(s, p);
      leftOf(h, l);
      const room = r.room(s)[side === 1 ? 0 : 1];
      const off = MathUtils.clamp(room + 0.7, 4.5, 11);
      const base = p.clone().addScaledVector(l, side * off);
      const head = base.clone().addScaledVector(l, -side * 2.3).setY(p.y + 8.3);
      out.push({ base, head, yaw: Math.atan2(-side * l.x, -side * l.z), road: p.y });
      side = -side;
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    registerLamps(lamps.map((l) => l.head));
    const o = new Object3D();
    lamps.forEach((lamp, i) => {
      o.rotation.set(0, lamp.yaw, 0);
      o.position.copy(lamp.base).setY(lamp.road + 4.4);
      o.updateMatrix();
      poles.current.setMatrixAt(i, o.matrix);
      o.position.copy(lamp.base).lerp(lamp.head, 0.5).setY(lamp.road + 8.7);
      o.updateMatrix();
      arms.current.setMatrixAt(i, o.matrix);
      o.position.copy(lamp.head);
      o.updateMatrix();
      heads.current.setMatrixAt(i, o.matrix);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.position.copy(lamp.head).setY(lamp.road + 0.04);
      o.updateMatrix();
      pools.current.setMatrixAt(i, o.matrix);
    });
    for (const im of [poles, arms, heads, pools]) {
      im.current.count = lamps.length;
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
    pools.current.layers.set(1);
  }, [lamps]);

  const _focus = useMemo(() => new Vector3(), []);
  const order = useMemo(() => [] as { i: number; d: number }[], []);

  useFrame((state) => {
    const on = chapterState.stage === 'city';
    group.current.visible = on || chapterState.cloud > 0.2;
    const e = chapterState.env;
    headMat.current.emissiveIntensity = CONFIG.coast.sodiumEmissive * e.lamps;
    // real lights: the lamps nearest to what the camera is looking at
    _focus.copy(state.camera.position).lerp(carState.position, 0.6);
    order.length = 0;
    if (on) for (let i = 0; i < lampHeads.length; i++) order.push({ i, d: lampHeads[i].distanceToSquared(_focus) });
    order.sort((a, b) => a.d - b.d);
    for (let k = 0; k < count; k++) {
      const light = lights.current[k];
      if (!light) continue;
      const pick = order[k];
      if (!pick) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(lampHeads[pick.i]).y -= 0.4;
      const d = Math.sqrt(pick.d);
      light.intensity = CONFIG.city.lampLight * e.lamps * (1 - MathUtils.smoothstep(d, 45, 70));
    }
  }, -1);

  return (
    <group ref={group}>
      <instancedMesh ref={poles} args={[undefined, undefined, MAX]}>
        <cylinderGeometry args={[0.09, 0.15, 8.8, 8]} />
        <meshStandardMaterial color="#17191e" roughness={0.45} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={arms} args={[undefined, undefined, MAX]}>
        <boxGeometry args={[0.12, 0.12, 2.6]} />
        <meshStandardMaterial color="#17191e" roughness={0.45} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, MAX]}>
        <boxGeometry args={[0.5, 0.16, 1.05]} />
        <meshStandardMaterial ref={headMat} color="#111" emissive={sodium} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, MAX]} renderOrder={1}>
        <planeGeometry args={[17, 17]} />
        <meshBasicMaterial map={glow} color={sodium} transparent opacity={0.07} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {Array.from({ length: count }, (_, k) => (
        <pointLight
          key={k}
          ref={(l) => {
            lights.current[k] = l;
          }}
          color={sodium}
          distance={34}
          decay={2}
          intensity={0}
        />
      ))}
    </group>
  );
}
