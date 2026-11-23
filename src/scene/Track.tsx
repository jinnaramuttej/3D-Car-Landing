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
  type InstancedMesh,
  Matrix4,
  type MeshStandardMaterial,
  Object3D,
  Vector2,
  Vector3,
} from 'three';
import { CONFIG } from '@/lib/config';
import { getTrack, leftOf, sampleTrack, type Track as TrackData } from '@/lib/motion';
import { createAsphaltTextures, createGlowTexture, createKerbTexture } from '@/lib/textures';
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

function useTrackKey() {
  const [key, setKey] = useState(() => getTrack().key);
  useFrame(() => {
    const k = getTrack().key;
    if (k !== key) setKey(k);
  });
  return key;
}

export function Track() {
  const mobile = useMemo(() => isMobile(), []);
  const key = useTrackKey();
  const track = useMemo(() => getTrack(), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const asphalt = useMemo(() => {
    const t = createAsphaltTextures();
    t.normal.repeat.set(160, 160);
    t.roughness.repeat.set(5, 5);
    return t;
  }, []);
  const kerbTex = useMemo(() => createKerbTexture(), []);
  const glowTex = useMemo(() => createGlowTexture(), []);

  const ground = useMemo(() => {
    const box = new Vector3();
    const min = new Vector3(Infinity, 0, Infinity);
    const max = new Vector3(-Infinity, 0, -Infinity);
    for (let i = 0; i <= 50; i++) {
      track.curve.getPointAt(i / 50, box);
      min.min(box);
      max.max(box);
    }
    return { center: min.clone().add(max).multiplyScalar(0.5), size: Math.max(max.x - min.x, max.z - min.z) + 400 };
  }, [track]);

  const lines = useMemo(() => {
    const hw = CONFIG.track.halfWidth;
    const kerbs: BufferGeometry[] = [];
    for (const arc of track.arcs) {
      // inside of the bend, plus the exit kerb on the outside where the car runs wide
      kerbs.push(ribbon(track, arc.sFrom - 8, arc.sTo + 8, arc.sign * (hw + 0.6), 1.1, 0.008, 3));
      kerbs.push(ribbon(track, arc.sTo - 18, arc.sTo + 30, -arc.sign * (hw + 0.6), 1.1, 0.008, 3));
    }
    return {
      edges: [ribbon(track, 0, track.length, hw, 0.22, 0.006), ribbon(track, 0, track.length, -hw, 0.22, 0.006)],
      kerbs,
    };
  }, [track]);

  // Lamp posts on both sides, staggered, arms reaching back over the road.
  const lamps = useMemo(() => {
    const out: { base: Vector3; inward: Vector3 }[] = [];
    const hw = CONFIG.track.halfWidth;
    const p = new Vector3();
    const l = new Vector3();
    const add = (s: number, side: number) => {
      const h = sampleTrack(track, s, p);
      leftOf(h, l);
      const inward = l.clone().multiplyScalar(-side);
      out.push({ base: p.clone().addScaledVector(l, side * (hw + 6)), inward });
    };
    for (let s = track.sStart - 60, i = 0; s < track.sEnd + 80 && out.length < 64; s += 18, i++) add(s, i % 2 ? 1 : -1);
    return out;
  }, [track]);

  const poles = useRef<InstancedMesh>(null!);
  const arms = useRef<InstancedMesh>(null!);
  const heads = useRef<InstancedMesh>(null!);
  const pools = useRef<InstancedMesh>(null!);
  const headMat = useRef<MeshStandardMaterial>(null!);
  const reflector = useRef<ReflectorMaterial>(null!);

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
      m.makeRotationX(-Math.PI / 2).setPosition(lamp.base.clone().addScaledVector(lamp.inward, 4.5).setY(0.02));
      pools.current.setMatrixAt(i, m);
    });
    for (const im of [poles, arms, heads, pools]) {
      im.current.count = lamps.length;
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
    pools.current.layers.set(1);
  }, [lamps]);

  useFrame(({ scene }) => {
    const l = CONFIG.look;
    headMat.current.emissiveIntensity = l.lampEmissive;
    const r = reflector.current;
    if (r) {
      r.mixStrength = l.reflection;
      r.mixBlur = l.reflectionBlur;
      r.color.set(l.groundColor);
      // three ignores envMapIntensity for materials that fall back to scene.environment,
      // so hand the env map over explicitly to get a separate (much lower) level here.
      if (scene.environment && r.envMap !== scene.environment) {
        r.envMap = scene.environment;
        r.needsUpdate = true;
      }
      r.envMapIntensity = l.groundEnv;
    }
  });

  const normalScale = useMemo(() => new Vector2(0.08, 0.08), []);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[ground.center.x, 0, ground.center.z]}>
        <planeGeometry args={[ground.size, ground.size]} />
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
          color={CONFIG.look.groundColor}
          metalness={0.5}
        />
      </mesh>

      {lines.edges.map((g, i) => (
        <mesh key={`edge-${i}`} geometry={g} renderOrder={1}>
          <meshStandardMaterial
            color="#d9d9d9"
            roughness={0.55}
            emissive={new Color('#ffffff')}
            emissiveIntensity={0.06}
            side={DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}
      {lines.kerbs.map((g, i) => (
        <mesh key={`kerb-${i}`} geometry={g} renderOrder={1}>
          <meshStandardMaterial map={kerbTex} roughness={0.6} side={DoubleSide} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      ))}

      <instancedMesh ref={poles} args={[undefined, undefined, 64]}>
        <cylinderGeometry args={[0.09, 0.14, 10, 8]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.6} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={arms} args={[undefined, undefined, 64]}>
        <boxGeometry args={[0.12, 0.12, 3.4]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.6} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, 64]}>
        <boxGeometry args={[0.7, 0.14, 1.5]} />
        <meshStandardMaterial ref={headMat} color="#111" emissive="#ffe3b8" emissiveIntensity={CONFIG.look.lampEmissive} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, 64]} renderOrder={1}>
        <planeGeometry args={[16, 16]} />
        <meshBasicMaterial
          map={glowTex}
          color="#ffcf94"
          transparent
          opacity={0.07}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
