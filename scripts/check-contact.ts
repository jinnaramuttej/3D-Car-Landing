/**
 * GROUND CONTACT CHECK
 * ====================
 *   npx tsx scripts/check-contact.ts        (also runs before every `npm run build`)
 *
 * Drives the car down the whole journey in 0.5 m steps with the scene's own code
 * (stepCityDrive: the drift, the slide's offset, the four wheel rays onto the road
 * surfaces and the plane fitted to them, src/lib/ground.ts) and checks every wheel: the
 * wheel follows the road's twist within its travel (TRAVEL), and anything past that is the
 * wheel standing off the road. Fails if any wheel is more than 5 cm above or below the
 * road, or finds no road under it.
 */
import { citySAt, contactState, carContact, stepCityDrive } from '../src/lib/cityDrive';
import { journeySeconds, progressAtTime, sAtTime, speedAtS, timeAtS, PARK_S } from '../src/lib/pacing';
import { setRoadMeshes, TRAVEL, WHEELS } from '../src/lib/ground';
import { carState } from '../src/lib/motion';
import { loadCityMeshes } from './lib/world';

const STEP = 0.1;
const LIMIT = 0.05;

async function main() {
  const city = await loadCityMeshes();
  setRoadMeshes(city.filter((c) => c.road).map((c) => c.mesh));
  const end = sAtTime(journeySeconds());
  let worst = 0;
  let worstAt = 0;
  let maxTwist = 0;
  const bad: { s: number; wheel: string; off: number; miss: boolean }[] = [];
  let lastS = PARK_S;
  for (let s = PARK_S; s <= end; s += STEP) {
    const p = progressAtTime(timeAtS(s));
    // the time a real drive takes over this half metre (the slide's yaw is damped in time)
    const dt = STEP / Math.max(1.5, speedAtS(s));
    stepCityDrive(p, s === PARK_S ? 0 : dt);
    void lastS;
    lastS = citySAt(p);
    if (!contactState.ok) {
      bad.push({ s, wheel: 'all', off: Infinity, miss: true });
      continue;
    }
    for (let i = 0; i < 4; i++) {
      const r = carContact.residual[i];
      maxTwist = Math.max(maxTwist, Math.abs(r));
      const off = Math.max(0, Math.abs(r) - TRAVEL);
      if (off > worst) {
        worst = off;
        worstAt = s;
      }
      if (!carContact.hit[i] || off > LIMIT) bad.push({ s: +s.toFixed(1), wheel: WHEELS[i].id, off, miss: !carContact.hit[i] });
    }
  }
  void carState;
  const steps = Math.round((end - PARK_S) / STEP) + 1;
  console.log(`contact check: ${steps} steps of ${STEP} m (route ${PARK_S}-${end.toFixed(0)} m), 4 wheels each`);
  console.log(`  largest twist a wheel takes up ${(maxTwist * 100).toFixed(1)} cm (travel ${TRAVEL * 100} cm); worst off the road ${(worst * 100).toFixed(1)} cm at ${worstAt.toFixed(1)} m`);
  if (!bad.length) {
    console.log(`  OK: every wheel on the road within ${LIMIT * 100} cm`);
    return;
  }
  // group neighbouring failures
  const runs: { from: number; to: number; wheels: Set<string>; worst: number; miss: boolean }[] = [];
  for (const b of bad) {
    const r = runs[runs.length - 1];
    if (r && b.s - r.to <= STEP * 2) {
      r.to = b.s;
      r.wheels.add(b.wheel);
      r.worst = Math.max(r.worst, b.off);
      r.miss ||= b.miss;
    } else runs.push({ from: b.s, to: b.s, wheels: new Set([b.wheel]), worst: b.off, miss: b.miss });
  }
  for (const r of runs)
    console.log(`  FAIL s ${r.from}-${r.to} m  ${[...r.wheels].join(',')}  ${r.miss ? 'no road under the wheel' : `${(r.worst * 100).toFixed(1)} cm off the road`}`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
