/**
 * PACING
 * ======
 * The journey is a time axis t (seconds). A keyframed speed curve v(t), eased between keys
 * (smoothstep: no jolt at a key), is integrated into metres along the route, s(t). The
 * scroll maps to t linearly (global progress p = t / DURATION) and the Play button runs t
 * at real time, so scrolling at an even pace and autoplay give the same drive. The journey
 * driver (chapterRuntime) still sits on top: a flick of the wheel is a fast drive, never a
 * jump.
 *
 *   parked      the title, the engine catches (IGNITE_AT), the car pulls away (GO_AT)
 *   run         fast, up to about 90 km/h, slowing for the corners it can't take flat
 *               (CORNERS): the first slide round the north-east corner on the way
 *   slow zone   at a stop: down to 8-15 km/h as the car rolls past the billboard, the
 *               panel follows the zone's progress (0 -> 1 across the zone)
 *   ...six stops, the second slide (the U-turn) between the third and the fourth...
 *   bridge      the last run, out over the sea, rolling to a stop under the far pylon
 *
 * Runs are planned from the distance between zones: accelerate at RUN.accel, cruise at
 * RUN.speed, brake at RUN.brake; a run too short to reach the cruise speed peaks lower, and
 * a run with a corner in it is planned as a run to the corner, the corner at its speed, and
 * a run on from it.
 * A ramp eased with smoothstep covers the same distance as a straight one, so the plan's
 * arithmetic holds for the eased curve.
 *
 * npx tsx scripts/pacing-report.ts prints the distance budget leg by leg.
 */
import { STOPS } from './cityRoute';

/** Where the car is parked at the start (on the north arc, facing east). */
export const PARK_S = 40;
/** The slide on the first run, round the north-east corner (a right-hander), route metres. */
export const DRIFT = {
  /** The cinema bars come in... */
  from: 184,
  /** The flick: the tail starts to come round going into the corner... */
  flick: 196,
  /** ...and is fully out by here... */
  full: 210,
  /** ...held round the corner... */
  hold: 246,
  /** ...and straight again by here. */
  to: 268,
  /** +1: tail out to the right (a left-hander); -1 a right-hander. */
  sign: -1,
};
/** The second slide: the U-turn in the cross-street junction (a teardrop, the loop to the left). */
export const DRIFT2 = { from: 1074, flick: 1088, full: 1099, hold: 1127, to: 1146, sign: 1 };
/** Both slides, in route order. */
export const DRIFTS = [DRIFT, DRIFT2];
/** Seconds: the title on a still street, then the engine catches, then the car pulls away. */
export const IGNITE_AT = 5.5;
export const GO_AT = 7.5;

/** The fast runs: cruise speed (m/s, 90 km/h) and average acceleration and braking (m/s^2). */
export const RUN = { speed: 25, accel: 8, brake: 9 };
/** The bridge: a touch faster, the sea opening up. */
const BRIDGE_SPEED = 28;

/**
 * Corners a run can't take flat: route metres and the speed through them (m/s). The first
 * slide's corner, the hard right off the east road, the U-turn, and the flyover's bends
 * down to the bridge.
 */
export const CORNERS: { from: number; to: number; v: number }[] = [
  { from: 196, to: 250, v: 72 / 3.6 },
  { from: 498, to: 530, v: 38 / 3.6 },
  { from: 1074, to: 1150, v: 36 / 3.6 },
  { from: 1712, to: 1806, v: 56 / 3.6 },
];

export type ZoneId = 'robowars' | 'competitions' | 'catalyst' | 'workshops' | 'speakers' | 'dkms';

/**
 * A slow zone: route metres either side of the billboard, the speed the car rolls in and
 * out at, and the slowest it gets as it passes the board (m/s). The car reaches the board
 * near the end of its zone (~0.8): the boards hang ~20 m off the road, so while the panel
 * plays out (0.3-0.7) the board is still ahead of the camera trailing the car, not beside it.
 */
export type Zone = { id: ZoneId; board: number; before: number; after: number; edge: number; slow: number };

const kmh = (v: number) => v / 3.6;

/** The six stops, in route order (their billboards: STOPS in cityRoute.ts). */
export const ZONES: Zone[] = [
  // The Arena
  { id: 'robowars', board: STOPS.robowars.s, before: 24, after: 6, edge: kmh(15), slow: kmh(9) },
  // The Pit Lane
  { id: 'competitions', board: STOPS.competitions.s, before: 24, after: 6, edge: kmh(15), slow: kmh(9) },
  // Catalyst (a smaller board, nearer the road)
  { id: 'catalyst', board: STOPS.catalyst.s, before: 20, after: 6, edge: kmh(15), slow: kmh(9) },
  // Workshops and Techfest World MUN
  { id: 'workshops', board: STOPS.workshops.s, before: 24, after: 6, edge: kmh(15), slow: kmh(9) },
  // The Stage: past speakers and the TechExpo exhibits, a little longer
  { id: 'speakers', board: STOPS.speakers.s, before: 28, after: 2, edge: kmh(15), slow: kmh(8.5) },
  // The Heartbeat: the slowest and quietest
  { id: 'dkms', board: STOPS.dkms.s, before: 20, after: 6, edge: kmh(12), slow: kmh(8) },
];

/** The finale: where the car eases off on the bridge, rolls, and stops; then a held beat. */
export type FinalePlan = { slowAt: number; stopAt: number; roll: number; hold: number };

type Key = { t: number; v: number };
type Leg = { name: string; kind: 'parked' | 'run' | 'zone' | 'finale'; s0: number; s1: number; t0: number; t1: number; vMax: number };

/** Plans a run from (s0, v0) to (s1, v1): eased up to the cruise (or as close as it gets), then down. */
function planRun(keys: Key[], t: number, s0: number, v0: number, s1: number, v1: number, cruise: number) {
  const D = s1 - s0;
  const a = RUN.accel;
  const b = RUN.brake;
  // the top speed the distance allows: (vp^2 - v0^2) / 2a + (vp^2 - v1^2) / 2b = D
  const reach = Math.sqrt((D + (v0 * v0) / (2 * a) + (v1 * v1) / (2 * b)) / (1 / (2 * a) + 1 / (2 * b)));
  const vp = Math.min(cruise, reach);
  const tUp = (vp - v0) / a;
  const tDown = (vp - v1) / b;
  const dUp = ((v0 + vp) / 2) * tUp;
  const dDown = ((vp + v1) / 2) * tDown;
  const tCruise = Math.max(0, (D - dUp - dDown) / vp);
  keys.push({ t: t + tUp, v: vp });
  if (tCruise > 0.05) keys.push({ t: t + tUp + tCruise, v: vp });
  keys.push({ t: t + tUp + tCruise + tDown, v: v1 });
  return { t: t + tUp + tCruise + tDown, vMax: vp };
}

function build(finaleBoard: number) {
  const keys: Key[] = [];
  const legs: Leg[] = [];
  let t = 0;
  keys.push({ t: 0, v: 0 });
  keys.push({ t: GO_AT, v: 0 });
  legs.push({ name: 'parked: title, ignition', kind: 'parked', s0: PARK_S, s1: PARK_S, t0: 0, t1: GO_AT, vMax: 0 });
  t = GO_AT;
  let s = PARK_S;
  let v = 0;
  const zoneTimes: Record<string, { t0: number; t1: number; tBoard: number }> = {};
  /** A run from (s, v) to (s1, v1) through any corners on the way. */
  const runTo = (name: string, s1: number, v1: number, cruise: number) => {
    let vMax = 0;
    const t0 = t;
    for (const c of CORNERS) {
      if (c.from < s || c.to > s1) continue;
      const r = planRun(keys, t, s, v, c.from, c.v, cruise);
      vMax = Math.max(vMax, r.vMax);
      t = r.t + (c.to - c.from) / c.v;
      keys.push({ t, v: c.v });
      s = c.to;
      v = c.v;
    }
    const r = planRun(keys, t, s, v, s1, v1, cruise);
    legs.push({ name, kind: 'run', s0: legStart, s1, t0, t1: r.t, vMax: Math.max(vMax, r.vMax) });
    t = r.t;
    s = s1;
    v = v1;
  };
  let legStart = s;
  for (const z of ZONES) {
    const from = z.board - z.before;
    const to = z.board + z.after;
    legStart = s;
    runTo(`run to ${z.id}`, from, z.edge, RUN.speed);
    // the zone: eased down to the slowest over its first third, held, eased up over its last
    // fifth (a ramp's distance is its mean speed times its time)
    const L = to - from;
    const l1 = L * 0.35;
    const l3 = L * 0.2;
    const t1 = (2 * l1) / (z.edge + z.slow);
    const t2 = (L - l1 - l3) / z.slow;
    const t3 = (2 * l3) / (z.slow + z.edge);
    keys.push({ t: t + t1, v: z.slow });
    keys.push({ t: t + t1 + t2, v: z.slow });
    keys.push({ t: t + t1 + t2 + t3, v: z.edge });
    const tBoard = t + t1 + (z.before - l1) / z.slow;
    zoneTimes[z.id] = { t0: t, t1: t + t1 + t2 + t3, tBoard };
    legs.push({ name: `zone ${z.id}`, kind: 'zone', s0: from, s1: to, t0: t, t1: t + t1 + t2 + t3, vMax: z.edge });
    t += t1 + t2 + t3;
    s = to;
    v = z.edge;
  }
  // the bridge: up to speed, out over the sea, easing off toward the far pylon, a roll to a
  // stop under it, and a held beat for the call to action
  const finale: FinalePlan = { slowAt: finaleBoard - 6, stopAt: finaleBoard + 4, roll: kmh(12), hold: 3.5 };
  legStart = s;
  runTo('run over the bridge', finale.slowAt, finale.roll, BRIDGE_SPEED);
  const run = { t };
  const tRoll = (2 * (finale.stopAt - finale.slowAt)) / finale.roll;
  keys.push({ t: t + tRoll, v: 0 });
  keys.push({ t: t + tRoll + finale.hold, v: 0 });
  legs.push({ name: 'finale: roll to a stop, hold', kind: 'finale', s0: finale.slowAt, s1: finale.stopAt, t0: t, t1: t + tRoll + finale.hold, vMax: finale.roll });
  t += tRoll + finale.hold;
  return { keys, legs, duration: t, zoneTimes, finale, finaleRollAt: run.t };
}

/* ------------------------------------------------------------ the curve */

/** Sample step of the integrated table, seconds. */
const DT = 1 / 120;

let plan: ReturnType<typeof build> | null = null;
let table: Float64Array | null = null;

function getPlan() {
  if (!plan) {
    plan = build(STOPS.finale.s);
    const n = Math.ceil(plan.duration / DT) + 2;
    table = new Float64Array(n);
    let s = PARK_S;
    table[0] = s;
    for (let i = 1; i < n; i++) {
      // trapezoid on the eased curve
      s += ((speedAt((i - 1) * DT) + speedAt(i * DT)) / 2) * DT;
      table[i] = s;
    }
  }
  return plan;
}

/** The eased speed curve v(t), m/s. */
export function speedAt(t: number) {
  const k = (plan ?? getPlan()).keys;
  if (t <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (t > b.t) continue;
    const u = b.t - a.t > 1e-9 ? (t - a.t) / (b.t - a.t) : 1;
    return a.v + (b.v - a.v) * u * u * (3 - 2 * u);
  }
  return k[k.length - 1].v;
}

/** Seconds the whole journey takes at the planned pace (the autoplay length). */
export const journeySeconds = () => getPlan().duration;

/** Route metres at journey time t (the integral of the speed curve). */
export function sAtTime(t: number) {
  getPlan();
  const tab = table!;
  const f = Math.max(0, t) / DT;
  const i = Math.floor(f);
  if (i >= tab.length - 1) return tab[tab.length - 1];
  return tab[i] + (tab[i + 1] - tab[i]) * (f - i);
}

/** The first time the car reaches route metre s (the inverse of sAtTime). */
export function timeAtS(s: number) {
  getPlan();
  const tab = table!;
  if (s <= tab[0]) return 0;
  if (s >= tab[tab.length - 1]) return (tab.length - 1) * DT;
  let lo = 0;
  let hi = tab.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid] < s) lo = mid;
    else hi = mid;
  }
  const span = tab[hi] - tab[lo];
  return (lo + (span > 1e-9 ? (s - tab[lo]) / span : 0)) * DT;
}

/** Planned speed (m/s) where the car passes route metre s. */
export const speedAtS = (s: number) => speedAt(timeAtS(s));

/** Global progress <-> journey time. */
export const timeAtProgress = (p: number) => Math.min(1, Math.max(0, p)) * journeySeconds();
export const progressAtTime = (t: number) => Math.min(1, Math.max(0, t / journeySeconds()));

/** A zone by id. */
export const zoneById = (id: ZoneId) => ZONES.find((z) => z.id === id)!;

/** Route metres where a zone starts and ends. */
export const zoneSpan = (z: Zone): [number, number] => [z.board - z.before, z.board + z.after];

/** Zone progress at route metre s: 0 entering, 1 leaving (unclamped). */
export function zoneProgress(z: Zone, s: number) {
  const [a, b] = zoneSpan(z);
  return (s - a) / (b - a);
}

/** The zone route metre s is in, if any (with a margin either side). */
export function zoneAtS(s: number, margin = 0): Zone | null {
  for (const z of ZONES) {
    const [a, b] = zoneSpan(z);
    if (s >= a - margin && s <= b + margin) return z;
  }
  return null;
}

/** Global progress at zone progress f of a zone (where the car is at that point of it). */
export function progressAtZone(id: ZoneId, f: number) {
  const z = zoneById(id);
  const [a, b] = zoneSpan(z);
  return progressAtTime(timeAtS(a + f * (b - a)));
}

/** Journey times of the plan's set moments. */
export function moments() {
  const p = getPlan();
  return { zones: p.zoneTimes, finaleRollAt: p.finaleRollAt, duration: p.duration, finale: p.finale };
}

/** The plan, leg by leg, for the budget report (scripts/pacing-report.ts). */
export function legs() {
  return getPlan().legs.map((l) => ({ ...l, metres: l.s1 - l.s0, seconds: l.t1 - l.t0, peakKmh: l.vMax * 3.6 }));
}

/** The keys of the speed curve (for the debug panel and the report). */
export const speedKeys = () => getPlan().keys;
