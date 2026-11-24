/**
 * The car's corridor: the space the car sweeps along the journey (its box at every pose the
 * scene drives it through, slides included, widened to CORRIDOR.width and from
 * CORRIDOR.from to CORRIDOR.to above the road), and the city geometry inside it. Shared by
 * clear-corridor (the asset pipeline: removes what is in the way) and check-corridor (the
 * build: fails if anything still is).
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { computeBoundsTree, type ExtendedTriangle, type MeshBVH, OrientedBox } from 'three-mesh-bvh';
import { carContact, contactState, stepCityDrive } from '../../src/lib/cityDrive';
import { fitContacts, makeContact, setRoadMeshes } from '../../src/lib/ground';
import { getRoute, sampleRoute } from '../../src/lib/cityRoute';
import { carState } from '../../src/lib/motion';
import { journeySeconds, PARK_S, progressAtTime, sAtTime, speedAtS, timeAtS } from '../../src/lib/pacing';
import type { CityMesh } from './world';

/** Width (the car is 1.96 m), length (4.64 m), and the band above the road it must have free. */
export const CORRIDOR = { width: 2.6, length: 4.9, from: 0.2, to: 2.8 };

export type Pose = { s: number; box: Matrix4; pos: Vector3; heading: number; onRoad: boolean };

/** The car's pose every `step` metres of the journey, as the scene drives it (stepCityDrive). */
export function journeyPoses(city: CityMesh[], step = 0.5): Pose[] {
  setRoadMeshes(city.filter((c) => c.road).map((c) => c.mesh));
  const end = sAtTime(journeySeconds());
  const out: Pose[] = [];
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YXZ');
  carState.initialized = false;
  for (let s = PARK_S; s <= end; s += step) {
    stepCityDrive(progressAtTime(timeAtS(s)), s === PARK_S ? 0 : step / Math.max(1.5, speedAtS(s)));
    const st = carState;
    e.set(-st.pitch, st.heading, st.groundRoll, 'YXZ');
    q.setFromEuler(e);
    const c = new Vector3(0, (CORRIDOR.from + CORRIDOR.to) / 2, 0).applyQuaternion(q).add(st.position);
    const box = new Matrix4().compose(c, q, new Vector3(CORRIDOR.width, CORRIDOR.to - CORRIDOR.from, CORRIDOR.length));
    out.push({ s: +s.toFixed(1), box, pos: st.position.clone(), heading: st.heading, onRoad: contactState.ok && carContact.hit.every(Boolean) });
  }
  return out;
}

type Bvh = { bvh: MeshBVH; inv: Matrix4 };
const bvhs = new WeakMap<CityMesh, Bvh>();
function bvhOf(c: CityMesh): Bvh {
  let b = bvhs.get(c);
  if (!b) {
    const g = c.mesh.geometry as typeof c.mesh.geometry & { boundsTree?: MeshBVH };
    g.boundsTree ??= computeBoundsTree.call(g)!;
    bvhs.set(c, (b = { bvh: g.boundsTree!, inv: c.mesh.matrixWorld.clone().invert() }));
  }
  return b;
}

export type Hit = { mesh: number; tri: number; s: number };

/** Every non-road triangle inside the corridor: which mesh, which triangle, the first metre it is met. */
export function sweep(city: CityMesh[], poses: Pose[]): Hit[] {
  const obb = new OrientedBox(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  const toLocal = new Matrix4();
  const seen = new Set<string>();
  const hits: Hit[] = [];
  // a coarse prefilter: the corridor's reach round each pose
  const reach = Math.hypot(CORRIDOR.width, CORRIDOR.length, CORRIDOR.to) / 2 + 0.5;
  city.forEach((c, mi) => {
    if (c.road) return;
    c.mesh.geometry.computeBoundingBox();
    const bb = c.mesh.geometry.boundingBox!.clone().applyMatrix4(c.mesh.matrixWorld).expandByScalar(reach);
    const near = poses.filter((p) => bb.containsPoint(p.pos));
    if (!near.length) return;
    const { bvh, inv } = bvhOf(c);
    for (const p of near) {
      toLocal.multiplyMatrices(inv, p.box);
      obb.min.set(-0.5, -0.5, -0.5);
      obb.max.set(0.5, 0.5, 0.5);
      obb.matrix.copy(toLocal);
      obb.needsUpdate = true;
      bvh.shapecast({
        intersectsBounds: (box) => obb.intersectsBox(box),
        intersectsTriangle: (tri: ExtendedTriangle, i: number) => {
          if (!obb.intersectsTriangle(tri)) return false;
          const k = `${mi}:${i}`;
          if (!seen.has(k)) {
            seen.add(k);
            hits.push({ mesh: mi, tri: i, s: p.s });
          }
          return false;
        },
      });
    }
  });
  return hits;
}

/** Triangle -> piece: triangles joined by shared corners (welded by position to 2 cm, the model's quads don't share vertices). */
export function pieces(c: CityMesh) {
  const g = c.mesh.geometry;
  const idx = g.index!.array;
  const pos = g.getAttribute('position');
  const n = pos.count;
  const weld = new Map<string, number>();
  const vid = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(pos.getX(v) * 50)},${Math.round(pos.getY(v) * 50)},${Math.round(pos.getZ(v) * 50)}`;
    let id = weld.get(k);
    if (id === undefined) weld.set(k, (id = weld.size));
    vid[v] = id;
  }
  const parent = new Int32Array(weld.size).map((_, i) => i);
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(vid[idx[t]]);
    parent[find(vid[idx[t + 1]])] = a;
    parent[find(vid[idx[t + 2]])] = a;
  }
  const triPiece = new Int32Array(idx.length / 3);
  for (let t = 0; t < triPiece.length; t++) triPiece[t] = find(vid[idx[t * 3]]);
  return triPiece;
}

/** The car's pose on the route line itself, no slide (the corridor every journey needs). */
export function routePoses(city: CityMesh[], step = 0.5): Pose[] {
  setRoadMeshes(city.filter((c) => c.road).map((c) => c.mesh));
  const end = sAtTime(journeySeconds());
  const out: Pose[] = [];
  const p = new Vector3();
  const t = new Vector3();
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YXZ');
  const fit = makeContact();
  for (let s = PARK_S; s <= end; s += step) {
    sampleRoute(s, p);
    getRoute().curve.getTangentAt(Math.min(1, s / getRoute().length), t);
    const heading = Math.atan2(t.x, t.z);
    const ok = fitContacts(p.x, p.z, heading, p.y, fit);
    e.set(ok ? -fit.pitch : 0, heading, ok ? fit.roll : 0, 'YXZ');
    q.setFromEuler(e);
    const pos = new Vector3(p.x, ok ? fit.y : p.y, p.z);
    const c = new Vector3(0, (CORRIDOR.from + CORRIDOR.to) / 2, 0).applyQuaternion(q).add(pos);
    const box = new Matrix4().compose(c, q, new Vector3(CORRIDOR.width, CORRIDOR.to - CORRIDOR.from, CORRIDOR.length));
    out.push({ s: +s.toFixed(1), box, pos, heading, onRoad: ok && fit.hit.every(Boolean) });
  }
  return out;
}

/**
 * The corridor's sides, metre by metre along the route: how far left (+) and right (-) of
 * the route line any of the boxes reaches (the slides swing it wide).
 */
export function corridorEnvelope(poses: Pose[]) {
  const env = new Map<number, [number, number]>();
  const p = new Vector3();
  const c = new Vector3();
  const corners = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((z) => new Vector3(x, -0.5, z)));
  for (const pose of poses) {
    const h = sampleRoute(pose.s, p);
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    for (const k of corners) {
      c.copy(k).applyMatrix4(pose.box).sub(p);
      const lat = c.x * fz - c.z * fx;
      const at = Math.round(pose.s + c.x * fx + c.z * fz);
      const e = env.get(at);
      if (!e) env.set(at, [lat, lat]);
      else {
        e[0] = Math.min(e[0], lat);
        e[1] = Math.max(e[1], lat);
      }
    }
  }
  return env;
}

/** Each vertex's welded id (vertices at the same spot, to 2 cm, share one). */
export function weldIds(c: CityMesh) {
  const pos = c.mesh.geometry.getAttribute('position');
  const weld = new Map<string, number>();
  const vid = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const k = `${Math.round(pos.getX(v) * 50)},${Math.round(pos.getY(v) * 50)},${Math.round(pos.getZ(v) * 50)}`;
    let id = weld.get(k);
    if (id === undefined) weld.set(k, (id = weld.size));
    vid[v] = id;
  }
  return vid;
}
