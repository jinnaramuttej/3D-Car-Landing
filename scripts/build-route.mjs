/**
 * Finds the drive through the city and writes it to src/lib/cityRoute.data.ts.
 *
 *   node scripts/build-route.mjs [city.glb] [preview.png]
 *
 * 1. rasterises every road surface of assets/city-full.glb top-down (0.5 m cells,
 *    keeping the highest road surface in each cell)
 * 2. treats steps of more than STEP metres between neighbouring cells as walls, so the
 *    search can't fall off a flyover onto the road underneath
 * 3. runs A* between the VIA points below, with a cost that keeps the path in the
 *    middle of its carriageway (distance transform of the road mask)
 * 4. resamples the path every 6 m, smooths it, and samples the road height under it
 *
 * The VIA points are rough picks from a top-down render; the search does the rest.
 * To change the drive, move or add VIA points and run this again. The debug view in
 * the page (/?debug, "route") draws the resulting curve and its waypoints.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

const SRC = process.argv[2] ?? path.join(process.cwd(), 'assets', 'city-full.glb');
const PREVIEW = process.argv[3];
const OUT = path.join(process.cwd(), 'src', 'lib', 'cityRoute.data.ts');

const CELL = 0.5;
const STEP = 0.6;

/** [x, z, expected road height] in city metres. Down the north-west diagonal, round the
 *  west side, east along the south ring, up the ramp, east on the flyover and out to the
 *  south (where the bridge starts). */
const VIA = [
  [-93.7, -87.7, 6],
  [-159.9, -47.5, 14],
  [-207.3, -4.9, 20],
  [-226.2, 32.9, 21],
  [-223.8, 89.7, 21],
  [-197.8, 141.8, 21],
  [-141.0, 174.9, 21],
  [-84.3, 184.3, 22],
  [-46.4, 196.2, 25],
  [0.9, 207.0, 29],
  [95.5, 212.7, 29],
  [213.8, 210.4, 29],
  [270.6, 224.5, 29],
  [299.0, 255.3, 29],
  [307.5, 293.1, 29],
];

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(SRC);

/* 1. raster ------------------------------------------------------------------ */
const tris = [];
/** Every road and pavement triangle (world), for exact heights by raycast. */
const drive = [];
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  // meshopt quantisation leaves a scale/offset on each node
  const m = node.getWorldMatrix();
  const world = (a) => {
    const [x, y, z] = a;
    a[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    a[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    a[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  };
  for (const p of mesh.listPrimitives()) {
    const kind = p.getMaterial()?.getName().split(':')[0];
    if (kind === 'road' || kind === 'ground') {
      const pos = p.getAttribute('POSITION');
      const idx = p.getIndices();
      const arr = new Float32Array(pos.getCount() * 3);
      const e = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, e);
        world(e);
        arr.set(e, i * 3);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(arr, 3));
      if (idx) g.setIndex(Array.from(idx.getArray()));
      drive.push(g);
    }
    if (kind !== 'road') continue;
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const v = [[], [], []];
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) world(pos.getElement(idx ? idx.getScalar(i + k) : i + k, v[k]));
      // flat-ish surfaces only (kerb faces and lamp posts are not road)
      const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
      const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
      const ny = uz * wx - ux * wz;
      const len = Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx) || 1;
      if (Math.abs(ny) / len < 0.85) continue;
      tris.push(v.map((a) => [...a]));
      for (const a of v) {
        minX = Math.min(minX, a[0]);
        maxX = Math.max(maxX, a[0]);
        minZ = Math.min(minZ, a[2]);
        maxZ = Math.max(maxZ, a[2]);
      }
    }
  }
}
minX -= 4;
minZ -= 4;
const W = Math.ceil((maxX + 4 - minX) / CELL);
const H = Math.ceil((maxZ + 4 - minZ) / CELL);
const height = new Float32Array(W * H).fill(NaN);
for (const t of tris) {
  const P = t.map((a) => [(a[0] - minX) / CELL, (a[2] - minZ) / CELL, a[1]]);
  const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
  const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
  const [A, B, C] = P;
  const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(d) < 1e-9) continue;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const l1 = ((B[1] - C[1]) * (x + 0.5 - C[0]) + (C[0] - B[0]) * (y + 0.5 - C[1])) / d;
      const l2 = ((C[1] - A[1]) * (x + 0.5 - C[0]) + (A[0] - C[0]) * (y + 0.5 - C[1])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const h = l1 * A[2] + l2 * B[2] + l3 * C[2];
      const k = y * W + x;
      if (!(height[k] >= h)) height[k] = h;
    }
  }
}

// close the hairline gaps between road meshes (two passes of a 3x3 fill)
for (let pass = 0; pass < 2; pass++) {
  const fill = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (!Number.isNaN(height[k])) continue;
      let n = 0;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const h = height[k + dy * W + dx];
          if (!Number.isNaN(h)) {
            n++;
            sum += h;
          }
        }
      if (n >= 4) fill.push([k, sum / n]);
    }
  for (const [k, h] of fill) height[k] = h;
}

/* 2. walls and distance to them ------------------------------------------------ */
const N8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];
const passable = (a, b) => !Number.isNaN(height[a]) && !Number.isNaN(height[b]) && Math.abs(height[a] - height[b]) < STEP;
// edge cells: road cells next to a non-road cell or a step
const dist = new Float32Array(W * H).fill(1e9);
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    if (Number.isNaN(height[k])) {
      dist[k] = 0;
      continue;
    }
    for (const [dx, dy] of N8) {
      if (!passable(k, (y + dy) * W + x + dx)) {
        dist[k] = 0.5;
        break;
      }
    }
  }
}
// two-pass chamfer distance (in cells)
for (let y = 1; y < H - 1; y++)
  for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    dist[k] = Math.min(dist[k], dist[k - 1] + 1, dist[k - W] + 1, dist[k - W - 1] + 1.414, dist[k - W + 1] + 1.414);
  }
for (let y = H - 2; y > 0; y--)
  for (let x = W - 2; x > 0; x--) {
    const k = y * W + x;
    dist[k] = Math.min(dist[k], dist[k + 1] + 1, dist[k + W] + 1, dist[k + W + 1] + 1.414, dist[k + W - 1] + 1.414);
  }

/* 3. A* between the via points ----------------------------------------------- */
const cellOf = (x, z) => [Math.round((x - minX) / CELL), Math.round((z - minZ) / CELL)];
/** Nearest road cell to (x, z) whose height is close to the expected one. */
function snap(x, z, h) {
  const [cx, cy] = cellOf(x, z);
  let best = -1;
  let bestScore = Infinity;
  for (let r = 0; r < 60; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let xx = cx - r; xx <= cx + r; xx++) {
        if (Math.max(Math.abs(y - cy), Math.abs(xx - cx)) !== r || xx < 0 || y < 0 || xx >= W || y >= H) continue;
        const k = y * W + xx;
        if (Number.isNaN(height[k]) || dist[k] < 2) continue;
        const score = r + Math.abs(height[k] - h) * 4 - dist[k] * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
    }
    if (best >= 0 && r > 12) break;
  }
  if (best < 0) throw new Error(`no road near via point ${x}, ${z}`);
  return best;
}

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = k[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

const CENTRE = 7; // cells (3.5 m): further from the edge than this costs nothing extra
function astar(from, to) {
  const g = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const heap = new Heap();
  const tx = to % W;
  const ty = Math.floor(to / W);
  g[from] = 0;
  heap.push(from, 0);
  while (heap.size) {
    const k = heap.pop();
    if (k === to) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const x = k % W;
    const y = Math.floor(k / W);
    for (const [dx, dy, step] of N8) {
      const n = (y + dy) * W + x + dx;
      if (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H || !passable(k, n)) continue;
      const edge = Math.max(0, CENTRE - dist[n]);
      const cost = g[k] + step * (1 + 0.6 * edge * edge);
      if (cost < g[n]) {
        g[n] = cost;
        came[n] = k;
        heap.push(n, cost + Math.hypot(x + dx - tx, y + dy - ty));
      }
    }
  }
  if (came[to] < 0) return null;
  const out = [];
  for (let k = to; k !== from; k = came[k]) out.push(k);
  out.push(from);
  return out.reverse();
}

const snapped = VIA.map(([x, z, h]) => snap(x, z, h));
let cells = [];
async function preview(file, path) {
  const img = Buffer.alloc(W * H * 3);
  for (let k = 0; k < W * H; k++) {
    if (Number.isNaN(height[k])) continue;
    const t = Math.max(0, Math.min(1, (height[k] + 4) / 36));
    const e = Math.min(1, dist[k] / CENTRE);
    img[k * 3] = 60 + 160 * t;
    img[k * 3 + 1] = 60 + 60 * e;
    img[k * 3 + 2] = 200 - 140 * t;
  }
  for (const k of path) img.set([255, 255, 255], k * 3);
  for (const k of snapped) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) img.set([255, 0, 0], (k + dy * W + dx) * 3);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
}
for (let i = 0; i < snapped.length - 1; i++) {
  const seg = astar(snapped[i], snapped[i + 1]);
  if (!seg) {
    console.error(`no path between via ${i} and ${i + 1}: ${VIA[i]} -> ${VIA[i + 1]}`);
    // show what is reachable from the first one
    const seen = new Uint8Array(W * H);
    const stack = [snapped[i]];
    seen[snapped[i]] = 1;
    const reach = [];
    while (stack.length) {
      const k = stack.pop();
      reach.push(k);
      const x = k % W;
      const y = Math.floor(k / W);
      for (const [dx, dy] of N8) {
        const n = (y + dy) * W + x + dx;
        if (seen[n] || !passable(k, n)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (PREVIEW) await preview(PREVIEW, reach);
    process.exit(1);
  }
  cells = cells.concat(i ? seg.slice(1) : seg);
}

/* 4. resample, smooth, heights ------------------------------------------------- */
let pts = cells.map((k) => [minX + (k % W) * CELL, minZ + Math.floor(k / W) * CELL]);
// moving average over ~10 m to iron out the cell staircase
const smooth = (arr, r) =>
  arr.map((_, i) => {
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) {
      sx += arr[j][0];
      sz += arr[j][1];
      n++;
    }
    return [sx / n, sz / n];
  });
pts = smooth(smooth(smooth(pts, 14), 14), 14);
// resample every SPACING metres along the path
const SPACING = 3;
const res = [pts[0]];
let acc = 0;
for (let i = 1; i < pts.length; i++) {
  const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  acc += d;
  if (acc >= SPACING) {
    res.push(pts[i]);
    acc = 0;
  }
}
if (acc > SPACING * 0.4) res.push(pts[pts.length - 1]);
else res[res.length - 1] = pts[pts.length - 1];

// road height under each point (nearest road cell), then smoothed along the path
const sampleH = (x, z, prev) => {
  const [cx, cy] = cellOf(x, z);
  let best = NaN;
  let bestScore = Infinity;
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      const k = (cy + dy) * W + cx + dx;
      if (Number.isNaN(height[k])) continue;
      const score = Math.hypot(dx, dy) + (prev === null ? 0 : Math.abs(height[k] - prev) * 3);
      if (score < bestScore) {
        bestScore = score;
        best = height[k];
      }
    }
  return best;
};
let prev = null;
const hs = res.map(([x, z]) => (prev = sampleH(x, z, prev)));
// exact heights: raycast the real road (and pavement) under each point, guided by the
// raster's estimate so a flyover above never wins
const driveRoot = new Group();
const driveMat = new MeshBasicMaterial({ side: DoubleSide });
for (const g of drive) driveRoot.add(new Mesh(g, driveMat));
driveRoot.updateMatrixWorld(true);
const ray = new Raycaster();
const DOWN = new Vector3(0, -1, 0);
const surfaceAt = (x, z, guess) => {
  ray.set(new Vector3(x, guess + 2.5, z), DOWN);
  ray.far = 6;
  const hit = ray.intersectObject(driveRoot, true)[0];
  return hit && Math.abs(hit.point.y - guess) < 3 ? hit.point.y : null;
};
const hsm = hs.map((h, i) => surfaceAt(res[i][0], res[i][1], h) ?? h);

// free road either side (for lamps and billboards): walk sideways to the first non-road cell
const sideRoom = (i) => {
  const a = res[Math.max(0, i - 1)];
  const b = res[Math.min(res.length - 1, i + 1)];
  const fx = b[0] - a[0];
  const fz = b[1] - a[1];
  const len = Math.hypot(fx, fz) || 1;
  // left of heading (x left, z forward): (fz, -fx) rotated: left = (cos h, -sin h) with h = atan2(fx, fz)
  const lx = fz / len;
  const lz = -fx / len;
  const out = [];
  for (const side of [1, -1]) {
    let d = 0;
    for (; d < 40; d += CELL) {
      const [cx, cy] = cellOf(res[i][0] + lx * side * d, res[i][1] + lz * side * d);
      const k = cy * W + cx;
      if (Number.isNaN(height[k]) || Math.abs(height[k] - hsm[i]) > 1.5) break;
    }
    out.push(+d.toFixed(1));
  }
  return out;
};

const points = res.map(([x, z], i) => [+x.toFixed(2), +hsm[i].toFixed(2), +z.toFixed(2)]);
const room = res.map((_, i) => sideRoom(i));
let length = 0;
for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);

// holes in the model's road under the route (the same curve the app builds): patched
const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)), false, 'centripetal', 0.5);
curve.arcLengthDivisions = 6000;
const curveLen = curve.getLength();
const patches = [];
for (let s = 0; s <= curveLen; s += 0.25) {
  const p = curve.getPointAt(s / curveLen);
  const ok = surfaceAt(p.x, p.z, p.y) !== null;
  const last = patches[patches.length - 1];
  if (ok) continue;
  if (last && s - last[1] <= 0.5) last[1] = +s.toFixed(2);
  else patches.push([+s.toFixed(2), +s.toFixed(2)]);
}
for (const p of patches) {
  p[0] = +(p[0] - 1.5).toFixed(2);
  p[1] = +(p[1] + 1.5).toFixed(2);
}

// open road ends at the edge of the model (sealed with barriers in the scene)
const ends = [];
{
  const margin = 6 / CELL;
  const seen = new Uint8Array(W * H);
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let k = 0; k < W * H; k++) {
    if (Number.isNaN(height[k])) continue;
    x0 = Math.min(x0, k % W);
    x1 = Math.max(x1, k % W);
    y0 = Math.min(y0, Math.floor(k / W));
    y1 = Math.max(y1, Math.floor(k / W));
  }
  const edge = (x, y) => x - x0 < margin || x1 - x < margin || y - y0 < margin || y1 - y < margin;
  for (let k = 0; k < W * H; k++) {
    if (seen[k] || Number.isNaN(height[k]) || !edge(k % W, Math.floor(k / W))) continue;
    // flood the edge cells of this road end
    const stack = [k];
    seen[k] = 1;
    const cellsIn = [];
    while (stack.length) {
      const c = stack.pop();
      cellsIn.push(c);
      const cx = c % W;
      const cy = Math.floor(c / W);
      for (const [dx, dy] of N8) {
        const n = (cy + dy) * W + cx + dx;
        if (cx + dx < 0 || cy + dy < 0 || cx + dx >= W || cy + dy >= H || seen[n] || Number.isNaN(height[n]) || !edge(cx + dx, cy + dy)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (cellsIn.length < 12) continue;
    let sx = 0, sy = 0, sh = 0, minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const c of cellsIn) {
      const cx = c % W, cy = Math.floor(c / W);
      sx += cx; sy += cy; sh += height[c];
      minx = Math.min(minx, cx); maxx = Math.max(maxx, cx); miny = Math.min(miny, cy); maxy = Math.max(maxy, cy);
    }
    const n = cellsIn.length;
    const cx = sx / n, cy = sy / n;
    // which edge: the barrier runs along it
    const dists = [cx - x0, x1 - cx, cy - y0, y1 - cy];
    const side = dists.indexOf(Math.min(...dists));
    const along = side < 2 ? (maxy - miny + 1) * CELL : (maxx - minx + 1) * CELL;
    ends.push([+(minX + cx * CELL).toFixed(1), +(sh / n).toFixed(2), +(minZ + cy * CELL).toFixed(1), side < 2 ? 0 : 1, +Math.min(40, along + 2).toFixed(1)]);
  }
}

const file = `/**
 * GENERATED by scripts/build-route.mjs from assets/city-full.glb. Do not edit by hand
 * unless you mean to: re-running the script overwrites this file.
 *
 * The drive through the city, city-local metres (x, y = road height, z), one point
 * every ~${SPACING} m along the middle of the carriageway, with the height of the real road
 * surface under it, and the free road either side of each point [left, right] in metres.
 */
export const ROUTE_LENGTH = ${length.toFixed(1)};

/** Route metres [from, to] where the model has a hole in the road under the route (patched in the scene). */
export const ROUTE_PATCHES: [number, number][] = ${JSON.stringify(patches)};

/** Open road ends at the edge of the model: [x, y, z, 0 = runs along z / 1 = along x, width]. */
export const ROAD_ENDS: [number, number, number, number, number][] = ${JSON.stringify(ends)};

export const ROUTE_POINTS: [number, number, number][] = ${JSON.stringify(points)};

export const ROUTE_ROOM: [number, number][] = ${JSON.stringify(room)};
`;
fs.writeFileSync(OUT, file);
console.log(`route: ${points.length} points, ${length.toFixed(0)} m, height ${Math.min(...hsm).toFixed(1)} .. ${Math.max(...hsm).toFixed(1)} m, ${patches.length} patches, ${ends.length} open road ends -> ${OUT}`);

if (PREVIEW) await preview(PREVIEW, cells);
