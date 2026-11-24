import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { CHAPTERS, IGNITION } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { DRIFT, nearestStop, PARK_S } from '@/lib/cityDrive';
import { type ZoneId, zoneAtS, zoneById, zoneProgress, zoneSpan, ZONES } from '@/lib/pacing';
import { getRoute, routeCurvature, sampleRoute, STOPS } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { feel } from '@/lib/feel';
import { carState, forwardOf, leftOf } from '@/lib/motion';
import { stopAnchor } from '@/lib/stops';
import { onWarmupEnd } from '@/lib/warmup';
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
 *   opening  I-III: a slow push on the parked car and along its left flank to the headlight as it
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

export type RigId = 'opening' | 'wake' | 'stop' | 'chase' | 'launch' | 'wheel' | 'hood' | 'sidepan' | 'drone';
export type DriveRig = 'chase' | 'launch' | 'wheel' | 'hood' | 'sidepan' | 'drone';
export const DRIVE_RIGS: DriveRig[] = ['chase', 'launch', 'wheel', 'hood', 'sidepan', 'drone'];

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


/**
 * The runs between stops are short bursts (4-5 s): low, long-lens rigs that sell the speed
 * (the launch chase, the wheel camera). The bridge gets the wide ones.
 */
const RUN_RIGS: DriveRig[] = ['launch', 'wheel', 'launch', 'chase'];

/** One rig per run out of a stop (two on a long one), then the bridge. */
function buildSchedule(): Cue[] {
  const route = getRoute();
  const out: Cue[] = [];
  for (let k = 0; k < ZONES.length; k++) {
    const a = zoneSpan(ZONES[k])[1] + 1;
    const b = k + 1 < ZONES.length ? zoneSpan(ZONES[k + 1])[0] - 8 : route.bridgeStart - 10;
    out.push({ s: a, rig: RUN_RIGS[k % RUN_RIGS.length], side: k % 2 ? -1 : 1 });
    if (b - a > 70) out.push({ s: a + (b - a) / 2, rig: 'chase', side: k % 2 ? 1 : -1 });
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
  const sch = getSchedule();
  let cue: Cue = sch[0];
  for (const c of sch) {
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
/** The intro while parked, keyed to journey progress: the car is still, the camera moves. */
function getParkedKeys(): Key[] {
  return (parkedKeys ??= [
    // up the street past the parked car to the Catalyst billboard, rain in the lamps
    { at: 0, pos: [-3.3, 1.05, -9.4], look: [1.2, 4.4, 10], fov: 34 },
    { at: IGNITION.at * 0.4, pos: [-1.2, 0.95, -7.0], look: [0.6, 2.4, 6], fov: 32 },
    // round behind it, in on the rear three-quarter and along the left flank (the open
    // side of this street: a barrier lines the right)...
    { at: IGNITION.at * 0.8, pos: [2.75, 0.74, -3.5], look: [0.25, 0.62, 0.2], fov: 31 },
    { at: IGNITION.at * 0.96, pos: [2.95, 0.62, 0.7], look: [0.7, 0.6, 1.7], fov: 30 },
    // ...to the left headlight as the engine catches
    { at: IGNITION.at + (IGNITION.driveAt - IGNITION.at) * 0.3, pos: [2.4, 0.64, 4.4], look: [0.58, 0.64, 1.95], fov: 30 },
    { at: IGNITION.driveAt, pos: [2.2, 0.6, 7.8], look: [0.3, 0.6, 1.6], fov: 31 },
  ]);
}

/** From the pull-away through the drift, keyed to route metres: a camera car riding ahead. */
const RUN_KEYS: Key[] = [
  { at: PARK_S, pos: [2.2, 0.6, 7.8], look: [0.3, 0.6, 1.6], fov: 31 },
  { at: 128, pos: [2.0, 0.52, 9.5], look: [0, 0.56, 1.4], fov: 31 },
  { at: 146, pos: [-1.6, 0.5, 10.5], look: [0.2, 0.55, 1.2], fov: 30 },
  { at: 164, pos: [-2.8, 0.55, 10.5], look: [0.3, 0.6, 1.2], fov: 30 },
  // the plaza is wide open: swing out for the flick (the camera is ~6 m ahead, still in it)
  { at: 178, pos: [-6.0, 0.8, 6.0], look: [0, 0.6, 0.6], fov: 31 },
  // past it the right side closes in: back across to the left
  { at: 192, pos: [3.0, 2.1, 9.5], look: [0, 0.5, 0.6], fov: 32 },
  // down the long left-hander on a long lens, the car coming at it sideways
  { at: 206, pos: [-1.5, 0.75, 12.5], look: [0, 0.6, 0.6], fov: 32 },
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
  const u = smoothstep(carState.s, DRIFT.hold + 14, zoneSpan(ZONES[0])[0] - 14);
  const back = lerp(17, 9.5, u);
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
    case 'launch':
      // low and well back on a long lens: the road rushes under it, the car squats and goes
      car(0.9 * side, 0.55, -11, out.pos);
      car(0, 0.7, 6, out.look);
      out.fov = 26;
      out.dof = 1;
      out.focusRange = 6;
      out.focus.copy(carState.position).setY(carState.position.y + 0.6);
      out.shake = 1.2;
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

/** The finale's camera place (worked out once: the bridge never changes). */
type StopPlace = { pos: Vector3; fov: number; shift: number; lean: number };
let finalePlace: StopPlace | null = null;

/** A throwaway lens to test framings with (16:9, as the page is designed). */
const probe = new PerspectiveCamera(30, 16 / 9, 0.1, 3000);
const _pr = new Vector3();
const _lk = new Vector3();
const _bf = new Vector3();
const _cb = Array.from({ length: 8 }, () => new Vector3());

/** Where the look aims on the board: its lower middle (the top may crop), or its centre (`drop` 0). */
function boardFocus(a: ReturnType<typeof stopAnchor>, out: Vector3, drop = 0.25) {
  return out.copy(a.centre).setY(a.centre.y - a.height * drop);
}

/** The look for a stop: from the car toward the board, then nudged so the group sits right of the panel. */
function stopLook(cam: Vector3, car: Vector3, a: ReturnType<typeof stopAnchor>, lean: number, fov: number, shift: number, out: Vector3, drop = 0.25) {
  out.copy(car).lerp(boardFocus(a, _bf, drop), lean);
  _c.subVectors(out, cam);
  const dist = _c.length();
  _d.crossVectors(_c, _b.set(0, 1, 0)).normalize();
  const halfW = Math.tan(MathUtils.degToRad(fov) / 2) * (16 / 9);
  return out.addScaledVector(_d, -dist * halfW * shift);
}

/** Is the whole car (as it is now) in frame and clear of the panel's column, from cam looking at look? */
function carInFrame(cam: Vector3, look: Vector3, fov: number) {
  forwardOf(carState.heading, _f);
  leftOf(carState.heading, _l);
  let k = 0;
  for (let iz = 0; iz < 2; iz++)
    for (let ix = 0; ix < 2; ix++)
      for (let iy = 0; iy < 2; iy++)
        _cb[k++]
          .copy(carState.position)
          .addScaledVector(_f, iz ? 2.35 : -2.35)
          .addScaledVector(_l, ix ? 1 : -1)
          .setY(carState.position.y + (iy ? 1.3 : 0.05));
  probe.position.copy(cam);
  probe.fov = fov;
  probe.updateProjectionMatrix();
  probe.lookAt(look);
  probe.updateMatrixWorld();
  for (const c of _cb) {
    _pr.copy(c).project(probe);
    if (_pr.z > 1 || _pr.x < -0.3 || _pr.x > 0.94 || _pr.y < -0.9 || _pr.y > 0.9) return false;
  }
  return true;
}

/**
 * The finale's board is high on a pylon and the car rolls to a stop under it: a camera back
 * down the deck, the look halfway between the car and the board, the lens opened (or the
 * camera backed off) until both fit.
 */
function pylonPlace(stop: ReturnType<typeof nearestStop>, a: ReturnType<typeof stopAnchor>): StopPlace {
  const spec = STOPS[stop];
  const r = getRoute();
  const pos = new Vector3();
  const carAt = new Vector3();
  sampleRoute(spec.s, carAt);
  carAt.y += 0.7;
  let back = 15;
  const put = () => {
    const at = spec.s - back;
    const h = sampleRoute(at, pos);
    leftOf(h, _l);
    const opposite = r.room(at)[spec.side === 1 ? 1 : 0];
    pos.addScaledVector(_l, -spec.side * Math.min(opposite * 0.55, 3.2)).setY(pos.y + 1.45);
  };
  const need = () => {
    _c.copy(carAt).lerp(a.centre, 0.5).sub(pos).normalize();
    let worst = 0;
    for (const q of [carAt, _b.copy(a.centre), _d.copy(a.centre).setY(a.centre.y - a.height / 2)]) {
      _pr.copy(q).sub(pos).normalize();
      worst = Math.max(worst, Math.acos(clamp(_pr.dot(_c), -1, 1)));
    }
    return MathUtils.radToDeg(worst) * 2 * 1.3;
  };
  put();
  let fov = need();
  for (let i = 0; i < 2 && fov > CONFIG.camera.fovMax; i++) {
    back += 7;
    put();
    fov = need();
  }
  return { pos, fov: clamp(fov, 30, CONFIG.camera.fovMax), shift: 0.28, lean: 0.5 };
}

/** The finale: the car rolls to a stop under the far pylon, its board above. */
function finaleRig(out: Pose) {
  const a = stopAnchor('finale');
  finalePlace ??= pylonPlace('finale', a);
  const place = finalePlace;
  out.pos.copy(place.pos);
  _a.copy(carState.position).setY(carState.position.y + 0.7);
  stopLook(out.pos, _a, a, place.lean, place.fov, place.shift, out.look, 0);
  out.fov = place.fov;
  out.focus.copy(_a).lerp(a.centre, 0.35);
  out.dof = 2.2;
  out.focusRange = 14;
  out.handheld = 0.25;
  out.shake = 0;
  out.nearFade[0] = 0.35;
  out.nearFade[1] = 2;
}

/** The zone shot's lean toward the board, eased (the most the car allows changes every frame). */
const zoneLook = { lean: 0, at: 0, key: '' };

/**
 * A stop's slow zone (src/lib/pacing.ts), keyed to the zone's progress p (0 -> 1 as the car
 * rolls past the billboard): low on the far side of the road, trailing the car on a side
 * three-quarter (12 m back, easing out to 15.5 m), so the car stays a steady size while it
 * rolls at walking pace. The camera rides forward with it, a slow push-in toward the
 * billboard: the look leans across to the board as the details come up (as far as keeps
 * the whole car in frame and right of the panel), and the focus pulls from the car to the
 * board and back; by 0.85 it is on the car again for the launch.
 */
function zoneRig(id: ZoneId, out: Pose) {
  const z = zoneById(id);
  const a = stopAnchor(id);
  const spec = STOPS[id];
  const u = clamp(zoneProgress(z, carState.s), 0, 1);
  const back = lerp(12, 15.5, smoothstep(u, 0, 0.9));
  const camS = carState.s - back;
  const h = sampleRoute(camS, out.pos);
  leftOf(h, _l);
  const room = getRoute().room(camS)[spec.side === 1 ? 1 : 0];
  const lateral = -spec.side * clamp(room - 1.1, 1, 3.5);
  out.pos.addScaledVector(_l, lateral).setY(out.pos.y + lerp(0.7, 1.25, smoothstep(u, 0.1, 0.6)));
  // the boards hang ~20 m off the road: the lens opens while the look leans across to
  // one, so the board fits beside the car (and closes again for the launch)
  const want = 0.75 * smoothstep(u, 0.15, 0.5) * (1 - smoothstep(u, 0.72, 0.92));
  const fov = lerp(30, 37, want / 0.75);
  _a.copy(carState.position).setY(carState.position.y + 0.65);
  // the most lean the car allows (bisection), wanted lean by p, eased in real time
  let lo = 0;
  let hi = want;
  if (!carInFrame(out.pos, stopLook(out.pos, _a, a, hi, fov, 0.2, _lk), fov)) {
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (carInFrame(out.pos, stopLook(out.pos, _a, a, mid, fov, 0.2, _lk), fov)) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  const now = performance.now();
  if (zoneLook.key !== id) {
    zoneLook.key = id;
    zoneLook.lean = hi;
  } else zoneLook.lean = MathUtils.damp(zoneLook.lean, hi, 2.5, Math.min(0.1, (now - zoneLook.at) / 1000));
  zoneLook.at = now;
  stopLook(out.pos, _a, a, zoneLook.lean, fov, 0.2, out.look);
  out.fov = fov;
  // focus: the car, pulling to the billboard as the details come up, back for the launch
  const pull = smoothstep(u, 0.25, 0.6) * (1 - smoothstep(u, 0.78, 0.95));
  out.focus.copy(_a).lerp(a.centre, pull);
  out.dof = 2.6;
  out.focusRange = lerp(4, 9, pull);
  out.handheld = 0.3;
  out.shake = 0.35;
  out.nearFade[0] = 0.35;
  out.nearFade[1] = 2;
}

/** At a stop: a zone's rolling shot, or the finale's place on the bridge. */
function stopRig(stop: ReturnType<typeof nearestStop>, out: Pose) {
  if (stop === 'finale') finaleRig(out);
  else zoneRig(stop, out);
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
  // a slow zone (from a few metres before it, so the camera has settled as the title lands)
  const zone = zoneAtS(s + 8, 0) ?? zoneAtS(s, 2);
  if (zone && speed < 20) return { shot: shot('stop', 1, zone.id), force: true };
  if (stop === 'finale' && speed < 20 && Math.abs(s - spec.s) < 60) return { shot: shot('stop', 1, stop), force: true };
  if (s < zoneSpan(ZONES[0])[0] - 14) return { shot: shot('wake', 1, 'iv'), force: false };
  if (speed > FAST) return { shot: shot('chase', 1, 'fast'), force: false };
  const cue = scheduledAt(s);
  return { shot: shot(cue.rig, cue.side, cue.s.toFixed(0)), force: false };
}

/**
 * How much each rig rides the camera's spring-damped follow (feel.ts): a chase hangs off
 * the car on a soft mount, a hood camera is bolted to it, a camera standing in the street
 * doesn't follow at all.
 */
const FOLLOW: Record<RigId, number> = { opening: 0.6, wake: 1, stop: 0, chase: 1, launch: 1, wheel: 0.5, hood: 0, sidepan: 0, drone: 0.7 };

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
  /** How much of the follow's lag the camera carries (eased per rig, see FOLLOW). */
  follow: 0,
  lastNow: 0,
  over: false,
  out: makePose(),
  a: makePose(),
  b: makePose(),
};

// after the warm-up drive (behind the loader): start fresh where the page is, no blend
onWarmupEnd(() => {
  state.init = false;
  director.manual = null;
  director.panKey = '';
});

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
    // a stop's camera stands still in the street: once the car pulls away, follow it at once
    const leaving = st.current.rig === 'stop';
    // (the opening is one continuous move: anything after it waits for the slide to end)
    if (!peak && (force || leaving || !held)) startBlend(want, now);
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
  const dt = Math.min(0.1, Math.max(0, (now - st.lastNow) / 1000));
  st.lastNow = now;
  st.follow = MathUtils.damp(st.follow, FOLLOW[rig], 3, dt);
  out.pos.copy(o.pos).addScaledVector(feel.lag, st.follow);
  // never under the road: rigs are set relative to the car, and the streets climb (15% by
  // the parked car), so check the road at the camera's own place along the route
  forwardOf(carState.pathHeading, _f);
  const along = carState.s + _d.subVectors(out.pos, carState.pathPoint).dot(_f);
  const hAlong = sampleRoute(along, _c);
  if (out.pos.y < _c.y + 0.32) out.pos.y = _c.y + 0.32;
  // and inside the street: a rig set relative to the car can land beside the road where
  // it narrows ahead (only near the ground: a drone above the roofs is fine)
  if (rig !== 'stop' && rig !== 'sidepan' && out.pos.y - _c.y < 5 && along < getRoute().bridgeStart) {
    leftOf(hAlong, _l);
    const lat = _d.subVectors(out.pos, _c).dot(_l);
    const [roomL, roomR] = getRoute().room(along);
    const max = Math.max(0.6, roomL - 0.5);
    const min = -Math.max(0.6, roomR - 0.5);
    if (lat > max || lat < min) out.pos.addScaledVector(_l, clamp(lat, min, max) - lat);
  }
  out.look.copy(o.look);
  const kick = smoothstep(speed, 8, 60) * CONFIG.feel.fovKick + smoothstep(carState.accel, 2, 12) * CONFIG.feel.fovKickAccel;
  out.fov = driving ? clamp(o.fov + kick, CONFIG.camera.fovMin, CONFIG.camera.fovMax) : o.fov;
  out.focus.copy(o.focus);
  out.dof = o.dof;
  out.focusRange = o.focusRange;
  out.handheld = o.handheld;
  out.nearFade[0] = o.nearFade[0];
  out.nearFade[1] = o.nearFade[1];
  // trauma (feel.ts): shake = trauma squared, times how much this rig shakes at all
  out.shake = feel.shake * o.shake;
  out.id = st.current.id;
  return out;
}
