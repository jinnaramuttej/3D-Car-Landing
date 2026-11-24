'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  MathUtils,
  type Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { CONFIG } from '@/lib/config';
import { carState } from '@/lib/motion';
import { isMobile } from '@/lib/device';
import { onWarmupEnd } from '@/lib/warmup';

const vert = /* glsl */ `
attribute float aAlpha;
varying float vA;
varying vec2 vUv;
void main() {
  vA = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */ `
uniform float uOpacity;
varying float vA;
varying vec2 vUv;
void main() {
  float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
  float tread = 0.72 + 0.28 * sin(vUv.x * 44.0);
  float grain = 0.8 + 0.2 * fract(sin(dot(floor(vUv * vec2(8.0, 30.0)), vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(vec3(0.01), vA * edge * tread * grain * uOpacity);
}
`;

type Ribbon = {
  started: boolean;
  edges: boolean;
  center: Vector3;
  left: Vector3;
  right: Vector3;
  alpha: number;
  v: number;
};

const Y = 0.012;
const MIN_STEP = 0.2; // metres between ribbon points
const MAX_STEP = 6; // larger jumps (debug jumps) restart the ribbon instead of drawing a bar

/**
 * Two rubber ribbons laid by the rear tyres while slip > minSlip.
 * Independent quads in a ring buffer: when it fills up, the oldest marks get reused.
 */
export function SkidMarks() {
  const quads = useMemo(() => (isMobile() ? 500 : 1000), []);
  const mesh = useRef<Mesh>(null!);

  const { geometry, material } = useMemo(() => {
    const geometry = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(quads * 4 * 3), 3).setUsage(DynamicDrawUsage);
    const uv = new BufferAttribute(new Float32Array(quads * 4 * 2), 2).setUsage(DynamicDrawUsage);
    const alpha = new BufferAttribute(new Float32Array(quads * 4), 1).setUsage(DynamicDrawUsage);
    const index = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      index.set([v, v + 2, v + 1, v + 2, v + 3, v + 1], q * 6);
    }
    geometry.setAttribute('position', pos);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute('aAlpha', alpha);
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);

    const material = new ShaderMaterial({
      uniforms: { uOpacity: { value: CONFIG.skid.opacity } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    return { geometry, material };
  }, [quads]);

  const state = useMemo(
    () => ({
      cursor: 0,
      used: 0,
      ribbons: [0, 1].map(
        (): Ribbon => ({
          started: false,
          edges: false,
          center: new Vector3(),
          left: new Vector3(),
          right: new Vector3(),
          alpha: 0,
          v: 0,
        }),
      ),
    }),
    [],
  );

  useLayoutEffect(() => {
    mesh.current.layers.set(1); // not needed in the ground reflection
  }, []);

  // the warm-up drives through the drift: wipe what it laid down
  useEffect(
    () =>
      onWarmupEnd(() => {
        state.cursor = 0;
        state.used = 0;
        for (const r of state.ribbons) r.started = false;
        geometry.setDrawRange(0, 0);
      }),
    [state, geometry],
  );

  useFrame(() => {
    const s = carState;
    if (!s.carReady) return;
    const cfg = CONFIG.skid;
    material.uniforms.uOpacity.value = cfg.opacity;

    const on = s.slip > cfg.minSlip;
    const a = on ? MathUtils.clamp((s.slip - cfg.minSlip) / Math.max(1e-3, 1 - cfg.minSlip), 0, 1) : 0;
    const hw = cfg.width / 2;
    const pos = geometry.attributes.position.array as Float32Array;
    const uv = geometry.attributes.uv.array as Float32Array;
    const alpha = geometry.attributes.aAlpha.array as Float32Array;
    let wrote = false;

    for (let w = 0; w < 2; w++) {
      const r = state.ribbons[w];
      const c = s.rearContacts[w];
      if (!on) {
        r.started = false;
        continue;
      }
      if (!r.started) {
        r.started = true;
        r.edges = false;
        r.center.copy(c);
        r.alpha = a;
        continue;
      }
      const dx = c.x - r.center.x;
      const dz = c.z - r.center.z;
      const len = Math.hypot(dx, dz);
      if (len < MIN_STEP) continue;
      if (len > MAX_STEP) {
        r.center.copy(c);
        r.edges = false;
        continue;
      }
      const px = (dz / len) * hw;
      const pz = (-dx / len) * hw;
      // (heights follow the road: the city climbs)
      const y0 = r.center.y + Y;
      const y1 = c.y + Y;
      if (!r.edges) {
        r.left.set(r.center.x + px, y0, r.center.z + pz);
        r.right.set(r.center.x - px, y0, r.center.z - pz);
      }
      const q = state.cursor;
      state.cursor = (q + 1) % quads;
      state.used = Math.min(state.used + 1, quads);

      const v0 = r.v / 1.2;
      const v1 = (r.v + len) / 1.2;
      const p = q * 12;
      pos.set([r.left.x, r.left.y, r.left.z, r.right.x, r.right.y, r.right.z, c.x + px, y1, c.z + pz, c.x - px, y1, c.z - pz], p);
      uv.set([0, v0, 1, v0, 0, v1, 1, v1], q * 8);
      alpha.set([r.alpha, r.alpha, a, a], q * 4);

      r.left.set(c.x + px, y1, c.z + pz);
      r.right.set(c.x - px, y1, c.z - pz);
      r.center.copy(c);
      r.alpha = a;
      r.v += len;
      r.edges = true;
      wrote = true;
    }

    if (wrote) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.uv.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.setDrawRange(0, state.used * 6);
    }
  }, -1);

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}
