/**
 * CORRIDOR CHECK (runs before every `npm run build`)
 * ==================================================
 *   npx tsx scripts/check-corridor.ts
 *
 * Sweeps the car's corridor (scripts/lib/corridor.ts: CORRIDOR.width wide, CORRIDOR.from to
 * CORRIDOR.to above the road, at every pose of the journey as the scene drives it, slides
 * included, and on the route line itself) through the city model and the corridor
 * barriers the scene adds (src/lib/corridorBlocks.ts), with three-mesh-bvh. Fails if
 * anything but road is inside it: rerun `npm run city` (scripts/clear-corridor.ts clears it)
 * or move whatever was added.
 */
import { BoxGeometry, Euler, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { barrierBlocks, BLOCK } from '../src/lib/corridorBlocks';
import { CORRIDOR, journeyPoses, routePoses, sweep } from './lib/corridor';
import { type CityMesh, loadCityMeshes } from './lib/world';

async function main() {
  const city = await loadCityMeshes();
  // the barriers, as one mesh
  const blocks = barrierBlocks();
  if (blocks.length) {
    const m = new Matrix4();
    const geos = blocks.map((b) => {
      const g = new BoxGeometry(BLOCK.w, BLOCK.h, BLOCK.l);
      m.compose(b.pos.clone().setY(b.pos.y + BLOCK.h / 2), new Quaternion().setFromEuler(new Euler(0, b.yaw, 0)), new Vector3(1, 1, 1));
      return g.applyMatrix4(m);
    });
    const mesh = new Mesh(mergeGeometries(geos), new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    city.push({ mesh, road: false, material: 'corridor barriers', node: 'CorridorBarriers', prim: 0 } as unknown as CityMesh);
  }
  const line = routePoses(city);
  const drive = journeyPoses(city);
  const hits = [...sweep(city, line), ...sweep(city, drive)];
  console.log(
    `corridor check: ${CORRIDOR.width} m wide, ${CORRIDOR.from}-${CORRIDOR.to} m above the road, ${drive.length} poses of the drive and ${line.length} on the route line, ${blocks.length} barrier blocks`,
  );
  if (!hits.length) {
    console.log('  OK: nothing but road inside the corridor');
    return;
  }
  const by = new Map<string, { s0: number; s1: number; n: number }>();
  for (const h of hits) {
    const k = city[h.mesh].material;
    const e = by.get(k);
    if (!e) by.set(k, { s0: h.s, s1: h.s, n: 1 });
    else {
      e.s0 = Math.min(e.s0, h.s);
      e.s1 = Math.max(e.s1, h.s);
      e.n++;
    }
  }
  for (const [k, e] of by) console.log(`  FAIL s ${e.s0}-${e.s1} m  ${k}: ${e.n} triangles inside the corridor`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
