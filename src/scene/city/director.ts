import { MathUtils, Vector3 } from 'three';
import { CHAPTERS, chapterById, stageSwitchAt } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { driftAt, HOLD, inHold, nearestStop } from '@/lib/cityDrive';
import { getRoute, sampleRoute, STOPS } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { carState, forwardOf, leftOf } from '@/lib/motion';
import { stopAnchor } from '@/lib/stops';
import { bridgeInfo } from './Bridge';
import type { CityShot } from './cityCamera';

const { clamp, smoothstep } = MathUtils;

/**
 * THE CAMERA DIRECTOR (chapters V on)
 * ===================================
 * Racing-game coverage of the drive, cut like a broadcast:
 *
 *   chase    behind and above, trailing the car through the corners
 *   wheel    low on the flank by a front wheel, looking back down the side
 *   hood     on the bonnet, looking down the road
 *   sidepan  a fixed camera at the roadside ahead; it pans as the car goes by
 *   drone    high and wide, floating after the car (the city, the sea, the bridge)
 *
 * The SCHEDULE cuts between them at set route metres on every drive between two stops
 * (a different order each time), and never while the car is near the peak of a slide:
 * a cut that lands on one moves to the nearest calm spot, or is dropped. At each stop the
 * director holds a framed shot of the billboard and the car (both kept in frame), and the
 * drive starts with the descent out of the cloud.
 *
 * Speed widens the lens a little (inside 24-40 degrees), changes of speed shake it.
 * Hold C (or the navbar camera button) to step through the drive shots by hand; the
 * schedule takes over again a few seconds after the last press.
 */

export type ShotType = 'chase' | 'wheel' | 'hood' | 'sidepan' | 'drone';
export const SHOT_TYPES: ShotType[] = ['chase', 'wheel', 'hood', 'sidepan', 'drone'];

type Cut = { s: number; type: ShotType; side: 1 | -1 };

const MANUAL_HOLD = 6; // seconds the manual pick lasts after the last press

export const director = {
  /** Manual override: the picked shot and when it was picked (performance.now() ms). */
  manual: null as ShotType | null,
  manualAt: 0,
  manualSide: 1 as 1 | -1,
  /** Current shot (for the HUD and the cut detection). */
  current: '',
  /** World position of the side-pan camera, fixed when its shot starts. */
  panPos: new Vector3(),
  panKey: '',
};

/** Step to the next drive shot (C key, navbar button). */
export function cycleShot() {
  const at = director.manual ?? (director.current.split(':')[0] as ShotType);
  const i = SHOT_TYPES.indexOf(at as ShotType);
  director.manual = SHOT_TYPES[(i + 1 + SHOT_TYPES.length) % SHOT_TYPES.length];
  director.manualAt = performance.now();
  director.manualSide = director.manualSide === 1 ? -1 : 1;
}

/* ---------------------------------------------------------------- schedule */

let schedule: Cut[] | null = null;

const ORDERS: ShotType[][] = [
  ['chase', 'wheel', 'drone', 'sidepan', 'chase'],
  ['drone', 'hood', 'sidepan', 'chase', 'wheel'],
  ['sidepan', 'chase', 'wheel', 'drone', 'hood'],
  ['wheel', 'drone', 'chase', 'hood', 'sidepan'],
];
const SPACING = [52, 44, 60, 48, 56];

function calm(s: number) {
  return driftAt(s) < 0.3;
}

function buildSchedule(): Cut[] {
  const route = getRoute();
  const out: Cut[] = [];
  // drive segments: between the holds, and from the last city stop out onto the bridge
  const holds = CHAPTERS.filter((c) => c.stop && c.stop !== 'finale').map((c) => STOPS[c.stop!].s);
  const segments: [number, number][] = [];
  let from = 0;
  for (const h of holds) {
    segments.push([from, h - 26]);
    from = h + 24;
  }
  segments.push([from, route.bridgeStart - 10]);
  segments.forEach(([a, b], k) => {
    const order = ORDERS[k % ORDERS.length];
    let s = a + 6;
    let i = 0;
    while (s < b - 18) {
      // never cut on a slide: slide the cut to the nearest calm metre within 24 m
      let at = s;
      if (!calm(at)) {
        let found = NaN;
        for (let d = 2; d <= 24 && Number.isNaN(found); d += 2) {
          if (calm(at + d) && at + d < b - 10) found = at + d;
          else if (calm(at - d) && at - d > a) found = at - d;
        }
        at = found;
      }
      if (!Number.isNaN(at)) out.push({ s: at, type: order[i % order.length], side: i % 2 ? -1 : 1 });
      s += SPACING[(i + k) % SPACING.length];
      i++;
    }
  });
  // over the water: the drone shows the bridge and the sea, then a pan past the first pylon
  const pyl = bridgeInfo.pylons[0] ?? route.bridgeStart + 240;
  out.push({ s: route.bridgeStart + 30, type: 'drone', side: 1 });
  out.push({ s: pyl - 70, type: 'sidepan', side: -1 });
  out.push({ s: pyl + 30, type: 'wheel', side: 1 });
  out.push({ s: pyl + 110, type: 'drone', side: -1 });
  return out.sort((x, y) => x.s - y.s);
}

/** Exposed for the debug HUD and the docs: where the scheduled cuts fall. */
export function getSchedule() {
  return (schedule ??= buildSchedule());
}

function scheduledAt(s: number): Cut {
  const sch = getSchedule();
  let cut: Cut = { s: 0, type: 'chase', side: 1 };
  for (const c of sch) {
    if (c.s > s) break;
    cut = c;
  }
  return cut;
}

/* ------------------------------------------------------------------ shots */

const _f = new Vector3();
const _l = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** Car frame to world: x left, y up, z forward; `body` turns with the slide, else with the road. */
function car(x: number, y: number, z: number, out: Vector3, body = false) {
  const h = body ? carState.heading : carState.pathHeading;
  forwardOf(h, _f);
  leftOf(h, _l);
  return out.copy(carState.position).addScaledVector(_l, x).addScaledVector(_f, z).setY(carState.position.y + y);
}

function driveShot(type: ShotType, side: 1 | -1, key: string, out: CityShot) {
  out.focus.copy(carState.position).setY(carState.position.y + 0.6);
  switch (type) {
    case 'chase':
      car(0, 2.05, -7.4, out.pos);
      car(0, 1.05, 8, out.look);
      out.fov = 36;
      out.damp = 0.09;
      out.dof = 0.6;
      out.focusRange = 5;
      break;
    case 'wheel':
      // bolted low by the front wheel on the outside, looking back down the flank
      car(1.32 * side, 0.34, 2.15, out.pos, true);
      car(0.86 * side, 0.42, -3, out.look, true);
      out.fov = 31;
      out.damp = 0;
      out.dof = 2.4;
      out.focusRange = 1.6;
      out.focus.copy(out.look);
      break;
    case 'hood':
      car(0, 1.06, 0.95, out.pos, true);
      car(0, 0.95, 30, out.look, true);
      out.fov = 38;
      out.damp = 0;
      out.dof = 0;
      out.focusRange = 10;
      out.focus.copy(out.look);
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
      out.damp = 0.05;
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
      out.damp = 0.55;
      out.dof = 0.4;
      out.focusRange = 12;
      break;
    }
  }
  out.id = `${type}:${key}`;
}

/**
 * At a stop: the billboard and the car, both in frame. A rear three-quarter from back
 * down the road (never into the headlights), on the far half of it, low; the look sits
 * between the two and the lens opens (or the camera backs off) until both fit.
 */
function stopShot(stop: ReturnType<typeof nearestStop>, out: CityShot) {
  const spec = STOPS[stop];
  const a = stopAnchor(stop);
  const r = getRoute();
  let back = 30;
  const place = () => {
    const at = spec.s - back;
    const h = sampleRoute(at, out.pos);
    leftOf(h, _l);
    const opposite = r.room(at)[spec.side === 1 ? 1 : 0];
    out.pos.addScaledVector(_l, -spec.side * Math.min(opposite * 0.55, 3.2)).setY(out.pos.y + 1.45);
  };
  place();
  _a.copy(carState.position).setY(carState.position.y + 0.7);
  _b.copy(a.centre);
  out.look.copy(_a).lerp(_b, 0.5);
  // angular spread of billboard + car seen from the camera -> the lens that fits both
  const need = () => {
    _c.subVectors(out.look, out.pos).normalize();
    let worst = 0;
    for (const p of [_a, _b.clone().setY(a.centre.y + a.height / 2), _b.clone().setY(a.centre.y - a.height / 2)]) {
      const d = p.clone().sub(out.pos).normalize();
      worst = Math.max(worst, Math.acos(clamp(d.dot(_c), -1, 1)));
    }
    return MathUtils.radToDeg(worst) * 2 * 1.25;
  };
  let fov = need();
  for (let i = 0; i < 4 && fov > CONFIG.camera.fovMax; i++) {
    back += 14;
    place();
    out.look.copy(_a).lerp(_b, 0.5);
    fov = need();
  }
  out.fov = clamp(fov, 30, CONFIG.camera.fovMax);
  out.focus.copy(a.centre);
  out.dof = 2.2;
  out.focusRange = 9;
  out.damp = 0.35;
  out.id = `stop:${stop}`;
}

let lastShot = '';

/**
 * The camera for this frame (world pose, lens, focus) and whether it is a cut.
 * `shake` is filled with metres of shake for the rig to add after the look.
 */
export function directShot(out: CityShot) {
  const s = carState.s;
  const stop = nearestStop(s);
  const spec = STOPS[stop];
  const now = performance.now();
  const manual = director.manual && now - director.manualAt < MANUAL_HOLD * 1000 ? director.manual : null;
  if (!manual) director.manual = null;

  // at a stop (and the bridge stop at the end), unless the visitor is picking shots
  const atStop = Math.abs(s - spec.s) < (stop === 'finale' ? 60 : 24) && (inHold(s) || stop === 'finale');
  if (atStop && !manual) stopShot(stop, out);
  else if (manual) driveShot(manual, director.manualSide, `m${director.manualAt}`, out);
  else {
    const cut = scheduledAt(s);
    driveShot(cut.type, cut.side, `${cut.s.toFixed(0)}`, out);
  }

  // out of the cloud: start high above and come down behind the car
  const arrival = chapterById('arrival');
  const p = chapterState.progress;
  const down = 1 - smoothstep(p, stageSwitchAt(), arrival.start + HOLD.arrive * (arrival.end - arrival.start));
  if (down > 0.001) {
    car(0, 2.4 + 46 * down * down, -9 - 26 * down * down, out.pos);
    car(0, 1 + 8 * down * down, 10, out.look);
    out.fov = 36;
    out.damp = 0.2;
    out.id = 'descent';
    out.focus.copy(carState.position);
    out.dof = 0.3;
  }

  // speed opens the lens a little, changes of speed shake it (drive shots only)
  const drive = !out.id.startsWith('stop') && out.id !== 'descent';
  const speed = Math.abs(carState.speed);
  if (drive) out.fov = clamp(out.fov + smoothstep(speed, 8, 60) * 4, CONFIG.camera.fovMin, CONFIG.camera.fovMax);
  const rigid = out.id.startsWith('wheel') || out.id.startsWith('hood');
  out.shake = drive ? (smoothstep(Math.abs(carState.accel), 2, 14) * 0.05 + carState.slip * 0.03) * (rigid ? 0.5 : 1) : 0;

  // every change of shot is a hard cut, except coming down out of the cloud
  out.cut = out.id !== lastShot && lastShot !== '' && !lastShot.startsWith('descent');
  lastShot = out.id;
  director.current = out.id;
  return out;
}
