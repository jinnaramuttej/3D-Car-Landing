import { MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { CHAPTERS, chapterById, PAGES, stageSwitchAt, type StopId } from './chapters';
import { getRoute, routeCurvature, sampleRoute, STOPS } from './cityRoute';
import { CONFIG } from './config';
import { carState, forwardOf, leftOf } from './motion';

const { clamp, degToRad, smoothstep } = MathUtils;

/**
 * THE CITY DRIVE
 * ==============
 * Scroll -> metres along the city route. Each stop chapter holds the car near its
 * billboard (it creeps past it, engine ticking over) through the middle of the chapter
 * and drives on to the next stop across the chapter boundary:
 *
 *   chapter k:   arrive ......... hold (creep past the billboard) ......... leave
 *                0     ARRIVE                                    LEAVE       1
 *
 * Between a LEAVE and the next ARRIVE the distance follows a cubic Hermite with the creep
 * speed at both ends, so the car pulls away, runs hard and brakes into the next stop at
 * any scroll speed, with no step in speed. The drift angle is a function of position
 * (precomputed from the route's curvature and the speed a steady scroll would give), so
 * the slides always happen at the same corners and the camera knows where they are.
 */

const ARRIVE = 0.22;
const LEAVE = 0.72;
/** Metres the car creeps through a stop (before / after the billboard). */
const HOLD_BEFORE = 10;
const HOLD_AFTER = 8;
/** The bridge stop: arrive later, roll on to the end. */
const FINALE_ARRIVE = 0.5;
const FINALE_ROLL = 34;
/** A steady scroll, pages per second, for the drift profile. */
const NOMINAL_SCROLL = 0.45;

type Key = { p: number; s: number; v: number };

let keys: Key[] | null = null;

function buildKeys(): Key[] {
  const out: Key[] = [];
  // the drive begins in the cloud with the car already moving
  out.push({ p: stageSwitchAt(), s: 0, v: NaN });
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
    const a = c.start + ((stop as { arrive?: number }).arrive ?? ARRIVE) * len;
    const l = c.start + LEAVE * len;
    const creep = (HOLD_BEFORE + HOLD_AFTER) / (l - a);
    out.push({ p: a, s: stop.s - HOLD_BEFORE, v: creep });
    out.push({ p: l, s: stop.s + HOLD_AFTER, v: creep });
  }
  // the entry leg: already at speed as the cloud thins
  const first = out[0];
  const next = out[1];
  first.v = ((next.s - first.s) / (next.p - first.p)) * 1.3;
  return out;
}

const getKeys = () => (keys ??= buildKeys());

/** Route metres at global progress p (0 before the stage switch). */
export function citySAt(p: number) {
  const k = getKeys();
  if (p <= k[0].p) return 0;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (p > b.p) continue;
    const T = b.p - a.p;
    const u = (p - a.p) / T;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a.s + (u3 - 2 * u2 + u) * a.v * T + (-2 * u3 + 3 * u2) * b.s + (u3 - u2) * b.v * T;
  }
  return k[k.length - 1].s;
}

/** Is route metre s inside a stop's hold (no drifting, no cuts)? */
export function inHold(s: number) {
  const k = getKeys();
  for (let i = 1; i < k.length - 1; i += 2) if (s >= k[i].s - 2 && s <= k[i + 1].s + 2) return true;
  return false;
}

/** The stop whose hold is nearest to s. */
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

/** Signed drift yaw target (radians, + = tail out to the right in a left-hander) every metre. */
function buildYaw() {
  const r = getRoute();
  const n = Math.ceil(r.length / STEP) + 1;
  const raw = new Float32Array(n);
  // nominal speed: ds/dp at each metre (sampled from the mapping), times a steady scroll
  const dpds = new Float32Array(n);
  const k = getKeys();
  const pStep = (k[k.length - 1].p - k[0].p) / 4000;
  let lastS = 0;
  for (let p = k[0].p; p <= k[k.length - 1].p; p += pStep) {
    const s = citySAt(p);
    const v = (s - lastS) / pStep; // metres per unit progress
    const i0 = Math.max(0, Math.floor(lastS / STEP));
    const i1 = Math.min(n - 1, Math.ceil(s / STEP));
    for (let i = i0; i <= i1; i++) dpds[i] = v;
    lastS = s;
  }
  const peak = degToRad(CONFIG.city.driftYawDeg);
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    if (s > r.bridgeStart - 20 || inHold(s)) continue;
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
  for (let i = 0; i < smooth.length; i++) smooth[i] = MathUtils.clamp(smooth[i] * gain, -peak, peak);
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

/** 0..1: how hard the car is sliding at s (for the camera director: no cuts above ~0.5). */
export const driftAt = (s: number) => Math.abs(driftYawAt(s)) / degToRad(Math.max(1, CONFIG.city.driftYawDeg));

/* -------------------------------------------------------------- kinematics */

const _p = new Vector3();
const _l = new Vector3();
const pitchOut = { pitch: 0 };
const WHEELBASE = 2.5;

/** City counterpart of stepDrive (motion.ts): fills carState from route metres. */
export function stepCityDrive(p: number, dt: number, snap: boolean) {
  const st = carState;
  const d = CONFIG.drift;
  const targetS = citySAt(p);
  const prevS = st.s;
  const prevSpeed = st.speed;
  st.s = targetS;
  st.burnout = 0;
  st.pathHeading = sampleRoute(st.s, st.pathPoint, pitchOut);

  const h0 = sampleRoute(st.s - 1.5, _p);
  const h1 = sampleRoute(st.s + 1.5, _p);
  const curvature = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / 3;
  const geomSteer = Math.atan(WHEELBASE * curvature);

  const damp = (key: 'driftYaw' | 'steer' | 'roll' | 'pitch', target: number, smooth: number) => {
    if (st.initialized && !snap) easing.damp(st, key, target, smooth, dt);
    else st[key] = target;
  };
  damp('driftYaw', driftYawAt(st.s), d.yawSmooth);
  st.slip = clamp(Math.abs(st.driftYaw) / degToRad(Math.max(1, d.slipRefDeg)), 0, 1);
  const slideSign = Math.sign(st.driftYaw) || 1;
  const cornerSign = Math.sign(curvature);
  damp('steer', geomSteer * (1 - st.slip) - slideSign * degToRad(d.counterSteerDeg) * st.slip, d.steerSmooth);
  const turnLoad = clamp(Math.abs(curvature) * 25, 0, 1) * 0.35;
  damp('roll', degToRad(d.rollDeg) * (slideSign * st.slip + cornerSign * turnLoad * (1 - st.slip)), d.rollSmooth);
  damp('pitch', pitchOut.pitch, 0.15);

  // pose: same tail swing as the drift scene
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

  // speed, braking and wheels
  const ds = st.initialized && !snap ? st.s - prevS : 0;
  const safeDt = Math.max(dt, 1e-4);
  easing.damp(st, 'speed', ds / safeDt, 0.15, dt);
  const accel = (st.speed - prevSpeed) / safeDt;
  easing.damp(st, 'accel', accel, 0.25, dt);
  st.brake = Math.max(st.slip, smoothstep(-st.accel, 4, 12));
  st.frontSpinRate = st.speed / st.frontRadius;
  st.rearSpinRate = st.speed / st.rearRadius + st.slip * d.rearSpinBoost;
  st.frontSpin += ds / st.frontRadius;
  st.rearSpin += ds / st.rearRadius + st.slip * d.rearSpinBoost * dt;
  st.progress = 1; // past the drift scene: the smoke treats the city like chapter IV on
  st.initialized = true;
}

/** Global progress at a fraction of a chapter. */
export const chapterAt = (id: Parameters<typeof chapterById>[0], f: number) => {
  const c = chapterById(id);
  return c.start + f * (c.end - c.start);
};

export const HOLD = { arrive: ARRIVE, leave: LEAVE, finaleArrive: FINALE_ARRIVE };
