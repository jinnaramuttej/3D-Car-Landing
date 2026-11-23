import { MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { schedule } from '@/content';
import { CONFIG } from './config';
import { engine } from './engineAudio';
import { carState, forwardOf, leftOf } from './motion';
import {
  DEFAULT_BLEND,
  FINALE,
  getParkedFrame,
  SCHEDULE_POSTS,
  type Section,
  SECTIONS,
  type SectionLook,
  sectionIndexAt,
  type Waypoint,
} from './sections';

const { clamp, lerp, smoothstep } = MathUtils;
const LOOK_KEYS = ['fog', 'env', 'bloom', 'headlights', 'accent', 'smoke'] as const;
const SCHEDULE_INDEX = SECTIONS.findIndex((s) => s.id === 'schedule');
const FINALE_INDEX = SECTIONS.findIndex((s) => s.id === 'finale');

/**
 * Shared, mutable, never re-rendered. stepSections (Scene, priority -3, before
 * stepDrive) fills it; Car, Smoke, Effects, CameraRig and the DOM read it.
 */
export const sectionState = {
  initialized: false,
  /** True once the drift scene has handed over (global progress >= DRIFT.end). */
  active: false,
  /** Damped global progress. */
  progress: 0,
  index: -1,
  /** 0..1 inside the current section. */
  local: 0,
  /** Damped light/fog/smoke for the current section. */
  look: { fog: 0.014, env: 0.9, bloom: 1, headlights: 1, accent: 0, smoke: 0 } as SectionLook,
  /** Finale: metres the car has launched down the track, and wheelspin smoke. */
  launchS: 0,
  burnout: 0,
  /** Schedule: 0..1 per day post, lit as the camera passes it. */
  scheduleLit: schedule.days.map(() => 0),
  revArmed: true,
  launchArmed: true,
};

function targetLook(i: number, local: number, out: SectionLook) {
  const s = SECTIONS[i];
  const next = SECTIONS[i + 1];
  const w = next ? smoothstep(local, 1 - (s.blend ?? DEFAULT_BLEND), 1) : 0;
  for (const k of LOOK_KEYS) {
    const v = lerp(s.look[k], s.lookEnd?.[k] ?? s.look[k], local);
    out[k] = next ? lerp(v, next.look[k], w) : v;
  }
  if (i === FINALE_INDEX) {
    const x = (local - FINALE.flareAt) / FINALE.flareWidth;
    out.headlights += FINALE.flarePeak * Math.exp(-x * x);
  }
  return out;
}

const _look = {} as SectionLook;
const _f = new Vector3();
const _d = new Vector3();

/** Advances sectionState from the raw global progress. `cameraPos` = last frame's camera. */
export function stepSections(raw: number, dt: number, cameraPos: Vector3) {
  const st = sectionState;
  if (!st.initialized) st.progress = raw;
  else easing.damp(st, 'progress', raw, CONFIG.scroll.progressSmooth, dt);
  st.initialized = true;

  const p = st.progress;
  const i = sectionIndexAt(p);
  const wasActive = st.active;
  st.active = i >= 0;
  st.index = i;

  if (p < SECTIONS[FINALE_INDEX].start - 0.005) {
    st.revArmed = true;
    st.launchArmed = true;
  }

  if (!st.active) {
    st.local = 0;
    st.launchS = 0;
    st.burnout = 0;
    st.scheduleLit.fill(0);
    return;
  }

  const s = SECTIONS[i];
  const local = clamp((p - s.start) / (s.end - s.start), 0, 1);
  st.local = local;

  targetLook(i, local, _look);
  if (!wasActive) {
    // Hand-over from the drift scene: start from its fog/env and its current smoke cover.
    Object.assign(st.look, _look);
    st.look.smoke = smoothstep(carState.progress, CONFIG.smoke.fillStart, CONFIG.smoke.fillFull);
  } else {
    for (const k of LOOK_KEYS) easing.damp(st.look, k, _look[k], k === 'headlights' ? 0.12 : 0.4, dt);
  }

  // Finale: launch distance, wheelspin smoke, engine sounds
  if (i === FINALE_INDEX) {
    const t = clamp((local - FINALE.launchFrom) / (FINALE.launchTo - FINALE.launchFrom), 0, 1);
    st.launchS = Math.pow(t, 2.4) * FINALE.launchDistance;
    const bx = (local - FINALE.burnoutAt) / FINALE.burnoutWidth;
    st.burnout = FINALE.burnoutPeak * Math.exp(-bx * bx);
    if (local >= FINALE.revAt && st.revArmed) {
      st.revArmed = false;
      engine.rev();
    }
    if (local >= FINALE.launchFrom && st.launchArmed) {
      st.launchArmed = false;
      engine.launch();
    }
  } else {
    st.launchS = 0;
    st.burnout = 0;
  }

  // Schedule posts light up as the camera passes them (and stay lit afterwards)
  const frame = getParkedFrame();
  forwardOf(frame.heading, _f);
  const camZ = _d.copy(cameraPos).sub(frame.origin).dot(_f);
  st.scheduleLit.forEach((_, d) => {
    const postZ = SCHEDULE_POSTS.firstZ + d * SCHEDULE_POSTS.spacing;
    st.scheduleLit[d] =
      i > SCHEDULE_INDEX
        ? 1
        : i === SCHEDULE_INDEX
          ? smoothstep(camZ, postZ - SCHEDULE_POSTS.lightFrom, postZ - SCHEDULE_POSTS.lightTo)
          : 0;
  });
}

/* ------------------------------------------------------------- camera */

type LocalPose = { pos: [number, number, number]; look: [number, number, number]; fov: number; shift: number };

const pose = (): LocalPose => ({ pos: [0, 0, 0], look: [0, 0, 0], fov: 40, shift: 0 });
const fromWaypoint = (w: Waypoint, out: LocalPose) => {
  out.pos = [...w.position];
  out.look = [...w.lookAt];
  out.fov = w.fov;
  out.shift = w.screenShift ?? 0;
  return out;
};

/**
 * 'orbit': position interpolated around the car (cylindrical), so moves swing round it
 * instead of cutting through it. 'line': straight, for dollies and runs down the track.
 */
function lerpPose(a: LocalPose, b: LocalPose, w: number, out: LocalPose, move: 'orbit' | 'line' = 'orbit') {
  let pos: [number, number, number];
  if (move === 'line') {
    pos = [lerp(a.pos[0], b.pos[0], w), lerp(a.pos[1], b.pos[1], w), lerp(a.pos[2], b.pos[2], w)];
  } else {
    const azA = Math.atan2(a.pos[0], a.pos[2]);
    const azB = Math.atan2(b.pos[0], b.pos[2]);
    const dAz = Math.atan2(Math.sin(azB - azA), Math.cos(azB - azA));
    const az = azA + dAz * w;
    const r = lerp(Math.hypot(a.pos[0], a.pos[2]), Math.hypot(b.pos[0], b.pos[2]), w);
    pos = [Math.sin(az) * r, lerp(a.pos[1], b.pos[1], w), Math.cos(az) * r];
  }
  const look: [number, number, number] = [
    lerp(a.look[0], b.look[0], w),
    lerp(a.look[1], b.look[1], w),
    lerp(a.look[2], b.look[2], w),
  ];
  out.pos = pos;
  out.look = look;
  out.fov = lerp(a.fov, b.fov, w);
  out.shift = lerp(a.shift, b.shift, w);
  return out;
}

const _a = pose();
const _b = pose();
function samplePath(keys: Waypoint[], t: number, out: LocalPose, move: 'orbit' | 'line' = 'orbit') {
  if (keys.length === 1) return fromWaypoint(keys[0], out);
  const n = keys.length;
  const times = keys.map((k, i) => k.t ?? i / (n - 1));
  let i = 0;
  while (i < n - 2 && t > times[i + 1]) i++;
  const u = clamp((t - times[i]) / Math.max(1e-6, times[i + 1] - times[i]), 0, 1);
  fromWaypoint(keys[i], _a);
  fromWaypoint(keys[i + 1], _b);
  return lerpPose(_a, _b, u * u * (3 - 2 * u), out, move);
}

const pathOf = (s: Section, mobile: boolean) => (mobile ? [s.mobileCamera ?? s.camera[0]] : s.camera);

export type CameraTarget = {
  pos: Vector3;
  look: Vector3;
  /** The subject (look target before screenShift): what depth of field focuses on. */
  focus: Vector3;
  fov: number;
  dof: number;
  focusRange: number;
};

const _cur = pose();
const _next = pose();
const _l = new Vector3();
const _up = new Vector3(0, 1, 0);
const _right = new Vector3();

/** Where the camera wants to be for the current section (world space). */
export function sectionCameraTarget(mobile: boolean, out: CameraTarget) {
  const i = Math.max(0, sectionState.index);
  const s = SECTIONS[i];
  const next = SECTIONS[i + 1];
  const local = sectionState.local;

  samplePath(pathOf(s, mobile), local, _cur, s.move);
  let dof = s.dof ?? 0;
  let focusRange = s.focusRange ?? 3;
  if (next) {
    const w = smoothstep(local, 1 - (s.blend ?? DEFAULT_BLEND), 1);
    if (w > 0) {
      samplePath(pathOf(next, mobile), 0, _next);
      lerpPose({ ..._cur }, _next, w, _cur);
      dof = lerp(dof, next.dof ?? 0, w);
      focusRange = lerp(focusRange, next.focusRange ?? 3, w);
    }
  }

  const frame = getParkedFrame();
  forwardOf(frame.heading, _f);
  leftOf(frame.heading, _l);
  const toWorld = (v: [number, number, number], o: Vector3) =>
    o.copy(frame.origin).addScaledVector(_l, v[0]).addScaledVector(_f, v[2]).setY(frame.origin.y + v[1]);
  toWorld(_cur.pos, out.pos);
  toWorld(_cur.look, out.look);
  out.focus.copy(out.look);
  if (_cur.shift) {
    _right.subVectors(out.look, out.pos).normalize().cross(_up).normalize();
    out.look.addScaledVector(_right, -_cur.shift);
  }
  out.fov = _cur.fov;
  out.dof = dof;
  out.focusRange = focusRange;
  return out;
}
