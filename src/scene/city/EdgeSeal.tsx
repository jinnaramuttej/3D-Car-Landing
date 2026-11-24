'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, type Group, type InstancedMesh, MeshStandardMaterial, Object3D, ShaderMaterial, Vector3 } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { CITY_ORIGIN, getRoute, sampleRoute } from '@/lib/cityRoute';
import { ROAD_ENDS } from '@/lib/cityRoute.data';
import { useCityLayer } from './City';

/** The city model's land, city-local (the sea is south of SOUTH_Z). */
const HALF_X = 430;
const NORTH_Z = -372;
const SOUTH_Z = 338;
const WALL_H = 230;

/** Road ends the model leaves open that the edge scan can't see (inside the map). */
const EXTRA_ENDS: [number, number, number, number, number][] = [
  // the flyover's west end, cut off in mid-air
  [-125.5, 29.8, 213.4, 0, 19],
];

type End = { pos: Vector3; yaw: number; width: number; out: Vector3 };

const wallVert = /* glsl */ `
varying float vH;
varying vec2 vUv;
void main() {
  vUv = uv;
  vH = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const wallFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vH;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
void main() {
  // solid fog at street level, thinning into the cloud higher up; a slow drift in it
  float drift = n(vec2(vUv.x * 18.0 + uTime * 0.03, vUv.y * 5.0)) * 0.25;
  float a = 1.0 - smoothstep(0.35, 1.0, vH + drift);
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * Closes the edges of the city so no camera sees past them: a soft fog wall round the
 * land (open to the south, where the sea and the bridge are), and concrete barriers with
 * blinking lights across every road the model leaves open, with a fog card behind each.
 */
export function EdgeSeal() {
  const group = useRef<Group>(null!);
  useCityLayer(group);
  const blocks = useRef<InstancedMesh>(null!);
  const lights = useRef<InstancedMesh>(null!);

  const ends = useMemo<End[]>(() => {
    const route = getRoute();
    const exit = new Vector3();
    sampleRoute(route.bridgeStart, exit);
    exit.sub(CITY_ORIGIN);
    return [...ROAD_ENDS, ...EXTRA_ENDS]
      .filter(([x, , z]) => Math.hypot(x - exit.x, z - exit.z) > 40) // (the flyover runs on onto the bridge)
      .map(([x, y, z, axis, width]) => ({
        pos: new Vector3(x, y, z).add(CITY_ORIGIN),
        yaw: axis === 0 ? 0 : Math.PI / 2,
        width,
        // away from the middle of the city, across the road
        out: axis === 0 ? new Vector3(Math.sign(x) || 1, 0, 0) : new Vector3(0, 0, Math.sign(z) || 1),
      }));
  }, []);

  const wallMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uTime: { value: 0 } },
        vertexShader: wallVert,
        fragmentShader: wallFrag,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    [],
  );
  const blinkMat = useMemo(() => new MeshStandardMaterial({ color: '#200', emissive: new Color('#ff2a1a'), emissiveIntensity: 6 }), []);

  const walls = useMemo(() => {
    const o = CITY_ORIGIN;
    const len = SOUTH_Z - NORTH_Z;
    return [
      { pos: new Vector3(o.x, WALL_H / 2 - 10, o.z + NORTH_Z), rot: 0, w: HALF_X * 2 },
      { pos: new Vector3(o.x - HALF_X, WALL_H / 2 - 10, o.z + (NORTH_Z + SOUTH_Z) / 2), rot: Math.PI / 2, w: len },
      { pos: new Vector3(o.x + HALF_X, WALL_H / 2 - 10, o.z + (NORTH_Z + SOUTH_Z) / 2), rot: Math.PI / 2, w: len },
    ];
  }, []);

  const counts = useMemo(() => {
    let b = 0;
    let l = 0;
    for (const e of ends) {
      b += Math.ceil(e.width / 2.1);
      l += Math.ceil(e.width / 4);
    }
    return { b: Math.max(1, b), l: Math.max(1, l) };
  }, [ends]);

  useLayoutEffect(() => {
    const o = new Object3D();
    let bi = 0;
    let li = 0;
    for (const e of ends) {
      const along = new Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      const n = Math.ceil(e.width / 2.1);
      for (let k = 0; k < n; k++) {
        o.position.copy(e.pos).addScaledVector(along, (k - (n - 1) / 2) * 2.1).setY(e.pos.y + 0.42);
        o.rotation.set(0, e.yaw, 0);
        o.updateMatrix();
        blocks.current.setMatrixAt(bi++, o.matrix);
      }
      const m = Math.ceil(e.width / 4);
      for (let k = 0; k < m; k++) {
        o.position.copy(e.pos).addScaledVector(along, (k - (m - 1) / 2) * 4).setY(e.pos.y + 0.95);
        o.updateMatrix();
        lights.current.setMatrixAt(li++, o.matrix);
      }
    }
    blocks.current.count = bi;
    lights.current.count = li;
    for (const im of [blocks, lights]) {
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
  }, [ends]);

  useFrame((state) => {
    group.current.visible = chapterState.stage === 'city' || chapterState.cloud > 0.2;
    (wallMat.uniforms.uColor.value as Color).copy(chapterState.env.fogColor);
    wallMat.uniforms.uTime.value = state.clock.elapsedTime;
    blinkMat.emissiveIntensity = Math.sin(state.clock.elapsedTime * 3.2) > 0 ? 6 : 0.6;
  });

  return (
    <group ref={group}>
      {walls.map((w, i) => (
        <mesh key={i} position={w.pos} rotation-y={w.rot} material={wallMat} renderOrder={-50}>
          <planeGeometry args={[w.w, WALL_H]} />
        </mesh>
      ))}
      {ends.map((e, i) => (
        // a fog card a few metres past each barrier hides whatever the open road runs into
        <mesh key={i} position={[e.pos.x + e.out.x * 8, e.pos.y + 12, e.pos.z + e.out.z * 8]} rotation-y={e.yaw + Math.PI / 2} material={wallMat}>
          <planeGeometry args={[e.width + 30, 60]} />
        </mesh>
      ))}
      <instancedMesh ref={blocks} args={[undefined, undefined, counts.b]}>
        <boxGeometry args={[0.6, 0.84, 2]} />
        <meshStandardMaterial color="#8e8f93" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[undefined, undefined, counts.l]} material={blinkMat}>
        <sphereGeometry args={[0.12, 8, 6]} />
      </instancedMesh>
    </group>
  );
}
