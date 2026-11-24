'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  type Group,
  type InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { chapterState } from '@/lib/chapterRuntime';
import { DECK_T, deckFrameAt, deckRange, deckStrip, patchGeometry } from '@/lib/bridgePath';
import { BRIDGE, CITY_ORIGIN, getRoute, SEA_LEVEL } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { patchCityMaterial } from './cityMaterials';
import { registerLamps } from './StreetLights';
import { useCityLayer } from './City';

const SEA_Y = CITY_ORIGIN.y + SEA_LEVEL;

export type BridgeInfo = {
  /** Route metres where the deck starts and ends. */
  from: number;
  to: number;
  /** Route metres of each pylon and of every stay-cable anchor on the deck (for the whoosh). */
  pylons: number[];
  anchors: number[];
};
export const bridgeInfo: BridgeInfo = { from: 0, to: 0, pylons: [], anchors: [] };

/** Lane markings for the deck: three lanes each way, solid edges, a double line in the middle. */
function deckTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26272b';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  const x = (f: number) => f * 512;
  g.fillStyle = '#d8d8d8';
  for (const f of [0.06, 0.94]) g.fillRect(x(f) - 3, 0, 6, 256);
  g.fillStyle = '#d6a41a';
  for (const f of [0.49, 0.51]) g.fillRect(x(f) - 2.5, 0, 5, 256);
  g.fillStyle = '#d8d8d8';
  for (const f of [0.205, 0.35, 0.65, 0.795]) g.fillRect(x(f) - 2.5, 0, 5, 110);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * The cable-stayed bridge of the finale, built from code along the end of the route:
 * a box-girder deck with lanes and parapets, two H-pylons rising from the sea with
 * fans of stay cables (instanced), red aviation lights that blink at the tops, a row
 * of lamps down each edge (they join the city's lamps, so real lights follow them too)
 * and piers on the approach spans.
 */
export function Bridge() {
  const group = useRef<Group>(null!);
  useCityLayer(group);
  const cables = useRef<InstancedMesh>(null!);
  const lampPoles = useRef<InstancedMesh>(null!);
  const lampHeads = useRef<InstancedMesh>(null!);
  const warnMat = useMemo(() => new MeshStandardMaterial({ color: '#300', emissive: new Color('#ff1a10'), emissiveIntensity: 9 }), []);
  const lampMat = useRef<MeshStandardMaterial>(null!);
  const deck = useRef<MeshStandardMaterial>(null!);

  const build = useMemo(() => {
    const route = getRoute();
    const hw = BRIDGE.halfWidth;
    // the deck takes over right where the city route ends (tangent-continuous: it is built
    // on the same curve), so the flyover runs straight onto it with no gap
    const { from, to } = deckRange();
    const top = deckStrip(from, to, hw, 0.02, -hw, 0.02, 30);
    const sides = [deckStrip(from, to, hw, 0.02, hw, -DECK_T, 30), deckStrip(from, to, -hw, -DECK_T, -hw, 0.02, 30)];
    const under = deckStrip(from, to, -hw, -DECK_T, hw, -DECK_T, 30);
    // solid concrete parapets (inner face, cap, outer face) with a steel rail on top
    const P = 0.55;
    const parapets = [1, -1].flatMap((side) => {
      const o = side * hw;
      const i = side * (hw - P);
      return side === 1
        ? [deckStrip(from, to, i, 1.1, i, 0, 30), deckStrip(from, to, o, 1.1, i, 1.1, 30), deckStrip(from, to, o, -0.4, o, 1.1, 30)]
        : [deckStrip(from, to, i, 0, i, 1.1, 30), deckStrip(from, to, i, 1.1, o, 1.1, 30), deckStrip(from, to, o, 1.1, o, -0.4, 30)];
    });
    const rails = [1, -1].map((side) => {
      const x = side * (hw - P * 0.5);
      return side === 1 ? deckStrip(from, to, x, 1.55, x, 1.4, 30) : deckStrip(from, to, x, 1.4, x, 1.55, 30);
    });
    const patches = patchGeometry();

    // pylons: two legs each, beyond the deck edges, from the sea to the top
    const legs: { pos: Vector3; height: number; quat: Quaternion }[] = [];
    const beams: { pos: Vector3; len: number; quat: Quaternion }[] = [];
    const warn: Vector3[] = [];
    const cableMats: Matrix4[] = [];
    const anchors: number[] = [];
    const pylonS = BRIDGE.pylons.map((d) => route.bridgeStart + d);
    const up = new Vector3(0, 1, 0);
    for (const s of pylonS) {
      const { p, f, l } = deckFrameAt(s);
      const heading = Math.atan2(f.x, f.z);
      const q = new Quaternion().setFromAxisAngle(up, heading);
      const topY = SEA_Y + BRIDGE.pylonHeight;
      for (const side of [1, -1]) {
        const base = p.clone().addScaledVector(l, side * (hw + 2.6));
        legs.push({ pos: base.clone().setY((SEA_Y + topY) / 2), height: topY - SEA_Y, quat: q });
        warn.push(base.clone().setY(topY + 0.8), base.clone().setY(p.y + 46));
        // a fan of stays from the upper leg to the deck edge, forward and back
        for (const dir of [1, -1]) {
          for (let k = 0; k < 11; k++) {
            const along = 26 + k * 13;
            const deckS = s + dir * along;
            const d = deckFrameAt(deckS);
            const a = d.p.clone().addScaledVector(d.l, side * (hw - 0.6)).setY(d.p.y + 0.6);
            const b = base.clone().setY(p.y + 44 + k * 3.4).addScaledVector(l, -side * 0.6);
            const mid = a.clone().add(b).multiplyScalar(0.5);
            const dirV = b.clone().sub(a);
            const len = dirV.length();
            const qq = new Quaternion().setFromUnitVectors(up, dirV.normalize());
            cableMats.push(new Matrix4().compose(mid, qq, new Vector3(1, len, 1)));
            if (side === 1) anchors.push(deckS);
          }
        }
      }
      // cross-beams: under the deck, at the billboard, near the top
      for (const y of [p.y - DECK_T - 1.5, p.y + 30 - 6.2, topY - 7]) beams.push({ pos: p.clone().setY(y), len: 2 * (hw + 2.6), quat: q });
    }

    // lamps down both edges, every 30 m
    const lamps: { pos: Vector3; quat: Quaternion; head: Vector3 }[] = [];
    for (let s = from + 15; s < to - 10; s += 30) {
      const { p, f, l } = deckFrameAt(s);
      const heading = Math.atan2(f.x, f.z);
      for (const side of [1, -1]) {
        const pos = p.clone().addScaledVector(l, side * (hw - 0.8));
        const head = pos.clone().addScaledVector(l, -side * 1.8).setY(p.y + 9.6);
        lamps.push({ pos: pos.setY(p.y + 4.9), quat: new Quaternion().setFromAxisAngle(up, heading + (side === 1 ? 0 : Math.PI)), head });
      }
    }

    // approach piers, clear of the pylons
    const piers: Vector3[] = [];
    for (let s = from + 30; s < to; s += 64) {
      if (pylonS.some((ps) => Math.abs(ps - s) < 70)) continue;
      const { p } = deckFrameAt(s);
      piers.push(p.clone().setY((p.y - DECK_T + SEA_Y) / 2));
    }
    const pierH = (y: number) => 2 * (y - SEA_Y);

    bridgeInfo.from = from;
    bridgeInfo.to = to;
    bridgeInfo.pylons = pylonS;
    bridgeInfo.anchors = anchors.sort((x, y) => x - y);
    return { top, sides, under, parapets, rails, patches, legs, beams, warn, cableMats, lamps, piers, pierH };
  }, []);

  const deckMat = useMemo(() => {
    const tex = deckTexture();
    tex.repeat.set(1, 1);
    return tex;
  }, []);

  useLayoutEffect(() => {
    cables.current.count = build.cableMats.length;
    build.cableMats.forEach((m, i) => cables.current.setMatrixAt(i, m));
    cables.current.instanceMatrix.needsUpdate = true;
    cables.current.computeBoundingSphere();
    const o = new Object3D();
    build.lamps.forEach((lamp, i) => {
      o.position.copy(lamp.pos);
      o.quaternion.copy(lamp.quat);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      lampPoles.current.setMatrixAt(i, o.matrix);
      o.position.copy(lamp.head);
      o.updateMatrix();
      lampHeads.current.setMatrixAt(i, o.matrix);
    });
    for (const im of [lampPoles, lampHeads]) {
      im.current.count = build.lamps.length;
      im.current.instanceMatrix.needsUpdate = true;
      im.current.computeBoundingSphere();
    }
    registerLamps(build.lamps.map((l) => l.head));
  }, [build]);

  useFrame((state) => {
    const on = chapterState.stage === 'city';
    group.current.visible = on || chapterState.cloud > 0.2;
    if (!on) return;
    const t = state.clock.elapsedTime;
    // the deck takes the sky the way the wet city streets do: faint (three ignores
    // envMapIntensity for materials that fall back to scene.environment)
    const d = deck.current;
    if (d && state.scene.environment && d.envMap !== state.scene.environment) {
      d.envMap = state.scene.environment;
      d.needsUpdate = true;
    }
    if (d) d.envMapIntensity = chapterState.env.groundEnv * 1.4;
    // aviation lights: one second on, one off
    warnMat.emissiveIntensity = (Math.sin(t * Math.PI) > 0 ? 9 : 0.4) * (0.5 + 0.5 * chapterState.env.city);
    lampMat.current.emissiveIntensity = CONFIG.coast.sodiumEmissive * chapterState.env.lamps;
  }, -1);

  return (
    <group ref={group}>
      {/* (a 'ground' deck: it drains, so fewer puddles than the city streets) */}
      <mesh geometry={build.top} onUpdate={(m) => patchCityMaterial(m.material as MeshStandardMaterial)}>
        <meshStandardMaterial ref={deck} name="ground:bridge" map={deckMat} roughness={0.55} metalness={0} />
      </mesh>
      {[...build.sides, build.under].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#3a3b40" roughness={0.8} side={2} />
        </mesh>
      ))}
      {build.parapets.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#56585e" roughness={0.75} side={2} />
        </mesh>
      ))}
      {build.rails.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#9a9ea6" roughness={0.35} metalness={0.8} side={2} />
        </mesh>
      ))}
      {/* the few holes in the model's road under the route, filled */}
      {build.patches.map((g, i) => (
        <mesh key={i} geometry={g} onUpdate={(m) => patchCityMaterial(m.material as MeshStandardMaterial)}>
          <meshStandardMaterial name="road:patch" color="#2a2b2f" roughness={0.6} metalness={0} />
        </mesh>
      ))}
      {build.legs.map((l, i) => (
        <mesh key={i} position={l.pos} quaternion={l.quat}>
          <boxGeometry args={[2.6, l.height, 4.2]} />
          <meshStandardMaterial color="#8a8c92" roughness={0.75} />
        </mesh>
      ))}
      {build.beams.map((b, i) => (
        <mesh key={i} position={b.pos} quaternion={b.quat}>
          <boxGeometry args={[b.len, 2.4, 3.2]} />
          <meshStandardMaterial color="#7d7f85" roughness={0.75} />
        </mesh>
      ))}
      {build.piers.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[5, build.pierH(p.y), 7]} />
          <meshStandardMaterial color="#45474c" roughness={0.85} />
        </mesh>
      ))}
      <instancedMesh ref={cables} args={[undefined, undefined, build.cableMats.length]}>
        <cylinderGeometry args={[0.13, 0.13, 1, 5]} />
        <meshStandardMaterial color="#c9ccd2" roughness={0.35} metalness={0.8} />
      </instancedMesh>
      {build.warn.map((w, i) => (
        <mesh key={i} position={w} material={warnMat}>
          <sphereGeometry args={[0.55, 10, 8]} />
        </mesh>
      ))}
      <instancedMesh ref={lampPoles} args={[undefined, undefined, build.lamps.length]}>
        <cylinderGeometry args={[0.1, 0.16, 9.8, 8]} />
        <meshStandardMaterial color="#2a2c31" roughness={0.45} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={lampHeads} args={[undefined, undefined, build.lamps.length]}>
        <boxGeometry args={[0.5, 0.16, 1.2]} />
        <meshStandardMaterial ref={lampMat} color="#111" emissive={new Color('#ffc890')} emissiveIntensity={6} />
      </instancedMesh>
    </group>
  );
}
