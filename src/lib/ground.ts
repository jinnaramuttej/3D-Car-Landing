import { type BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree, type MeshBVH } from 'three-mesh-bvh';
import { deckExtraGeometry } from './bridgePath';

/**
 * GROUND CONTACT
 * ==============
 * The car stands on the road it is over, not on the smoothed route line: each frame a ray
 * goes down from each wheel onto the road surfaces only (the city's road and ground
 * materials, the bridge deck and the ramp and the patches that fill the model's holes: never
 * kerbs, barriers or walls), and the car's height, pitch and roll are fitted to the four
 * contact points. The wheels take up the twist the plane can't (each within TRAVEL); the
 * body rides on top through a spring-damper (src/lib/feel.ts).
 *
 * The same code runs in the browser (City.tsx registers the city's road meshes) and in the
 * build's contact test (scripts/check-contact.ts loads them from the GLB).
 */

/** Wheel contact patches in the car's frame (x left, z forward), metres, from the model's hubs. */
export const WHEELS = [
  { id: 'LF', x: 0.841, z: 1.301 },
  { id: 'RF', x: -0.841, z: 1.301 },
  { id: 'LR', x: 0.83, z: -1.215 },
  { id: 'RR', x: -0.83, z: -1.215 },
] as const;
/** Wheel travel either way (m): the twist of the road a wheel can follow on its own. */
export const TRAVEL = 0.08;

const WHEELBASE = WHEELS[0].z - WHEELS[2].z;
const ZC = (WHEELS[0].z + WHEELS[2].z) / 2;
const TRACK = (WHEELS[0].x - WHEELS[1].x + WHEELS[2].x - WHEELS[3].x) / 2;

(Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

const roads: Mesh[] = [];
let deck: Mesh[] | null = null;

const withBvh = (m: Mesh) => {
  const g = m.geometry as BufferGeometry & { boundsTree?: MeshBVH };
  if (!g.boundsTree) g.boundsTree = computeBoundsTree.call(g) ?? g.boundsTree;
  m.updateWorldMatrix(true, false);
  return m;
};

/** The city's road surfaces (world-placed meshes). Replaces what was registered before. */
export function setRoadMeshes(list: Mesh[]) {
  roads.length = 0;
  for (const m of list) roads.push(withBvh(m));
}

/** The bridge deck, the ramp and the patches (built here from bridgePath, the same as the scene's). */
function deckMeshes() {
  if (!deck) {
    const mat = new MeshBasicMaterial();
    deck = deckExtraGeometry().map((g) => withBvh(new Mesh(g, mat)));
  }
  return deck;
}

/** Every surface the car may stand on. */
export const roadSurfaces = () => [...roads, ...deckMeshes()];
export const hasRoad = () => roads.length > 0;

const ray = new Raycaster();
const down = new Vector3(0, -1, 0);
const _o = new Vector3();
(ray as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
const hits: { point: Vector3; distance: number }[] = [];

/**
 * Road height under (x, z), looking from yHint + 1.5 m down to 4 m; null if there is no road.
 * A hairline crack between two of the model's road tiles (a centimetre or two) doesn't count
 * as no road: a miss is tried again a few centimetres to each side.
 */
export function roadHeight(x: number, z: number, yHint: number) {
  const y = roadHeightAt(x, z, yHint);
  if (y !== null) return y;
  for (const [dx, dz] of CRACK) {
    const v = roadHeightAt(x + dx, z + dz, yHint);
    if (v !== null) return v;
  }
  return null;
}
const CRACK = [
  [0.05, 0],
  [-0.05, 0],
  [0, 0.05],
  [0, -0.05],
];

function roadHeightAt(x: number, z: number, yHint: number) {
  _o.set(x, yHint + 1.5, z);
  ray.set(_o, down);
  ray.near = 0;
  ray.far = 4;
  let best: number | null = null;
  let bestD = Infinity;
  for (const m of roads) {
    hits.length = 0;
    m.raycast(ray, hits as never);
    for (const h of hits)
      if (h.distance < bestD) {
        bestD = h.distance;
        best = h.point.y;
      }
  }
  for (const m of deckMeshes()) {
    hits.length = 0;
    m.raycast(ray, hits as never);
    for (const h of hits)
      if (h.distance < bestD) {
        bestD = h.distance;
        best = h.point.y;
      }
  }
  return best;
}

/** The car's pose fitted to its four contacts. */
export type Contact = {
  /** Road height under the car's origin (m), its pitch (+ nose up) and roll (+ left side up), rad. */
  y: number;
  pitch: number;
  roll: number;
  /** Per wheel (WHEELS order): the road height, and how far the road is off the fitted plane. */
  heights: [number, number, number, number];
  residual: [number, number, number, number];
  /** Per wheel: did its ray find road? World xz of the contact. */
  hit: [boolean, boolean, boolean, boolean];
  points: [Vector3, Vector3, Vector3, Vector3];
};

export const makeContact = (): Contact => ({
  y: 0,
  pitch: 0,
  roll: 0,
  heights: [0, 0, 0, 0],
  residual: [0, 0, 0, 0],
  hit: [false, false, false, false],
  points: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
});

/**
 * Fits the car at (x, z) facing `heading` (forward = (sin h, 0, cos h), left = (cos h, 0,
 * -sin h)) to the road under its wheels. A wheel with no road under it takes the height the
 * others give it (and `hit` says so). Returns false if no wheel found road.
 */
export function fitContacts(x: number, z: number, heading: number, yHint: number, out: Contact) {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  let found = 0;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const w = WHEELS[i];
    const wx = x + c * w.x + s * w.z;
    const wz = z - s * w.x + c * w.z;
    const h = roadHeight(wx, wz, yHint);
    out.hit[i] = h !== null;
    out.heights[i] = h ?? Number.NaN;
    out.points[i].set(wx, h ?? yHint, wz);
    if (h !== null) {
      found++;
      sum += h;
    }
  }
  if (!found) return false;
  const mean = sum / found;
  for (let i = 0; i < 4; i++) if (!out.hit[i]) out.heights[i] = mean;
  const [fl, fr, rl, rr] = out.heights;
  const slopeZ = ((fl + fr) / 2 - (rl + rr) / 2) / WHEELBASE;
  const slopeX = ((fl + rl) / 2 - (fr + rr) / 2) / TRACK;
  const centre = (fl + fr + rl + rr) / 4;
  out.y = centre - slopeZ * ZC;
  out.pitch = Math.atan(slopeZ);
  out.roll = Math.atan(slopeX);
  // the twist the plane can't take: + on one diagonal, - on the other
  const e = (fl + rr - fr - rl) / 4;
  out.residual[0] = e;
  out.residual[1] = -e;
  out.residual[2] = -e;
  out.residual[3] = e;
  for (let i = 0; i < 4; i++) out.points[i].y = out.heights[i];
  return true;
}
