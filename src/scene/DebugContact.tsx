'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  Euler,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { carContact, contactState } from '@/lib/cityDrive';
import { boxTriangles } from '@/lib/collide';
import { WHEELS } from '@/lib/ground';
import { carState } from '@/lib/motion';

/** The car's box for the HUD (and what the corridor sweep keeps clear): width, height above the road, length. */
export const CAR_BOX = { width: 2.0, from: 0.2, to: 1.35, length: 4.7 };

const MAX_TRIS = 600;

/**
 * /?debug: the car's oriented bounding box (green, red while anything but road is inside
 * it), the four wheel contact rays down to where they hit (cyan, magenta for a wheel that
 * found no road), and the triangles of whatever the box intersects (red). The text HUD
 * (DebugPanel) has the rest: route metre, journey time, zone, speed, the camera sphere.
 */
export function DebugContact() {
  const on = useMemo(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'), []);
  return on ? <ContactHud /> : null;
}

function ContactHud() {
  const box = useMemo(() => {
    const l = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), new LineBasicMaterial({ color: '#3cff8a', depthTest: false, transparent: true }));
    l.renderOrder = 20;
    l.matrixAutoUpdate = false;
    l.frustumCulled = false;
    return l;
  }, []);
  const rays = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(8 * 3), 3));
    const l = new LineSegments(g, new LineBasicMaterial({ color: '#33e0ff', depthTest: false, transparent: true }));
    l.renderOrder = 21;
    l.frustumCulled = false;
    return l;
  }, []);
  const dots = useMemo(
    () =>
      [0, 1, 2, 3].map(() => {
        const m = new Mesh(new SphereGeometry(0.07, 10, 8), new MeshBasicMaterial({ color: '#33e0ff', depthTest: false, transparent: true }));
        m.renderOrder = 22;
        return m;
      }),
    [],
  );
  const red = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_TRIS * 9), 3));
    g.setDrawRange(0, 0);
    const m = new Mesh(g, new MeshBasicMaterial({ color: '#ff2020', depthTest: false, transparent: true, opacity: 0.75, side: 2 }));
    m.renderOrder = 23;
    m.frustumCulled = false;
    return m;
  }, []);
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), e: new Euler(0, 0, 0, 'YXZ'), p: new Vector3(), s: new Vector3(), tris: [] as number[], frame: 0, hits: 0 }), []);
  const group = useRef<import('three').Group>(null!);

  useFrame(() => {
    const s = carState;
    // the box: the car's frame (on the road), from CAR_BOX.from to CAR_BOX.to above it
    tmp.e.set(-s.pitch, s.heading, s.groundRoll, 'YXZ');
    tmp.q.setFromEuler(tmp.e);
    tmp.p.set(0, (CAR_BOX.from + CAR_BOX.to) / 2, 0).applyQuaternion(tmp.q).add(s.position);
    tmp.s.set(CAR_BOX.width, CAR_BOX.to - CAR_BOX.from, CAR_BOX.length);
    tmp.m.compose(tmp.p, tmp.q, tmp.s);
    box.matrix.copy(tmp.m);
    // what is inside it (every few frames: a debug view, not free)
    if (tmp.frame++ % 4 === 0) {
      tmp.hits = boxTriangles(tmp.m, tmp.tris, MAX_TRIS);
      const attr = red.geometry.getAttribute('position') as BufferAttribute;
      (attr.array as Float32Array).set(tmp.tris.slice(0, MAX_TRIS * 9));
      attr.needsUpdate = true;
      red.geometry.setDrawRange(0, tmp.hits * 3);
      red.geometry.computeBoundingSphere();
    }
    (box.material as LineBasicMaterial).color.set(tmp.hits ? '#ff3030' : '#3cff8a');
    debugContact.boxHits = tmp.hits;
    // the wheel rays: from the hub down to the road they hit
    const pos = rays.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < 4; i++) {
      const c = carContact.points[i];
      pos.setXYZ(i * 2, c.x, c.y + 1.2, c.z);
      pos.setXYZ(i * 2 + 1, c.x, c.y, c.z);
      dots[i].position.copy(c);
      (dots[i].material as MeshBasicMaterial).color.set(contactState.ok && carContact.hit[i] ? '#33e0ff' : '#ff3cf0');
    }
    pos.needsUpdate = true;
    void WHEELS;
  }, 1);

  return (
    <group ref={group}>
      <primitive object={box} />
      <primitive object={rays} />
      {dots.map((d, i) => (
        <primitive key={i} object={d} />
      ))}
      <primitive object={red} />
    </group>
  );
}

/** What the HUD found this frame (the text HUD prints it). */
export const debugContact = { boxHits: 0 };
