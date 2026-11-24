/**
 * Trims the city to what the journey can see.
 *
 *   node scripts/trim-city.mjs [full.glb] [out.glb]      (npm run city runs it last)
 *
 * Input: the full city as optimize-city.mjs builds it (default assets/city-full.glb).
 * Output: public/models/city.glb.
 *
 *   1. every connected piece of geometry (a building, a kerb, a lamp post: pieces are
 *      found by shared vertices inside each joined mesh) is kept whole if any of it is
 *      within KEEP metres of the route or the bridge, and dropped otherwise, so no building
 *      is ever cut in half
 *   2. the tallest dropped buildings, spread out round the city, come back as low-poly
 *      proxies (one box each, all in one mesh) with a "window:" material, so the scene
 *      lights them like the rest and the skyline stays full
 *   3. prune, compact, meshopt
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dequantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const SRC = process.argv[2] ?? path.join(process.cwd(), 'assets', 'city-full.glb');
const OUT = process.argv[3] ?? path.join(process.cwd(), 'public', 'models', 'city.glb');
/** Metres from the route (or the bridge) within which geometry is kept. */
const KEEP = Number(process.env.KEEP ?? 150);
/** Landmark proxies: how many, how tall at least, how far apart. */
const LANDMARKS = 10;
const MIN_HEIGHT = 35;
const SPACING = 55;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(SRC);
const root = doc.getRoot();
await doc.transform(dequantize());

/* ---------------------------------------------------- the route, as segments */

const data = fs.readFileSync('src/lib/cityRoute.data.ts', 'utf8');
const pts = JSON.parse(data.match(/ROUTE_POINTS[^=]*= (\[\[.*?\]\]);/s)[1]);
const segs = [];
for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i][0], pts[i][2], pts[i + 1][0], pts[i + 1][2]]);
// the bridge runs straight on from the last two points (cityRoute.ts): 800 m of it
{
  const a = pts[pts.length - 3];
  const b = pts[pts.length - 1];
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const l = Math.hypot(dx, dz);
  segs.push([b[0], b[2], b[0] + (dx / l) * 800, b[2] + (dz / l) * 800]);
}
function routeDist(x, z) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of segs) {
    const vx = x1 - x0;
    const vz = z1 - z0;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - (x0 + vx * t), z - (z0 + vz * t));
    if (d < best) best = d;
  }
  return best;
}
// a distance field on a 4 m grid (the per-vertex test reads it)
const CELL = 4;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
const worldPos = (node, prim) => {
  const m = node.getWorldMatrix();
  const pos = prim.getAttribute('POSITION');
  const n = pos.getCount();
  const out = new Float32Array(n * 3);
  const e = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, e);
    out[i * 3] = m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12];
    out[i * 3 + 1] = m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13];
    out[i * 3 + 2] = m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14];
  }
  return out;
};
const meshes = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const w = worldPos(node, prim);
    for (let i = 0; i < w.length; i += 3) {
      minX = Math.min(minX, w[i]);
      maxX = Math.max(maxX, w[i]);
      minZ = Math.min(minZ, w[i + 2]);
      maxZ = Math.max(maxZ, w[i + 2]);
    }
    meshes.push({ node, prim, w });
  }
}
const GW = Math.ceil((maxX - minX) / CELL) + 1;
const GH = Math.ceil((maxZ - minZ) / CELL) + 1;
const field = new Float32Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) field[j * GW + i] = routeDist(minX + i * CELL, minZ + j * CELL);
const near = (x, z) => {
  const i = Math.round((x - minX) / CELL);
  const j = Math.round((z - minZ) / CELL);
  return field[Math.max(0, Math.min(GH - 1, j)) * GW + Math.max(0, Math.min(GW - 1, i))] <= KEEP;
};

/* ------------------------------------------- keep or drop each connected piece */

let trisBefore = 0;
let trisAfter = 0;
const dropped = []; // { minX, maxX, minY, maxY, minZ, maxZ, tris }
for (const { prim, w } of meshes) {
  const idx = prim.getIndices();
  const n = w.length / 3;
  const ia = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
  trisBefore += ia.length / 3;
  // union-find over vertices (pieces share vertices after the weld in optimize-city)
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < ia.length; t += 3) {
    const a = find(ia[t]);
    const b = find(ia[t + 1]);
    const c = find(ia[t + 2]);
    parent[b] = a;
    parent[c] = a;
  }
  const keepPiece = new Map();
  const box = new Map();
  for (let v = 0; v < n; v++) {
    const r = find(v);
    const x = w[v * 3];
    const y = w[v * 3 + 1];
    const z = w[v * 3 + 2];
    if (!keepPiece.get(r) && near(x, z)) keepPiece.set(r, true);
    let b = box.get(r);
    if (!b) box.set(r, (b = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z, tris: 0 }));
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  const kept = [];
  for (let t = 0; t < ia.length; t += 3) {
    const r = find(ia[t]);
    if (keepPiece.get(r)) kept.push(ia[t], ia[t + 1], ia[t + 2]);
    else box.get(r).tris++;
  }
  for (const [r, b] of box) if (!keepPiece.get(r) && b.tris) dropped.push(b);
  trisAfter += kept.length / 3;
  if (!kept.length) {
    prim.dispose();
    continue;
  }
  const out = doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? Uint32Array.from(kept) : Uint16Array.from(kept));
  prim.setIndices(out);
  compactPrimitive(prim);
}
// meshes left without primitives, and their nodes
for (const mesh of root.listMeshes()) if (!mesh.listPrimitives().length) mesh.dispose();

/* ----------------------------------------------------------- landmark proxies */

// merge dropped pieces that overlap into buildings (a tower is several pieces)
const towers = [];
for (const b of dropped.sort((a, c) => c.maxY - a.maxY)) {
  const t = towers.find((o) => b.minX < o.maxX + 2 && b.maxX > o.minX - 2 && b.minZ < o.maxZ + 2 && b.maxZ > o.minZ - 2);
  if (t) {
    t.minX = Math.min(t.minX, b.minX);
    t.maxX = Math.max(t.maxX, b.maxX);
    t.minZ = Math.min(t.minZ, b.minZ);
    t.maxZ = Math.max(t.maxZ, b.maxZ);
    t.minY = Math.min(t.minY, b.minY);
    t.maxY = Math.max(t.maxY, b.maxY);
  } else towers.push({ ...b });
}
const picks = [];
for (const t of towers.sort((a, b) => b.maxY - a.maxY)) {
  const w = t.maxX - t.minX;
  const d = t.maxZ - t.minZ;
  if (t.maxY - t.minY < MIN_HEIGHT || w < 8 || d < 8 || w > 90 || d > 90) continue;
  const cx = (t.minX + t.maxX) / 2;
  const cz = (t.minZ + t.maxZ) / 2;
  if (picks.some((p) => Math.hypot(p.cx - cx, p.cz - cz) < SPACING)) continue;
  picks.push({ ...t, cx, cz });
  if (picks.length >= LANDMARKS) break;
}
if (picks.length) {
  const pos = [];
  const nor = [];
  const ind = [];
  for (const p of picks) {
    // a box a little inside the tower's footprint, ground to roof
    const x0 = p.minX + 1;
    const x1 = p.maxX - 1;
    const z0 = p.minZ + 1;
    const z1 = p.maxZ - 1;
    const y0 = p.minY;
    const y1 = p.maxY;
    const faces = [
      [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]],
      [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
    ];
    for (const [a, b, c, d, n] of faces) {
      const base = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) nor.push(...n);
      ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const buf = root.listBuffers()[0];
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(ind)).setBuffer(buf))
    .setMaterial(doc.createMaterial('window:landmark').setBaseColorFactor([0.16, 0.17, 0.2, 1]).setRoughnessFactor(0.85).setMetallicFactor(0));
  const node = doc.createNode('landmarks').setMesh(doc.createMesh('landmarks').addPrimitive(prim));
  root.listScenes()[0].addChild(node);
}

await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);

const prims = root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
console.log(`trim-city: kept within ${KEEP} m of the route and the bridge`);
console.log(`  triangles ${Math.round(trisBefore)} -> ${Math.round(trisAfter + picks.length * 10)} (${picks.length} landmark proxies)`);
console.log(`  draw calls (primitives) ${meshes.length} -> ${prims}`);
console.log(`  file ${mb(fs.statSync(SRC).size)} -> ${mb(fs.statSync(OUT).size)}  ${OUT}`);
