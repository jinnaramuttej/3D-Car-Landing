'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MathUtils,
  type Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { rainLevel } from '@/lib/chapterRuntime';
import { interaction } from '@/lib/interaction';
import { carState } from '@/lib/motion';
import { cameraState } from './CameraRig';

/*
 * Rain, all stateless on the GPU: every drop's position is a function of its seed and
 * the clock, so the CPU only updates a handful of uniforms per frame.
 *   streaks   thin quads stretched along the fall velocity (wind slant), wrapped inside a
 *             box that rides in front of the camera; lit by the headlights and tail lights
 *   splashes  ground ripples + little crowns of droplets around the car
 *   beams     faint haze cones in front of the headlights (the lit drops inside them do
 *             the "rain curtain")
 * Everything sits on layer 1, so the ground reflection and contact shadows skip it.
 */

/** Shared lighting: city glow + both headlight cones (forward scattering) + tail lights. */
const lightChunk = /* glsl */ `
uniform vec3 uRainColor;
uniform float uAmbient;
uniform vec3 uHeadPos0;
uniform vec3 uHeadPos1;
uniform vec3 uHeadDir;
uniform float uHeadCos;
uniform float uHeadLevel;
uniform float uHeadGain;
uniform vec3 uTailPos;
uniform float uTailGlow;

float headCone(vec3 p, vec3 hp) {
  vec3 d = p - hp;
  float dist = max(length(d), 1e-3);
  float c = dot(d / dist, uHeadDir);
  float cone = smoothstep(uHeadCos, mix(uHeadCos, 1.0, 0.55), c);
  return cone / (1.0 + dist * dist * 0.012);
}

vec3 rainLight(vec3 p) {
  vec3 col = uRainColor * uAmbient;
  float hl = headCone(p, uHeadPos0) + headCone(p, uHeadPos1);
  // drops glow far more when the beam points at the lens
  float fwd = 0.45 + 0.75 * pow(max(dot(uHeadDir, normalize(cameraPosition - p)), 0.0), 3.0);
  col += vec3(1.0, 0.95, 0.86) * hl * uHeadGain * uHeadLevel * fwd;
  float td = distance(p, uTailPos);
  col += vec3(1.0, 0.09, 0.05) * uTailGlow / (1.0 + td * td * 1.2);
  return col;
}
`;

const streakVert = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uWind;
uniform float uFall;
uniform float uTime;
uniform float uLength;
uniform float uWidth;
uniform float uPixel;
uniform float uIntensity;
uniform float uJitter;
uniform vec2 uNearFade;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
${lightChunk}

void main() {
  vUv = uv;
  float spd = mix(0.82, 1.18, aSeed.w);
  vec3 vel = vec3(uWind.x, -uFall * spd, uWind.z);
  // world-anchored positions wrapped into the camera's box: drops don't swim when the box moves
  vec3 rel = mod(aSeed.xyz * uBoxSize * 3.0 + vel * uTime - uBoxMin, uBoxSize);
  vec3 q = rel / uBoxSize;
  vec3 center = uBoxMin + rel;
  vec3 edge = smoothstep(0.0, 0.1, q) * smoothstep(1.0, 0.9, q);
  // a rev shakes the air: drops shiver sideways
  center.xz += vec2(sin(uTime * 53.0 + aSeed.w * 40.0), cos(uTime * 47.0 + aSeed.x * 31.0)) * uJitter;

  vec3 axis = normalize(vel);
  vec3 toCam = cameraPosition - center;
  float dist = max(length(toCam), 1e-3);
  vec3 side = normalize(cross(axis, toCam / dist));
  // never thinner than ~1px; sub-pixel drops lose alpha instead (no shimmer)
  float w = max(uWidth, dist * uPixel * 1.1);
  float len = uLength * spd * mix(0.7, 1.3, fract(aSeed.w * 7.31));
  vec3 wp = center + axis * position.y * len + side * position.x * w;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float near = smoothstep(uNearFade.x, uNearFade.y, -mv.z);
  vColor = rainLight(center);
  vAlpha = edge.x * edge.y * edge.z * near * (uWidth / w) * uIntensity * step(0.0, center.y);
}
`;

const streakFrag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float along = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
  float a = vAlpha * across * along;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

/** Splash position for this cycle: random in a disk around the car, never under it. */
const splashCommon = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uLife;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uSize;
uniform float uOpacity;
uniform vec3 uCarPos;
uniform float uCarHeading;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
${lightChunk}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 splashCenter(out float phase, out float alive) {
  float t = uTime / (uLife * mix(0.8, 1.2, aSeed.z)) + aSeed.w;
  phase = fract(t);
  float cycle = floor(t);
  float r = sqrt(hash12(vec2(aSeed.x * 91.7 + cycle, aSeed.y * 13.1 + cycle * 1.7))) * uRadius;
  float a = hash12(vec2(aSeed.y * 47.3 + cycle * 0.37, aSeed.x * 7.9 + cycle)) * 6.2831853;
  vec3 c = uCenter + vec3(cos(a), 0.0, sin(a)) * r;
  // car-local mask: no rain under the body
  vec3 d = c - uCarPos;
  float ch = cos(uCarHeading);
  float sh = sin(uCarHeading);
  vec2 l = vec2(d.x * ch - d.z * sh, d.x * sh + d.z * ch);
  alive = 1.0 - step(abs(l.x), 1.12) * step(abs(l.y), 2.45);
  return vec3(c.x, uCenter.y, c.z);
}
`;

const rippleVert = /* glsl */ `
${splashCommon}
void main() {
  float phase, alive;
  vec3 c = splashCenter(phase, alive);
  vUv = uv;
  vPhase = phase;
  float s = uSize * (0.35 + 2.4 * phase);
  vec3 wp = c + vec3(position.x * s, 0.012, -position.y * s);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vColor = rainLight(c + vec3(0.0, 0.1, 0.0));
  float camD = distance(c, cameraPosition);
  vAlpha = alive * uOpacity * (1.0 - phase) * (1.0 - phase) * smoothstep(1.5, 4.0, camD);
}
`;

const rippleFrag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.16, 0.0, abs(r - 0.82)) + 0.5 * smoothstep(0.14, 0.0, abs(r - 0.5)) * (1.0 - vPhase);
  float a = vAlpha * ring;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const crownVert = /* glsl */ `
${splashCommon}
void main() {
  float phase, alive;
  vec3 c = splashCenter(phase, alive);
  vUv = uv;
  vPhase = phase;
  // upright billboard (turns around Y only), base on the asphalt
  vec3 toCam = cameraPosition - c;
  vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + 1e-5);
  float s = uSize * 1.5;
  vec3 wp = c + side * position.x * s + vec3(0.0, (position.y + 0.5) * s, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vColor = rainLight(c + vec3(0.0, 0.1, 0.0));
  vAlpha = alive * uOpacity * 1.6 * smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.45, 0.8, phase)) * smoothstep(2.0, 5.0, distance(c, cameraPosition));
}
`;

const crownFrag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main() {
  // five droplets thrown out on little arcs, plus a short sheet at the base early on
  float t = vPhase / 0.8;
  float d = 0.0;
  for (int k = 0; k < 5; k++) {
    float a = mix(-1.0, 1.0, float(k) / 4.0);
    vec2 p = vec2(0.5 + sin(a) * t * 0.42, 0.04 + cos(a) * t * 1.1 - t * t * 0.95);
    d += smoothstep(0.05, 0.0, length((vUv - p) * vec2(1.0, 0.7)));
  }
  float sheet = smoothstep(0.3, 0.0, abs(vUv.x - 0.5)) * smoothstep(0.22 * (1.0 - t), 0.0, vUv.y) * (1.0 - t);
  float a = vAlpha * clamp(d + sheet * 0.6, 0.0, 1.0);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const beamVert = /* glsl */ `
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vDepth;
void main() {
  vAlong = position.z; // unit cone, scaled by the mesh
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const beamFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
uniform vec2 uNearFade;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vDepth;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float a = uOpacity * pow(facing, 2.0) * pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.06, vAlong);
  a *= smoothstep(0.0, 0.4, vY) * smoothstep(uNearFade.x, uNearFade.y, vDepth);
  if (a < 0.001) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function seeds(count: number) {
  const a = new Float32Array(count * 4);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  return new InstancedBufferAttribute(a, 4);
}

function instanced(base: PlaneGeometry, count: number) {
  const g = new InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  g.setAttribute('aSeed', seeds(count));
  g.instanceCount = count;
  return g;
}

function lightUniforms() {
  return {
    uRainColor: { value: new Color(CONFIG.rain.color) },
    uAmbient: { value: CONFIG.rain.ambient },
    uHeadPos0: { value: new Vector3() },
    uHeadPos1: { value: new Vector3() },
    uHeadDir: { value: new Vector3(0, 0, 1) },
    uHeadCos: { value: Math.cos(0.5) },
    uHeadLevel: { value: 1 },
    uHeadGain: { value: CONFIG.rain.headGain },
    uTailPos: { value: new Vector3() },
    uTailGlow: { value: 0 },
  };
}

const _fwd = new Vector3();
const _cam = new Vector3();
const _half = new Vector3();

export function Rain() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const mobile = useMemo(() => isMobile(), []);
  const r = CONFIG.rain;
  const streakCount = useMemo(() => Math.round(r.count * (mobile ? r.mobileScale : 1)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const splashCount = useMemo(() => Math.round(r.splashCount * (mobile ? r.mobileScale : 1)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const light = useMemo(() => lightUniforms(), []);

  const streaks = useMemo(() => {
    const geometry = instanced(new PlaneGeometry(1, 1), streakCount);
    const material = new ShaderMaterial({
      uniforms: {
        ...light,
        uBoxMin: { value: new Vector3() },
        uBoxSize: { value: new Vector3() },
        uWind: { value: new Vector3() },
        uFall: { value: r.fallSpeed },
        uTime: { value: 0 },
        uLength: { value: r.streakLength },
        uWidth: { value: r.streakWidth },
        uPixel: { value: 0.001 },
        uIntensity: { value: r.intensity },
        uJitter: { value: 0 },
        uNearFade: { value: new Vector2(0.4, 1.6) },
      },
      vertexShader: streakVert,
      fragmentShader: streakFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    return { geometry, material };
  }, [light, streakCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const splashes = useMemo(() => {
    const geometry = instanced(new PlaneGeometry(1, 1), splashCount);
    const common = {
      ...light,
      uTime: { value: 0 },
      uLife: { value: r.splashLife },
      uCenter: { value: new Vector3() },
      uRadius: { value: r.splashRadius },
      uSize: { value: r.splashSize },
      uOpacity: { value: r.splashOpacity },
      uCarPos: { value: new Vector3() },
      uCarHeading: { value: 0 },
    };
    const make = (vertexShader: string, fragmentShader: string) =>
      new ShaderMaterial({
        uniforms: common,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
    return { geometry, ripple: make(rippleVert, rippleFrag), crown: make(crownVert, crownFrag), uniforms: common };
  }, [light, splashCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const beam = useMemo(() => {
    // unit-length open cone, apex at the origin, opening along +Z (scaled per frame)
    const geometry = new ConeGeometry(1, 1, 28, 1, true);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, 0.5);
    const material = new ShaderMaterial({
      uniforms: {
        uOpacity: { value: r.beamOpacity },
        uColor: { value: new Color('#fff1dc') },
        uNearFade: { value: new Vector2(0.4, 1.6) },
      },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    return { geometry, material };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const streakMesh = useRef<Mesh>(null!);
  const rippleMesh = useRef<Mesh>(null!);
  const crownMesh = useRef<Mesh>(null!);
  const beams = [useRef<Mesh>(null!), useRef<Mesh>(null!)];

  useLayoutEffect(() => {
    for (const m of [streakMesh, rippleMesh, crownMesh, ...beams]) m.current.layers.set(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => {
    const c = CONFIG.rain;
    const s = carState;
    const t = state.clock.elapsedTime;
    const level = rainLevel();
    const on = level > 0.001;
    const rev = interaction.rev * CONFIG.interaction.revRain;

    // shared light
    (light.uRainColor.value as Color).set(c.color);
    light.uAmbient.value = c.ambient;
    light.uHeadPos0.value.copy(s.headPos[0]);
    light.uHeadPos1.value.copy(s.headPos[1]);
    light.uHeadDir.value.copy(s.headDir);
    light.uHeadCos.value = Math.cos(CONFIG.car.headBeamAngle * 0.85);
    light.uHeadLevel.value = s.carReady ? s.headLevel : 0;
    light.uHeadGain.value = c.headGain;
    light.uTailPos.value.copy(s.tailLight);
    light.uTailGlow.value = c.tailGain * (0.35 + s.brake);

    // streaks: a box that rides ahead of the camera along its view direction
    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_fwd);
    const u = streaks.material.uniforms;
    const box = u.uBoxSize.value as Vector3;
    box.set(c.boxSize, c.boxHeight, c.boxSize);
    (u.uBoxMin.value as Vector3)
      .copy(_cam)
      .addScaledVector(_fwd, c.boxSize * 0.38)
      .sub(_half.set(box.x / 2, box.y * 0.55, box.z / 2));
    // the drops come at the car as fast as it drives: they slant back and stretch on the
    // runs, fall straight through the slow zones
    const v = Math.abs(s.speed);
    (u.uWind.value as Vector3).set(c.windX, 0, c.windZ).addScaledVector(s.forward, -v * c.speedSlant);
    u.uFall.value = c.fallSpeed;
    u.uTime.value = t;
    u.uLength.value = c.streakLength * (1 + v * c.speedStretch);
    u.uWidth.value = c.streakWidth;
    u.uPixel.value = (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size.height);
    u.uIntensity.value = level * CONFIG.rain.streakOpacity;
    u.uJitter.value = rev * 0.035;
    (u.uNearFade.value as Vector2).set(c.nearFade, c.nearFade * 4);
    streakMesh.current.visible = on;

    // splashes around the car
    const su = splashes.uniforms;
    su.uTime.value = t;
    su.uLife.value = c.splashLife / (1 + rev * 1.6); // revving: the puddles jump
    su.uCenter.value.copy(s.position);
    su.uRadius.value = c.splashRadius;
    su.uSize.value = c.splashSize * (1 + rev * 0.9);
    su.uOpacity.value = c.splashOpacity * level * (1 + rev * 0.8);
    su.uCarPos.value.copy(s.position);
    su.uCarHeading.value = s.heading;
    rippleMesh.current.visible = on && s.carReady;
    crownMesh.current.visible = on && s.carReady;

    // headlight haze cones
    const bu = beam.material.uniforms;
    const len = c.beamLength;
    const radius = Math.tan(CONFIG.car.headBeamAngle * 0.7) * len;
    bu.uOpacity.value = c.beamOpacity * (s.carReady ? s.headLevel : 0) * (0.4 + 0.6 * Math.min(1, level));
    (bu.uNearFade.value as Vector2).set(cameraState.nearFade[0], cameraState.nearFade[1]);
    beams.forEach((b, i) => {
      const m = b.current;
      m.position.copy(s.headPos[i]);
      m.quaternion.setFromUnitVectors(Z, s.headDir);
      m.scale.set(radius, radius, len);
      m.visible = bu.uOpacity.value > 0.001;
    });
  }, -1);

  return (
    <>
      <mesh ref={streakMesh} geometry={streaks.geometry} material={streaks.material} frustumCulled={false} renderOrder={12} />
      <mesh ref={rippleMesh} geometry={splashes.geometry} material={splashes.ripple} frustumCulled={false} renderOrder={11} />
      <mesh ref={crownMesh} geometry={splashes.geometry} material={splashes.crown} frustumCulled={false} renderOrder={11} />
      {beams.map((b, i) => (
        <mesh key={i} ref={b} geometry={beam.geometry} material={beam.material} frustumCulled={false} renderOrder={13} />
      ))}
    </>
  );
}

const Z = new Vector3(0, 0, 1);
