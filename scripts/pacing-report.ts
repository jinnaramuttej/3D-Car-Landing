/**
 * The distance budget: does the speed profile (src/lib/pacing.ts) fit the route?
 *
 *   npx tsx scripts/pacing-report.ts        (npm run pacing)
 *
 * Prints every leg (metres, seconds, top speed), where the drift happens and how fast,
 * the route the drive uses against the route there is, and the total time.
 */
import { getRoute } from '../src/lib/cityRoute';
import { DRIFT, journeySeconds, legs, PARK_S, RUN, sAtTime, speedAtS, speedKeys, ZONES } from '../src/lib/pacing';

const r = getRoute();
const kmh = (v: number) => (v * 3.6).toFixed(0);
const pad = (x: string | number, n: number) => String(x).padStart(n);

console.log('distance budget');
console.log(`  route: city ${r.bridgeStart.toFixed(0)} m, bridge to ${r.length.toFixed(0)} m (deck ${(r.length - r.bridgeStart).toFixed(0)} m)`);
const end = sAtTime(journeySeconds());
console.log(`  the drive uses ${PARK_S} -> ${end.toFixed(0)} m (${(end - PARK_S).toFixed(0)} m): ${(r.bridgeStart - PARK_S).toFixed(0)} m of city, ${(end - r.bridgeStart).toFixed(0)} m of bridge`);
console.log(`  runs: cruise ${kmh(RUN.speed)} km/h, accel ${RUN.accel} m/s2, brake ${RUN.brake} m/s2`);
console.log('');
console.log('  leg                              from     to   metres  seconds  top km/h');
let total = 0;
for (const l of legs()) {
  total += l.seconds;
  console.log(`  ${l.name.padEnd(30)} ${pad(l.s0.toFixed(0), 6)} ${pad(l.s1.toFixed(0), 6)} ${pad(l.metres.toFixed(0), 8)} ${pad(l.seconds.toFixed(1), 8)} ${pad(l.peakKmh.toFixed(0), 9)}`);
}
console.log(`  ${'total'.padEnd(30)} ${pad('', 6)} ${pad('', 6)} ${pad((end - PARK_S).toFixed(0), 8)} ${pad(total.toFixed(1), 8)}`);
console.log('');
console.log('  zones (km/h): edge / slowest, seconds in the zone');
for (const z of ZONES) {
  const l = legs().find((x) => x.name === `zone ${z.id}`)!;
  console.log(`    ${z.id.padEnd(13)} board ${z.board}  ${kmh(z.edge)} / ${kmh(z.slow)}  ${l.seconds.toFixed(1)} s over ${l.metres} m`);
}
let lo = Infinity;
let hi = 0;
for (let s = DRIFT.full; s <= DRIFT.hold; s += 2) {
  lo = Math.min(lo, speedAtS(s));
  hi = Math.max(hi, speedAtS(s));
}
console.log(`  the drift (${DRIFT.full}-${DRIFT.hold} m): ${kmh(lo)}-${kmh(hi)} km/h`);
console.log(`  speed keys: ${speedKeys().length}, journey ${journeySeconds().toFixed(1)} s`);
