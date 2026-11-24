'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { landPolygon } from '@/lib/coast';
import { chapterState } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { forwardOf, getTrack, leftOf, sampleTrack, type Track as TrackData } from '@/lib/motion';
import { createAsphaltTextures, createDashTexture, createGlowTexture, createWaveNormalTexture } from '@/lib/textures';
import { isMobile } from '@/lib/device';

type ReflectorMaterial = MeshStandardMaterial & { mixStrength: number; mixBlur: number };

/** A flat strip that follows the centre line at a lateral offset (positive = left). */
function ribbon(track: TrackData, sFrom: number, sTo: number, offset: number, width: number, y: number, vScale = 1) {
  const step = 1.5;
  const n = Math.max(2, Math.ceil((sTo - sFrom) / step) + 1);
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx: number[] = [];
  const p = new Vector3();
  const l = new Vector3();
  for (let i = 0; i < n; i++) {
    const s = sFrom + ((sTo - sFrom) * i) / (n - 1);
    const h = sampleTrack(track, s, p);
    leftOf(h, l);
    const cx = p.x + l.x * offset;
    const cz = p.z + l.z * offset;
    pos.set([cx + (l.x * width) / 2, y, cz + (l.z * width) / 2, cx - (l.x * width) / 2, y, cz - (l.z * width) / 2], i * 6);
    uv.set([0, s / vScale, 1, s / vScale], i * 4);
    if (i < n - 1) {
      const v = i * 2;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ribbons wind either way depending on side; force normals up for lighting
  const normals = g.attributes.normal as BufferAttribute;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  return g;
}

/**
 * The land: one flat polygon that stops at the sea wall on the left of the road and
 * runs far out to the city on the right. Built in the XY plane (y = -world z) and
 * rotated flat, which is what MeshReflectorMaterial expects of a mirror.
 */
function landGeometry(track: TrackData) {
  const pts = landPolygon(track).map((v) => new Vector2(v.x, -v.y));
  return new ShapeGeometry(new Shape(pts));
}

/** Concrete sea wall along the left edge: road-side face, cap, sea-side face. */
function seaWallGeometry(track: TrackData) {
  const { seaWallOffset: off, seaLevel } = CONFIG.coast;
  const height = 0.95;
  const thick = 0.55;
  // cross-section (lateral offset, y), one strip per face
  const faces: [number, number, number, number][] = [
    [off, 0, off, height],
    [off, height, off + thick, height],
    [off + thick, height, off + thick, seaLevel - 0.6],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const l = new Vector3();
  const samples: { p: Vector3; l: Vector3 }[] = [];
  for (let s = -500; s <= track.length + 500; s += 3) {
    const h = sampleTrack(track, Math.min(Math.max(s, 0), track.length), p);
    leftOf(h, l);
    const fwd = forwardOf(h, new Vector3());
    const extra = s < 0 ? s : s > track.length ? s - track.length : 0;
    samples.push({ p: p.clone().addScaledVector(fwd, extra), l: l.clone() });
  }
  for (const [o0, y0, o1, y1] of faces) {
    const base = pos.length / 3;
    for (const smp of samples) {
      pos.push(smp.p.x + smp.l.x * o0, y0, smp.p.z + smp.l.z * o0);
      pos.push(smp.p.x + smp.l.x * o1, y1, smp.p.z + smp.l.z * o1);
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const v = base + i * 2;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sodium lamp heads on the waterfront (world space): the smoke picks up the nearest. */
export const coastLampHeads: Vector3[] = [];

function useTrackKey() {
  const [key, setKey] = useState(() => getTrack().key);
  useFrame(() => {
    const k = getTrack().key;
    if (k !== key) setKey(k);
  });
  return key;
}

/**
 * The waterfront at night in the rain (chapters I-IV): wet asphalt (blurred reflections, puddles),
 * Indian road markings, a sea wall with the sea beyond, and sodium street lamps
 * along the promenade (Queen's Necklace style) with orange pools on the wet road.
 */
export function Track() {
  const mobile = useMemo(() => isMobile(), []);
  const key = useTrackKey();
  const track = useMemo(() => getTrack(), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const asphalt = useMemo(() => {
    const t = createAsphaltTextures();
    // the land's UVs are in metres: grain every 1.6 m, puddle pattern every 34 m
    t.normal.repeat.set(1 / 1.6, 1 / 1.6);
    t.roughness.repeat.set(1 / 34, 1 / 34);
    return t;
  }, []);
  const dashTex = useMemo(() => createDashTexture(), []);
  const glowTex = useMemo(() => createGlowTexture(), []);
  const waves = useMemo(() => {
    const t = createWaveNormalTexture();
    t.repeat.set(220, 220);
    return t;
  }, []);

  const land = useMemo(() => landGeometry(track), [track]);
  const wall = useMemo(() => seaWallGeometry(track), [track]);

  const lines = useMemo(() => {
    const hw = CONFIG.track.halfWidth;
    return {
      // solid white edges, double yellow centre, dashed white lane lines (3 m dash, 6 m gap)
      edges: [ribbon(track, 0, track.length, hw - 0.3, 0.16, 0.006), ribbon(track, 0, track.length, -hw + 0.3, 0.16, 0.006)],
      centre: [ribbon(track, 0, track.length, 0.14, 0.12, 0.006), ribbon(track, 0, track.length, -0.14, 0.12, 0.006)],
      lanes: [ribbon(track, 0, track.length, hw / 2, 0.13, 0.006, 9), ribbon(track, 0, track.length, -hw / 2, 0.13, 0.006, 9)],
    };
  }, [track]);

  // Sodium lamps: along the promenade (sea side) and staggered on the city side
  const lamps = useMemo(() => {
    const out: { base: Vector3; inward: Vector3 }[] = [];
    const hw = CONFIG.track.halfWidth;
    const p = new Vector3();
    const l = new Vector3();
    const add = (s: number, side: number, offset: number) => {
      const h = sampleTrack(track, s, p);
      leftOf(h, l);
      out.push({ base: p.clone().addScaledVector(l, side * offset), inward: l.clone().multiplyScalar(-side) });
    };
    for (let s = 0, i = 0; s < track.length && out.length < 96; s += 15, i++) {
      if (i % 2 === 0) add(s, 1, CONFIG.coast.seaWallOffset - 1.2);
      else add(s, -1, hw + 3);
    }
    coastLampHeads.length = 0;
    for (const lamp of out) coastLampHeads.push(lamp.base.clone().addScaledVector(lamp.inward, 3).setY(9.85));
    return out;
  }, [track]);

  const poles = useRef<InstancedMesh>(null!);
  const arms = useRef<InstancedMesh>(null!);
  const heads = useRef<InstancedMesh>(null!);
  const pools = useRef<InstancedMesh>(null!);
  const headMat = useRef<MeshStandardMaterial>(null!);
  const poolMat = useRef<MeshStandardMaterial>(null!);
  const reflector = useRef<ReflectorMaterial>(null!);
  const sea = useRef<Mesh>(null!);
  const seaMat = useRef<MeshStandardMaterial>(null!);
  const root = useRef<Group>(null!);

  useLayoutEffect(() => {
    const o = new Object3D();
    const m = new Matrix4();
    lamps.forEach((lamp, i) => {
      const yaw = Math.atan2(lamp.inward.x, lamp.inward.z);
      o.rotation.set(0, yaw, 0);
      o.scale.set(1, 1, 1);
      o.position.copy(lamp.base).setY(5);
      o.updateMatrix();
      poles.current.setMatrixAt(i, o.matrix);
      o.position.copy(lamp.base).addScaledVector(lamp.inward, 1.6).setY(10);
      o.updateMatrix();
      arms.current.setMatrixAt(i, o.matrix);
      o.position.copy(lamp.base).addScaledVector(lamp.inward, 3).setY(9.85);
      o.updateMatrix();
      heads.current.setMatrixAt(i, o.matrix);
      m.makeRotationX(-Math.PI / 2).setPosition(lamp.base.clone().addScaledVector(lamp.inward, 3.5).setY(0.02));
      pools.current.setMatrixAt(i, m);
    });
    for (const im of [poles, arms, heads, pools]) {
      im.current.count = lamps.length;
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
    pools.current.layers.set(1);
  }, [lamps]);

  useFrame(({ scene }, dt) => {
    // the waterfront is only drawn on its own stage (and through the cloud to the city)
    root.current.visible = chapterState.stage === 'coast' || chapterState.cloud > 0.2;
    if (!root.current.visible) return;
    const l = CONFIG.look;
    const c = CONFIG.coast;
    headMat.current.emissive.set(c.sodium);
    // the street lamps switch off as it gets light
    const e = chapterState.env;
    headMat.current.emissiveIntensity = c.sodiumEmissive * e.lamps;
    poolMat.current.opacity = 0.06 * e.lamps;
    poolMat.current.color.set(c.sodium);
    const r = reflector.current;
    if (r) {
      r.mixStrength = l.reflection * e.wet;
      r.mixBlur = l.reflectionBlur;
      r.color.copy(e.ground);
      // three ignores envMapIntensity for materials that fall back to scene.environment,
      // so hand the env map over explicitly to get a separate (much lower) level here.
      if (scene.environment && r.envMap !== scene.environment) {
        r.envMap = scene.environment;
        r.needsUpdate = true;
      }
      r.envMapIntensity = e.groundEnv;
    }
    // Water reflects ~2% face-on and a lot at grazing angles, so metalness stays 0;
    // the env map is handed over explicitly for the same reason as the asphalt.
    const sm = seaMat.current;
    if (sm && scene.environment && sm.envMap !== scene.environment) {
      sm.envMap = scene.environment;
      sm.needsUpdate = true;
    }
    if (sm) sm.envMapIntensity = e.seaEnv;
    // slow swell on the sea
    waves.offset.x += c.waveSpeed * dt;
    waves.offset.y += c.waveSpeed * 0.6 * dt;
  });

  const normalScale = useMemo(() => new Vector2(0.1, 0.1), []);
  const seaNormal = useMemo(() => new Vector2(0.35, 0.35), []);

  return (
    <group ref={root}>
      {/* wet asphalt: land polygon stops at the sea wall */}
      <mesh geometry={land} rotation-x={-Math.PI / 2}>
        <MeshReflectorMaterial
          ref={reflector as never}
          resolution={mobile ? 256 : 1024}
          blur={[400, 120]}
          mixBlur={CONFIG.look.reflectionBlur}
          mixStrength={CONFIG.look.reflection}
          mixContrast={1}
          roughness={1}
          roughnessMap={asphalt.roughness}
          normalMap={asphalt.normal}
          normalScale={normalScale}
          depthScale={1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#0e1014"
          metalness={0.5}
        />
      </mesh>

      {/* the sea below the wall */}
      <mesh ref={sea} rotation-x={-Math.PI / 2} position={[0, CONFIG.coast.seaLevel, 0]}>
        <planeGeometry args={[6000, 6000]} />
        <meshStandardMaterial
          ref={seaMat}
          color="#010305"
          roughness={0.12}
          metalness={0}
          normalMap={waves}
          normalScale={seaNormal}
        />
      </mesh>

      <mesh geometry={wall}>
        <meshStandardMaterial color="#2a2c31" roughness={0.72} metalness={0.05} />
      </mesh>

      {lines.edges.map((g, i) => (
        <mesh key={`edge-${i}`} geometry={g} renderOrder={1}>
          <meshStandardMaterial color="#d8d8d8" roughness={0.4} side={DoubleSide} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      ))}
      {lines.centre.map((g, i) => (
        <mesh key={`centre-${i}`} geometry={g} renderOrder={1}>
          <meshStandardMaterial color="#d9a514" roughness={0.4} side={DoubleSide} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      ))}
      {lines.lanes.map((g, i) => (
        <mesh key={`lane-${i}`} geometry={g} renderOrder={1}>
          <meshStandardMaterial
            color="#d8d8d8"
            map={dashTex}
            alphaTest={0.5}
            roughness={0.4}
            side={DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}

      <instancedMesh ref={poles} args={[undefined, undefined, 96]}>
        <cylinderGeometry args={[0.09, 0.14, 10, 8]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={arms} args={[undefined, undefined, 96]}>
        <boxGeometry args={[0.12, 0.12, 3.4]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, 96]}>
        <boxGeometry args={[0.6, 0.16, 1.2]} />
        <meshStandardMaterial ref={headMat} color="#111" emissive={new Color(CONFIG.coast.sodium)} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, 96]} renderOrder={1}>
        <planeGeometry args={[18, 18]} />
        <meshBasicMaterial
          ref={poolMat as never}
          map={glowTex}
          transparent
          opacity={0.06}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
