'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, type Group, type InstancedMesh, MathUtils, type MeshStandardMaterial, Object3D, type PointLight, ShaderMaterial, Vector3 } from 'three';
import { chapterState, rainLevel } from '@/lib/chapterRuntime';
import { getRoute, sampleRoute } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState, leftOf } from '@/lib/motion';
import { nearestK } from '@/lib/nearest';
import { createGlowTexture } from '@/lib/textures';
import { hasRoad, roadHeight } from '@/lib/ground';

const _up = new Vector3();
import { useCityLayer } from './City';

/**
 * Every sodium lamp head in the city stage (world space): the route's lamps from here,
 * the bridge's from Bridge.tsx. The real lights follow the nearest of these.
 */
export const lampHeads: Vector3[] = [];
export const registerLamps = (heads: Vector3[]) => {
  for (const h of heads) lampHeads.push(h);
};

/** A soft cone of lamplight through the rain under each head (volumetric, faked). */
const shaftVert = /* glsl */ `
varying float vH;
varying vec3 vW;
varying vec3 vN;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  // 1 at the lamp, 0 at the road (from the world height: the cone's own uvs gave NaNs on
  // some GPUs through pow())
  float top = (m * vec4(0.0, 4.05, 0.0, 1.0)).y;
  vH = clamp(1.0 - (top - wp.y) / 8.1, 0.0, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const shaftFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying float vH;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  // soft edges (a cone seen side-on has none), bright under the lamp, gone by the road
  float edge = abs(dot(normalize(vN), V));
  edge *= sqrt(edge);
  float h = clamp(vH, 0.0, 1.0);
  float fall = h * h * (0.4 + 0.6 * h);
  // rain drifting through the beam
  float grain = 0.78 + 0.22 * sin(vW.y * 2.6 - uTime * 7.0 + vW.x * 1.3 + vW.z);
  float near = smoothstep(1.5, 6.0, length(cameraPosition - vW));
  float a = clamp(uOpacity * edge * fall * grain * near, 0.0, 1.0);
  gl_FragColor = vec4(uColor * a, a);
}
`;

const SPACING = 26;
const MAX = 80;

type Lamp = { base: Vector3; head: Vector3; yaw: number; road: number };

/**
 * Sodium street lamps along the city route: instanced posts, arms and heads, a cone of
 * light through the rain and a soft orange pool on the wet road under each, and a handful
 * of real point lights that follow the camera from lamp to lamp (lights cost every material
 * on screen: three here, the two headlights and the billboard spill make six in all; the
 * other lamps are emissive heads, shafts and pools only).
 */
export function StreetLights() {
  const mobile = useMemo(() => isMobile(), []);
  const count = mobile ? 2 : 3;
  const group = useRef<Group>(null!);
  useCityLayer(group);
  const poles = useRef<InstancedMesh>(null!);
  const arms = useRef<InstancedMesh>(null!);
  const heads = useRef<InstancedMesh>(null!);
  const pools = useRef<InstancedMesh>(null!);
  const shafts = useRef<InstancedMesh>(null!);
  const shaftMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(CONFIG.city.sodium) }, uOpacity: { value: 0 }, uTime: { value: 0 } },
        vertexShader: shaftVert,
        fragmentShader: shaftFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: false,
      }),
    [],
  );
  const headMat = useRef<MeshStandardMaterial>(null!);
  const lights = useRef<(PointLight | null)[]>([]);
  const glow = useMemo(() => createGlowTexture(), []);
  const sodium = useMemo(() => new Color(CONFIG.city.sodium), []);

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
      o.rotation.set(0, 0, 0);
      o.position.copy(lamp.head).setY(lamp.head.y - 4.05);
      o.updateMatrix();
      shafts.current.setMatrixAt(i, o.matrix);
    });
    for (const im of [poles, arms, heads, pools, shafts]) {
      im.current.count = lamps.length;
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
    pools.current.layers.set(1);
    shafts.current.layers.set(1);
  }, [lamps]);

  const _focus = useMemo(() => new Vector3(), []);
  const conformed = useRef(false);

  /**
   * Each lamp's pool of light lies on the road under it: fitted (height and tilt) to the road
   * sampled round its centre once the city's road is in. Laid flat at the route's height, a
   * pool on the ramp or a cambered street hovered over half of it.
   */
  const conformPools = () => {
    const o = new Object3D();
    const n = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    lamps.forEach((lamp, i) => {
      const x = lamp.head.x;
      const z = lamp.head.z;
      const h0 = roadHeight(x, z, lamp.road);
      if (h0 === null) return;
      const hx = roadHeight(x + 3, z, lamp.road) ?? h0;
      const hz = roadHeight(x, z + 3, lamp.road) ?? h0;
      a.set(3, hx - h0, 0);
      b.set(0, hz - h0, 3);
      n.crossVectors(b, a).normalize();
      if (n.y < 0.8) n.set(0, 1, 0);
      o.position.set(x, h0 + 0.04, z);
      o.quaternion.setFromUnitVectors(_up.set(0, 0, 1), n);
      o.updateMatrix();
      pools.current.setMatrixAt(i, o.matrix);
    });
    pools.current.instanceMatrix.needsUpdate = true;
    pools.current.computeBoundingSphere();
  };
  const near = useMemo(() => ({ idx: new Int32Array(count), d: new Float64Array(count) }), [count]);

  useFrame((state) => {
    if (!conformed.current && hasRoad()) {
      conformed.current = true;
      conformPools();
    }
    const e = chapterState.env;
    headMat.current.emissiveIntensity = CONFIG.city.sodiumEmissive * e.lamps;
    // the shafts show in the rain and the haze, and go with the lamps at dawn
    shaftMat.uniforms.uOpacity.value = CONFIG.city.lampShafts * e.lamps * (0.45 + 0.55 * Math.min(1, rainLevel()));
    shaftMat.uniforms.uTime.value = state.clock.elapsedTime;
    // real lights: the lamps nearest to what the camera is looking at
    _focus.copy(state.camera.position).lerp(carState.position, 0.6);
    nearestK(lampHeads, _focus, near.idx, near.d);
    for (let k = 0; k < count; k++) {
      const light = lights.current[k];
      if (!light) continue;
      const i = near.idx[k];
      if (i < 0) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(lampHeads[i]).y -= 0.4;
      const d = Math.sqrt(near.d[k]);
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
      <instancedMesh ref={shafts} args={[undefined, undefined, MAX]} material={shaftMat} renderOrder={3}>
        <cylinderGeometry args={[0.32, 3.3, 8.1, 20, 1, true]} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, MAX]} renderOrder={1}>
        <planeGeometry args={[12, 12]} />
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
