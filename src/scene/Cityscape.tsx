'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  type InstancedMesh,
  LineBasicMaterial,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { insidePolygon, landPolygon } from '@/lib/coast';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { forwardOf, getTrack, leftOf, sampleTrack, type Track } from '@/lib/motion';
import { mulberry32 } from '@/lib/textures';

/* ================================================================== sky */

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
  // low rain clouds lit from below
  vec2 cuv = d.xz / max(h + 0.18, 0.05) * 1.4 + vec2(uTime * 0.004, uTime * 0.002);
  col *= 0.8 + 0.45 * fbm(cuv) * smoothstep(-0.02, 0.25, h);
  if (h < 0.0) col = uHorizon;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function Sky({ cityDir }: { cityDir: Vector2 }) {
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
    const c = CONFIG.coast;
    const u = mat.uniforms;
    (u.uTop.value as Color).set(c.skyTop);
    (u.uHorizon.value as Color).set(c.skyHorizon);
    (u.uGlow.value as Color).set(c.skyGlow);
    u.uTime.value = state.clock.elapsedTime;
    mesh.current.position.copy(state.camera.position);
  });
  return (
    <mesh ref={mesh} material={mat} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[1500, 32, 16]} />
    </mesh>
  );
}

/* ============================================================ light sprites */

const spriteVert = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aSize;
attribute float aBlink;
uniform float uTime;
uniform float uIntensity;
uniform float uHaze;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float dist = -mv.z;
  float size = max(aSize, dist * 0.0032); // far lights never shrink below a couple of pixels
  mv.xy += position.xy * size;
  float blink = aBlink > 0.0 ? step(0.55, fract(uTime * aBlink + aPos.x * 0.013)) : 1.0;
  vFade = exp(-dist * uHaze) * blink;
  vColor = aColor * uIntensity;
  gl_Position = projectionMatrix * mv;
}
`;

const spriteFrag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = (exp(-r2 * 18.0) + exp(-r2 * 3.0) * 0.22) * vFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}
`;

type Sprite = { pos: Vector3; color: Color; size: number; blink?: number };

/** Distant point lights as additive billboards (bloom and depth of field turn them into bokeh). */
function LightSprites({ sprites, intensity }: { sprites: Sprite[]; intensity: () => number }) {
  return sprites.length ? <LightSpritesInner sprites={sprites} intensity={intensity} /> : null;
}

function LightSpritesInner({ sprites, intensity }: { sprites: Sprite[]; intensity: () => number }) {
  const mesh = useRef<InstancedMesh>(null!);
  const { geometry, material } = useMemo(() => {
    const geometry = new PlaneGeometry(1, 1);
    const n = sprites.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const blink = new Float32Array(n);
    sprites.forEach((s, i) => {
      pos.set([s.pos.x, s.pos.y, s.pos.z], i * 3);
      col.set([s.color.r, s.color.g, s.color.b], i * 3);
      size[i] = s.size;
      blink[i] = s.blink ?? 0;
    });
    geometry.setAttribute('aPos', new InstancedBufferAttribute(pos, 3));
    geometry.setAttribute('aColor', new InstancedBufferAttribute(col, 3));
    geometry.setAttribute('aSize', new InstancedBufferAttribute(size, 1));
    geometry.setAttribute('aBlink', new InstancedBufferAttribute(blink, 1));
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uHaze: { value: 0.002 } },
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    return { geometry, material };
  }, [sprites]);
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uIntensity.value = intensity();
    material.uniforms.uHaze.value = CONFIG.coast.haze * 0.6;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, sprites.length]} frustumCulled={false} />;
}

/* ============================================================== buildings */

/** Lit windows from world position: crisp at any building size, no textures. */
function windowShader(shader: WebGLProgramParametersWithUniforms, glow: { value: number }, haze: { value: number }, hazeColor: { value: Color }) {
  shader.uniforms.uWindowGlow = glow;
  shader.uniforms.uHaze = haze;
  shader.uniforms.uHazeColor = hazeColor;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWPos = wp.xyz;
      vWNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;\nuniform float uWindowGlow;\nuniform float uHaze;\nuniform vec3 uHazeColor;',
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 n = normalize(vWNormal);
        float wall = 1.0 - step(0.5, abs(n.y));
        vec2 t = length(n.xz) > 0.01 ? normalize(vec2(-n.z, n.x)) : vec2(1.0, 0.0); // roofs: no NaN
        float u = dot(vWPos.xz, t);
        float v = vWPos.y;
        vec2 g = vec2(u / 3.0, v / 3.3);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.34, f.y) * step(f.y, 0.7);
        float h = fract(sin(dot(cell + vSeed * 91.7, vec2(127.1, 311.7))) * 43758.5453);
        float lit = step(0.7, h) * win * wall * step(4.0, v);
        vec3 warm = vec3(1.0, 0.6, 0.3);
        vec3 cool = vec3(0.55, 0.75, 1.0);
        vec3 wc = mix(warm, cool, step(0.86, fract(h * 7.31)));
        // inside the pane: a mullion, a blind pulled part-way down, and a room that is
        // brighter under the ceiling light, so close windows don't read as flat squares
        vec2 wf = vec2((f.x - 0.3) / 0.4, (f.y - 0.34) / 0.36);
        float mullion = 1.0 - (1.0 - step(0.035, abs(wf.x - 0.5))) * 0.85;
        float blind = mix(1.0, 0.35, step(1.0 - fract(h * 3.17) * 0.6, wf.y));
        float room = 0.55 + 0.45 * smoothstep(0.0, 0.9, wf.y);
        float edge = smoothstep(0.0, 0.06, wf.x) * smoothstep(0.0, 0.06, 1.0 - wf.x) * smoothstep(0.0, 0.06, wf.y) * smoothstep(0.0, 0.06, 1.0 - wf.y);
        totalEmissiveRadiance += wc * lit * mullion * blind * room * mix(0.6, 1.0, edge) * (0.5 + 0.5 * fract(h * 13.7)) * uWindowGlow;
        // shop fronts at street level
        // (glazing between a sill and a fascia, split into panes, warmer near the floor)
        float shop = wall * step(0.55, v) * step(v, 2.7) * step(0.55, fract(vSeed * 5.0 + floor(u / 7.0) * 0.37));
        float pane = step(0.06, fract(u / 1.4)) * step(fract(u / 1.4), 0.94);
        float display = 0.55 + 0.45 * smoothstep(2.7, 0.8, v);
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * shop * mix(0.12, 1.0, pane) * display * 0.5 * uWindowGlow;
      }`,
    )
    .replace(
      '#include <dithering_fragment>',
      `float hz = 1.0 - exp(-length(vWPos - cameraPosition) * uHaze);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, hz);
      #include <dithering_fragment>`,
    );
}

type CityLayout = {
  buildings: { pos: Vector3; yaw: number; size: Vector3 }[];
  signs: { pos: Vector3; yaw: number; w: number; h: number; color: Color }[];
  aviation: Sprite[];
};

const NEON = ['#ff2bd6', '#00e5ff', '#ff3b3b', '#7cff4a', '#ffd23f', '#a259ff', '#ff7a1a'];

function layoutCity(track: Track, mobile: boolean): CityLayout {
  const rnd = mulberry32(42);
  const land = landPolygon(track);
  const hw = CONFIG.track.halfWidth;
  const p = new Vector3();
  const l = new Vector3();
  const f = new Vector3();
  const road: Vector3[] = [];
  for (let s = 0; s <= track.length; s += 8) {
    sampleTrack(track, s, p);
    road.push(p.clone());
  }
  const clear = (v: Vector3, min: number) => road.every((r) => Math.hypot(r.x - v.x, r.z - v.z) > min);
  const at = (s: number) => {
    const h = sampleTrack(track, Math.min(Math.max(s, 0), track.length), p);
    leftOf(h, l);
    forwardOf(h, f);
    const extra = s < 0 ? s : s > track.length ? s - track.length : 0;
    return { h, base: p.clone().addScaledVector(f, extra), left: l.clone() };
  };

  const buildings: CityLayout['buildings'] = [];
  const signs: CityLayout['signs'] = [];
  const aviation: Sprite[] = [];

  // Seafront row facing the road (city side = right)
  for (let s = -60; s < track.length + 60; ) {
    const step = 18 + rnd() * 9;
    const { h, base, left } = at(s + step / 2);
    const depth = 14 + rnd() * 7;
    const height = 15 + rnd() * 20;
    const pos = base.clone().addScaledVector(left, -(hw + 16 + depth / 2));
    if (insidePolygon(land, pos.x, pos.z) && clear(pos, hw + 12 + depth / 2)) {
      buildings.push({ pos: pos.setY(height / 2), yaw: h, size: new Vector3(depth, height, step * 0.92) });
      // a neon sign on most fronts, facing the road
      if (rnd() < 0.7) {
        const vertical = rnd() < 0.3;
        const w = vertical ? 1 + rnd() * 0.6 : 3 + rnd() * 4;
        const hh = vertical ? 4 + rnd() * 4 : 0.8 + rnd() * 0.8;
        const signPos = base
          .clone()
          .addScaledVector(left, -(hw + 16) + 0.08)
          .addScaledVector(forwardOf(h, new Vector3()), (rnd() - 0.5) * step * 0.5)
          .setY(5 + rnd() * Math.max(2, height - 9));
        signs.push({ pos: signPos, yaw: h + Math.PI / 2, w, h: hh, color: new Color(NEON[Math.floor(rnd() * NEON.length)]) });
      }
    }
    s += step;
  }

  // Taller city behind it
  const towers = mobile ? 45 : 110;
  for (let i = 0, tries = 0; i < towers && tries < towers * 8; tries++) {
    const s = -200 + rnd() * (track.length + 400);
    const { h, base, left } = at(s);
    const lateral = 70 + Math.pow(rnd(), 1.4) * 420;
    const pos = base.clone().addScaledVector(left, -lateral);
    if (!insidePolygon(land, pos.x, pos.z) || !clear(pos, 50)) continue;
    const height = 35 + Math.pow(rnd(), 2.2) * 150;
    const w = 18 + rnd() * 24;
    buildings.push({ pos: pos.setY(height / 2), yaw: h + (rnd() - 0.5) * 0.3, size: new Vector3(w, height, 18 + rnd() * 24) });
    if (height > 95) aviation.push({ pos: pos.clone().setY(height + 1.5), color: new Color('#ff2020').multiplyScalar(2), size: 1.6, blink: 0.6 + rnd() * 0.4 });
    i++;
  }
  return { buildings, signs, aviation };
}

function Buildings({ layout }: { layout: CityLayout }) {
  const mesh = useRef<InstancedMesh>(null!);
  const uniforms = useMemo(
    () => ({ glow: { value: CONFIG.coast.windowGlow }, haze: { value: CONFIG.coast.haze }, hazeColor: { value: new Color(CONFIG.look.fogColor) } }),
    [],
  );
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: '#0c0e12', roughness: 0.55, metalness: 0.15, fog: false });
    m.onBeforeCompile = (shader) => windowShader(shader, uniforms.glow, uniforms.haze, uniforms.hazeColor);
    return m;
  }, [uniforms]);

  useLayoutEffect(() => {
    const o = new Object3D();
    layout.buildings.forEach((b, i) => {
      o.position.copy(b.pos);
      o.rotation.set(0, b.yaw, 0);
      o.scale.copy(b.size);
      o.updateMatrix();
      mesh.current.setMatrixAt(i, o.matrix);
    });
    mesh.current.count = layout.buildings.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [layout]);

  useFrame(() => {
    uniforms.glow.value = CONFIG.coast.windowGlow;
    uniforms.haze.value = CONFIG.coast.haze;
    uniforms.hazeColor.value.set(CONFIG.look.fogColor);
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, material, Math.max(1, layout.buildings.length)]}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

function NeonSigns({ layout }: { layout: CityLayout }) {
  const mesh = useRef<InstancedMesh>(null!);
  const material = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), []);
  useLayoutEffect(() => {
    const o = new Object3D();
    layout.signs.forEach((s, i) => {
      o.position.copy(s.pos);
      o.rotation.set(0, s.yaw, 0);
      o.scale.set(s.w, s.h, 1);
      o.updateMatrix();
      mesh.current.setMatrixAt(i, o.matrix);
      mesh.current.setColorAt(i, s.color);
    });
    mesh.current.count = layout.signs.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [layout]);
  useFrame((state) => {
    // one sign in five buzzes like a tired neon tube
    material.color.setScalar(CONFIG.coast.neonGlow * (0.92 + 0.08 * Math.sin(state.clock.elapsedTime * 31)));
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, material, Math.max(1, layout.signs.length)]}>
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  );
}

/* ================================================================= bridge */

type BridgeLayout = { origin: Vector3; yaw: number; length: number; pylons: number[]; deckY: number };

/** Cable-stayed bridge silhouette (Sea Link style): inverted-Y pylons, cable fans, deck. */
function Bridge({ b }: { b: BridgeLayout }) {
  const { solids, cables } = useMemo(() => {
    const silhouette = new MeshStandardMaterial({ color: '#10151c', roughness: 0.9, fog: false });
    const parts: { pos: [number, number, number]; rot: [number, number, number]; size: [number, number, number] }[] = [];
    const { length, pylons, deckY } = b;
    const sea = CONFIG.coast.seaLevel;
    parts.push({ pos: [0, deckY, 0], rot: [0, 0, 0], size: [20, 2.6, length] });
    const merge = 86;
    const top = 132;
    for (const z of pylons) {
      for (const side of [-1, 1]) {
        const dx = 13;
        const legLen = Math.hypot(dx, merge - sea);
        const tilt = Math.atan2(dx, merge - sea) * side;
        parts.push({ pos: [(side * dx) / 2, (merge + sea) / 2, z], rot: [0, 0, tilt], size: [3.2, legLen, 4.5] });
      }
      parts.push({ pos: [0, (merge + top) / 2, z], rot: [0, 0, 0], size: [4.2, top - merge, 5.5] });
    }
    // cable fans in the central plane
    const pts: number[] = [];
    for (const z of pylons) {
      for (let k = 1; k <= 16; k++) {
        const ay = 94 + k * 2.3;
        for (const dir of [-1, 1]) pts.push(0, ay, z, 0, deckY + 1.3, z + dir * (18 + k * 16));
      }
    }
    const cableGeo = new BufferGeometry();
    cableGeo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const cableMat = new LineBasicMaterial({ color: '#7c8da3', transparent: true, opacity: 0.5, fog: false });
    return { solids: { parts, silhouette }, cables: { cableGeo, cableMat } };
  }, [b]);

  return (
    <group position={b.origin} rotation-y={b.yaw}>
      {solids.parts.map((p, i) => (
        <mesh key={i} position={p.pos} rotation={p.rot} material={solids.silhouette}>
          <boxGeometry args={p.size} />
        </mesh>
      ))}
      <lineSegments geometry={cables.cableGeo} material={cables.cableMat} />
    </group>
  );
}

/* ================================================================== scene */

/**
 * Everything beyond the road: sky, the city with lit windows and neon, the far
 * shoreline across the bay, and a cable-stayed bridge out at sea.
 */
export function Cityscape() {
  const mobile = useMemo(() => isMobile(), []);
  const track = useMemo(() => getTrack(), []);

  const { cityDir, layout, bridge, shore, bridgeLights } = useMemo(() => {
    const rnd = mulberry32(7);
    const p = new Vector3();
    const l = new Vector3();
    const f = new Vector3();

    // The city lies to the right of the road's middle
    const hMid = sampleTrack(track, track.length / 2, p);
    const mid = p.clone();
    leftOf(hMid, l);
    const cityDir = new Vector2(-l.x, -l.z).normalize();

    const layout = layoutCity(track, mobile);

    // Bridge out at sea, off the main bend, set at an angle to the coast
    const arcB = track.arcs[1];
    const hB = sampleTrack(track, (arcB.sFrom + arcB.sTo) / 2, p);
    leftOf(hB, l);
    const bridgeYaw = hB + 0.35;
    const bridge: BridgeLayout = {
      origin: p.clone().addScaledVector(l, 560).setY(0),
      yaw: bridgeYaw,
      length: 1700,
      pylons: [-280, 280],
      deckY: 24,
    };
    const along = forwardOf(bridgeYaw, new Vector3());
    const across = leftOf(bridgeYaw, new Vector3());
    const bridgeLights: Sprite[] = [];
    for (let z = -850; z <= 850; z += 20) {
      for (const side of [-1, 1]) {
        const pos = bridge.origin.clone().addScaledVector(along, z).addScaledVector(across, side * 9.5).setY(bridge.deckY + 1.6);
        bridgeLights.push({ pos, color: new Color('#ffd9a8'), size: 1.4 });
      }
    }
    for (const z of bridge.pylons) {
      bridgeLights.push({ pos: bridge.origin.clone().addScaledVector(along, z).setY(134), color: new Color('#ff2020').multiplyScalar(2), size: 2.2, blink: 0.5 });
    }

    // Far shoreline across the bay: promenade lamps plus the city above them
    leftOf(hMid, l);
    forwardOf(hMid, f);
    const shoreCentre = mid.clone().addScaledVector(l, 980);
    const shore: Sprite[] = [];
    const lamps = mobile ? 160 : 340;
    for (let i = 0; i < lamps; i++) {
      const u = -1100 + (2200 * i) / lamps;
      const pos = shoreCentre
        .clone()
        .addScaledVector(f, u)
        .addScaledVector(l, -(u * u) / 4800)
        .setY(3);
      shore.push({ pos, color: new Color('#ffb066').multiplyScalar(1.3), size: 2.4 });
    }
    const cityLights = mobile ? 180 : 420;
    for (let i = 0; i < cityLights; i++) {
      const u = -1200 + rnd() * 2400;
      const back = 20 + rnd() * 160;
      const pos = shoreCentre
        .clone()
        .addScaledVector(f, u)
        .addScaledVector(l, -(u * u) / 4800 + back)
        .setY(6 + Math.pow(rnd(), 1.8) * 90);
      const tint = rnd();
      const color = new Color(tint < 0.6 ? '#ffc58a' : tint < 0.85 ? '#e8f1ff' : '#8fd8ff');
      shore.push({ pos, color, size: 1.6 + rnd() * 1.4, blink: rnd() < 0.02 ? 0.7 : 0 });
    }
    return { cityDir, layout, bridge, shore, bridgeLights };
  }, [track, mobile]);

  return (
    <group>
      <Sky cityDir={cityDir} />
      <Buildings layout={layout} />
      <NeonSigns layout={layout} />
      <Bridge b={bridge} />
      <LightSprites sprites={bridgeLights} intensity={() => CONFIG.coast.bridgeLights} />
      <LightSprites sprites={shore} intensity={() => CONFIG.coast.shoreLights} />
      <LightSprites sprites={layout.aviation} intensity={() => CONFIG.coast.bridgeLights} />
    </group>
  );
}
