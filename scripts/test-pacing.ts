/**
 * FAST-FLICK PACING TEST (runs before every `npm run build`)
 * ===========================================================
 *   npx tsx scripts/test-pacing.ts
 *
 * Plays the playhead (src/lib/playhead.ts) and the car (stepCityDrive, on the city's road
 * surfaces) frame by frame at 60 fps through the scrolls a visitor throws at it, and fails if
 *
 *  - any cue (a stop's phases, its title card, the finale's card: cueWindows()) is up for
 *    less than its minimum on a
 *    flick forward, a flick back or a normal wheel scroll (cues the playhead passes while a
 *    glide has them hidden are not up at all, and don't count);
 *  - a glide shows anything before its destination, or the destination's cues too briefly;
 *  - the playhead goes faster than CONFIG.playhead.chase (glide: .glide) times real time;
 *  - any wheel leaves the road (more than 5 cm off it, past the suspension's travel).
 */
import { carContact, contactState, stepCityDrive } from '../src/lib/cityDrive';
import { chapterAnchor } from '../src/lib/chapters';
import { CONFIG } from '../src/lib/config';
import { setRoadMeshes, TRAVEL } from '../src/lib/ground';
import { carState } from '../src/lib/motion';
import { journeySeconds, PARK_S, progressAtTime, timeAtProgress } from '../src/lib/pacing';
import { type Cue, cueWindows, glideTo, playhead, stepPlayhead, stopPhases } from '../src/lib/playhead';
import { loadCityMeshes } from './lib/world';

const FPS = 60;
const DT = 1 / FPS;
/** One frame's grace on every minimum. */
const GRACE = DT * 1.01;

type Run = {
  name: string;
  /** The scroll's target (journey seconds) at real time `time`; null once it has stopped asking. */
  target: (time: number) => number;
  start: number;
  /** Seconds of real time to play. */
  length: number;
  glide?: number;
  /** Cues that must be up (the rest may be passed by a glide). */
  mustShow: (c: Cue) => boolean;
};

const T = journeySeconds();
const issues: string[] = [];
const report: string[] = [];

function play(run: Run, all: Cue[]) {
  // land at the start as the page would
  stepPlayhead(run.start, 0, true);
  carState.initialized = false;
  stepCityDrive(progressAtTime(run.start), 0);
  if (run.glide !== undefined) glideTo(run.glide);
  const shown = new Map<string, number[]>(); // cue -> each visit's seconds
  const inside = new Map<string, number>();
  let maxRate = 0;
  let maxArrived = 0;
  let offRoad = 0;
  let worstOff = 0;
  let firstOff = -1;
  let hiddenShown = 0;
  let time = 0;
  let arrived = -1;
  const frames = Math.round(run.length * FPS);
  for (let f = 0; f < frames; f++) {
    time += DT;
    stepPlayhead(run.target(time), DT, false, false);
    maxRate = Math.max(maxRate, Math.abs(playhead.rate));
    if (playhead.glide && !playhead.hidden) maxArrived = Math.max(maxArrived, Math.abs(playhead.rate));
    if (arrived < 0 && Math.abs(playhead.t - run.target(run.length)) < 0.05 && Math.abs(playhead.rate) < 0.05) arrived = time;
    stepCityDrive(progressAtTime(playhead.t), DT);
    if (carState.s >= PARK_S + 0.5) {
      const ok = contactState.ok && carContact.hit.every(Boolean);
      const off = ok ? Math.max(...carContact.residual.map((r) => Math.abs(r) - TRAVEL)) : Infinity;
      if (!ok || off > 0.05) {
        offRoad++;
        worstOff = Math.max(worstOff, off);
        if (firstOff < 0) firstOff = carState.s;
      }
    }
    for (const c of all) {
      const up = !playhead.hidden && playhead.t >= c.from && playhead.t < c.to;
      if (up) inside.set(c.id, (inside.get(c.id) ?? 0) + DT);
      else if (inside.has(c.id)) {
        const v = shown.get(c.id) ?? [];
        v.push(inside.get(c.id)!);
        shown.set(c.id, v);
        inside.delete(c.id);
      }
      if (up && run.glide !== undefined && !run.mustShow(c)) hiddenShown++;
    }
  }
  for (const [id, s] of inside) shown.set(id, [...(shown.get(id) ?? []), s]);

  const cap = run.glide !== undefined ? CONFIG.playhead.glide : CONFIG.playhead.chase;
  if (maxRate > cap + 1e-6) issues.push(`${run.name}: played at ${maxRate.toFixed(2)}x, over the ${cap}x limit`);
  if (offRoad) issues.push(`${run.name}: a wheel off the road for ${offRoad} frames (first at ${firstOff.toFixed(1)} m, worst ${(worstOff * 100).toFixed(1)} cm)`);
  if (maxArrived > CONFIG.playhead.enter + 1e-6) issues.push(`${run.name}: played its destination at ${maxArrived.toFixed(2)}x, over ${CONFIG.playhead.enter}x`);
  if (arrived < 0) issues.push(`${run.name}: never got there`);
  if (hiddenShown) issues.push(`${run.name}: the glide showed cues on the way (${hiddenShown} cue-frames)`);
  let shortest = Infinity;
  let shortestId = '';
  for (const c of all) {
    if (!run.mustShow(c)) continue;
    const visits = shown.get(c.id);
    if (!visits?.length) {
      issues.push(`${run.name}: ${c.id} never came up`);
      continue;
    }
    // the visit that counts: the longest (a cue the playhead brushes past on its way back is a second visit)
    const best = Math.max(...visits);
    if (best + GRACE < c.min) issues.push(`${run.name}: ${c.id} up for ${best.toFixed(2)} s (at least ${c.min} s)`);
    if (best / c.min < shortest) {
      shortest = best / c.min;
      shortestId = `${c.id} ${best.toFixed(2)} s of ${c.min} s`;
    }
  }
  report.push(
    `  ${run.name.padEnd(34)} there after ${arrived < 0 ? 'never' : `${arrived.toFixed(1)} s`}, fastest ${maxRate.toFixed(2)}x, tightest cue ${shortestId}`,
  );
}

async function main() {
  const city = await loadCityMeshes();
  setRoadMeshes(city.filter((c) => c.road).map((c) => c.mesh));
  const all = cueWindows();
  const everything = () => true;
  // a hard flick: the scroll target runs to the end in a third of a second (Lenis smooths a
  // flick about like that), then rests
  const flick = (from: number, to: number) => (time: number) => from + (to - from) * Math.min(1, time / 0.33);
  // a visitor wheeling at a steady pace: a notch (0.4 s of journey) every 0.12 s
  const wheel = (from: number) => (time: number) => Math.min(T, from + Math.floor(time / 0.12) * 0.4);
  // where the mini-map's dot for the Stage goes
  const dest = timeAtProgress(chapterAnchor('speakers'));

  const runs: Run[] = [
    { name: 'flick from the top to the end', start: 0, target: flick(0, T), length: T / 1 + 10, mustShow: everything },
    { name: 'flick from the end to the top', start: T, target: flick(T, 0), length: T / 1 + 10, mustShow: everything },
    { name: 'wheel scroll, a notch every 0.12 s', start: 0, target: wheel(0), length: T / 1 + 10, mustShow: everything },
    {
      name: 'mini-map glide to the Stage',
      start: 0,
      target: () => dest,
      glide: dest,
      length: 40,
      // the Stage's cues the playhead reaches (it rests at the dot), and nothing on the way
      mustShow: (c) => c.zone === 'speakers' && c.from < dest,
    },
  ];
  for (const r of runs) play(r, all);
  const sz = stopPhases().filter((p) => p.zone === 'speakers');
  report.push(`  (the Stage's dot is at journey ${dest.toFixed(1)} s; its phases run ${sz[0].from.toFixed(1)}-${sz[sz.length - 1].to.toFixed(1)} s)`);

  // the magnet: a scroll resting 1.5 s short of each stop's title cue is drawn onto it
  for (const p of stopPhases().filter((x) => x.name === 'title')) {
    const rest = p.from - 1.5;
    stepPlayhead(rest - 4, 0, true);
    for (let f = 0; f < FPS * 8; f++) stepPlayhead(rest, DT);
    const gap = p.from - playhead.t;
    report.push(`  magnet before ${p.zone.padEnd(12)} scroll rests 1.50 s short of the title cue, the playhead settles ${gap.toFixed(2)} s short`);
    if (gap > 0.5) issues.push(`magnet: ${p.zone} did not draw the playhead in (still ${gap.toFixed(2)} s short)`);
    if (gap < -0.05) issues.push(`magnet: ${p.zone} pulled past its cue`);
  }

  console.log(`pacing test: ${FPS} fps, journey ${T.toFixed(1)} s, chase ${CONFIG.playhead.chase}x, glide ${CONFIG.playhead.glide}x, ${all.length} cues`);
  for (const r of report) console.log(r);
  if (!issues.length) {
    console.log('  OK: every cue up for its minimum, no wheel off the road, never over the limits');
    return;
  }
  for (const i of issues) console.log(`  FAIL ${i}`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
