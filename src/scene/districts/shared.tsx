'use client';

import { type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  type Group,
  type PointLight,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { type DistrictId, getDistrictFrame } from '@/lib/chapters';
import { chapterState, districtVisible, districtWeight } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';

/**
 * Places a district's set on its platform and only draws it while its chapter (or a
 * neighbour, during the move) is on screen. Everything inside lands on layer 1, so the
 * wet-road reflection and the car's contact shadows never render it.
 */
export function DistrictSet({ id, children, onFrame }: { id: DistrictId; children: ReactNode; onFrame?: () => void }) {
  const group = useRef<Group>(null!);
  const frame = useMemo(() => getDistrictFrame(id), [id]);
  useLayoutEffect(() => {
    group.current.traverse((o) => o.layers.set(1));
  });
  useFrame(() => {
    const on = districtVisible(id);
    group.current.visible = on;
    if (on) onFrame?.();
  }, -1);
  return (
    <group ref={group} position={frame.origin} rotation-y={frame.heading}>
      {children}
    </group>
  );
}

/** A light a district wants; `intensity` may be changed every frame (the heartbeat). */
export type DistrictLight = { pos: [number, number, number]; color: string; intensity: number; distance: number };
export const districtLights: Partial<Record<DistrictId, DistrictLight[]>> = {};

const POOL = 4;
const _w = new Vector3();

/**
 * Four point lights shared by every district (lights cost every material on screen, so
 * the sets don't get their own). They follow whichever district is on screen and dip
 * to nothing in the middle of a move, while the fog is at its thickest.
 */
export function DistrictLights() {
  const refs = useRef<(PointLight | null)[]>([]);
  useFrame(() => {
    let dom: DistrictId | null = null;
    let best = 0;
    for (const id of Object.keys(districtLights) as DistrictId[]) {
      const w = districtWeight(id);
      if (w > best) {
        best = w;
        dom = id;
      }
    }
    const specs = dom ? districtLights[dom] ?? [] : [];
    const fade = Math.max(0, (best - 0.5) * 2);
    const frame = dom ? getDistrictFrame(dom) : null;
    for (let i = 0; i < POOL; i++) {
      const l = refs.current[i];
      if (!l) continue;
      const s = specs[i];
      if (!s || !frame) {
        l.intensity = 0;
        continue;
      }
      const f = Math.sin(frame.heading);
      const c = Math.cos(frame.heading);
      // frame-local (x left, z forward) to world
      _w.set(frame.origin.x + s.pos[0] * c + s.pos[2] * f, s.pos[1], frame.origin.z - s.pos[0] * f + s.pos[2] * c);
      l.position.copy(_w);
      l.color.set(s.color);
      l.distance = s.distance;
      l.intensity = s.intensity * fade * (1 - 0.6 * chapterState.transition);
    }
  }, -1);
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            refs.current[i] = l;
          }}
          intensity={0}
          decay={2}
          distance={20}
        />
      ))}
    </>
  );
}

/** Holographic look: fresnel edge, scanlines, a little flicker. Additive. */
export function createHologramMaterial(color = '#5fe8ff') {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uBoost: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uBoost;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float scan = 0.65 + 0.35 * sin(vW.y * 90.0 - uTime * 5.0);
        float band = smoothstep(0.0, 0.08, fract(vW.y * 0.6 - uTime * 0.35)) * 0.5 + 0.5;
        float flicker = 0.92 + 0.08 * sin(uTime * 37.0) * sin(uTime * 13.0);
        float a = (0.12 + fres * 0.9) * scan * band * flicker * uOpacity * (1.0 + uBoost);
        gl_FragColor = vec4(uColor * (1.4 + uBoost), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** Ticks every hologram material's clock and brightness knob. */
export function tickHolograms(mats: ShaderMaterial[], t: number) {
  for (const m of mats) {
    m.uniforms.uTime.value = t;
    m.uniforms.uOpacity.value = CONFIG.districts.hologram;
  }
}

/** The display font next/font loaded, for canvas text. */
export function displayFont() {
  if (typeof document === 'undefined') return "'Arial Black', sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return v ? `${v}, 'Arial Black', sans-serif` : "'Arial Black', sans-serif";
}

/** A canvas texture, redrawn once the display font has loaded. */
export function textTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const paint = () => {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    draw(g, displayFont());
    tex.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);
  return tex;
}

/** Shared radial glow sprite material (additive). */
export function glowMaterial(color: string, opacity = 1) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 s = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), 1.0);
        mv.xy += position.xy * s.xy;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = (exp(-r * r * 6.0) + exp(-r * r * 1.5) * 0.25) * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
