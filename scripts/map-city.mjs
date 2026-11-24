/**
 * SURVEY THE CITY'S ROADS
 * =======================
 *   node scripts/map-city.mjs [map.png]
 *
 * Reads the whole city (assets/city-full.glb, before the trim) and reports its road network:
 * how long the roads are (centre lines, from the road surfaces thinned to a line), the
 * junctions, the dead ends, the flyovers (road decks more than 4 m over what is under them)
 * and the underpasses and tunnels (road with another road or a roof 2.5-8 m over it). With a
 * file name it also draws a top-down map: road coloured by height, the centre lines, the
 * junctions (red; the count includes short spurs where lane markings thin to branches, so
 * read it from the map), flyover decks (orange), underpasses (blue), and the drive's route
 * (src/lib/cityRoute.data.ts, yellow).
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = path.join(process.cwd(), 'assets', 'city-full.glb');
const OUT = process.argv[2];
const CELL = 1;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(SRC);

/* triangles, world space, by kind -------------------------------------------- */
const road = [];
const other = [];
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const kind = p.getMaterial()?.getName().split(':')[0];
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const e = [];
    const w = (i) => {
      pos.getElement(idx ? idx.getScalar(i) : i, e);
      return [m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12], m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13], m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14]];
    };
    for (let i = 0; i < n; i += 3) {
      const t = [w(i), w(i + 1), w(i + 2)];
      for (const a of t) {
        minX = Math.min(minX, a[0]);
        maxX = Math.max(maxX, a[0]);
        minZ = Math.min(minZ, a[2]);
        maxZ = Math.max(maxZ, a[2]);
      }
      const [a, b, c] = t;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const ny = uz * vx - ux * vz;
      const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
      if (kind === 'road' && Math.abs(ny) / len > 0.85) road.push(t);
      else other.push(t);
    }
  }
}
const W = Math.ceil((maxX - minX) / CELL) + 1;
const H = Math.ceil((maxZ - minZ) / CELL) + 1;
const idxOf = (x, z) => Math.floor((z - minZ) / CELL) * W + Math.floor((x - minX) / CELL);

/** Calls fn(cellIndex, height) for every cell centre inside the triangle (top-down). */
function raster(t, fn) {
  const [a, b, c] = t;
  const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - minX) / CELL));
  const x1 = Math.min(W - 1, Math.floor((Math.max(a[0], b[0], c[0]) - minX) / CELL));
  const z0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - minZ) / CELL));
  const z1 = Math.min(H - 1, Math.floor((Math.max(a[2], b[2], c[2]) - minZ) / CELL));
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(d) < 1e-9) return;
  for (let j = z0; j <= z1; j++)
    for (let i = x0; i <= x1; i++) {
      const px = minX + (i + 0.5) * CELL;
      const pz = minZ + (j + 0.5) * CELL;
      const l1 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d;
      const l2 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
      fn(j * W + i, l1 * a[1] + l2 * b[1] + l3 * c[1]);
    }
}

/* road levels per cell ------------------------------------------------------- */
const top = new Float32Array(W * H).fill(NaN);
const low = new Float32Array(W * H).fill(NaN);
for (const t of road)
  raster(t, (k, y) => {
    if (!(top[k] >= y)) top[k] = y;
    if (!(low[k] <= y)) low[k] = y;
  });
const isRoad = (k) => !Number.isNaN(top[k]);
// what is under each road cell, and over its lower level
const under = new Float32Array(W * H).fill(NaN); // highest non-road surface below the top road level by > 1 m
const roof = new Float32Array(W * H).fill(NaN); // lowest non-road surface 2.5-8 m over the lower road level
for (const t of other)
  raster(t, (k, y) => {
    if (!isRoad(k)) return;
    if (y < top[k] - 1 && !(under[k] >= y)) under[k] = y;
    const h = y - low[k];
    if (h > 2.5 && h < 8 && !(roof[k] <= y)) roof[k] = y;
  });
const twoLevel = (k) => isRoad(k) && top[k] - low[k] > 2.5;
const flyCell = (k) => isRoad(k) && (twoLevel(k) || (!Number.isNaN(under[k]) && top[k] - under[k] > 4) || Number.isNaN(under[k]) === false && false);
const coveredCell = (k) => isRoad(k) && (twoLevel(k) || (!Number.isNaN(roof[k]) && roof[k] - low[k] < 8 && top[k] - low[k] < 1));

/* centre lines: close small gaps, thin --------------------------------------- */
let mask = new Uint8Array(W * H);
for (let k = 0; k < W * H; k++) mask[k] = isRoad(k) ? 1 : 0;
const morph = (src, grow) => {
  const out = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      let any = 0;
      let all = 1;
      for (const d of [0, 1, -1, W, -W]) {
        any |= src[k + d];
        all &= src[k + d];
      }
      out[k] = grow ? any : all;
    }
  return out;
};
// close gaps up to ~8 m (markings, medians): a dual carriageway reads as one road, as a
// driver would count it
const CLOSE = 4;
for (let i = 0; i < CLOSE; i++) mask = morph(mask, true);
for (let i = 0; i < CLOSE; i++) mask = morph(mask, false);
// Zhang-Suen thinning
const sk = mask.slice();
const nb = (k) => [sk[k - W], sk[k - W + 1], sk[k + 1], sk[k + W + 1], sk[k + W], sk[k + W - 1], sk[k - 1], sk[k - W - 1]];
for (let changed = true, pass = 0; changed && pass < 200; pass++) {
  changed = false;
  for (const step of [0, 1]) {
    const kill = [];
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        const k = j * W + i;
        if (!sk[k]) continue;
        const p = nb(k);
        const B = p.reduce((s, v) => s + v, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let q = 0; q < 8; q++) if (!p[q] && p[(q + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        kill.push(k);
      }
    for (const k of kill) sk[k] = 0;
    if (kill.length) changed = true;
  }
}
const OFF = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
const deg = (k) => OFF.reduce((s, d) => s + sk[k + d], 0);
// prune spurs shorter than SPUR metres (the corners of wide plazas thin to whiskers)
const SPUR = 25;
for (let round = 0; round < 4; round++) {
  for (let k = 0; k < W * H; k++) {
    if (!sk[k] || deg(k) !== 1) continue;
    const path = [k];
    let cur = k;
    let prev = -1;
    while (path.length * CELL < SPUR) {
      const next = OFF.map((d) => cur + d).filter((q) => sk[q] && q !== prev && !path.includes(q));
      if (next.length !== 1 || deg(next[0]) > 2) break;
      prev = cur;
      cur = next[0];
      path.push(cur);
    }
    if (path.length * CELL < SPUR) for (const q of path) sk[q] = 0;
  }
}
let length = 0;
for (let k = 0; k < W * H; k++) {
  if (!sk[k]) continue;
  // each link counted once (to the right and below)
  for (const [d, l] of [[1, 1], [W, 1], [W + 1, Math.SQRT2], [W - 1, Math.SQRT2]]) if (sk[k + d]) length += l * CELL;
}
// junctions: clusters of branch cells within 12 m; grade-separated crossings set apart
const branch = [];
for (let k = 0; k < W * H; k++) if (sk[k] && deg(k) >= 3) branch.push(k);
const ends = [];
for (let k = 0; k < W * H; k++) if (sk[k] && deg(k) === 1) ends.push(k);
const xy = (k) => [minX + ((k % W) + 0.5) * CELL, minZ + (Math.floor(k / W) + 0.5) * CELL];
const clusters = [];
for (const k of branch) {
  const [x, z] = xy(k);
  const c = clusters.find((q) => Math.hypot(q.x - x, q.z - z) < 22);
  if (c) c.cells.push(k);
  else clusters.push({ x, z, cells: [k] });
}
for (const c of clusters) {
  let stacked = 0;
  for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) if (twoLevel(idxOf(c.x + di, c.z + dj))) stacked++;
  c.crossing = stacked > 6;
}
// flyover decks and covered stretches as connected areas
const areas = (test, minArea) => {
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let k = 0; k < W * H; k++) {
    if (seen[k] || !test(k)) continue;
    const stack = [k];
    seen[k] = 1;
    let n = 0;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    while (stack.length) {
      const q = stack.pop();
      n++;
      const [x, z] = xy(q);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      for (const d of [1, -1, W, -W]) {
        const r = q + d;
        if (r >= 0 && r < W * H && !seen[r] && test(r)) {
          seen[r] = 1;
          stack.push(r);
        }
      }
    }
    if (n * CELL * CELL >= minArea) out.push({ area: n * CELL * CELL, x0, x1, z0, z1, long: Math.max(x1 - x0, z1 - z0) });
  }
  return out;
};
const decks = areas(flyCell, 150);
const covered = areas(coveredCell, 40);

/* the route --------------------------------------------------------------------- */
const data = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'cityRoute.data.ts'), 'utf8');
const pts = JSON.parse(data.match(/ROUTE_POINTS[^=]*= (\[\[.*?\]\]);/s)[1]);
let routeLen = 0;
for (let i = 1; i < pts.length; i++) routeLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);

let roadArea = 0;
for (let k = 0; k < W * H; k++) if (isRoad(k)) roadArea += CELL * CELL;
const out = {
  extent: `${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} m`,
  mapOrigin: [+minX.toFixed(2), +minZ.toFixed(2)],
  roadTriangles: road.length,
  roadArea: Math.round(roadArea),
  centreLines: Math.round(length),
  junctions: clusters.filter((c) => !c.crossing).length,
  gradeSeparatedCrossings: clusters.filter((c) => c.crossing).length,
  deadEnds: ends.length,
  flyoverDecks: decks.map((d) => `${d.long.toFixed(0)} m (${d.x0.toFixed(0)}..${d.x1.toFixed(0)}, ${d.z0.toFixed(0)}..${d.z1.toFixed(0)})`),
  underpassesAndTunnels: covered.map((d) => `${d.long.toFixed(0)} m (${d.x0.toFixed(0)}..${d.x1.toFixed(0)}, ${d.z0.toFixed(0)}..${d.z1.toFixed(0)})`),
  routeThroughCity: Math.round(routeLen),
};
console.log(JSON.stringify(out, null, 2));

/* the map ----------------------------------------------------------------------- */
if (OUT) {
  const S = 2; // pixels per cell
  const img = Buffer.alloc(W * S * H * S * 3);
  let yMin = Infinity, yMax = -Infinity;
  for (let k = 0; k < W * H; k++) if (isRoad(k)) { yMin = Math.min(yMin, top[k]); yMax = Math.max(yMax, top[k]); }
  const put = (i, j, r, g, b) => {
    if (i < 0 || j < 0 || i >= W * S || j >= H * S) return;
    const o = (j * W * S + i) * 3;
    img[o] = r; img[o + 1] = g; img[o + 2] = b;
  };
  const anyH = new Float32Array(W * H).fill(NaN);
  for (const t of other) raster(t, (k, y) => { if (!(anyH[k] >= y)) anyH[k] = y; });
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let c = [12, 12, 16];
      if (!Number.isNaN(anyH[k]) && !isRoad(k)) { const v = Math.min(70, 20 + (anyH[k] - yMin) * 0.6); c = [v, v, v + 6]; }
      if (isRoad(k)) { const u = (top[k] - yMin) / Math.max(1, yMax - yMin); c = [60 + 60 * u, 70 + 50 * u, 90 - 20 * u]; }
      if (flyCell(k)) c = [200, 110, 40];
      if (coveredCell(k)) c = [50, 110, 230];
      if (sk[k]) c = [235, 235, 235];
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) put(i * S + a, j * S + b, ...c);
    }
  const dot = (x, z, rad, col) => {
    const ci = ((x - minX) / CELL) * S;
    const cj = ((z - minZ) / CELL) * S;
    for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) if (a * a + b * b <= rad * rad) put(Math.round(ci + a), Math.round(cj + b), ...col);
  };
  for (const c of clusters) dot(c.x, c.z, 5, c.crossing ? [190, 90, 255] : [240, 40, 40]);
  // the route (city-local, like the model)
  for (let i = 1; i < pts.length; i++) {
    const [ax, , az] = pts[i - 1];
    const [bx, , bz] = pts[i];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
    for (let q = 0; q <= n; q++) dot(ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n, 2, [255, 214, 0]);
  }
  dot(pts[0][0], pts[0][2], 7, [60, 255, 120]);
  await sharp(img, { raw: { width: W * S, height: H * S, channels: 3 } }).png().toFile(OUT);
  console.log('map:', OUT, `${W * S} x ${H * S} px, 1 px = ${CELL / S} m, north (-z) up`);
}
