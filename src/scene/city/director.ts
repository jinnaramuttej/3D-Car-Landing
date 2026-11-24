import { MathUtils, Vector3 } from 'three';
import { chapterAt, CHAPTERS, IGNITION } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { DRIFT, inHold, nearestStop, PARK_S } from '@/lib/cityDrive';
import { getRoute, routeCurvature, sampleRoute, STOPS } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { carState, forwardOf, leftOf } from '@/lib/motion';
import { stopAnchor } from '@/lib/stops';
import { bridgeInfo } from './Bridge';
import type { CityShot } from './cityCamera';

const { clamp, lerp, smoothstep, smootherstep } = MathUtils;

/**
 * THE CAMERA DIRECTOR
 * ===================
 * One camera for the whole page, made of RIGS (each a pose that follows the car, or a place
 * in the world it looks from) and BLENDS between them. There are no cuts: when the director
 * changes rig, the camera travels from where it is to the new rig over 1.2-2 s, eased,
 * round the car (or over it, where the street is too narrow to go round), while both rigs
 * keep tracking the car. It never changes rig while the car is near the peak of a slide.
 *
 *   opening  I-III: a slow push on the parked car and along its flank to the headlight as it
 *            wakes (keyed to the scroll), then a camera car riding ahead of it as it pulls
 *            away and slides through the plaza and down the long left-hander (keyed to route
 *            metres)
 *   wake     IV: trailing well back, low, so the camera drives through the smoke the drift
 *            left hanging in the street, closing up as it thins
 *   stop     at each stop: the billboard and the car, both in frame, from back down the road
 *   chase    behind and above                         \
 *   wheel    low on the flank by a front wheel          |  between the stops and over the
 *   hood     on the bonnet, looking down the road       |  bridge, one per drive (C or the
 *   sidepan  a fixed camera at the roadside ahead       |  navbar button steps through them)
 *   drone    high and wide                             /
 *
 * Speed widens the lens a little (inside 24-40 degrees), changes of speed shake it.
 */

export type RigId = 'opening' | 'wake' | 'stop' | 'chase' | 'wheel' | 'hood' | 'sidepan' | 'drone';
export type DriveRig = 'chase' | 'wheel' | 'hood' | 'sidepan' | 'drone';
export const DRIVE_RIGS: DriveRig[] = ['chase', 'wheel', 'hood', 'sidepan', 'drone'];

type Shot = { rig: RigId; side: 1 | -1; key: string; id: string };

/** Seconds a picked rig lasts after the last press of C. */
const MANUAL_HOLD = 6;
/** Seconds a scheduled rig is kept at least (so a fast drive doesn't flick between rigs). */
const MIN_HOLD = 2.4;
/** Above this speed (m/s) between the stops the director stays on the chase rig. */
const FAST = 48;

export const director = {
  /** Manual override: the picked rig and when it was picked (performance.now() ms). */
  manual: null as DriveRig | null,
  manualAt: 0,
  manualSide: 1 as 1 | -1,
  /** Current shot (for the HUD), and how far the blend into it has got (1 = settled). */
  current: '',
  blend: 1,
  /** Seconds the current shot has been settled (the layout waits for this at a stop). */
  settled: 0,
  /** World position of the side-pan camera, fixed when its shot starts. */
  panPos: new Vector3(),
  panKey: '',
};

/** Step to the next drive rig (C key, navbar button). */
export function cycleShot() {
  const at = director.manual ?? (director.current.split(':')[0] as DriveRig);
  const i = DRIVE_RIGS.indexOf(at as DriveRig);
  director.manual = DRIVE_RIGS[(i + 1 + DRIVE_RIGS.length) % DRIVE_RIGS.length];
  director.manualAt = performance.now();
  director.manualSide = director.manualSide === 1 ? -1 : 1;
}

/* ---------------------------------------------------------------- schedule */

type Cue = { s: number; rig: DriveRig; side: 1 | -1 };
let schedule: Cue[] | null = null;

const ORDER: DriveRig[] = ['chase', 'wheel', 'drone', 'hood', 'sidepan', 'chase', 'drone'];

/** One rig per drive between two stops (two on a long one), then the bridge. */
function buildSchedule(): Cue[] {
  const route = getRoute();
  const out: Cue[] = [];
  const holds = CHAPTERS.filter((c) => c.stop && c.stop !== 'finale').map((c) => STOPS[c.stop!].s);
  for (let k = 0; k < holds.length; k++) {
    const a = holds[k] + 8;
    const b = k + 1 < holds.length ? holds[k + 1] - 10 : route.bridgeStart - 10;
    out.push({ s: a, rig: ORDER[k % ORDER.length], side: k % 2 ? -1 : 1 });
    if (b - a > 70) out.push({ s: a + (b - a) / 2, rig: ORDER[(k + 3) % ORDER.length], side: k % 2 ? 1 : -1 });
  }
  // over the water: the drone shows the bridge and the sea, then a pan past the first pylon
  const pyl = bridgeInfo.pylons[0] ?? route.bridgeStart + 240;
  out.push({ s: route.bridgeStart + 30, rig: 'drone', side: 1 });
  out.push({ s: pyl - 70, rig: 'sidepan', side: -1 });
  out.push({ s: pyl + 30, rig: 'wheel', side: 1 });
  out.push({ s: pyl + 110, rig: 'drone', side: -1 });
  return out.sort((x, y) => x.s - y.s);
}

/** Exposed for the debug HUD and the docs: where the scheduled rigs start. */
export function getSchedule() {
  return (schedule ??= buildSchedule());
}

function scheduledAt(s: number): Cue {
  let cue: Cue = { s: 0, rig: 'chase', side: 1 };
  for (const c of getSchedule()) {
    if (c.s > s) break;
    cue = c;
  }
  return cue;
}

/* ------------------------------------------------------------------- poses */

type Pose = {
  pos: Vector3;
  look: Vector3;
  fov: number;
  focus: Vector3;
  dof: number;
  focusRange: number;
  /** Slow hand-held float, 0..1. */
  handheld: number;
  /** How much the slide shakes this rig, 0..1. */
  shake: number;
  /** Smoke puffs fade between these camera distances. */
  nearFade: [number, number];
};
const makePose = (): Pose => ({ pos: new Vector3(), look: new Vector3(), fov: 34, focus: new Vector3(), dof: 0, focusRange: 4, handheld: 0, shake: 0, nearFade: [0.35, 2] });

function copyPose(a: Pose, out: Pose) {
  out.pos.copy(a.pos);
  out.look.copy(a.look);
  out.fov = a.fov;
  out.focus.copy(a.focus);
  out.dof = a.dof;
  out.focusRange = a.focusRange;
  out.handheld = a.handheld;
  out.shake = a.shake;
  out.nearFade[0] = a.nearFade[0];
  out.nearFade[1] = a.nearFade[1];
  return out;
}

const _f = new Vector3();
const _l = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

/** Car frame to world: x left, y up, z forward; `body` turns with the slide, else with the road. */
function car(x: number, y: number, z: number, out: Vector3, body = false) {
  const h = body ? carState.heading : carState.pathHeading;
  forwardOf(h, _f);
  leftOf(h, _l);
  return out.copy(carState.position).addScaledVector(_l, x).addScaledVector(_f, z).setY(carState.position.y + y);
}

/** The frame blends happen in: the route under the car, facing down it. */
function toLocal(w: Vector3, out: Vector3) {
  forwardOf(carState.pathHeading, _f);
  leftOf(carState.pathHeading, _l);
  _d.copy(w).sub(carState.pathPoint);
  return out.set(_d.dot(_l), w.y - carState.pathPoint.y, _d.dot(_f));
}
function toWorld(v: Vector3, out: Vector3) {
  forwardOf(carState.pathHeading, _f);
  leftOf(carState.pathHeading, _l);
  return out.copy(carState.pathPoint).addScaledVector(_l, v.x).addScaledVector(_f, v.z).setY(carState.pathPoint.y + v.y);
}

/* ------------------------------------------------------------- keyed moves */

type V3 = readonly [number, number, number];
type Key = { at: number; pos: V3; look: V3; fov: number };

/** Cubic Hermite through keys (Catmull-Rom tangents), so a move never stops at a key. */
function sampleKeys(keys: Key[], t: number, pos: Vector3, look: Vector3) {
  const n = keys.length;
  if (t <= keys[0].at) {
    pos.set(...keys[0].pos);
    look.set(...keys[0].look);
    return keys[0].fov;
  }
  if (t >= keys[n - 1].at) {
    pos.set(...keys[n - 1].pos);
    look.set(...keys[n - 1].look);
    return keys[n - 1].fov;
  }
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].at) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const span = k2.at - k1.at;
  const u = clamp((t - k1.at) / span, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const ch = (get: (k: Key) => number) => {
    const m1 = k0 === k1 ? (get(k2) - get(k1)) / span : (get(k2) - get(k0)) / (k2.at - k0.at);
    const m2 = k3 === k2 ? (get(k2) - get(k1)) / span : (get(k3) - get(k1)) / (k3.at - k1.at);
    return h00 * get(k1) + h10 * span * m1 + h01 * get(k2) + h11 * span * m2;
  };
  pos.set(ch((k) => k.pos[0]), ch((k) => k.pos[1]), ch((k) => k.pos[2]));
  look.set(ch((k) => k.look[0]), ch((k) => k.look[1]), ch((k) => k.look[2]));
  return ch((k) => k.fov);
}

let parkedKeys: Key[] | null = null;
/** I and the start of II, keyed to journey progress: the car is parked, the camera moves. */
function getParkedKeys(): Key[] {
  return (parkedKeys ??= [
    // up the street past the parked car to the Catalyst billboard, rain in the lamps
    { at: chapterAt('stillness', 0), pos: [-3.3, 1.2, -9.4], look: [0.7, 1.7, 8], fov: 34 },
    { at: chapterAt('stillness', 0.5), pos: [-2.95, 0.95, -6.6], look: [0.45, 1.15, 4], fov: 32 },
    // in on the rear three-quarter and along the right flank...
    { at: chapterAt('stillness', 0.94), pos: [-2.75, 0.74, -3.5], look: [-0.25, 0.62, 0.2], fov: 31 },
    { at: chapterAt('ignition', 0.06), pos: [-2.95, 0.62, 0.7], look: [-0.7, 0.6, 1.7], fov: 30 },
    // ...to the right headlight as the engine catches
    { at: chapterAt('ignition', IGNITION.at + 0.05), pos: [-2.4, 0.64, 4.4], look: [-0.58, 0.64, 1.95], fov: 30 },
    { at: chapterAt('ignition', IGNITION.driveAt), pos: [-2.2, 0.6, 7.8], look: [-0.3, 0.6, 1.6], fov: 31 },
  ]);
}

/** II (from the pull-away) and III, keyed to route metres: a camera car riding ahead. */
const RUN_KEYS: Key[] = [
  { at: PARK_S, pos: [-2.2, 0.6, 7.8], look: [-0.3, 0.6, 1.6], fov: 31 },
  { at: 128, pos: [-2.0, 0.52, 9.5], look: [0, 0.56, 1.4], fov: 31 },
  { at: 146, pos: [-1.6, 0.5, 10.5], look: [0.2, 0.55, 1.2], fov: 30 },
  { at: 164, pos: [-2.8, 0.55, 10.5], look: [0.3, 0.6, 1.2], fov: 30 },
  // the plaza is wide open: swing out for the flick
  { at: 184, pos: [-8.5, 0.8, 7.5], look: [0, 0.6, 0.6], fov: 31 },
  // down the long left-hander on a long lens, the car coming at it sideways
  { at: 206, pos: [-2.2, 0.75, 12.5], look: [0, 0.6, 0.6], fov: 32 },
  { at: 250, pos: [-1.2, 1.1, 13.5], look: [0, 0.65, 0.4], fov: 34 },
  { at: 300, pos: [2.4, 0.9, 11.0], look: [0, 0.62, 0.2], fov: 33 },
  { at: 345, pos: [1.2, 1.6, 15.5], look: [0, 0.7, 0], fov: 32 },
  { at: DRIFT.to, pos: [0.6, 2.2, 17], look: [0, 0.8, 0], fov: 32 },
];

function openingRig(out: Pose) {
  const p = chapterState.progress;
  const parked = getParkedKeys();
  const local = _a;
  const look = _b;
  const fov = p < parked[parked.length - 1].at ? sampleKeys(parked, p, local, look) : sampleKeys(RUN_KEYS, carState.s, local, look);
  car(local.x, local.y, local.z, out.pos);
  car(look.x, look.y, look.z, out.look);
  out.fov = fov;
  out.focus.copy(carState.position).setY(carState.position.y + 0.6);
  const moving = smoothstep(carState.s, PARK_S + 2, PARK_S + 30);
  out.dof = lerp(2, 1.4, moving);
  out.focusRange = lerp(2.4, 5, moving);
  out.handheld = lerp(0.5, 0.35, moving);
  out.shake = 1;
  out.nearFade[0] = 0.35;
  out.nearFade[1] = 2;
}

/** IV: trailing well back on the road itself, through the smoke, closing up as it thins. */
function wakeRig(out: Pose) {
  const u = smoothstep(carState.s, DRIFT.hold + 14, STOPS.arrival.s - 14);
  const back = lerp(24, 9.5, u);
  const at = carState.s - back;
  const h = sampleRoute(at, out.pos);
  leftOf(h, _l);
  // keep to the outside of the bend between camera and car, so the inside kerb (or the
  // ramp wall) never comes between them
  const k = routeCurvature(carState.s - back / 2, 4);
  const bend = clamp(Math.abs(k) * 60, 0, 1);
  const room = getRoute().room(at)[k > 0 ? 1 : 0];
  const lateral = -Math.sign(k) * bend * Math.min(1.6, Math.max(0, room - 0.8));
  out.pos.addScaledVector(_l, lateral).setY(out.pos.y + lerp(1.25, 1.9, u) + bend * 0.8);
  car(0, 0.8, 4, out.look);
  out.fov = lerp(30, 34, u);
  out.focus.copy(carState.position).setY(carState.position.y + 0.6);
  out.dof = 1.2;
  out.focusRange = 6;
  out.handheld = 0.6;
  out.shake = 0.4;
  out.nearFade[0] = 0.25;
  out.nearFade[1] = 1.6;
}

function driveRig(rig: DriveRig, side: 1 | -1, key: string, out: Pose) {
  out.focus.copy(carState.position).setY(carState.position.y + 0.6);
  out.handheld = 0;
  out.shake = 1;
  out.nearFade[0] = 0.35;
  out.nearFade[1] = 2;
  switch (rig) {
    case 'chase':
      car(0, 2.05, -7.4, out.pos);
      car(0, 1.05, 8, out.look);
      out.fov = 36;
      out.dof = 0.6;
      out.focusRange = 5;
      break;
    case 'wheel':
      // bolted low by the front wheel on the outside, looking back down the flank
      car(1.32 * side, 0.34, 2.15, out.pos, true);
      car(0.86 * side, 0.42, -3, out.look, true);
      out.fov = 31;
      out.dof = 2.4;
      out.focusRange = 1.6;
      out.focus.copy(out.look);
      out.shake = 0.5;
      break;
    case 'hood':
      car(0, 1.06, 0.95, out.pos, true);
      car(0, 0.95, 30, out.look, true);
      out.fov = 38;
      out.dof = 0;
      out.focusRange = 10;
      out.focus.copy(out.look);
      out.shake = 0.5;
      break;
    case 'sidepan': {
      // a fixed camera at the roadside ahead, set where the shot starts
      if (director.panKey !== key) {
        director.panKey = key;
        const r = getRoute();
        const s = Math.min(carState.s + 30, r.length - 5);
        const h = sampleRoute(s, director.panPos);
        leftOf(h, _l);
        const room = r.room(s)[side === 1 ? 0 : 1];
        director.panPos.addScaledVector(_l, side * clamp(room - 0.8, 3, 9)).setY(director.panPos.y + 1.15);
      }
      out.pos.copy(director.panPos);
      out.look.copy(carState.position).setY(carState.position.y + 0.7);
      out.fov = 32;
      out.dof = 1.6;
      out.focusRange = 4;
      break;
    }
    case 'drone': {
      // in the city the street is a canyon: stay over the road (the route knows how wide it
      // is); over the water swing out wide to show the bridge and the sea
      const r = getRoute();
      const overSea = carState.s > r.bridgeStart + 20;
      const room = r.room(carState.s)[side === 1 ? 0 : 1];
      const lateral = overSea ? 34 : clamp(room - 1.5, 0, 6);
      car(lateral * side, overSea ? 14 : 17, overSea ? -10 : -17, out.pos);
      car(0, 1, overSea ? 18 : 12, out.look);
      out.fov = 34;
      out.dof = 0.4;
      out.focusRange = 12;
      break;
    }
  }
}

/** Where each stop's camera stands (fixed per stop, so it never jumps as the car creeps). */
const stopPlaces = new Map<string, { pos: Vector3; fov: number }>();

/**
 * At a stop: the billboard and the car, both in frame. A rear three-quarter from back down
 * the road (never into the headlights), on the far half of it, low; the look sits between
 * the two and the lens opens (or the camera backs off) until both fit.
 */
function stopRig(stop: ReturnType<typeof nearestStop>, out: Pose) {
  const spec = STOPS[stop];
  const a = stopAnchor(stop);
  let place = stopPlaces.get(stop);
  if (!place || !a.placed) {
    const r = getRoute();
    const pos = new Vector3();
    const carAt = new Vector3();
    sampleRoute(spec.s, carAt);
    carAt.y += 0.7;
    // start close (the car big in frame) and back off only as far as the billboard needs
    let back = 15;
    const put = () => {
      const at = spec.s - back;
      const h = sampleRoute(at, pos);
      leftOf(h, _l);
      const opposite = r.room(at)[spec.side === 1 ? 1 : 0];
      pos.addScaledVector(_l, -spec.side * Math.min(opposite * 0.55, 3.2)).setY(pos.y + 1.45);
    };
    // angular spread of billboard + car seen from the camera -> the lens that fits both
    const need = () => {
      _c.copy(carAt).lerp(a.centre, 0.5).sub(pos).normalize();
      let worst = 0;
      for (const p of [carAt, _b.copy(a.centre).setY(a.centre.y + a.height / 2), _d.copy(a.centre).setY(a.centre.y - a.height / 2)]) {
        const d = p.clone().sub(pos).normalize();
        worst = Math.max(worst, Math.acos(clamp(d.dot(_c), -1, 1)));
      }
      return MathUtils.radToDeg(worst) * 2 * 1.25;
    };
    put();
    let fov = need();
    for (let i = 0; i < 6 && fov > CONFIG.camera.fovMax; i++) {
      back += 7;
      put();
      fov = need();
    }
    place = { pos, fov: clamp(fov, 30, CONFIG.camera.fovMax) };
    if (a.placed) stopPlaces.set(stop, place);
  }
  out.pos.copy(place.pos);
  _a.copy(carState.position).setY(carState.position.y + 0.7);
  out.look.copy(_a).lerp(a.centre, 0.5);
  out.fov = place.fov;
  out.focus.copy(a.centre);
  out.dof = 2.2;
  out.focusRange = 9;
  out.handheld = 0.25;
  out.shake = 0;
  out.nearFade[0] = 0.35;
  out.nearFade[1] = 2;
}

function evalShot(shot: Shot, out: Pose) {
  switch (shot.rig) {
    case 'opening':
      return openingRig(out);
    case 'wake':
      return wakeRig(out);
    case 'stop':
      return stopRig(shot.key as ReturnType<typeof nearestStop>, out);
    default:
      return driveRig(shot.rig, shot.side, shot.key, out);
  }
}

/* --------------------------------------------------------------- selection */

const shot = (rig: RigId, side: 1 | -1, key: string): Shot => ({ rig, side, key, id: `${rig}:${key}` });

/** The shot the director wants for this frame (before the hold and slide rules). */
function wanted(now: number): { shot: Shot; force: boolean } {
  const s = carState.s;
  const speed = Math.abs(carState.speed);
  const manual = director.manual && now - director.manualAt < MANUAL_HOLD * 1000 ? director.manual : null;
  if (!manual) director.manual = null;
  if (manual) return { shot: shot(manual, director.manualSide, `m${director.manualAt}`), force: true };

  const wakeFrom = DRIFT.hold + 14;
  if (s < wakeFrom) return { shot: shot('opening', 1, 'run'), force: false };
  // at a stop (and the bridge stop at the end), unless driving through it fast
  const stop = nearestStop(s);
  const spec = STOPS[stop];
  const atStop = speed < 20 && Math.abs(s - spec.s) < (stop === 'finale' ? 60 : 24) && (inHold(s) || stop === 'finale');
  if (atStop) return { shot: shot('stop', 1, stop), force: true };
  if (s < STOPS.arrival.s - 14) return { shot: shot('wake', 1, 'iv'), force: false };
  if (speed > FAST) return { shot: shot('chase', 1, 'fast'), force: false };
  const cue = scheduledAt(s);
  return { shot: shot(cue.rig, cue.side, cue.s.toFixed(0)), force: false };
}

/* -------------------------------------------------------------- the blend */

const state = {
  init: false,
  current: shot('opening', 1, 'run'),
  since: 0,
  /** The blend: from a live shot, or from a frozen pose (car-local) if a blend was cut short. */
  blendFrom: null as Shot | null,
  frozen: makePose(),
  frozenLocal: true,
  blendStart: 0,
  blendDur: 1.6,
  over: false,
  out: makePose(),
  a: makePose(),
  b: makePose(),
};

const _la = new Vector3();
const _lb = new Vector3();
const _lo = new Vector3();

/** a -> b by w, in the route frame under the car: round the car, or over it. */
function mix(a: Pose, b: Pose, w: number, over: boolean, out: Pose) {
  toLocal(a.pos, _la);
  toLocal(b.pos, _lb);
  if (over) {
    // a crane move over the car (front <-> back in a narrow street)
    _lo.lerpVectors(_la, _lb, w);
    const lift = Math.max(0, 3.4 - Math.min(_la.y, _lb.y)) + 0.08 * Math.abs(_la.z - _lb.z);
    _lo.y += Math.sin(Math.PI * w) * lift;
  } else {
    const azA = Math.atan2(_la.x, _la.z);
    const azB = Math.atan2(_lb.x, _lb.z);
    const dAz = Math.atan2(Math.sin(azB - azA), Math.cos(azB - azA));
    const az = azA + dAz * w;
    const r = lerp(Math.hypot(_la.x, _la.z), Math.hypot(_lb.x, _lb.z), w);
    _lo.set(Math.sin(az) * r, lerp(_la.y, _lb.y, w), Math.cos(az) * r);
  }
  // stay inside the street while travelling between two rigs
  const [roomL, roomR] = getRoute().room(carState.s);
  if (w > 0 && w < 1) _lo.x = clamp(_lo.x, -Math.max(roomR - 0.6, 0.5), Math.max(roomL - 0.6, 0.5));
  toWorld(_lo, out.pos);
  toLocal(a.look, _la);
  toLocal(b.look, _lb);
  toWorld(_la.lerp(_lb, w), out.look);
  out.fov = lerp(a.fov, b.fov, w);
  out.focus.lerpVectors(a.focus, b.focus, w);
  out.dof = lerp(a.dof, b.dof, w);
  out.focusRange = lerp(a.focusRange, b.focusRange, w);
  out.handheld = lerp(a.handheld, b.handheld, w);
  out.shake = lerp(a.shake, b.shake, w);
  out.nearFade[0] = lerp(a.nearFade[0], b.nearFade[0], w);
  out.nearFade[1] = lerp(a.nearFade[1], b.nearFade[1], w);
  return out;
}

function startBlend(next: Shot, now: number) {
  const st = state;
  const midBlend = st.blendFrom !== null || now - st.blendStart < st.blendDur * 1000;
  if (midBlend) {
    // freeze where the camera is now, relative to the car, and travel on from there
    copyPose(st.out, st.frozen);
    toLocal(st.out.pos, st.frozen.pos);
    toLocal(st.out.look, st.frozen.look);
    st.frozenLocal = true;
    st.blendFrom = null;
  } else st.blendFrom = st.current;
  // longer for a bigger move: 1.2 s for a nudge, 2 s round to the other side
  evalShot(next, st.b);
  const from = midBlend ? null : st.blendFrom;
  if (from) evalShot(from, st.a);
  else {
    copyPose(st.frozen, st.a);
    toWorld(st.frozen.pos, st.a.pos);
    toWorld(st.frozen.look, st.a.look);
  }
  toLocal(st.a.pos, _la);
  toLocal(st.b.pos, _lb);
  const dAz = Math.abs(Math.atan2(Math.sin(Math.atan2(_lb.x, _lb.z) - Math.atan2(_la.x, _la.z)), Math.cos(Math.atan2(_lb.x, _lb.z) - Math.atan2(_la.x, _la.z))));
  const room = getRoute().room(carState.s);
  st.over = dAz > 1.3 && Math.min(room[0], room[1]) < 7;
  st.blendDur = lerp(CONFIG.director.blendMin, CONFIG.director.blendMax, clamp(dAz / Math.PI + _la.distanceTo(_lb) / 40, 0, 1));
  st.blendStart = now;
  st.current = next;
  st.since = now;
}

/**
 * The camera for this frame: world pose, lens, focus, shake. Call once per frame.
 */
export function directShot(out: CityShot) {
  const st = state;
  const now = performance.now();
  const { shot: want, force } = wanted(now);
  if (!st.init) {
    st.current = want;
    st.since = now;
    st.blendStart = now - 1e6;
    st.blendFrom = null;
    st.init = true;
  } else if (want.id !== st.current.id) {
    const peak = carState.slip > 0.5;
    const held = now - st.since < MIN_HOLD * 1000;
    // (the opening is one continuous move: anything after it waits for the slide to end)
    if (!peak && (force || !held)) startBlend(want, now);
  }

  // evaluate: the current rig, blended in from the previous one
  evalShot(st.current, st.b);
  const w = clamp((now - st.blendStart) / (st.blendDur * 1000), 0, 1);
  if (w < 1) {
    if (st.blendFrom) evalShot(st.blendFrom, st.a);
    else {
      copyPose(st.frozen, st.a);
      toWorld(st.frozen.pos, st.a.pos);
      toWorld(st.frozen.look, st.a.look);
    }
    mix(st.a, st.b, smootherstep(w, 0, 1), st.over, st.out);
  } else {
    st.blendFrom = null;
    copyPose(st.b, st.out);
  }
  const o = st.out;
  director.current = st.current.id;
  director.blend = w;
  director.settled = w < 1 ? 0 : (now - st.blendStart) / 1000 - st.blendDur;

  // speed opens the lens a little, changes of speed and slides shake it
  const speed = Math.abs(carState.speed);
  const rig = st.current.rig;
  const driving = rig !== 'stop';
  out.pos.copy(o.pos);
  out.look.copy(o.look);
  out.fov = driving ? clamp(o.fov + smoothstep(speed, 8, 60) * 4, CONFIG.camera.fovMin, CONFIG.camera.fovMax) : o.fov;
  out.focus.copy(o.focus);
  out.dof = o.dof;
  out.focusRange = o.focusRange;
  out.handheld = o.handheld;
  out.nearFade[0] = o.nearFade[0];
  out.nearFade[1] = o.nearFade[1];
  out.shake = (smoothstep(Math.abs(carState.accel), 2, 14) * 0.05 + carState.slip * CONFIG.camera.shakePeak) * o.shake;
  out.id = st.current.id;
  return out;
}
