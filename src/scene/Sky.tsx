'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, Color, MathUtils, type Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import { chapterState, sunDirection } from '@/lib/chapterRuntime';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec2 uCityDir;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform float uClouds;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.5, h));
  // sodium light pollution, strongest low over the city
  float city = max(dot(normalize(d.xz + 1e-5), uCityDir), 0.0);
  float low = pow(1.0 - clamp(h * 2.5, 0.0, 1.0), 3.0);
  col += uGlow * low * (0.3 + 0.7 * city);
  // the sun (dawn and morning): a soft halo low on the city side and a small disc
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSunGlow * (pow(sd, 8.0) * 0.25 + pow(sd, 64.0) * 0.9 + pow(sd, 2400.0) * 30.0);
  // clouds: dark rain clouds at night, thin broken ones by morning
  vec2 cuv = d.xz / max(h + 0.18, 0.05) * 1.4 + vec2(uTime * 0.004, uTime * 0.002);
  float cl = fbm(cuv);
  col *= mix(1.0, 0.8 + 0.45 * cl, uClouds * smoothstep(-0.02, 0.25, h));
  col = mix(col, col * 0.75 + uHorizon * 0.35, (1.0 - uClouds) * smoothstep(0.55, 0.8, cl) * smoothstep(0.02, 0.3, h));
  if (h < 0.0) col = uHorizon;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The sky dome: night cloud lit sodium from below over the city, dawn over the sea, and
 * the sun's disc and halo when it is up (all from chapterState.env). Follows the camera,
 * drawn first, writes no depth; the street reflection (layer 3) sees it too.
 */
export function Sky() {
  // the city lies north of the sea: its glow is strongest that way
  const cityDir = useMemo(() => new Vector2(0, -1), []);
  const mesh = useRef<Mesh>(null!);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTop: { value: new Color() },
          uHorizon: { value: new Color() },
          uGlow: { value: new Color() },
          uCityDir: { value: cityDir },
          uTime: { value: 0 },
          uSunDir: { value: new Vector3(0, 1, 0) },
          uSunColor: { value: new Color() },
          uSunGlow: { value: 0 },
          uClouds: { value: 1 },
        },
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: BackSide,
        // drawn first and writes no depth, so everything else lands on top of it
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [cityDir],
  );
  useFrame((state) => {
    const e = chapterState.env;
    const u = mat.uniforms;
    (u.uTop.value as Color).copy(e.skyTop);
    (u.uHorizon.value as Color).copy(e.skyHorizon);
    (u.uGlow.value as Color).copy(e.skyGlow);
    sunDirection(e.sunAzimuth, e.sunElevation, u.uSunDir.value as Vector3);
    (u.uSunColor.value as Color).copy(e.sun);
    u.uSunGlow.value = MathUtils.smoothstep(e.sunIntensity, 0.4, 1.6);
    u.uClouds.value = e.clouds;
    u.uTime.value = state.clock.elapsedTime;
    mesh.current.position.copy(state.camera.position);
    mesh.current.layers.enable(3); // (the city's street reflection sees the sky too)
  });
  return (
    <mesh ref={mesh} material={mat} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[1500, 32, 16]} />
    </mesh>
  );
}

