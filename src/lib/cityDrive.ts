import { MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { type StopId } from './chapters';
import { getRoute, routeCurvature, sampleRoute, STOPS } from './cityRoute';
import { CONFIG } from './config';
import { carState, forwardOf, leftOf } from './motion';
import { DRIFT, DRIFT2, DRIFTS, journeySeconds, PARK_S, sAtTime, speedAtS, timeAtProgress, ZONES, zoneAtS } from './pacing';
import { fitContacts, hasRoad, makeContact } from './ground';

/** The car's last fit to the road under its wheels (src/lib/ground.ts): the HUD and the wheels read it. */
export const carContact = makeContact();
/** Did the last fit find road under the car (false before the city loads: the route line then)? */
export const contactState = { ok: false };

export { DRIFT, DRIFT2, PARK_S };

const { clamp, degToRad, smootherstep, smoothstep } = MathUtils;

/**
 * THE DRIVE
 * =========
 * Journey progress -> metres along the route: progress is time (src/lib/pacing.ts), and
 * the route metre is the integral of the planned speed curve. Parked under the title, the
 * launch, a fast run with the drift through the plaza, then four slow zones (each a stop's
 * billboard, rolled past at walking pace) with fast runs between, and the bridge.
 *
 * The drift angle is a function of position (an explicit slide on the first run; small
 * ones where the route bends hard at the planned speed after it), so the slides always
 * happen at the same corners and the camera knows where they are.
 */

/** Route metres at journey progress p. */
export function citySAt(p: number) {
  return sAtTime(timeAtProgress(p));
}

/** Is route metre s inside a stop's slow zone (no drifting, the camera frames the billboard)? */
export function inHold(s: number) {
  return zoneAtS(s, 2) !== null;
}

/** The stop whose billboard is nearest to s (the four zones, then the bridge). */
export function nearestStop(s: number): StopId {
  let best: StopId = ZONES[0].id;
  let d = Infinity;
  for (const z of ZONES) {
    const dd = Math.abs(z.board - s);
    if (dd < d) {
      d = dd;
      best = z.id;
    }
  }
  if (Math.abs(STOPS.finale.s - s) < d) best = 'finale';
  return best;
}

/* -------------------------------------------------------------- drift profile */

let yawProfile: Float32Array | null = null;
const STEP = 1;

/** A slide's build-up, hold and release, 0..1 at route metres s. */
function envelopeOf(d: (typeof DRIFTS)[number], s: number) {
  if (s <= d.flick || s >= d.to) return 0;
  if (s < d.full) return smootherstep(s, d.flick, d.full);
  if (s <= d.hold) return 1;
  return 1 - smootherstep(s, d.hold, d.to);
}

/** The big slides (round the north-east corner, and the U-turn), 0..1 at route metres s. */
export function driftEnvelope(s: number) {
  let e = 0;
  for (const d of DRIFTS) e = Math.max(e, envelopeOf(d, s));
  return e;
}

/** Is route metre s on one of the big slides (from its cinema bars to its end)? */
export const onDrift = (s: number) => DRIFTS.some((d) => s >= d.from && s <= d.to + 20);

/** Signed drift yaw target (radians, + = tail out to the right in a left-hander) every metre. */
function buildYaw() {
  const r = getRoute();
  const n = Math.ceil(r.length / STEP) + 1;
  const raw = new Float32Array(n);
  // after the drift: small slides where the route bends hard at the planned speed
  const peak = degToRad(CONFIG.city.driftYawDeg);
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    if (s < DRIFT.to + 10 || s > r.bridgeStart - 20 || inHold(s) || (s > DRIFT2.from - 10 && s < DRIFT2.to + 10)) continue;
    const v = speedAtS(s); // m/s
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
  // the big ones: round the north-east corner, and the U-turn
  const big = degToRad(CONFIG.drift.yawPeakDeg);
  for (let i = 0; i < n; i++)
    for (const d of DRIFTS) {
      const e = envelopeOf(d, i * STEP);
      if (e > 0) smooth[i] = big * d.sign * e;
    }
  return fitToRoad(smooth);
}

/** Half the car's footprint (m): across and along. */
const HALF_W = 0.98;
const HALF_L = 2.32;
/** How close the car's outline may come to the edge of the street (m). */
const EDGE = 0.3;

/**
 * Lateral reach of the car's outline (left positive) at yaw y, from the slide's pose: the
 * tail swings round a pivot ahead of the centre and the whole car slides out with the slip.
 */
function reach(y: number) {
  const d = CONFIG.drift;
  const slip = clamp(Math.abs(y) / degToRad(Math.max(1, d.slipRefDeg)), 0, 1);
  const centre = -d.pivotZ * Math.sin(y) - (Math.sign(y) || 1) * d.widen * slip;
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of [-HALF_W, HALF_W])
    for (const b of [-HALF_L, HALF_L]) {
      const lat = centre + a * Math.cos(y) + b * Math.sin(y);
      lo = Math.min(lo, lat);
      hi = Math.max(hi, lat);
    }
  return [lo, hi];
}

/**
 * Keeps every slide inside the street: where the car's outline would reach past the road's
 * edge (getRoute().room) the yaw is trimmed until it fits, and the trim eases in and out over
 * a few metres so the slide doesn't twitch. Without it the tail swung over the kerb islands
 * and off the road's edge after the plaza, where the street narrows to 2-3.5 m outside.
 */
function fitToRoad(yaw: Float32Array) {
  const r = getRoute();
  const n = yaw.length;
  const k = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const y0 = yaw[i];
    if (Math.abs(y0) < 1e-3) continue;
    const [roomL, roomR] = r.room(i * STEP);
    let f = 1;
    for (let it = 0; it < 30; it++) {
      const [lo, hi] = reach(y0 * f);
      if (lo >= -(roomR - EDGE) && hi <= roomL - EDGE) break;
      f *= 0.94;
    }
    k[i] = Math.max(0.15, f);
  }
  // ease the trim: the tightest within +-8 m, then softened
  const rad = Math.round(8 / STEP);
  const tight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let j = Math.max(0, i - rad); j <= Math.min(n - 1, i + rad); j++) m = Math.min(m, k[j]);
    tight[i] = m;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - rad); j <= Math.min(n - 1, i + rad); j++) {
      sum += tight[j];
      cnt++;
    }
    out[i] = yaw[i] * Math.min(k[i], sum / cnt);
  }
  return out;
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
let lastJourneyT = 0;

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

  // the slide is damped in journey time, not real time: it takes the same shape at any
  // playback rate (at 4x through a glide it lagged a quarter as far behind the car's place on
  // the route, and a wheel swung off the road)
  const tNow = p * journeySeconds();
  const jdt = snap ? 0 : Math.min(Math.abs(tNow - lastJourneyT), 0.25);
  lastJourneyT = tNow;
  const damp = (key: 'driftYaw' | 'steer' | 'roll' | 'pitch', target: number, smooth: number) => {
    if (!snap) easing.damp(st, key, target, smooth, jdt);
    else st[key] = target;
  };
  damp('driftYaw', driftYawAt(st.s), d.yawSmooth);
  st.slip = clamp(Math.abs(st.driftYaw) / degToRad(Math.max(1, d.slipRefDeg)), 0, 1);
  const slideSign = Math.sign(st.driftYaw) || 1;
  damp('steer', geomSteer * (1 - st.slip) - slideSign * degToRad(d.counterSteerDeg) * st.slip, d.steerSmooth);
  // (the slide's roll; cornering roll comes from the body's springs, src/lib/feel.ts)
  damp('roll', degToRad(d.rollDeg) * slideSign * st.slip, d.rollSmooth);

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

  // height, pitch and roll: fitted to the road under the four wheels, not the smoothed
  // route line (that only until the city's road is in)
  contactState.ok = hasRoad() && fitContacts(st.position.x, st.position.z, st.heading, st.pathPoint.y, carContact);
  if (contactState.ok) {
    st.position.y = carContact.y;
    st.pitch = carContact.pitch;
    st.groundRoll = carContact.roll;
  } else {
    damp('pitch', pitchOut.pitch, 0.15);
    st.groundRoll = 0;
  }

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

