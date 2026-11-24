import { MathUtils } from 'three';

const { clamp, lerp, smoothstep } = MathUtils;

/**
 * THE POWERTRAIN (what the sound listens to)
 * ==========================================
 * A small model of a sequential six-speed flat-six. Each frame it takes how the car is
 * moving (speed, acceleration, slip, from the scroll) and the visitor's rev input, turns
 * them into a THROTTLE with an attack and a release, picks a GEAR with shift points, and
 * works out the RPM (wheel speed through the gearbox, a clutch slip at a standstill, a
 * flare when the rears spin). The audio (engineAudio.ts) reads `rpm`, `throttle`, `load`
 * and the shift/lift events from here and nothing else: never the scroll or the keys.
 */

const IDLE = 950;
const REDLINE = 8600;
const UPSHIFT = 7700;
const DOWNSHIFT = 3900;
/** Gearbox and final drive (GT3 R-ish), wheel radius in metres. */
const RATIOS = [3.15, 2.27, 1.76, 1.41, 1.17, 0.98];
const FINAL = 3.6;
const WHEEL_R = 0.35;
const SHIFT_TIME = 0.11;

export const powertrain = {
  running: false,
  /** 0..1 while the starter turns and the engine catches. */
  starting: 0,
  rpm: 0,
  gear: 1,
  /** Damped 0..1 (attack/release). */
  throttle: 0,
  /** 0..1, how hard the engine is working (throttle against rpm). */
  load: 0,
  /** Seconds left in the current shift (the throttle is cut). */
  shifting: 0,
  /** Counters: the audio compares them with what it last saw. */
  shifts: 0,
  lifts: 0,
  /** Slip and speed, passed through for the tyres and the wind. */
  slip: 0,
  speed: 0,
};

let startAt = -1;
/** Seconds left of a rev-matching blip (a downshift into a slow zone). */
let blipT = 0;
const BLIP = 0.24;
/** Seconds left of a launch (full throttle out of a slow zone). */
let launchT = 0;

/** Braking into a slow zone: down a gear with a blip of the throttle (the audio hears the flare). */
export function blip() {
  const p = powertrain;
  if (!p.running) return;
  if (p.gear > 1) {
    p.gear--;
    p.shifts++;
  }
  blipT = BLIP;
}

/** Out of a slow zone: full throttle for a moment; the gear changes and the pops follow. */
export function launchBurst() {
  if (powertrain.running) launchT = 0.9;
}
/** A lift counts once the throttle comes off a high point (re-armed when it goes back up). */
let liftArmed = false;

/** The key turns (chapter II): starter, catch, settle to idle. */
export function ignite() {
  startAt = 0;
  powertrain.running = true;
  powertrain.starting = 1;
}

export function stopEngine() {
  powertrain.running = false;
  powertrain.starting = 0;
  startAt = -1;
}

const wheelRpm = (speed: number) => (Math.abs(speed) / (2 * Math.PI * WHEEL_R)) * 60;

export type DriveInput = {
  /** Is the engine running (after the ignition)? */
  engineOn: boolean;
  /** Ground speed m/s and its rate of change m/s^2 (both damped by the car). */
  speed: number;
  accel: number;
  /** 0..1 rear slip (drift) and straight-line wheelspin. */
  slip: number;
  /** 0..1 the visitor holding the throttle (hold to rev). */
  rev: number;
};

/** Advances the model by dt. */
export function stepPowertrain(input: DriveInput, dt: number) {
  const p = powertrain;
  if (!input.engineOn && !p.starting) {
    p.running = false;
    easeTo(p, 'rpm', 0, 0.25, dt);
    p.throttle = 0;
    p.load = 0;
    return;
  }
  p.running = true;
  p.speed = Math.abs(input.speed);
  p.slip = input.slip;

  // throttle demand: from how the car is accelerating, plus the visitor's rev
  const moving = p.speed > 1.2;
  let demand = moving ? clamp(0.32 + input.accel / 7, 0, 1) : 0.05;
  if (input.accel < -1.5) demand = 0.02; // braking: off the throttle
  demand = Math.max(demand, input.slip * 0.9, input.rev, launchT > 0 ? 1 : 0, blipT > 0 ? 0.85 : 0);
  if (p.shifting > 0) demand = 0.05; // the shift cuts the throttle
  launchT = Math.max(0, launchT - dt);
  // attack is quick, the release a little slower
  const tau = demand > p.throttle ? 0.07 : 0.22;
  p.throttle += (demand - p.throttle) * (1 - Math.exp(-dt / tau));
  if (p.throttle > 0.72) liftArmed = true;
  if (liftArmed && p.throttle < 0.32 && p.shifting <= 0) {
    liftArmed = false;
    if (p.rpm > 3200) p.lifts++;
  }

  // gear: up at the shift point, down when the revs fall away
  const inGear = (g: number) => wheelRpm(p.speed) * RATIOS[g - 1] * FINAL;
  if (p.shifting > 0) p.shifting -= dt;
  else if (p.gear < RATIOS.length && inGear(p.gear) > UPSHIFT) {
    p.gear++;
    p.shifting = SHIFT_TIME;
    p.shifts++;
  } else if (p.gear > 1 && inGear(p.gear) < DOWNSHIFT && inGear(p.gear - 1) < UPSHIFT - 600) {
    p.gear--;
    p.shifts++;
  }
  if (!moving) p.gear = 1;

  // rpm: through the gearbox when rolling, the clutch slips near a standstill, the
  // throttle lifts it, wheelspin flares it
  const geared = inGear(p.gear);
  const free = IDLE + p.throttle * 6400;
  const clutch = smoothstep(p.speed, 1, 6);
  let target = lerp(free, Math.max(IDLE, geared), clutch);
  target += p.slip * 1600 * clutch;
  // the blip: the revs flare to meet the lower gear
  if (blipT > 0) {
    target += 1900 * Math.sin((Math.PI * (BLIP - blipT)) / BLIP);
    blipT = Math.max(0, blipT - dt);
  }
  target = clamp(target, IDLE * 0.9, REDLINE);

  // the starter: cranking, the catch, then idle
  if (p.starting > 0) {
    startAt += dt;
    if (startAt < 0.45) target = 240 + Math.sin(startAt * 60) * 30;
    else if (startAt < 0.7) target = 1900;
    p.starting = startAt < 1.6 ? 1 : 0;
  }
  // a shift drops the revs quickly, they climb a little slower
  easeTo(p, 'rpm', target, target > p.rpm ? 0.06 : p.shifting > 0 ? 0.035 : 0.12, dt);
  p.load = clamp(p.throttle * (0.6 + 0.4 * (p.rpm / REDLINE)), 0, 1);
}

function easeTo<K extends 'rpm'>(o: Record<K, number>, k: K, to: number, tau: number, dt: number) {
  o[k] += (to - o[k]) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
}

export const POWERTRAIN = { IDLE, REDLINE, UPSHIFT, DOWNSHIFT, RATIOS, FINAL };
