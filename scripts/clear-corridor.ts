/**
 * CLEAR THE CAR'S CORRIDOR (asset pipeline, after trim-city: `npm run city`)
 * ==========================================================================
 * Sweeps the car's corridor along the whole journey (scripts/lib/corridor.ts: the car's box
 * at every pose the scene drives it through, slides included, CORRIDOR.width wide and from
 * CORRIDOR.from to CORRIDOR.to above the road, and the same box on the route line itself)
 * through public/models/city.glb with three-mesh-bvh, and takes out whatever non-road
 * geometry is inside it:
 *
 *   - a small piece (a post, a sign, a bollard, one facade card) goes whole;
 *   - a big one (the kerb network, a planter run) is cut back: the triangles inside the
 *     corridor, and the other half of each quad, go.
 *
 * Every removal is reported with its route metre. Where a cut was at street level (a kerb, a
 * median's nose: the model has no road under those) a road strip is laid under it
 * (CORRIDOR_PATCHES) and a row of barriers stands just outside the corridor where the cut
 * piece carries on (CORRIDOR_BARRIERS, drawn by src/scene/city/CorridorBarriers.tsx). Both go
 * to src/lib/corridor.data.ts. Rerun on a model that is already clear, it changes nothing.
 *
 *   npx tsx scripts/clear-corridor.ts
 */
import fs from 'node:fs';
import { Logger } from '@gltf-transform/core';
import { compactPrimitive, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { Box3, Matrix4, Quaternion, Raycaster, Vector3 } from 'three';
import { PATCH_COLS, PATCH_HALF, patchSpans } from '../src/lib/bridgePath';
import { CITY_ORIGIN, sampleRoute } from '../src/lib/cityRoute';
import { CORRIDOR_CUTS, CORRIDOR_PATCHES } from '../src/lib/corridor.data';
import { CORRIDOR, corridorEnvelope, journeyPoses, pieces, routePoses, sweep, weldIds } from './lib/corridor';
import { CITY_FILE, cityIO, cityMeshes } from './lib/world';

/** A piece no bigger than this (metres, any side) goes whole. */
const SMALL = 12;
/** The berth the backdrop's facade cards keep: width, and from/to above the road. */
const VIEW = { width: 9, from: -6, to: 30 };
/** Barriers stand this far outside the corridor's edge. */
const BARRIER_GAP = 0.35;
const OUT = 'src/lib/corridor.data.ts';
const DOWN = new Vector3(0, -1, 0);

type Cut = {
  s: [number, number];
  lat: [number, number];
  y: [number, number];
  material: string;
  what: string;
  street: boolean;
};

async function main() {
  // judge the model on its own: without the strips a previous run laid (the wheels would
  // find those and the run would drop them)
  CORRIDOR_PATCHES.length = 0;
  const io = await cityIO();
  const doc = await io.read(CITY_FILE);
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const city = cityMeshes(doc);
  const line = routePoses(city);
  const drive = journeyPoses(city);
  const env = corridorEnvelope([...line, ...drive]);
  const hits = [...sweep(city, line), ...sweep(city, drive)];
  // the backdrop's facade cards (flat boxes meant to be seen from across the city) get a
  // wider berth: none standing over or beside the road as the car passes (one box stood
  // across the flyover's end at the bridge, the car drove through its wall); those wholly
  // under the road stay
  const backdrop = city.map((m) => (m.node.startsWith('backdrop') ? m : { ...m, road: true }));
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const up = new Vector3();
  const view = line.map((p) => {
    p.box.decompose(pos, quat, scl);
    up.set(0, 1, 0).applyQuaternion(quat);
    const centre = pos.clone().addScaledVector(up, (VIEW.from + VIEW.to) / 2 - (CORRIDOR.from + CORRIDOR.to) / 2);
    return { ...p, box: new Matrix4().compose(centre, quat, new Vector3(VIEW.width, VIEW.to - VIEW.from, scl.z)) };
  });
  for (const h of sweep(backdrop, view)) {
    const m = city[h.mesh].mesh;
    const idx = m.geometry.index!.array;
    const at = m.geometry.getAttribute('position');
    let top = -Infinity;
    for (let k = 0; k < 3; k++) top = Math.max(top, new Vector3().fromBufferAttribute(at, idx[h.tri * 3 + k]).applyMatrix4(m.matrixWorld).y);
    const p = view.find((x) => x.s === h.s)!;
    if (top > p.pos.y - 1) hits.push(h);
  }
  // a model this has already cleared: keep what the earlier run cut (and its strips and barriers)
  const again = !hits.length;

  // group the hits by piece
  type Group = { mesh: number; piece: number; tris: Set<number>; s0: number; s1: number };
  const groups = new Map<string, Group>();
  const triPiece = new Map<number, Int32Array>();
  for (const h of hits) {
    if (!triPiece.has(h.mesh)) triPiece.set(h.mesh, pieces(city[h.mesh]));
    const piece = triPiece.get(h.mesh)![h.tri];
    const k = `${h.mesh}:${piece}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { mesh: h.mesh, piece, tris: new Set(), s0: h.s, s1: h.s }));
    g.tris.add(h.tri);
    g.s0 = Math.min(g.s0, h.s);
    g.s1 = Math.max(g.s1, h.s);
  }

  const drop = new Map<number, Set<number>>(); // mesh -> triangles to remove
  const cuts: Cut[] = [];
  const v = new Vector3();
  const rp = new Vector3();
  for (const g of groups.values()) {
    const c = city[g.mesh];
    const idx = c.mesh.geometry.index!.array;
    const pos = c.mesh.geometry.getAttribute('position');
    const tp = triPiece.get(g.mesh)!;
    const all: number[] = [];
    const box = new Box3();
    for (let t = 0; t < tp.length; t++) {
      if (tp[t] !== g.piece) continue;
      all.push(t);
      for (let k = 0; k < 3; k++) box.expandByPoint(v.fromBufferAttribute(pos, idx[t * 3 + k]).applyMatrix4(c.mesh.matrixWorld));
    }
    const size = box.getSize(new Vector3());
    const whole = all.length <= 4 || Math.max(size.x, size.y, size.z) <= SMALL;
    let gone: number[];
    if (whole) gone = all;
    else {
      // the hit triangles and the other half of their quads (sharing an edge, same facing)
      const vid = weldIds(c);
      const set = new Set(g.tris);
      const n = (t: number) => {
        const a = v.fromBufferAttribute(pos, idx[t * 3]).clone();
        const b = new Vector3().fromBufferAttribute(pos, idx[t * 3 + 1]).sub(a);
        const d = new Vector3().fromBufferAttribute(pos, idx[t * 3 + 2]).sub(a);
        return b.cross(d).normalize();
      };
      for (const t of g.tris) {
        const mine = [0, 1, 2].map((k) => vid[idx[t * 3 + k]]);
        const nt = n(t);
        for (const u of all) {
          if (set.has(u)) continue;
          const shared = [0, 1, 2].filter((k) => mine.includes(vid[idx[u * 3 + k]])).length;
          if (shared >= 2 && n(u).dot(nt) > 0.98) set.add(u);
        }
      }
      gone = [...set];
    }
    let d = drop.get(g.mesh);
    if (!d) drop.set(g.mesh, (d = new Set()));
    for (const t of gone) d.add(t);

    // where it was, relative to the route
    let lat0 = Infinity;
    let lat1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const t of gone)
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, idx[t * 3 + k]).applyMatrix4(c.mesh.matrixWorld);
        // nearest route metre within the hit range
        let best = Infinity;
        let bs = g.s0;
        for (let s = g.s0 - 6; s <= g.s1 + 6; s += 0.5) {
          sampleRoute(s, rp);
          const dd = Math.hypot(v.x - rp.x, v.z - rp.z);
          if (dd < best) {
            best = dd;
            bs = s;
          }
        }
        const h = sampleRoute(bs, rp);
        const lat = (v.x - rp.x) * Math.cos(h) - (v.z - rp.z) * Math.sin(h);
        lat0 = Math.min(lat0, lat);
        lat1 = Math.max(lat1, lat);
        y0 = Math.min(y0, v.y - rp.y);
        y1 = Math.max(y1, v.y - rp.y);
      }
    cuts.push({
      s: [g.s0, g.s1],
      lat: [+lat0.toFixed(2), +lat1.toFixed(2)],
      y: [+y0.toFixed(2), +y1.toFixed(2)],
      material: c.material,
      what: whole
        ? `whole piece, ${gone.length} triangles, ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} m`
        : `cut back: ${gone.length} of its ${all.length} triangles (the piece is ${Math.max(size.x, size.z).toFixed(0)} m across)`,
      // on the street: kerbs, medians, planters (not a facade that only reaches down past the road)
      street: !whole && y0 > -1 && y1 < 3,
    });
  }

  if (again) cuts.push(...CORRIDOR_CUTS);

  // street-level cuts: a road strip under them, barriers outside the corridor where the piece carries on
  const patches: [number, number][] = [];
  const barriers: { s: [number, number]; side: 1 | -1; lat: [number, number][] }[] = [];
  for (const cut of cuts.filter((c) => c.street)) {
    const a = Math.floor(cut.s[0] - 2);
    const b = Math.ceil(cut.s[1] + 2);
    const last = patches[patches.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else patches.push([a, b]);
    const side: 1 | -1 = Math.abs(cut.lat[1]) > Math.abs(cut.lat[0]) ? 1 : -1;
    const line: [number, number][] = [];
    for (let s = Math.floor(cut.s[0]); s <= Math.ceil(cut.s[1]); s++) {
      const e = env.get(s);
      if (!e) continue;
      line.push([s, +(side === 1 ? e[1] + BARRIER_GAP : e[0] - BARRIER_GAP).toFixed(2)]);
    }
    if (line.length) barriers.push({ s: [line[0][0], line[line.length - 1][0]], side, lat: line });
  }
  // and under any wheel that finds no road at all (a crack between two of the model's road tiles)
  const cracks = drive.filter((p) => !p.onRoad && !cuts.some((c) => c.street && p.s >= c.s[0] - 2 && p.s <= c.s[1] + 2)).map((p) => p.s);
  for (const s of cracks) patches.push([Math.floor(s - 1.5), Math.ceil(s + 1.5)]);
  patches.sort((x, y) => x[0] - y[0]);
  for (let i = patches.length - 1; i > 0; i--)
    if (patches[i][0] <= patches[i - 1][1]) {
      patches[i - 1][1] = Math.max(patches[i - 1][1], patches[i][1]);
      patches.splice(i, 1);
    }
  // one line per side where cuts overlap, the outermost offset at each metre
  barriers.sort((x, y) => x.side - y.side || x.s[0] - y.s[0]);
  for (let i = barriers.length - 1; i > 0; i--) {
    const a = barriers[i - 1];
    const b = barriers[i];
    if (a.side !== b.side || b.s[0] > a.s[1] + 1) continue;
    const at = new Map(a.lat);
    for (const [m, l] of b.lat) at.set(m, at.has(m) ? (a.side === 1 ? Math.max(at.get(m)!, l) : Math.min(at.get(m)!, l)) : l);
    a.lat = [...at].sort((x, y) => x[0] - y[0]);
    a.s = [a.lat[0][0], a.lat[a.lat.length - 1][0]];
    barriers.splice(i, 1);
  }

  // how far under the route line the model's road is, across each strip (a column a metre)
  // and metre by metre: just under the road where it is, and bridging each hole from the road
  // either side of it
  CORRIDOR_PATCHES.length = 0;
  CORRIDOR_PATCHES.push(...patches);
  const drops: number[][] = [];
  const roads = city.filter((m) => m.road).map((m) => m.mesh);
  const ray = new Raycaster();
  ray.far = 4;
  const cols = PATCH_COLS;
  for (const [a, b] of patchSpans()) {
    for (let m = a; m <= b; m++) {
      const row: number[] = [];
      for (let j = 0; j < cols; j++) {
        const lat = -PATCH_HALF + (2 * PATCH_HALF * j) / (cols - 1);
        let low = Infinity;
        for (const ds of [-0.5, 0, 0.5])
          for (const dl of [-0.5, 0, 0.5]) {
            const h = sampleRoute(m + ds, rp);
            const y0 = rp.y;
            ray.set(v.set(rp.x + Math.cos(h) * (lat + dl), y0 + 1.5, rp.z - Math.sin(h) * (lat + dl)), DOWN);
            const hit = ray.intersectObjects(roads, false)[0];
            if (hit && Math.abs(hit.point.y - y0) < 1) low = Math.min(low, hit.point.y - y0);
          }
        row.push(low - 0.03);
      }
      // holes: from the road either side
      for (let j = 0; j < cols; j++) {
        if (Number.isFinite(row[j])) continue;
        let l = j - 1;
        while (l >= 0 && !Number.isFinite(row[l])) l--;
        let r = j + 1;
        while (r < cols && !Number.isFinite(row[r])) r++;
        row[j] = l >= 0 && r < cols ? row[l] + ((row[r] - row[l]) * (j - l)) / (r - l) : l >= 0 ? row[l] : r < cols ? row[r] : -0.04;
      }
      drops.push([m, ...row.map((y) => +y.toFixed(3))]);
    }
  }

  // write the model back without them
  let removed = 0;
  if (again) console.log('clear-corridor: nothing new in the corridor (already cleared), keeping the earlier cuts');
  for (const [mi, tris] of drop) {
    const prim = city[mi].primitive;
    // (three-mesh-bvh reorders the triangles when it builds: the hits number them in the
    // mesh's index, so that index, minus the cut, becomes the primitive's)
    const ia = city[mi].mesh.geometry.index!.array;
    const kept: number[] = [];
    for (let t = 0; t < ia.length / 3; t++) if (!tris.has(t)) kept.push(ia[t * 3], ia[t * 3 + 1], ia[t * 3 + 2]);
    removed += tris.size;
    const n = prim.getAttribute('POSITION')!.getCount();
    prim.getIndices()!.setArray(n > 65535 ? Uint32Array.from(kept) : Uint16Array.from(kept));
    compactPrimitive(prim);
  }
  if (!again) {
    await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(CITY_FILE, doc);
  }

  const text = `/** Generated by scripts/clear-corridor.ts (npm run city): what the corridor sweep took out of the city model. Don't edit. */

/** Each removal: route metres, how far left (+) / right (-) of the route line and above the road it reached, and what it was. */
export const CORRIDOR_CUTS: { s: [number, number]; lat: [number, number]; y: [number, number]; material: string; what: string; street: boolean }[] = ${JSON.stringify(cuts)};

/** Road strips laid under the street-level cuts (route metres): the model has no road under a kerb. */
export const CORRIDOR_PATCHES: [number, number][] = ${JSON.stringify(patches)};

/** How far under the route line (m) each road strip lies, metre by metre: [metre, then one height per column from right to left]. */
export const PATCH_DROP: number[][] = ${JSON.stringify(drops)};

/** Barrier lines just outside the corridor where a cut piece carries on: [route metre, lateral offset] points. */
export const CORRIDOR_BARRIERS: { s: [number, number]; side: 1 | -1; lat: [number, number][] }[] = ${JSON.stringify(barriers)};
`;
  fs.writeFileSync(OUT, text);
  if (!again) console.log(`clear-corridor: ${CORRIDOR.width} m wide, ${CORRIDOR.from}-${CORRIDOR.to} m above the road, ${drive.length} poses; removed ${removed} triangles in ${cuts.length} places`);
  for (const c of cuts.sort((x, y) => x.s[0] - y.s[0]))
    console.log(
      `  s ${c.s[0]}-${c.s[1]} m  ${c.material}  ${c.what}  (${c.lat[0]} to ${c.lat[1]} m off the line, ${c.y[0]} to ${c.y[1]} m above the road)${c.street ? '  + road strip, barriers' : ''}`,
    );
  for (const s of cracks) console.log(`  s ${s} m  no road under a wheel (a crack between road tiles)  + road strip`);
  void CITY_ORIGIN;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
