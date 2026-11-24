/**
 * ROUTE CONTINUITY CHECK
 * ======================
 *   npx tsx scripts/check-route.ts         (also runs before every `npm run build`)
 *
 * Walks the whole drive every 25 cm (the city route, the connecting ramp and the bridge)
 * and, against the real geometry (public/models/city.glb plus the deck the scene builds
 * from src/lib/bridgePath.ts), reports:
 *
 *   gap      no road surface under the route (a hole, an open end, a missing deck)
 *   ledge    the road surface jumps more than 8 cm between two samples (a step); 5-8 cm
 *            jumps are only noted (the model's painted crossings sit on their own layer)
 *   offset   the route runs more than 8 cm above or below the road (the car floats or sinks)
 *   heading  the route turns more than 3 degrees between two samples (a kink)
 *
 * Exits with code 1 if it finds anything, so the build stops.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { deckExtraGeometry, deckFrameAt, deckRange } from '../src/lib/bridgePath';
import { CITY_ORIGIN, getRoute } from '../src/lib/cityRoute';

const STEP = 0.25;
const NOTE_LEDGE = 0.05;
const MAX_LEDGE = 0.08;
const MAX_OFFSET = 0.08;
const MAX_TURN_DEG = 3;

async function loadCity() {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read('public/models/city.glb');
  const root = new Group();
  const mat = new MeshBasicMaterial({ side: DoubleSide });
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      // only what a car drives on: roads, pavements and plazas (not kerbs, rails, roofs)
      const kind = p.getMaterial()?.getName().split(':')[0];
      if (kind !== 'road' && kind !== 'ground') continue;
      const pos = p.getAttribute('POSITION')!;
      const arr = new Float32Array(pos.getCount() * 3);
      const e: number[] = [];
      for (let i = 0; i < pos.getCount(); i++) arr.set(pos.getElement(i, e), i * 3);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(arr, 3));
      const idx = p.getIndices();
      if (idx) g.setIndex(Array.from(idx.getArray()!));
      const me = new Mesh(g, mat);
      me.applyMatrix4(m);
      // city-local -> world, like the scene
      me.position.add(CITY_ORIGIN);
      root.add(me);
    }
  }
  return root;
}

/** The deck top and anything the scene adds to carry the road (ramp), as world meshes. */
function deckMeshes() {
  const root = new Group();
  const mat = new MeshBasicMaterial({ side: DoubleSide });
  for (const g of deckExtraGeometry()) root.add(new Mesh(g, mat));
  return root;
}

type Issue = { kind: 'gap' | 'ledge' | 'note' | 'offset' | 'heading'; from: number; to: number; worst: number };

async function main() {
  const route = getRoute();
  const { to } = deckRange();
  const end = Math.min(to, route.length);
  const world = new Group();
  world.add(await loadCity());
  world.add(deckMeshes());
  world.updateMatrixWorld(true);

  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const issues: Issue[] = [];
  const push = (kind: Issue['kind'], s: number, v: number) => {
    const last = issues[issues.length - 1];
    if (last && last.kind === kind && s - last.to <= STEP * 1.5) {
      last.to = s;
      last.worst = Math.max(last.worst, v);
    } else issues.push({ kind, from: s, to: s, worst: v });
  };

  let prevH: number | null = null;
  let prevY: number | null = null;
  for (let s = 0; s <= end; s += STEP) {
    const { p, f } = deckFrameAt(s);
    const h = Math.atan2(f.x, f.z);
    if (prevH !== null) {
      const turn = Math.abs(Math.atan2(Math.sin(h - prevH), Math.cos(h - prevH))) * (180 / Math.PI);
      if (turn > MAX_TURN_DEG) push('heading', s, turn);
    }
    prevH = h;
    ray.set(p.clone().setY(p.y + 1.2), down);
    ray.far = 4;
    const hit = ray.intersectObject(world, true)[0];
    if (!hit) {
      push('gap', s, 4);
      prevY = null;
    } else {
      const off = Math.abs(hit.point.y - p.y);
      if (off > MAX_OFFSET) push('offset', s, off);
      const jump = prevY === null ? 0 : Math.abs(hit.point.y - prevY);
      if (jump > MAX_LEDGE) push('ledge', s, jump);
      else if (jump > NOTE_LEDGE) push('note', s, jump);
      prevY = hit.point.y;
    }
  }

  const fmt = (i: Issue) =>
    `  ${i.kind.padEnd(8)} s ${i.from.toFixed(1)} .. ${i.to.toFixed(1)} m (${(i.to - i.from + STEP).toFixed(2)} m long)  worst ${i.kind === 'heading' ? `${i.worst.toFixed(1)} deg` : `${(i.worst * 100).toFixed(0)} cm`}`;
  console.log(`route check: ${end.toFixed(0)} m walked every ${STEP * 100} cm (city route ${route.bridgeStart.toFixed(0)} m, deck from ${deckRange().from.toFixed(0)} m)`);
  for (const i of issues) console.log(fmt(i));
  const failing = issues.filter((i) => i.kind !== 'note');
  if (!failing.length) {
    console.log('  OK: no gaps, no ledges over 8 cm, nowhere more than 8 cm off the road, no kinks over 3 degrees');
    return;
  }
  console.log(`  FAILED: ${failing.length} problem(s)`);
  process.exitCode = 1;
}

void main();
