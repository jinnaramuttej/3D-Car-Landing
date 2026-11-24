import { MathUtils, Vector3 } from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { routeCurvature } from './cityRoute';
import { CONFIG } from './config';
import { carState, forwardOf, leftOf } from './motion';
import { blip, launchBurst, powertrain } from './powertrain';
import { ZONES, zoneSpan } from './pacing';
import { onWarmupEnd } from './warmup';

/**
 * How the drive feels, on top of where the car and the camera are (CONFIG.feel):
 *
 *   body    the body on its springs over the wheels: pitch from the car's acceleration
 *           (squat under power, dive on the brakes), roll from cornering, heave over crests,
 *           dips and the road's texture. A spring-damper per axis, a little under-damped.
 *   follow  the camera's spring-damped follow: an offset that the car's acceleration pushes
 *           (it falls back as the car pulls away, swings out in a corner) and a spring pulls
 *           home. Car-relative rigs carry it; rigs standing in the street don't.
 *   trauma  0..1, raised by hard acceleration and braking, slides, gear changes, bumps and
 *           exhaust pops, and decaying over time. The camera shakes by trauma squared
 *           through layered simplex noise (a small position and roll offset).
 *   pops    the exhaust flash, fired on the same powertrain events the audio pops on (a lift
 *           from high revs, an upshift), never on the scroll.
 *
 * Every step is allocation-free; Car.tsx steps the body and the pops, CameraRig the rest.
 */
export const feel = {
  pitch: 0,
  pitchV: 0,
  roll: 0,
  rollV: 0,
  heave: 0,
  heaveV: 0,
  trauma: 0,
  /** Shake amount this frame: trauma². */
  shake: 0,
  /** The follow's offset (world, metres) and its speed. */
  lag: new Vector3(),
  lagV: new Vector3(),
  /** Exhaust flash 0..1 (decays fast, flickers). */
  pop: 0,
  /** The launch burst out of a slow zone, 1 -> 0 over CONFIG.feel.launchSeconds: the lens kicks wider, the frame streaks. */
  kick: 0,
  /** Seconds until each queued pop fires (a lift fires two or three in a ripple). */
  popQueue: [-1, -1, -1],
  /** What the body and the pops last saw. */
  seen: { shifts: 0, lifts: 0, pitch: 0, init: false },
};

const noise = new SimplexNoise();

/** Layered simplex noise in -1..1 on channel `ch` at time t (three octaves). */
export function shakeNoise(t: number, ch: number) {
  const y = ch * 17.3;
  return noise.noise(t, y) * 0.6 + noise.noise(t * 2.1 + 3.7, y) * 0.3 + noise.noise(t * 4.3 + 7.1, y) * 0.1;
}

type Axis = 'pitch' | 'roll' | 'heave';
const VEL = { pitch: 'pitchV', roll: 'rollV', heave: 'heaveV' } as const;

/** One semi-implicit step of a body axis's damped spring toward `target` (natural frequency hz). */
function spring(axis: Axis, target: number, hz: number, zeta: number, dt: number) {
  const w = 2 * Math.PI * hz;
  const v = VEL[axis];
  feel[v] += (w * w * (target - feel[axis]) - 2 * zeta * w * feel[v]) * dt;
  feel[axis] += feel[v] * dt;
}

/** Lateral acceleration (m/s², positive to the left) from the speed and the road's bend (per frame). */
let lateral = 0;

let lastS = -1;

/**
 * The slow zones' edges, driving forward: braking in, a downshift with a blip; launching
 * out, full throttle (the gear changes and the pops follow from the powertrain), a spike
 * of trauma, the lens kicking wider and the frame streaking for a moment.
 */
function stepLaunch(dt: number) {
  const f = CONFIG.feel;
  const s = carState.s;
  if (lastS >= 0 && s > lastS && s - lastS < 8) {
    for (const z of ZONES) {
      const [a, b] = zoneSpan(z);
      if (lastS < a && s >= a) blip();
      if (lastS < b && s >= b) {
        launchBurst();
        feel.kick = 1;
        feel.trauma = Math.min(1, feel.trauma + f.launchTrauma);
      }
    }
  }
  lastS = s;
  feel.kick = Math.max(0, feel.kick - dt / Math.max(0.1, f.launchSeconds));
}

/** The body on its springs, and the exhaust pops. Call once per frame, after the drive. */
export function stepBody(dt: number) {
  const f = CONFIG.feel;
  const s = carState;
  stepLaunch(dt);
  if (!feel.seen.init) {
    feel.seen.shifts = powertrain.shifts;
    feel.seen.lifts = powertrain.lifts;
    feel.seen.pitch = s.pitch;
    feel.seen.init = true;
  }
  // (a couple of sub-steps keep the springs stable at low frame rates)
  const n = dt > 1 / 45 ? 2 : 1;
  const h = dt / n;
  // vertical acceleration over a crest or a dip: speed times how fast the road pitch turns
  const pitchRate = dt > 1e-4 ? (s.pitch - feel.seen.pitch) / dt : 0;
  feel.seen.pitch = s.pitch;
  const vert = MathUtils.clamp(s.speed * pitchRate, -12, 12);
  // road texture at speed, as small kicks to the heave
  const bump = noise.noise(s.s * 0.9, 41.7) * f.bumps * MathUtils.smoothstep(Math.abs(s.speed), 4, 40);
  lateral = s.speed * s.speed * routeCurvature(s.s) * (1 - s.slip);
  const zeta = f.bodyDamping;
  for (let i = 0; i < n; i++) {
    // (targets capped: a jump across the page drives far harder than any real car)
    spring('pitch', MathUtils.clamp(-s.accel * f.pitchPerAccel, -0.026, 0.026), f.bodyHz, zeta, h);
    spring('roll', MathUtils.clamp(lateral * f.rollPerAccel, -0.03, 0.03), f.bodyHz * 0.9, zeta, h);
    spring('heave', MathUtils.clamp(-vert * f.heavePerAccel, -0.025, 0.025) + bump, f.bodyHz * 1.3, zeta, h);
  }
  // (a teleport, the warm-up or a hitch can kick the springs: keep them sane)
  feel.pitch = MathUtils.clamp(feel.pitch, -0.06, 0.06);
  feel.roll = MathUtils.clamp(feel.roll, -0.06, 0.06);
  feel.heave = MathUtils.clamp(feel.heave, -0.06, 0.06);

  // exhaust pops: the same events the audio pops on (engineAudio.ts), above 3000 rpm
  const p = powertrain;
  if (p.lifts !== feel.seen.lifts || p.shifts !== feel.seen.shifts) {
    const lift = p.lifts !== feel.seen.lifts;
    feel.seen.shifts = p.shifts;
    feel.seen.lifts = p.lifts;
    if (p.running && p.rpm > 3000) {
      const count = lift ? 2 + Math.floor(Math.random() * 2) : 1;
      for (let k = 0; k < count; k++) feel.popQueue[k] = k * (0.05 + Math.random() * 0.06);
    }
  }
  for (let k = 0; k < feel.popQueue.length; k++) {
    if (feel.popQueue[k] < 0) continue;
    feel.popQueue[k] -= dt;
    if (feel.popQueue[k] < 0) {
      feel.popQueue[k] = -1;
      feel.pop = 0.7 + Math.random() * 0.3;
      feel.trauma = Math.min(1, feel.trauma + f.traumaPop);
    }
  }
  feel.pop = Math.max(0, feel.pop - dt / 0.09);
}

const _f = new Vector3();
const _l = new Vector3();
const _a = new Vector3();
let lastShifts = -1;

/** Trauma and the follow. Call once per frame from the camera, after stepBody. */
export function stepCamera(dt: number) {
  const f = CONFIG.feel;
  const s = carState;
  // trauma: rises with hard acceleration and braking, slides, gear changes and bumps
  let add = f.traumaAccel * MathUtils.smoothstep(Math.abs(s.accel), 3, 14) + f.traumaSlip * s.slip;
  add += f.traumaBump * Math.min(2, Math.abs(feel.heaveV) * 10);
  feel.trauma += add * dt;
  if (lastShifts < 0) lastShifts = powertrain.shifts;
  if (powertrain.shifts !== lastShifts) {
    lastShifts = powertrain.shifts;
    if (Math.abs(s.speed) > 3) feel.trauma += f.traumaShift;
  }
  feel.trauma = MathUtils.clamp(feel.trauma - f.traumaDecay * dt, 0, 1);
  feel.shake = feel.trauma * feel.trauma;

  // the follow: the car's acceleration (along and across) pushes the offset, a spring
  // pulls it home
  forwardOf(s.pathHeading, _f);
  leftOf(s.pathHeading, _l);
  _a.copy(_f).multiplyScalar(-s.accel).addScaledVector(_l, -lateral);
  const w = 2 * Math.PI * f.followHz;
  const zeta = f.followDamping;
  const n = dt > 1 / 45 ? 2 : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    feel.lagV.x += (_a.x - w * w * feel.lag.x - 2 * zeta * w * feel.lagV.x) * h;
    feel.lagV.z += (_a.z - w * w * feel.lag.z - 2 * zeta * w * feel.lagV.z) * h;
    feel.lag.x += feel.lagV.x * h;
    feel.lag.z += feel.lagV.z * h;
  }
  const len = feel.lag.length();
  if (len > f.followMax) {
    feel.lag.multiplyScalar(f.followMax / len);
    feel.lagV.multiplyScalar(0.5);
  }
}

/** After the warm-up drive behind the loader: settle everything at rest. */
export function resetFeel() {
  feel.pitch = feel.pitchV = feel.roll = feel.rollV = feel.heave = feel.heaveV = 0;
  feel.trauma = feel.shake = feel.pop = feel.kick = 0;
  lastS = -1;
  feel.lag.set(0, 0, 0);
  feel.lagV.set(0, 0, 0);
  feel.popQueue.fill(-1);
  feel.seen.init = false;
  lastShifts = -1;
}

onWarmupEnd(resetFeel);
