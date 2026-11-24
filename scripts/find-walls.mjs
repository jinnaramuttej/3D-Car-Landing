/**
 * Lists the walls along the city route that a stop's billboard can hang on.
 *
 *   node scripts/find-walls.mjs            (FAR=55 SMALL=1 for a longer reach / smaller boards)
 *
 * For each stop in src/lib/cityRoute.ts it raycasts sideways from the route at its
 * metre, then scans the whole route every 4 m on both sides for a flat, road-facing wall
 * about 16 x 9 m (five probes that agree within 2.5 m), and prints the best candidates
 * near each stop and every wall it found ("s:distance" per side, 1 = left of the road).
 */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('public/models/city.glb');
const root = new THREE.Group();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); const idx = p.getIndices();
    const arr = new Float32Array(pos.getCount() * 3); const e = [];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, e); arr.set(e, i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (idx) g.setIndex(Array.from(idx.getArray()));
    const me = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); me.applyMatrix4(m); me.name = p.getMaterial()?.getName() ?? '';
    root.add(me);
  }
}
root.updateMatrixWorld(true);
const src = fs.readFileSync('src/lib/cityRoute.data.ts', 'utf8');
const pts = JSON.parse(src.match(/ROUTE_POINTS[^=]*= (\[\[.*?\]\]);/s)[1]);
const room = JSON.parse(src.match(/ROUTE_ROOM[^=]*= (\[\[.*?\]\]);/s)[1]);
const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'centripetal');
const L = curve.getLength();
const routeSrc = fs.readFileSync('src/lib/cityRoute.ts', 'utf8');
const stops = Object.fromEntries([...routeSrc.matchAll(/^\s+(\w+): \{ s: (\d+), side: (-?1)/gm)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
const ray = new THREE.Raycaster();
for (const [id, [s, side]] of Object.entries(stops)) {
  const u = s / L; const o = curve.getPointAt(u); const t = curve.getTangentAt(u);
  const h = Math.atan2(t.x, t.z); const l = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
  const i = Math.min(room.length - 1, Math.round(u * (pts.length - 1)));
  const rm = room[i][side === 1 ? 0 : 1];
  const out = [];
  for (const sd of [side, -side]) {
    const d = l.clone().multiplyScalar(sd);
    ray.set(o.clone().setY(o.y + 11), d); ray.near = 0; ray.far = 60;
    const hits = ray.intersectObject(root, true).slice(0, 3).map(hh => { const n = hh.face.normal.clone().transformDirection(hh.object.matrixWorld); return `${hh.distance.toFixed(1)}m ${hh.object.name.slice(0, 18)} n.y ${n.y.toFixed(2)} dot ${n.dot(d).toFixed(2)}`; });
    out.push(`${sd === side ? 'SIDE' : 'OPP '} ${hits.join(' | ') || 'none'}`);
  }
  console.log(id, 's', s, 'room', room[i], 'y', o.y.toFixed(1)); for (const x of out) console.log('   ', x);
}

console.log('--- scan');
function wallAt(s, side, dy) {
  const u = s / L; const o = curve.getPointAt(u); const t = curve.getTangentAt(u);
  const h = Math.atan2(t.x, t.z); const l = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)); const f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
  const i = Math.min(room.length - 1, Math.round(u * (pts.length - 1)));
  const rm = room[i][side === 1 ? 0 : 1];
  const d = l.clone().multiplyScalar(side);
  const probe = (along, up) => {
    ray.set(o.clone().addScaledVector(f, along).setY(o.y + dy + up), d); ray.near = Math.min(rm + 1.5, 30); ray.far = Number(process.env.FAR ?? 42);
    for (const hh of ray.intersectObject(root, true)) { const n = hh.face.normal.clone().transformDirection(hh.object.matrixWorld); if (Math.abs(n.y) > 0.3) continue; if (n.dot(d) > -0.6) return null; return hh.distance; }
    return null;
  };
  const c = probe(0, 0); if (c === null) return null;
  // a flat stretch of wall: 5 more probes across a 16 x 9 m area agree within 2.5 m
  for (const [a, b] of (process.env.SMALL ? [[-5, 0], [5, 0], [0, -2.5], [0, 2.5]] : [[-7, 0], [7, 0], [0, -3.5], [0, 3.5], [-7, 3.5]])) { const v = probe(a, b); if (v === null || Math.abs(v - c) > 2.5) return null; }
  return c;
}
const found = [];
for (let s = 30; s < L - 10; s += 4) for (const side of [1, -1]) for (const dy of [8, 11, 14]) { const d = wallAt(s, side, dy); if (d !== null) found.push({ s, side, dy, d, edge: d - room[Math.min(room.length - 1, Math.round((s / L) * (pts.length - 1)))][side === 1 ? 0 : 1] }); }
for (const [id, [s0]] of Object.entries(stops)) {
  const c = found.filter(f => Math.abs(f.s - s0) <= 50).sort((a, b) => (Math.abs(a.d - 20) + Math.abs(a.s - s0) * 0.15) - (Math.abs(b.d - 20) + Math.abs(b.s - s0) * 0.15));
  console.log(id, s0, c.slice(0, 4).map(x => `s${x.s} side${x.side} lift${x.dy} d${x.d.toFixed(1)}`).join(' | ') || 'NONE');
}
console.log('--- all walls (s side d)');
const bySide = {};
for (const f of found) { const k = `${f.side}`; const m = (bySide[k] ??= new Map()); const was = m.get(f.s); if (!was || f.d < was.d) m.set(f.s, f); }
// "s:distance from the centre line/from the road's edge" (boards go on walls within 15 m of the road's edge)
for (const [side, m] of Object.entries(bySide)) console.log('side', side, [...m.entries()].map(([s, f]) => `${s}:${f.d.toFixed(0)}/${f.edge.toFixed(0)}`).join(' '));
