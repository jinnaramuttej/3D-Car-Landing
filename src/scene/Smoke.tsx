'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  MathUtils,
  type Mesh,
  NormalBlending,
  type PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { CONFIG } from '@/lib/config';
import { DRIFT } from '@/lib/chapters';
import { carState, getCloudCenter } from '@/lib/motion';
import { chapterState, rainLevel } from '@/lib/chapterRuntime';
import { cameraState } from './CameraRig';
import { createSmokeTexture } from '@/lib/textures';
import { isMobile } from '@/lib/device';

/* -------------------------------------------------------------- shaders */

const particleVert = /* glsl */ `
attribute vec3 aCenter;
attribute float aSize;
attribute float aAlpha;
attribute float aAngle;
attribute float aShade;
uniform vec3 uTailPos;
uniform float uTailRadius;
uniform float uProjScale;
uniform float uMaxCover;
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
  // Coverage guard: a puff may only cover uMaxCover of the frame height (before shot IV
  // the smoke must never fill the screen); bigger ones fade instead of growing.
  float cover = aSize * uProjScale / max(vDepth, 0.05);
  vAlpha *= 1.0 - smoothstep(uMaxCover * 0.55, uMaxCover, cover);
  // tyre spray and mist pick up the headlight beams
  float fwd = 0.5 + 1.5 * pow(max(dot(uHeadDir, normalize(cameraPosition - aCenter)), 0.0), 2.0);
  vHead = (headCone(aCenter, uHeadPos0) + headCone(aCenter, uHeadPos1)) * uHeadLit * fwd;

  // World height of this corner, so the fragment can fade out where it meets the asphalt.
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vGroundY = (aCenter + camRight * offset.x + camUp * offset.y).y;

  gl_Position = projectionMatrix * mv;
}
`;

const particleFrag = /* glsl */ `
uniform sampler2D uMap;
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

void main() {
  vec4 tex = texture2D(uMap, vUv);
  // fade puffs that reach the lens instead of clipping them on the near plane
  // (per shot: close-ups let the smoke come right up to the glass)
  float nearFade = smoothstep(uNearFade.x, uNearFade.y, vDepth);
  // fake soft particles against the ground plane (no depth texture needed)
  float groundFade = smoothstep(0.0, 0.9, vGroundY);
  float a = tex.a * vAlpha * uOpacity * nearFade * groundFade;
  if (a < 0.003) discard;
  vec3 col = uColor * vShade + vec3(1.0, 0.95, 0.86) * vHead;
  col = mix(col, uTailColor, clamp(vTail * uTailTint, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const veilVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0); // clip-space full-screen quad
}
`;

const veilFrag = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uAspect;
uniform float uPush;
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  // zoom into the noise as the camera pushes forward
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * mix(3.0, 1.6, uPush);
  float n = fbm(p + vec2(uTime * 0.05, -uTime * 0.08));
  float m = fbm(p * 1.7 + n * 1.6 - vec2(uTime * 0.07, uTime * 0.03));
  float dens = smoothstep(0.2, 0.8, m);
  float a = uOpacity * mix(0.7, 1.0, dens);
  vec3 col = uColor * (0.68 + 0.55 * dens);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
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
    grav: new Float32Array(max), // m/s^2 pulling down (spray), on top of cfg.rise
    size: new Float32Array(max),
    alpha: new Float32Array(max),
    depth: new Float32Array(max),
    order: new Uint16Array(max),
    acc: [0, 0, 0, 0, 0], // fractional emission carry: left tyre, right tyre, cloud, left spray, right spray
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
const _cam = new Vector3();
const _camDir = new Vector3();
const _cloud = new Vector3();

export function Smoke() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
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
    const attrs = { center: attr(3), size: attr(1), alpha: attr(1), angle: attr(1), shade: attr(1) };
    geometry.setAttribute('aCenter', attrs.center);
    geometry.setAttribute('aSize', attrs.size);
    geometry.setAttribute('aAlpha', attrs.alpha);
    geometry.setAttribute('aAngle', attrs.angle);
    geometry.setAttribute('aShade', attrs.shade);

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
        uProjScale: { value: 1 },
        uMaxCover: { value: 100 },
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
      blending: NormalBlending,
    });
    return { geometry, material, attrs };
  }, [max]);

  const veilMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uPush: { value: 0 },
          uColor: { value: new Color(CONFIG.smoke.veilColor) },
        },
        vertexShader: veilVert,
        fragmentShader: veilFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  const pool = useMemo(() => createPool(max), [max]);
  const mesh = useRef<InstancedMesh>(null!);
  const veil = useRef<Mesh>(null!);

  useLayoutEffect(() => {
    // Layer 1 = main camera only. Keeps the full-screen veil out of the ground reflection.
    veil.current.layers.set(1);
    mesh.current.count = 0;
  }, []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const cfg = CONFIG.smoke;
    const s = carState;
    const p = s.progress;
    const t = state.clock.elapsedTime;
    // Outside the drift the chapter beats own the smoke cover (chapter IV thins it out).
    // Before shot IV (cfg.fullScreenFrom) the smoke stays low and may never fill the frame.
    const fillFrom = Math.max(cfg.fillStart, cfg.fullScreenFrom);
    const fillTo = Math.max(fillFrom + 1e-3, cfg.fillFull);
    const after = !chapterState.drift && p >= DRIFT.localEnd - 1e-3; // chapters IV and V
    const fill = after ? chapterState.look.smoke : MathUtils.smoothstep(p, fillFrom, fillTo);
    const guarded = !after && p < cfg.fullScreenFrom;
    if (chapterState.jumped) {
      // a mini-map jump: drop the old smoke instead of leaving it hanging where it was
      pool.life.fill(0);
      pool.hasPrev = false;
    }

    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_camDir);

    /* 1. tyre smoke: rate follows slip, spread along the wheel's path this frame */
    if (s.carReady) {
      // burnout = straight-line wheelspin at the finale launch (0 during the drift)
      const rate = cfg.rate * scale * Math.pow(Math.max(s.slip, s.burnout), 1.3);
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
          pool.pos[o + 1] = rand(0.12, 0.25);
          pool.pos[o + 2] = _tmp.z + rand(-0.15, 0.15);
          const kick = cfg.kick * rand(0.4, 1) * side;
          const back = rand(0.8, 1.8);
          pool.vel[o] = s.forward.x * (inherit - back) + s.outward.x * kick + rand(-0.4, 0.4);
          pool.vel[o + 1] = rand(0.3, 0.8);
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
          pool.pos[o + 1] = rand(0.08, 0.2);
          pool.pos[o + 2] = cur.z - s.forward.z * 0.35 + rand(-0.12, 0.12);
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

    /* 2. after fillStart: seed the cloud between its centre and the camera */
    if (fill > 0) {
      // Eased: the cloud swells around its centre first, only reaches the lens near fillFull.
      const f2 = fill * fill;
      getCloudCenter(_cloud);
      pool.acc[2] += cfg.fillRate * scale * f2 * dt;
      const n = Math.floor(pool.acc[2]);
      pool.acc[2] -= n;
      const radius = 2 + 5 * fill;
      for (let k = 0; k < n; k++) {
        const i = claim(pool);
        const o = i * 3;
        _tmp.lerpVectors(_cloud, _cam, Math.random() * 0.75 * f2);
        pool.pos[o] = _tmp.x + rand(-1, 1) * radius;
        pool.pos[o + 1] = MathUtils.clamp(_tmp.y + rand(-0.5, 0.8) * radius * 0.5, 0.6, 6);
        pool.pos[o + 2] = _tmp.z + rand(-1, 1) * radius;
        pool.vel[o] = rand(-0.4, 0.4);
        pool.vel[o + 1] = rand(0, 0.3);
        pool.vel[o + 2] = rand(-0.4, 0.4);
        pool.life[i] = rand(cfg.lifeMin, Math.max(cfg.lifeMin, cfg.lifeMax)) * 1.4;
        pool.size0[i] = rand(2.4, 4.2);
        pool.size1[i] = pool.size0[i] * rand(1.8, 2.6);
        pool.alpha0[i] = 0.75;
      }
    }

    /* 3. simulate */
    const drag = Math.exp(-cfg.drag * dt);
    const ageRate = 1 - 0.7 * fill; // the cloud lingers once it starts filling the frame
    let alive = 0;
    for (let i = 0; i < pool.max; i++) {
      if (pool.life[i] <= 0) continue;
      pool.age[i] += dt * ageRate;
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
      let vx = pool.vel[o] * drag + nx * cfg.noise * dt;
      let vy = pool.vel[o + 1] * drag + (cfg.rise - pool.grav[i] + ny * 0.3 * cfg.noise) * dt;
      let vz = pool.vel[o + 2] * drag + nz * cfg.noise * dt;

      // filling: everything drifts toward the lens
      if (fill > 0) {
        const dx = _cam.x - px;
        const dy = _cam.y - py;
        const dz = _cam.z - pz;
        const inv = (cfg.fillPull * fill * fill * dt) / (Math.hypot(dx, dy, dz) + 1e-3);
        vx += dx * inv;
        vy += dy * inv;
        vz += dz * inv;
      }

      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;

      const tl = pool.age[i] / life;
      const grow = 1 - (1 - tl) * (1 - tl);
      const sz = (pool.size0[i] + (pool.size1[i] - pool.size0[i]) * grow) * (1 + fill * fill * cfg.fillGrow);
      py = Math.max(py, sz * 0.25); // keep most of the billboard above the asphalt (the shader fades the rest)

      pool.pos[o] = px;
      pool.pos[o + 1] = py;
      pool.pos[o + 2] = pz;
      pool.vel[o] = vx;
      pool.vel[o + 1] = vy;
      pool.vel[o + 2] = vz;
      pool.angle[i] += pool.spin[i] * dt;
      pool.size[i] = sz;
      pool.alpha[i] =
        pool.alpha0[i] * MathUtils.smoothstep(tl, 0, 0.1) * (1 - MathUtils.smoothstep(tl, 0.35, 1));
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
    for (let j = 0; j < alive; j++) {
      const i = order[j];
      c[j * 3] = pool.pos[i * 3];
      c[j * 3 + 1] = pool.pos[i * 3 + 1];
      c[j * 3 + 2] = pool.pos[i * 3 + 2];
      sz[j] = pool.size[i];
      al[j] = pool.alpha[i];
      an[j] = pool.angle[i];
      sh[j] = pool.shade[i];
    }
    for (const a of Object.values(attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, alive) * a.itemSize);
      a.needsUpdate = true;
    }
    mesh.current.count = alive;

    const u = material.uniforms;
    (u.uColor.value as Color).set(cfg.color);
    u.uOpacity.value = cfg.opacity;
    u.uTailTint.value = cfg.tailTint * s.slip;
    (u.uTailPos.value as Vector3).copy(s.tailLight);
    (u.uNearFade.value as Vector2).set(cameraState.nearFade[0], cameraState.nearFade[1]);
    u.uProjScale.value = 1 / (2 * Math.tan(MathUtils.degToRad((camera as PerspectiveCamera).fov) / 2));
    // the guard eases off across the cut into shot IV
    u.uMaxCover.value = guarded
      ? MathUtils.lerp(cfg.maxCover, 100, MathUtils.smoothstep(p, cfg.fullScreenFrom - 0.02, cfg.fullScreenFrom))
      : 100;
    (u.uHeadPos0.value as Vector3).copy(s.headPos[0]);
    (u.uHeadPos1.value as Vector3).copy(s.headPos[1]);
    (u.uHeadDir.value as Vector3).copy(s.headDir);
    u.uHeadCos.value = Math.cos(CONFIG.car.headBeamAngle * 0.9);
    u.uHeadLit.value = s.carReady ? cfg.headLit * s.headLevel : 0;

    /* 6. veil: guarantees full coverage by fillFull, independent of particle count */
    const veilOpacity = after
      ? MathUtils.smoothstep(fill, 0.1, 1) * cfg.veilOpacity
      : MathUtils.smoothstep(p, fillFrom + (fillTo - fillFrom) * 0.55, fillTo) * cfg.veilOpacity;
    const vu = veilMaterial.uniforms;
    vu.uOpacity.value = veilOpacity;
    vu.uTime.value = t;
    vu.uAspect.value = size.width / Math.max(1, size.height);
    vu.uPush.value = MathUtils.smoothstep(p, cfg.fillFull, 1);
    (vu.uColor.value as Color).set(cfg.veilColor);
    veil.current.visible = veilOpacity > 0.001;
  }, -1);

  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, material, max]} frustumCulled={false} renderOrder={10} />
      <mesh ref={veil} frustumCulled={false} renderOrder={20} material={veilMaterial}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </>
  );
}
