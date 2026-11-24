import { type BufferGeometry, Matrix4, type Mesh, Sphere, Vector3 } from 'three';
import { computeBoundsTree, type ExtendedTriangle, type MeshBVH, OrientedBox } from 'three-mesh-bvh';

/**
 * COLLISION QUERIES against the city (three-mesh-bvh): every city mesh gets a bounds tree
 * when the model loads (City.tsx), so the camera's collision sphere and the debug HUD's
 * "what is inside the car's box" are cheap enough to ask every frame.
 */

type Entry = { mesh: Mesh; bvh: MeshBVH; inv: Matrix4; scale: number; road: boolean; card: boolean };
const entries: Entry[] = [];

/**
 * All city meshes, which of them are road (the wheels may touch those), and which are
 * see-through cards (foliage, palms, cut-out plants: the camera may pass through those).
 */
export function setCityMeshes(list: { mesh: Mesh; road: boolean; card?: boolean }[]) {
  entries.length = 0;
  for (const { mesh, road, card = false } of list) {
    const g = mesh.geometry as BufferGeometry & { boundsTree?: MeshBVH };
    if (!g.boundsTree) g.boundsTree = computeBoundsTree.call(g) ?? g.boundsTree;
    if (!g.boundsTree) continue;
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    const scale = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
    entries.push({ mesh, bvh: g.boundsTree, inv: mesh.matrixWorld.clone().invert(), scale, road, card });
  }
}
export const hasCity = () => entries.length > 0;

const _sphere = new Sphere();
const _c = new Vector3();

/** Does a sphere (world) touch any solid city geometry (not the road surface, not a see-through card)? */
export function sphereHitsCity(centre: Vector3, radius: number) {
  for (const e of entries) {
    if (e.road || e.card) continue;
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
/** How far ahead along its own path the camera's sphere is swept (seconds). */
const LOOKAHEAD = 0.5;
/** The pull's spring (seconds to settle). */
const PULL_TIME = 0.22;
/** The pull never brings the camera closer than this to what it looks at (into the car). */
const MIN_DISTANCE = 2.6;
/**
 * `hit`: the shot's own position is in something this frame; `need`: metres it must be drawn in
 * (now or on its way); `pulled`: metres it is (sprung).
 */
export const cameraCollision = { hit: false, pulled: 0, need: 0, vel: 0 };
const _prev = new Vector3();
const _ahead = new Vector3();
let hasPrev = false;

/** Metres a camera at `pos` must move toward `look` to be clear: the nearest clear point (a march, then a few halvings). */
function needAt(pos: Vector3, look: Vector3, len: number) {
  if (!sphereHitsCity(pos, CAMERA_RADIUS)) return 0;
  let lo = 0;
  let hi = -1;
  for (let f = 0.04; f <= 0.9; f += 0.04) {
    _v.copy(pos).lerp(look, f);
    if (!sphereHitsCity(_v, CAMERA_RADIUS)) {
      hi = f;
      break;
    }
    lo = f;
  }
  if (hi < 0) return 0.9 * len;
  for (let i = 0; i < 5; i++) {
    const mid = (lo + hi) / 2;
    _v.copy(pos).lerp(look, mid);
    if (sphereHitsCity(_v, CAMERA_RADIUS)) lo = mid;
    else hi = mid;
  }
  return hi * len;
}

/**
 * Moves `pos` along the line to `look` so a CAMERA_RADIUS sphere there stays clear of the
 * city. The sphere is swept along the camera's own path LOOKAHEAD seconds ahead, and the pull
 * follows on a critically damped spring: it starts before the lens reaches a wall and is
 * never a jump (a pull applied the frame contact began shoved the camera 1.2 m in one
 * frame as the opening shot backed toward the wall behind the parked car).
 */
export function clearCamera(pos: Vector3, look: Vector3, dt: number) {
  const col = cameraCollision;
  const len = pos.distanceTo(look);
  if (!entries.length || len < 1e-3) {
    col.hit = false;
    return pos;
  }
  const now = needAt(pos, look, len);
  col.hit = now > 0;
  let need = now;
  if (hasPrev && dt > 1e-4) {
    _ahead.copy(pos).addScaledVector(_c.subVectors(pos, _prev), LOOKAHEAD / dt);
    // (a cut-sized move is a new shot being placed, not motion: don't sweep across it)
    if (_c.length() < 3) need = Math.max(need, needAt(_ahead, look, _ahead.distanceTo(look)));
  }
  _prev.copy(pos);
  hasPrev = true;
  col.need = need;
  // critically damped spring toward the need (continuous position and speed)
  const w = 2 / PULL_TIME;
  const x = col.pulled - need;
  const e = Math.exp(-w * Math.max(dt, 0));
  const tmp = (col.vel + w * x) * Math.max(dt, 0);
  col.vel = (col.vel - w * tmp) * e;
  col.pulled = Math.max(0, need + (x + tmp) * e);
  const most = Math.max(0, len - MIN_DISTANCE);
  if (col.pulled > 1e-3 && most > 0) pos.lerp(look, Math.min(col.pulled, most) / len);
  return pos;
}
