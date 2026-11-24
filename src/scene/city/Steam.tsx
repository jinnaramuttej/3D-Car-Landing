'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedBufferAttribute, type InstancedMesh, MathUtils, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { getRoute, sampleRoute } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { leftOf } from '@/lib/motion';
import { createSmokeTexture, mulberry32 } from '@/lib/textures';

const vert = /* glsl */ `
attribute vec3 aVent;
attribute float aSeed;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vAlpha;
varying float vLift;
void main() {
  vUv = uv;
  // each puff loops: out of the grate, up, spreading and thinning, drifting downwind
  float phase = fract(uTime * (0.16 + 0.06 * fract(aSeed * 7.3)) + aSeed);
  float rise = phase * (3.2 + 1.6 * fract(aSeed * 3.1));
  vec3 c = aVent + vec3(uWind.x, 0.0, uWind.y) * phase * 1.6 + vec3(sin(aSeed * 40.0 + uTime * 0.7), 0.0, cos(aSeed * 31.0 + uTime * 0.6)) * 0.25 * phase;
  c.y += rise;
  float size = mix(0.5, 2.6, sqrt(phase));
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float a = aSeed * 6.28318;
  mv.xy += mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy * size;
  vAlpha = sin(3.14159 * phase) * (1.0 - phase * 0.4) * smoothstep(0.6, 2.5, -mv.z);
  vLift = phase;
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uLamp;
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;
varying float vLift;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha * uOpacity;
  if (a < 0.003) discard;
  // lit warm from the street lamps below, cooler as it climbs into the dark
  vec3 col = mix(uColor + uLamp, uColor, vLift);
  gl_FragColor = vec4(col * a, a);
}
`;

/** Route metres of the grates that steam (a few in every part of the drive). */
const VENTS = [96, 124, 206, 262, 318, 447, 532, 612, 664, 722, 790];
const PUFFS = 7;

/**
 * Steam from street grates: a few vents at the kerb along the route, each a slow loop of
 * soft puffs (moved entirely in the vertex shader), lit warm by the sodium lamps.
 */
export function Steam() {
  const mobile = useMemo(() => isMobile(), []);
  const mesh = useRef<InstancedMesh>(null!);
  const count = (mobile ? 5 : VENTS.length) * PUFFS;

  const { geometry, material } = useMemo(() => {
    const rnd = mulberry32(9);
    const r = getRoute();
    const geometry = new PlaneGeometry(1, 1);
    const vents = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const p = new Vector3();
    const l = new Vector3();
    for (let v = 0; v < count / PUFFS; v++) {
      const s = VENTS[v];
      const h = sampleRoute(s, p);
      leftOf(h, l);
      const side = v % 2 ? 1 : -1;
      const room = r.room(s)[side === 1 ? 0 : 1];
      p.addScaledVector(l, side * MathUtils.clamp(room - 1.1, 1.2, 4)).setY(p.y + 0.05);
      for (let k = 0; k < PUFFS; k++) {
        const i = v * PUFFS + k;
        vents.set([p.x, p.y, p.z], i * 3);
        seeds[i] = (k + rnd() * 0.6) / PUFFS;
      }
    }
    geometry.setAttribute('aVent', new InstancedBufferAttribute(vents, 3));
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    const material = new ShaderMaterial({
      uniforms: {
        uMap: { value: createSmokeTexture(128) },
        uTime: { value: 0 },
        uWind: { value: [0, 0] },
        uColor: { value: new Color('#5b6068') },
        uLamp: { value: new Color('#3a2410') },
        uOpacity: { value: 0.32 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: false,
      premultipliedAlpha: true,
    });
    return { geometry, material };
  }, [count]);

  useLayoutEffect(() => {
    mesh.current.frustumCulled = false;
    mesh.current.layers.set(1); // main camera only
  }, []);

  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uWind.value = [CONFIG.rain.windX * 0.35, CONFIG.rain.windZ * 0.35];
    // steam shows best on a cold wet night; it fades out with the rain toward dawn
    u.uOpacity.value = 0.32 * MathUtils.clamp(chapterState.env.wet, 0, 1) * (1 - chapterState.env.day * 0.7);
    (u.uLamp.value as Color).setRGB(0.23, 0.14, 0.06).multiplyScalar(chapterState.env.lamps);
  });

  return <instancedMesh ref={mesh} args={[geometry, material, count]} />;
}
