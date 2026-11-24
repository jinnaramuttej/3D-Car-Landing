import { type BufferGeometry, Matrix4, type Mesh, Sphere, Vector3 } from 'three';
import { computeBoundsTree, type ExtendedTriangle, type MeshBVH, OrientedBox } from 'three-mesh-bvh';

/**
 * COLLISION QUERIES against the city (three-mesh-bvh): every city mesh gets a bounds tree
 * when the model loads (City.tsx), so the camera's collision sphere and the debug HUD's
 * "what is inside the car's box" are cheap enough to ask every frame.
 */

type Entry = { mesh: Mesh; bvh: MeshBVH; inv: Matrix4; scale: number; road: boolean };
const entries: Entry[] = [];

/** All city meshes, and which of them are road (the wheels may touch those). */
export function setCityMeshes(list: { mesh: Mesh; road: boolean }[]) {
  entries.length = 0;
  for (const { mesh, road } of list) {
    const g = mesh.geometry as BufferGeometry & { boundsTree?: MeshBVH };
    if (!g.boundsTree) g.boundsTree = computeBoundsTree.call(g) ?? g.boundsTree;
    if (!g.boundsTree) continue;
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    const scale = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
    entries.push({ mesh, bvh: g.boundsTree, inv: mesh.matrixWorld.clone().invert(), scale, road });
  }
}
export const hasCity = () => entries.length > 0;

const _sphere = new Sphere();
const _c = new Vector3();

/** Does a sphere (world) touch any city geometry other than the road surface? */
export function sphereHitsCity(centre: Vector3, radius: number) {
  for (const e of entries) {
    if (e.road) continue;
    _sphere.center.copy(centre).applyMatrix4(e.inv);
    _sphere.radius = radius / e.scale;
    if (e.bvh.intersectsSphere(_sphere)) return true;
  }
  return false;
}

const _obb = new OrientedBox(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
const _toLocal = new Matrix4();
const _v = new Vector3();

/**
 * Triangles of non-road city geometry inside a box (world matrix of a unit cube centred on
 * the origin), written as world-space triangle corners into `out` (x, y, z, ...). Returns
 * the count. For the HUD: slow-ish, debug only.
 */
export function boxTriangles(boxWorld: Matrix4, out: number[], max = 600) {
  out.length = 0;
  let n = 0;
  for (const e of entries) {
    if (e.road || n >= max) continue;
    // the box in the mesh's space
    _toLocal.multiplyMatrices(e.inv, boxWorld);
    _obb.min.set(-0.5, -0.5, -0.5);
    _obb.max.set(0.5, 0.5, 0.5);
    _obb.matrix.copy(_toLocal);
    _obb.needsUpdate = true;
    e.bvh.shapecast({
      intersectsBounds: (box) => _obb.intersectsBox(box),
      intersectsTriangle: (tri: ExtendedTriangle) => {
        if (!_obb.intersectsTriangle(tri)) return false;
        for (const p of [tri.a, tri.b, tri.c]) {
          _v.copy(p).applyMatrix4(e.mesh.matrixWorld);
          out.push(_v.x, _v.y, _v.z);
        }
        return ++n >= max;
      },
    });
  }
  return n;
}

/** The camera's collision sphere: pulled toward what it looks at until it is clear. */
export const CAMERA_RADIUS = 0.35;
export const cameraCollision = { hit: false, pulled: 0 };

/** Moves `pos` along the line to `look` until a CAMERA_RADIUS sphere there is clear of the city. */
export function clearCamera(pos: Vector3, look: Vector3) {
  cameraCollision.hit = false;
  cameraCollision.pulled = 0;
  if (!entries.length || !sphereHitsCity(pos, CAMERA_RADIUS)) return pos;
  cameraCollision.hit = true;
  // the furthest clear point toward the look (bisection over the segment)
  let lo = 0;
  let hi = 1;
  _c.copy(pos);
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    _v.copy(_c).lerp(look, mid);
    if (sphereHitsCity(_v, CAMERA_RADIUS)) lo = mid;
    else hi = mid;
  }
  cameraCollision.pulled = hi * _c.distanceTo(look);
  return pos.copy(_c).lerp(look, Math.min(0.9, hi));
}
