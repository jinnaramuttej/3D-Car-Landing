'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, type InstancedMesh, MathUtils, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { getRoute, sampleRoute } from '@/lib/cityRoute';
import { isMobile } from '@/lib/device';
import { carState, leftOf } from '@/lib/motion';
import { mulberry32 } from '@/lib/textures';

const vert = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aFade;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  vUv = uv;
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float dist = -mv.z;
  // far lights never shrink below a couple of pixels
  float size = max(0.32, dist * 0.0028);
  mv.xy += position.xy * size;
  vColor = aColor;
  vFade = aFade * exp(-dist * 0.0022);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = (exp(-r2 * 16.0) + exp(-r2 * 3.0) * 0.18) * vFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

type Car = { s0: number; v: number; dir: 1 | -1 };

const _p = new Vector3();
const _l = new Vector3();

/**
 * Distant traffic: pairs of head lights (coming the other way) and tail lights (going the
 * same way) running along the route's roads and over the bridge, as additive sprites (bloom
 * and depth of field make them bokeh). They only ever show well away from the car, so the
 * street the car is on stays its own; up close they fade out.
 */
export function Traffic() {
  const mobile = useMemo(() => isMobile(), []);
  const n = mobile ? 14 : 36;
  const mesh = useRef<InstancedMesh>(null!);

  const { cars, geometry, material, pos, fade } = useMemo(() => {
    const rnd = mulberry32(42);
    const len = getRoute().length;
    const cars: Car[] = Array.from({ length: n }, () => ({ s0: rnd() * len, v: 11 + rnd() * 9, dir: rnd() < 0.5 ? 1 : -1 }));
    const geometry = new PlaneGeometry(1, 1);
    const pos = new InstancedBufferAttribute(new Float32Array(n * 2 * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    const fade = new InstancedBufferAttribute(new Float32Array(n * 2), 1);
    fade.setUsage(DynamicDrawUsage);
    const col = new Float32Array(n * 2 * 3);
    cars.forEach((c, i) => {
      // oncoming: warm white head lights; going away: red tail lights
      const rgb = c.dir === -1 ? [3.2, 2.9, 2.4] : [3.4, 0.25, 0.15];
      col.set(rgb, i * 6);
      col.set(rgb, i * 6 + 3);
    });
    geometry.setAttribute('aPos', pos);
    geometry.setAttribute('aFade', fade);
    geometry.setAttribute('aColor', new InstancedBufferAttribute(col, 3));
    const material = new ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    return { cars, geometry, material, pos, fade };
  }, [n]);

  useLayoutEffect(() => {
    mesh.current.count = n * 2;
    mesh.current.frustumCulled = false;
    mesh.current.layers.set(1); // main camera only (not in the street reflection)
  }, [n]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const r = getRoute();
    const len = r.length;
    const lit = MathUtils.clamp(chapterState.env.city * 1.2, 0.3, 1);
    const p = pos.array as Float32Array;
    const f = fade.array as Float32Array;
    cars.forEach((c, i) => {
      const s = 20 + MathUtils.euclideanModulo(c.s0 + c.dir * c.v * t, len - 40);
      const h = sampleRoute(s, _p);
      leftOf(h, _l);
      const room = r.room(s);
      // keep to the right: oncoming on the left of the route's middle, the rest on the right
      const lane = c.dir === -1 ? Math.min(room[0] - 1.2, s > r.bridgeStart ? 7 : 2.8) : -Math.min(room[1] - 1.2, s > r.bridgeStart ? 3 : 2.8);
      _p.addScaledVector(_l, lane).setY(_p.y + 0.68);
      for (const k of [0, 1]) {
        const off = (k ? 0.72 : -0.72) * 1;
        p[(i * 2 + k) * 3] = _p.x + _l.x * off;
        p[(i * 2 + k) * 3 + 1] = _p.y;
        p[(i * 2 + k) * 3 + 2] = _p.z + _l.z * off;
        f[i * 2 + k] = MathUtils.smoothstep(Math.abs(s - carState.s), 70, 130) * lit;
      }
    });
    pos.needsUpdate = true;
    fade.needsUpdate = true;
  }, -0.5);

  return <instancedMesh ref={mesh} args={[geometry, material, n * 2]} />;
}
