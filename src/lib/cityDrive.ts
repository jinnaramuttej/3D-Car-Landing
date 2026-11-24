import { MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { CHAPTERS, chapterById, IGNITION, PAGES, type StopId } from './chapters';
import { getRoute, routeCurvature, sampleRoute, STOPS } from './cityRoute';
import { CONFIG } from './config';
import { carState, forwardOf, leftOf } from './motion';

const { clamp, degToRad, smootherstep, smoothstep } = MathUtils;

/**
 * THE DRIVE
 * =========
 * Journey progress -> metres along the route, one curve for the whole page:
 *
 *   I     parked at PARK_S, engine off
 *   II    the engine catches, then the car pulls away (from IGNITION.driveAt)
 *   III   the drift: a steady pace from DRIFT.from to DRIFT.to, sideways from the flick
 *         into the plaza to the end of the long left-hander
 *   IV    it runs on through the S-bend, slowing for the first stop
 *   V-XI  each stop chapter holds the car near its billboard (it creeps past it, engine
 *         ticking over) through the middle of the chapter and drives on to the next stop
 *         across the chapter boundary:
 *
 *           chapter k:   arrive ......... hold (creep past the billboard) ......... leave
 *                        0     ARRIVE                                    LEAVE       1
 *   Fin   up the ramp and onto the bridge, rolling to a stop under the far pylon
 *
 * Between two keys the distance follows a cubic Hermite with each key's speed at both
 * ends, so the car pulls away, runs and brakes with no step in speed. The drift angle is a
 * function of position (an explicit slide in III; from the route's curvature after), so the
 * slides always happen at the same corners and the camera knows where they are.
 */

/** Where the car is parked in I and II: the straight before the plaza, the Catalyst board ahead. */
export const PARK_S = 112;
/** The drift (chapter III), route metres. */
export const DRIFT = {
  from: 160,
  /** The flick: the tail starts to come round going into the plaza... */
  flick: 174,
  /** ...and is fully out by here... */
  full: 190,
  /** ...held down the long left-hander... */
  hold: 350,
  /** ...and straight again by here. */
  to: 372,
  /** +1: tail out to the right (a left-hander). */
  sign: 1,
};

const ARRIVE = 0.22;
const LEAVE = 0.72;
/** Metres the car creeps through a stop (before / after the billboard). */
const HOLD_BEFORE = 10;
const HOLD_AFTER = 8;
/** The bridge stop: arrive later, roll on to the end. */
const FINALE_ARRIVE = 0.5;
const FINALE_ROLL = 34;
/** A steady scroll, pages per second, for the drift profile after the stops. */
const NOMINAL_SCROLL = 0.45;

type Key = { p: number; s: number; v: number };

let keys: Key[] | null = null;
let holds: [number, number][] = [];

function buildKeys(): Key[] {
  const out: Key[] = [];
  const at = (id: Parameters<typeof chapterById>[0], f: number) => {
    const c = chapterById(id);
    return c.start + f * (c.end - c.start);
  };
  const turn = chapterById('turn');
  const vDrift = (DRIFT.to - DRIFT.from) / (turn.end - turn.start);
  // I and the start of II: parked
  out.push({ p: 0, s: PARK_S, v: 0 });
  out.push({ p: at('ignition', IGNITION.driveAt), s: PARK_S, v: 0 });
  // II: pulls away; III: a steady drift pace
  out.push({ p: turn.start, s: DRIFT.from, v: vDrift });
  out.push({ p: turn.end, s: DRIFT.to, v: vDrift });
  // IV runs into V's first hold; then the stops
  holds = [];
  for (const c of CHAPTERS) {
    if (!c.stop) continue;
    const stop = STOPS[c.stop];
    const len = c.end - c.start;
    if (c.stop === 'finale') {
      const a = c.start + FINALE_ARRIVE * len;
      const holdV = FINALE_ROLL / (c.end - a);
      out.push({ p: a, s: stop.s - 20, v: holdV });
      out.push({ p: c.end, s: stop.s - 20 + FINALE_ROLL, v: holdV });
      continue;
    }
    const a = c.start + ARRIVE * len;
    const l = c.start + LEAVE * len;
    const creep = (HOLD_BEFORE + HOLD_AFTER) / (l - a);
    out.push({ p: a, s: stop.s - HOLD_BEFORE, v: creep });
    out.push({ p: l, s: stop.s + HOLD_AFTER, v: creep });
    holds.push([stop.s - HOLD_BEFORE, stop.s + HOLD_AFTER]);
  }
  return out;
}

const getKeys = () => (keys ??= buildKeys());

/** Route metres at journey progress p. */
export function citySAt(p: number) {
  const k = getKeys();
  if (p <= k[0].p) return k[0].s;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (p > b.p) continue;
    const T = b.p - a.p;
    if (T <= 1e-9) return b.s;
    const u = (p - a.p) / T;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a.s + (u3 - 2 * u2 + u) * a.v * T + (-2 * u3 + 3 * u2) * b.s + (u3 - u2) * b.v * T;
  }
  return k[k.length - 1].s;
}

/** Is route metre s inside a stop's hold (no drifting, the camera frames the billboard)? */
export function inHold(s: number) {
  getKeys();
  for (const [a, b] of holds) if (s >= a - 2 && s <= b + 2) return true;
  return false;
}

/** The stop whose billboard is nearest to s. */
export function nearestStop(s: number): StopId {
  let best: StopId = 'arrival';
  let d = Infinity;
  for (const c of CHAPTERS) {
    if (!c.stop) continue;
    const dd = Math.abs(STOPS[c.stop].s - s);
    if (dd < d) {
      d = dd;
      best = c.stop;
    }
  }
  return best;
}

/* -------------------------------------------------------------- drift profile */

let yawProfile: Float32Array | null = null;
const STEP = 1;

/** The chapter III slide, 0..1 at route metres s. */
export function driftEnvelope(s: number) {
  if (s <= DRIFT.flick || s >= DRIFT.to) return 0;
  if (s < DRIFT.full) return smootherstep(s, DRIFT.flick, DRIFT.full);
  if (s <= DRIFT.hold) return 1;
  return 1 - smootherstep(s, DRIFT.hold, DRIFT.to);
}

/** Signed drift yaw target (radians, + = tail out to the right in a left-hander) every metre. */
function buildYaw() {
  const r = getRoute();
  const n = Math.ceil(r.length / STEP) + 1;
  const raw = new Float32Array(n);
  // after the stops start: small slides where the route bends hard at the speed a steady
  // scroll gives (ds/dp sampled from the mapping)
  const dpds = new Float32Array(n);
  const k = getKeys();
  const first = holds[0]?.[0] ?? DRIFT.to;
  const pFrom = k[0].p;
  const pTo = k[k.length - 1].p;
  const pStep = (pTo - pFrom) / 6000;
  let lastS = citySAt(pFrom);
  for (let p = pFrom + pStep; p <= pTo; p += pStep) {
    const s = citySAt(p);
    const v = (s - lastS) / pStep; // metres per unit progress
    const i0 = Math.max(0, Math.floor(Math.min(s, lastS) / STEP));
    const i1 = Math.min(n - 1, Math.ceil(Math.max(s, lastS) / STEP));
    for (let i = i0; i <= i1; i++) dpds[i] = v;
    lastS = s;
  }
  const peak = degToRad(CONFIG.city.driftYawDeg);
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    if (s < first || s > r.bridgeStart - 20 || inHold(s)) continue;
    const v = (dpds[i] * NOMINAL_SCROLL) / PAGES; // m/s
    const kappa = routeCurvature(s, 5);
    const lat = v * v * Math.abs(kappa);
    raw[i] = Math.sign(kappa) * smoothstep(lat, CONFIG.city.driftFrom, CONFIG.city.driftFull) * peak;
  }
  // build-up and release: average over +-14 m, then a softer pass
  const box = (src: Float32Array, rad: number) => {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      let sum = 0;
      let cnt = 0;
      for (let j = Math.max(0, i - rad); j <= Math.min(src.length - 1, i + rad); j++) {
        sum += src[j];
        cnt++;
      }
      out[i] = sum / cnt;
    }
    return out;
  };
  // (the box filter flattens short peaks: scale back up to the peak, never past it)
  const smooth = box(box(raw, 14), 8);
  let m = 0;
  for (const v of smooth) m = Math.max(m, Math.abs(v));
  const gain = m > 1e-4 ? Math.min(2.2, peak / m) : 1;
  for (let i = 0; i < smooth.length; i++) smooth[i] = clamp(smooth[i] * gain, -peak, peak);
  // the big one: chapter III
  const big = degToRad(CONFIG.drift.yawPeakDeg) * DRIFT.sign;
  for (let i = 0; i < n; i++) {
    const e = driftEnvelope(i * STEP);
    if (e > 0) smooth[i] = big * e;
  }
  return smooth;
}

/** Drift yaw (radians) the car wants at route metres s. */
export function driftYawAt(s: number) {
  yawProfile ??= buildYaw();
  const f = clamp(s / STEP, 0, yawProfile.length - 1);
  const i = Math.floor(f);
  const t = f - i;
  return yawProfile[i] * (1 - t) + yawProfile[Math.min(yawProfile.length - 1, i + 1)] * t;
}

/** 0..1: how hard the car is sliding at s (the camera director never changes shot above ~0.5). */
export const driftAt = (s: number) => Math.abs(driftYawAt(s)) / degToRad(Math.max(1, CONFIG.drift.yawPeakDeg));

/* -------------------------------------------------------------- kinematics */

const _p = new Vector3();
const _l = new Vector3();
const pitchOut = { pitch: 0 };
const WHEELBASE = 2.5;

/**
 * Fills carState from journey progress. Pure kinematics, no physics: the drive is never
 * faster than the journey driver (chapterRuntime) lets progress move.
 */
export function stepCityDrive(p: number, dt: number) {
  const st = carState;
  const d = CONFIG.drift;
  const snap = !st.initialized;
  const prevS = st.s;
  const prevSpeed = st.speed;
  st.s = citySAt(p);
  st.pathHeading = sampleRoute(st.s, st.pathPoint, pitchOut);

  const h0 = sampleRoute(st.s - 1.5, _p);
  const h1 = sampleRoute(st.s + 1.5, _p);
  const curvature = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / 3;
  const geomSteer = Math.atan(WHEELBASE * curvature);

  const damp = (key: 'driftYaw' | 'steer' | 'roll' | 'pitch', target: number, smooth: number) => {
    if (!snap) easing.damp(st, key, target, smooth, dt);
    else st[key] = target;
  };
  damp('driftYaw', driftYawAt(st.s), d.yawSmooth);
  st.slip = clamp(Math.abs(st.driftYaw) / degToRad(Math.max(1, d.slipRefDeg)), 0, 1);
  const slideSign = Math.sign(st.driftYaw) || 1;
  damp('steer', geomSteer * (1 - st.slip) - slideSign * degToRad(d.counterSteerDeg) * st.slip, d.steerSmooth);
  // (the slide's roll; cornering roll comes from the body's springs, src/lib/feel.ts)
  damp('roll', degToRad(d.rollDeg) * slideSign * st.slip, d.rollSmooth);
  damp('pitch', pitchOut.pitch, 0.15);

  // pose: the tail swings out round a point just ahead of the car's centre
  st.heading = st.pathHeading + st.driftYaw;
  leftOf(st.pathHeading, _l);
  st.outward.copy(_l).multiplyScalar(-slideSign);
  st.position.set(
    st.pathPoint.x + d.pivotZ * (Math.sin(st.pathHeading) - Math.sin(st.heading)),
    st.pathPoint.y,
    st.pathPoint.z + d.pivotZ * (Math.cos(st.pathHeading) - Math.cos(st.heading)),
  );
  st.position.addScaledVector(st.outward, d.widen * st.slip);
  forwardOf(st.heading, st.forward);

  // speed, braking and wheels; the rear wheels keep spinning (and smoking) while the car
  // is held sideways, even if the scroll stops mid-drift
  const ds = snap ? 0 : st.s - prevS;
  const safeDt = Math.max(dt, 1e-4);
  easing.damp(st, 'speed', ds / safeDt, 0.15, dt);
  const accel = (st.speed - prevSpeed) / safeDt;
  easing.damp(st, 'accel', accel, 0.25, dt);
  st.brake = Math.max(st.slip, smoothstep(-st.accel, 4, 12));
  st.frontSpinRate = st.speed / st.frontRadius;
  st.rearSpinRate = st.speed / st.rearRadius + st.slip * d.rearSpinBoost;
  st.frontSpin += ds / st.frontRadius;
  st.rearSpin += ds / st.rearRadius + st.slip * d.rearSpinBoost * dt;
  st.initialized = true;
}

export const HOLD = { arrive: ARRIVE, leave: LEAVE, finaleArrive: FINALE_ARRIVE, before: HOLD_BEFORE, after: HOLD_AFTER };
