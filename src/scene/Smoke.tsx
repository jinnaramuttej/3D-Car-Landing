'use client';

import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { CONFIG } from '@/lib/config';
import { carState } from '@/lib/motion';
import { chapterState, rainLevel } from '@/lib/chapterRuntime';
import { cameraState } from './CameraRig';
import { lampHeads } from './city/StreetLights';
import { smokeLayer } from './postfx/SoftSmokeEffect';
import { createSmokeTexture } from '@/lib/textures';
import { onWarmupEnd } from '@/lib/warmup';
import { nearestK } from '@/lib/nearest';
import { isMobile } from '@/lib/device';

const LAMPS = 4;

/* -------------------------------------------------------------- shaders */

const particleVert = /* glsl */ `
attribute vec3 aCenter;
attribute float aSize;
attribute float aAlpha;
attribute float aAngle;
attribute float aShade;
attribute float aGround;
uniform vec3 uTailPos;
uniform float uTailRadius;
uniform vec3 uLampPos[${LAMPS}];
uniform vec3 uLampColor;
uniform float uLampLit;
uniform vec3 uHeadPos0;
uniform vec3 uHeadPos1;
uniform vec3 uHeadDir;
uniform float uHeadCos;
uniform float uHeadLit;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying float vTail;
varying float vDepth;
varying float vGroundY;
varying float vHead;
varying vec3 vLamp;
varying float vSize;
varying float vGround;

float headCone(vec3 p, vec3 hp) {
  vec3 d = p - hp;
  float dist = max(length(d), 1e-3);
  float cone = smoothstep(uHeadCos, mix(uHeadCos, 1.0, 0.5), dot(d / dist, uHeadDir));
  return cone / (1.0 + dist * dist * 0.03);
}

void main() {
  vUv = uv;
  vAlpha = aAlpha;
  // lighter on the upper half: cheap "lit from the floodlights above"
  vShade = aShade * (0.55 + 0.7 * (position.y + 0.5));
  float d = distance(aCenter, uTailPos);
  vTail = exp(-(d * d) / (uTailRadius * uTailRadius));

  // Billboard: expand the quad in view space so it always faces the camera.
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  float c = cos(aAngle);
  float s = sin(aAngle);
  vec2 offset = mat2(c, s, -s, c) * position.xy * aSize;
  mv.xy += offset;
  vDepth = -mv.z;
  vSize = aSize;
  // sodium street lamps light the smoke from above (the nearest few)
  vec3 lamp = vec3(0.0);
  for (int i = 0; i < ${LAMPS}; i++) {
    vec3 d = uLampPos[i] - aCenter;
    lamp += uLampColor / (1.0 + dot(d, d) * 0.018);
  }
  vLamp = lamp * uLampLit;
  // tyre spray and mist pick up the headlight beams
  float fwd = 0.5 + 1.5 * pow(max(dot(uHeadDir, normalize(cameraPosition - aCenter)), 0.0), 2.0);
  vHead = (headCone(aCenter, uHeadPos0) + headCone(aCenter, uHeadPos1)) * uHeadLit * fwd;

  // World height of this corner, so the fragment can fade out where it meets the asphalt.
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vGroundY = (aCenter + camRight * offset.x + camUp * offset.y).y;
  vGround = aGround;

  gl_Position = projectionMatrix * mv;
}
`;

const particleFrag = /* glsl */ `
#include <packing>
uniform sampler2D uMap;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uSoft;
uniform float uSoftOn;
uniform vec3 uColor;
uniform vec3 uTailColor;
uniform float uTailTint;
uniform float uOpacity;
uniform vec2 uNearFade;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying float vTail;
varying float vDepth;
varying float vGroundY;
varying float vHead;
varying vec3 vLamp;
varying float vSize;
varying float vGround;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  // Near the lens a puff fades out by its own size (a big one from further away), so
  // nothing close to the camera fills the frame; the shot can let it in closer still.
  // (inside the wake a big puff seen face-on is a flat sheet: those go well before the lens)
  float nearFade = smoothstep(uNearFade.x, uNearFade.y, vDepth) * smoothstep(0.5 + 0.8 * vSize, 1.4 + 2.1 * vSize, vDepth);
  // soft against the road it was laid on...
  float groundFade = smoothstep(vGround, vGround + 0.9, vGroundY);
  // ...and against everything else: fade where the puff meets the scene's depth
  float soft = 1.0;
  if (uSoftOn > 0.5) {
    float sceneZ = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uRes).x, uNear, uFar);
    soft = clamp((sceneZ - vDepth) / (uSoft * (0.3 + 0.28 * vSize)), 0.0, 1.0);
  }
  float a = tex.a * vAlpha * uOpacity * nearFade * groundFade * soft;
  if (a < 0.002) discard;
  vec3 col = uColor * vShade + vec3(1.0, 0.95, 0.86) * vHead + vLamp;
  col = mix(col, uTailColor, clamp(vTail * uTailTint, 0.0, 1.0));
  // premultiplied: laid over the frame by SoftSmokeEffect
  gl_FragColor = vec4(col * a, a);
}
`;

/* ----------------------------------------------------------------- pool */

function createPool(max: number) {
  return {
    max,
    cursor: 0,
    pos: new Float32Array(max * 3),
    vel: new Float32Array(max * 3),
    age: new Float32Array(max),
    life: new Float32Array(max), // 0 = free slot
    size0: new Float32Array(max),
    size1: new Float32Array(max),
    angle: new Float32Array(max),
    spin: new Float32Array(max),
    seed: new Float32Array(max),
    shade: new Float32Array(max),
    alpha0: new Float32Array(max),
    grav: new Float32Array(max), // m/s^2 pulling down (spray), on top of the rise
    base: new Float32Array(max), // height of the road where the puff was laid
    size: new Float32Array(max),
    alpha: new Float32Array(max),
    depth: new Float32Array(max),
    order: new Uint16Array(max),
    acc: [0, 0, 0, 0], // fractional emission carry: left tyre, right tyre, left spray, right spray
    prev: [new Vector3(), new Vector3()],
    hasPrev: false,
  };
}
type Pool = ReturnType<typeof createPool>;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Takes the next slot in the ring. When the pool is full this recycles the oldest puff. */
function claim(pool: Pool) {
  const i = pool.cursor;
  pool.cursor = (i + 1) % pool.max;
  pool.age[i] = 0;
  pool.angle[i] = Math.random() * Math.PI * 2;
  pool.spin[i] = rand(-0.35, 0.35);
  pool.seed[i] = Math.random() * 100;
  pool.shade[i] = rand(0.65, 1.1);
  pool.grav[i] = 0;
  return i;
}

/* ------------------------------------------------------------ component */

const _tmp = new Vector3();
const _far = new Vector3(0, -1e4, 0);
const _cam = new Vector3();
const _camDir = new Vector3();

/**
 * The tyre smoke and the wet-road spray, as soft billboards in their own pass
 * (postfx/SoftSmokeEffect). Emission follows the slip (with a floor, so it never cuts out
 * mid-slide). What the drift lays down stays behind as a wake for 6-8 s: it hugs the road
 * first, then warms and rises, sheared by the rain's wind and lit by the street lamps and
 * the headlights, so the camera can drive back through it as it thins. Near the lens every
 * puff fades by its own size, so smoke never fills the frame.
 */
export function Smoke() {
  const camera = useThree((s) => s.camera);
  const mobile = useMemo(() => isMobile(), []);
  const scale = mobile ? 0.5 : 1;
  const max = useMemo(() => Math.max(32, Math.round(CONFIG.smoke.maxParticles * scale)), [scale]);

  const { geometry, material, attrs } = useMemo(() => {
    const geometry = new PlaneGeometry(1, 1);
    const attr = (itemSize: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(max * itemSize), itemSize);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    const attrs = { center: attr(3), size: attr(1), alpha: attr(1), angle: attr(1), shade: attr(1), ground: attr(1) };
    geometry.setAttribute('aCenter', attrs.center);
    geometry.setAttribute('aSize', attrs.size);
    geometry.setAttribute('aAlpha', attrs.alpha);
    geometry.setAttribute('aAngle', attrs.angle);
    geometry.setAttribute('aShade', attrs.shade);
    geometry.setAttribute('aGround', attrs.ground);

    const material = new ShaderMaterial({
      uniforms: {
        uMap: { value: createSmokeTexture() },
        uColor: { value: new Color(CONFIG.smoke.color) },
        uTailColor: { value: new Color('#ff3020') },
        uTailPos: { value: new Vector3() },
        uTailRadius: { value: 2 },
        uTailTint: { value: CONFIG.smoke.tailTint },
        uOpacity: { value: CONFIG.smoke.opacity },
        uNearFade: { value: new Vector2(0.35, 2) },
        uLampPos: { value: Array.from({ length: LAMPS }, () => new Vector3(0, -1e4, 0)) },
        uLampColor: { value: new Color(CONFIG.city.sodium) },
        uLampLit: { value: 0 },
        uDepth: { value: null },
        uRes: { value: new Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 2000 },
        uSoft: { value: CONFIG.smoke.soft },
        uSoftOn: { value: 0 },
        uHeadPos0: { value: new Vector3() },
        uHeadPos1: { value: new Vector3() },
        uHeadDir: { value: new Vector3(0, 0, 1) },
        uHeadCos: { value: Math.cos(0.5) },
        uHeadLit: { value: 0 },
      },
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      depthTest: false, // (its own pass, with no depth buffer: the soft fade does the occlusion)
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    return { geometry, material, attrs };
  }, [max]);

  // the particles render in the smoke pass (postfx/SoftSmokeEffect.ts), not the main scene
  const particles = useMemo(() => {
    const m = new InstancedMesh(geometry, material, max);
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, [geometry, material, max]);
  useLayoutEffect(() => {
    smokeLayer.scene.add(particles);
    return () => {
      smokeLayer.scene.remove(particles);
    };
  }, [particles]);

  const pool = useMemo(() => createPool(max), [max]);
  // the warm-up drives through the drift: none of its smoke stays behind
  useEffect(
    () =>
      onWarmupEnd(() => {
        pool.life.fill(0);
        pool.hasPrev = false;
        particles.count = 0;
      }),
    [pool, particles],
  );
  const near = useMemo(() => ({ idx: new Int32Array(LAMPS), d: new Float64Array(LAMPS) }), []);
  const attrList = useMemo(() => Object.values(attrs), [attrs]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const cfg = CONFIG.smoke;
    const s = carState;
    const t = state.clock.elapsedTime;

    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_camDir);

    /* 1. tyre smoke: rate follows slip, spread along the wheel's path this frame */
    if (s.carReady) {
      // emission follows the slip angle, with a floor while the car is sliding at all
      const slide = s.slip;
      const rate = cfg.rate * scale * (slide > 0.04 ? Math.max(Math.pow(slide, 1.3), cfg.floor) : 0);
      const side = s.slip > 0.05 ? 1 : 0.25; // a launch throws smoke back, not sideways
      const inherit = MathUtils.clamp(s.speed, -15, 15) * 0.2;
      for (let w = 0; w < 2; w++) {
        const cur = s.rearContacts[w];
        if (!pool.hasPrev) pool.prev[w].copy(cur);
        pool.acc[w] += rate * dt;
        const n = Math.floor(pool.acc[w]);
        pool.acc[w] -= n;
        for (let k = 0; k < n; k++) {
          _tmp.lerpVectors(pool.prev[w], cur, (k + Math.random()) / n);
          const i = claim(pool);
          const o = i * 3;
          pool.pos[o] = _tmp.x + rand(-0.15, 0.15);
          pool.pos[o + 1] = _tmp.y + rand(0.1, 0.22);
          pool.pos[o + 2] = _tmp.z + rand(-0.15, 0.15);
          pool.base[i] = _tmp.y;
          const kick = cfg.kick * rand(0.4, 1) * side;
          const back = rand(0.8, 1.8);
          pool.vel[o] = s.forward.x * (inherit - back) + s.outward.x * kick + rand(-0.4, 0.4);
          // low and flat out of the tyre: it rolls along the road before it rises
          pool.vel[o + 1] = rand(0.05, 0.3);
          pool.vel[o + 2] = s.forward.z * (inherit - back) + s.outward.z * kick + rand(-0.4, 0.4);
          pool.life[i] = rand(cfg.lifeMin, Math.max(cfg.lifeMin, cfg.lifeMax));
          pool.size0[i] = cfg.sizeStart * rand(0.7, 1.3);
          pool.size1[i] = cfg.sizeEnd * rand(0.75, 1.25);
          pool.alpha0[i] = 1;
        }
        pool.prev[w].copy(cur);
      }
      pool.hasPrev = true;

      /* 1b. wet-road spray: rate follows ground speed, not slip; low, short-lived, falls back */
      const sprayRate =
        cfg.sprayRate * scale * rainLevel() * Math.pow(MathUtils.clamp(Math.abs(s.speed) / 25, 0, 1), 1.5);
      for (let w = 0; w < 2; w++) {
        pool.acc[3 + w] += sprayRate * dt;
        const n = Math.floor(pool.acc[3 + w]);
        pool.acc[3 + w] -= n;
        const cur = s.rearContacts[w];
        for (let k = 0; k < n; k++) {
          const i = claim(pool);
          const o = i * 3;
          pool.pos[o] = cur.x - s.forward.x * 0.35 + rand(-0.12, 0.12);
          pool.pos[o + 1] = cur.y + rand(0.06, 0.18);
          pool.pos[o + 2] = cur.z - s.forward.z * 0.35 + rand(-0.12, 0.12);
          pool.base[i] = cur.y;
          const carry = s.speed * rand(0.15, 0.45); // water leaves the tyre slower than the car
          const sideways = rand(-0.6, 0.6);
          pool.vel[o] = s.forward.x * carry + s.outward.x * sideways + rand(-0.3, 0.3);
          pool.vel[o + 1] = rand(0.5, 1.4);
          pool.vel[o + 2] = s.forward.z * carry + s.outward.z * sideways + rand(-0.3, 0.3);
          pool.life[i] = rand(0.5, 1.1);
          pool.size0[i] = cfg.spraySize * rand(0.6, 1);
          pool.size1[i] = cfg.spraySize * rand(3.5, 5.5);
          pool.alpha0[i] = cfg.sprayOpacity;
          pool.grav[i] = 2.2;
        }
      }
    }

    /* 3. simulate */
    const drag = Math.exp(-cfg.drag * dt);
    // the rain's wind carries the smoke off (it eases into the particles' own motion)
    const windX = CONFIG.rain.windX * cfg.wind;
    const windZ = CONFIG.rain.windZ * cfg.wind;
    const windPull = 1 - Math.exp(-0.8 * dt);
    let alive = 0;
    for (let i = 0; i < pool.max; i++) {
      if (pool.life[i] <= 0) continue;
      pool.age[i] += dt;
      const life = pool.life[i];
      if (pool.age[i] >= life) {
        pool.life[i] = 0;
        continue;
      }
      const o = i * 3;
      let px = pool.pos[o];
      let py = pool.pos[o + 1];
      let pz = pool.pos[o + 2];
      const sd = pool.seed[i];

      // cheap flowing noise drift
      const nx = Math.sin(py * 0.9 + t * 0.7 + sd) + 0.6 * Math.sin(pz * 0.45 + t * 0.31 + sd * 1.7);
      const ny = Math.sin(px * 0.3 + pz * 0.3 + t * 0.5 + sd);
      const nz = Math.cos(px * 0.5 + t * 0.6 + sd * 0.6) + 0.6 * Math.cos(py * 0.8 + t * 0.4 + sd * 2.3);
      // the wake: hugs the road for the first second or two (a slight settle), then warms
      // and rises; the wind shears it, stronger the higher it gets
      const age = pool.age[i];
      const spray = pool.grav[i] > 0;
      const up = spray ? 0 : MathUtils.lerp(-cfg.settle, cfg.rise, MathUtils.smoothstep(age, 1.2, 3.6));
      const above = py - pool.base[i];
      const shear = spray ? 0.2 : 0.25 + cfg.shear * MathUtils.clamp(above / 3, 0, 1.5);
      let vx = pool.vel[o] * drag + nx * cfg.noise * dt;
      let vy = pool.vel[o + 1] * drag + (up - pool.grav[i] + ny * 0.3 * cfg.noise) * dt;
      let vz = pool.vel[o + 2] * drag + nz * cfg.noise * dt;
      vx += (windX * shear - vx) * windPull;
      vz += (windZ * shear - vz) * windPull;

      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;

      const tl = pool.age[i] / life;
      const grow = 1 - (1 - tl) * (1 - tl);
      const sz = pool.size0[i] + (pool.size1[i] - pool.size0[i]) * grow;
      py = Math.max(py, pool.base[i] + sz * 0.25); // keep most of the billboard above the asphalt (the shader fades the rest)

      pool.pos[o] = px;
      pool.pos[o + 1] = py;
      pool.pos[o + 2] = pz;
      pool.vel[o] = vx;
      pool.vel[o + 1] = vy;
      pool.vel[o + 2] = vz;
      pool.angle[i] += pool.spin[i] * dt;
      pool.size[i] = sz;
      // in fast, then a long, slow thinning as it spreads
      pool.alpha[i] = pool.alpha0[i] * MathUtils.smoothstep(tl, 0, 0.05) * (1 - MathUtils.smoothstep(tl, 0.4, 1));
      pool.depth[i] = (px - _cam.x) * _camDir.x + (py - _cam.y) * _camDir.y + (pz - _cam.z) * _camDir.z;
      pool.order[alive++] = i;
    }

    /* 4. back-to-front so normal blending layers correctly */
    const order = pool.order.subarray(0, alive);
    order.sort((a, b) => pool.depth[b] - pool.depth[a]);

    /* 5. upload */
    const c = attrs.center.array as Float32Array;
    const sz = attrs.size.array as Float32Array;
    const al = attrs.alpha.array as Float32Array;
    const an = attrs.angle.array as Float32Array;
    const sh = attrs.shade.array as Float32Array;
    const gr = attrs.ground.array as Float32Array;
    for (let j = 0; j < alive; j++) {
      const i = order[j];
      c[j * 3] = pool.pos[i * 3];
      c[j * 3 + 1] = pool.pos[i * 3 + 1];
      c[j * 3 + 2] = pool.pos[i * 3 + 2];
      sz[j] = pool.size[i];
      al[j] = pool.alpha[i];
      an[j] = pool.angle[i];
      sh[j] = pool.shade[i];
      gr[j] = pool.base[i];
    }
    for (const a of attrList) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, alive) * a.itemSize);
      a.needsUpdate = true;
    }
    particles.count = alive;

    const u = material.uniforms;
    (u.uColor.value as Color).set(cfg.color);
    u.uOpacity.value = cfg.opacity;
    u.uTailTint.value = cfg.tailTint * s.slip;
    (u.uTailPos.value as Vector3).copy(s.tailLight);
    (u.uNearFade.value as Vector2).set(cameraState.nearFade[0], cameraState.nearFade[1]);
    // soft particles: the main render's depth, from the smoke pass
    const cam = camera as PerspectiveCamera;
    u.uDepth.value = smokeLayer.depth;
    u.uSoftOn.value = smokeLayer.depth ? 1 : 0;
    (u.uRes.value as Vector2).copy(smokeLayer.resolution);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uSoft.value = cfg.soft;
    // the nearest street lamps
    nearestK(lampHeads, s.position, near.idx, near.d);
    const lp = u.uLampPos.value as Vector3[];
    for (let k = 0; k < LAMPS; k++) lp[k].copy(near.idx[k] >= 0 ? lampHeads[near.idx[k]] : _far);
    u.uLampLit.value = cfg.lampLit * chapterState.env.lamps;
    (u.uHeadPos0.value as Vector3).copy(s.headPos[0]);
    (u.uHeadPos1.value as Vector3).copy(s.headPos[1]);
    (u.uHeadDir.value as Vector3).copy(s.headDir);
    u.uHeadCos.value = Math.cos(CONFIG.car.headBeamAngle * 0.9);
    u.uHeadLit.value = s.carReady ? cfg.headLit * s.headLevel : 0;
  }, -1);

  return null;
}
