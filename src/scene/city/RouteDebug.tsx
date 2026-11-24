'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  type Group,
  type InstancedMesh,
  Line,
  LineBasicMaterial,
  Object3D,
  SpriteMaterial,
  Vector3,
} from 'three';
import { CHAPTERS } from '@/lib/chapters';
import { CITY_ORIGIN, getRoute, sampleRoute, STOPS } from '@/lib/cityRoute';
import { ROUTE_POINTS } from '@/lib/cityRoute.data';
import { CONFIG } from '@/lib/config';
import { stopAnchor } from '@/lib/stops';

function label(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.font = 'bold 30px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 33);
  return new SpriteMaterial({ map: new CanvasTexture(c), depthTest: false, transparent: true });
}

/**
 * Debug view of the city route (/?debug, city > showRoute, or /?route): the curve in
 * yellow, every waypoint from src/lib/cityRoute.data.ts as a dot (index every 5th),
 * each stop as a red post with its route metre, and each billboard's anchor in cyan.
 * To fix the route, move the VIA points in scripts/build-route.mjs and run it again
 * (or edit a waypoint in the data file); stops are STOPS in src/lib/cityRoute.ts.
 */
export function RouteDebug() {
  const group = useRef<Group>(null!);
  const dots = useRef<InstancedMesh>(null!);
  const forced = useMemo(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('route'), []);

  const { line, labels, posts } = useMemo(() => {
    const r = getRoute();
    const pts: Vector3[] = [];
    for (let s = 0; s <= r.length; s += 2) {
      const v = new Vector3();
      sampleRoute(s, v);
      pts.push(v.setY(v.y + 0.6));
    }
    const line = new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: '#ffd400', depthTest: false }));
    line.renderOrder = 50;
    const labels: { pos: Vector3; mat: SpriteMaterial }[] = [];
    ROUTE_POINTS.forEach((p, i) => {
      if (i % 5) return;
      labels.push({ pos: new Vector3(p[0], p[1] + 3, p[2]).add(CITY_ORIGIN), mat: label(`#${i}`, '#ffd400') });
    });
    const posts: { pos: Vector3; anchor: Vector3; mat: SpriteMaterial }[] = [];
    for (const c of CHAPTERS) {
      if (!c.stop) continue;
      const s = STOPS[c.stop].s;
      const pos = new Vector3();
      sampleRoute(s, pos);
      posts.push({
        pos,
        anchor: stopAnchor(c.stop).centre.clone(),
        mat: label(`${c.numeral} ${c.stop} @${s.toFixed(0)}m`, '#ff5a4a'),
      });
    }
    return { line, labels, posts };
  }, []);

  useLayoutEffect(() => {
    const o = new Object3D();
    ROUTE_POINTS.forEach((p, i) => {
      o.position.set(p[0], p[1] + 0.6, p[2]).add(CITY_ORIGIN);
      o.updateMatrix();
      dots.current.setMatrixAt(i, o.matrix);
      dots.current.setColorAt(i, new Color(i % 5 ? '#ffffff' : '#ffd400'));
    });
    dots.current.instanceMatrix.needsUpdate = true;
    dots.current.computeBoundingSphere();
    group.current.traverse((x) => x.layers.set(1));
  }, []);

  useFrame(() => {
    group.current.visible = forced || CONFIG.city.showRoute;
  });

  return (
    <group ref={group} visible={false}>
      <primitive object={line} />
      <instancedMesh ref={dots} args={[undefined, undefined, ROUTE_POINTS.length]} renderOrder={51}>
        <sphereGeometry args={[0.7, 8, 6]} />
        <meshBasicMaterial depthTest={false} toneMapped={false} />
      </instancedMesh>
      {labels.map((l, i) => (
        <sprite key={i} position={l.pos} scale={[8, 2, 1]} material={l.mat} renderOrder={52} />
      ))}
      {posts.map((p, i) => (
        <group key={i}>
          <mesh position={[p.pos.x, p.pos.y + 6, p.pos.z]} renderOrder={51}>
            <cylinderGeometry args={[0.35, 0.35, 12, 8]} />
            <meshBasicMaterial color="#ff3020" depthTest={false} toneMapped={false} />
          </mesh>
          <sprite position={[p.pos.x, p.pos.y + 14, p.pos.z]} scale={[22, 5.5, 1]} material={p.mat} renderOrder={52} />
          <mesh position={p.anchor} renderOrder={51}>
            <sphereGeometry args={[1.2, 12, 8]} />
            <meshBasicMaterial color="#20e0ff" depthTest={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
