import { Color, MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { CONFIG } from './config';
import { engine } from './engineAudio';
import { carState, forwardOf, type Frame, leftOf } from './motion';
import {
  BEATS,
  type BeatLook,
  beatById,
  beatIndexAt,
  CHAPTERS,
  chapterById,
  chapterIndexAt,
  type DistrictId,
  DRIFT,
  driftLocal,
  type Env,
  type FrameKind,
  FINALE,
  getDistrictFrame,
  getParkedFrame,
  getStartFrame,
  IGNITION,
  isDistrict,
  type Waypoint,
} from './chapters';

const { clamp, degToRad, lerp, smoothstep } = MathUtils;

const NUM_KEYS = [
  'rain',
  'fog',
  'exposure',
  'clouds',
  'enclosed',
  'sunIntensity',
  'sunAzimuth',
  'sunElevation',
  'hemi',
  'env',
  'day',
  'lamps',
  'city',
  'wet',
  'groundEnv',
  'seaEnv',
  'bloom',
] as const;
const COLOR_KEYS = ['fogColor', 'skyTop', 'skyHorizon', 'skyGlow', 'sun', 'hemiSky', 'hemiGround', 'buildings', 'ground'] as const;
const LOOK_KEYS = ['headlights', 'accent', 'smoke'] as const;

type NumKey = (typeof NUM_KEYS)[number];
type ColorKey = (typeof COLOR_KEYS)[number];
export type EnvState = Record<NumKey, number> & Record<ColorKey, Color>;

function makeEnv(): EnvState {
  const e = {} as EnvState;
  for (const k of NUM_KEYS) e[k] = 0;
  for (const k of COLOR_KEYS) e[k] = new Color();
  return e;
}

/**
 * Shared, mutable, never re-rendered. stepChapters (Scene, priority -3, before stepDrive)
 * fills it; Car, Rain, Smoke, the city, Effects, CameraRig and the DOM read it.
 */
export const chapterState = {
  initialized: false,
  /** Damped global progress. */
  progress: 0,
  chapter: 0,
  chapterLocal: 0,
  /** Current camera beat, or -1 inside the drift chapter. */
  beat: 0,
  beatLocal: 0,
  /** True inside chapter III (the shot script owns the camera). */
  drift: false,
  /** Damped environment (night -> dawn -> morning). */
  env: makeEnv(),
  /** Damped per-beat effects. */
  look: { headlights: 0, accent: 0, smoke: 0 } as BeatLook,
  /** What stepDrive gets: the drift's raw progress, metres added along the road, wheelspin. */
  driftRaw: DRIFT.launchFrom,
  extraS: -DRIFT.approach,
  burnout: 0,
  /** 0 = engine off and dark .. 1 = lights fully up (chapter II ignition). */
  ignition: 0,
  engineOn: false,
  /** 0..1 bell across a chapter-to-chapter move (peaks halfway): extra fog, lights dip. */
  transition: 0,
  /** One frame: the camera should cut (and the frame cross-dissolve). */
  cut: false,
  /** One frame: progress jumped (mini-map): everything snaps. */
  jumped: false,
  revArmed: true,
  launchArmed: true,
  igniteArmed: true,
};

/** Effective rain: the leva knob times the chapter's rain. */
export const rainLevel = () => CONFIG.rain.intensity * chapterState.env.rain;

const _env = makeEnv();
const _ca = new Color();
const _cb = new Color();

function targetEnv(ci: number, local: number, out: EnvState) {
  const c = CHAPTERS[ci];
  const next = CHAPTERS[ci + 1];
  const w = next ? smoothstep(local, 1 - c.blend, 1) : 0;
  const u = smoothstep(local, 0.04, 0.92);
  chapterState.transition = Math.sin(Math.PI * w);
  const end = (k: keyof Env) => (c.envEnd?.[k] ?? c.env[k]) as never;
  for (const k of NUM_KEYS) {
    const v = lerp(c.env[k], end(k), u);
    out[k] = next ? lerp(v, next.env[k], w) : v;
  }
  for (const k of COLOR_KEYS) {
    _ca.set(c.env[k]).lerp(_cb.set(end(k)), u);
    if (next) _ca.lerp(_cb.set(next.env[k]), w);
    out[k].copy(_ca);
  }
  // A move between districts lifts out of the hall into morning mist over the water and
  // back down into the next one: the fog and light cross-fade through that in-between.
  if (next && (c.district || next.district)) {
    const t = chapterState.transition;
    const d = CONFIG.districts;
    out.enclosed = lerp(out.enclosed, 0.2, t * 0.9);
    out.fog = lerp(out.fog, d.transitionFog, t);
    out.fogColor.lerp(_cb.set(d.transitionFogColor), t * 0.85);
    out.hemi = lerp(out.hemi, 0.9, t);
    out.sunIntensity = lerp(out.sunIntensity, 1.2, t * 0.8);
    out.exposure *= 1 - 0.1 * t;
  }
  return out;
}

const _look = {} as BeatLook;
function targetLook(bi: number, local: number, out: BeatLook) {
  const b = BEATS[bi];
  const next = BEATS[bi + 1];
  const w = next && next.chapter === b.chapter ? smoothstep(local, 1 - (b.blend ?? 0.18), 1) : 0;
  for (const k of LOOK_KEYS) {
    const v = lerp(b.look[k], b.lookEnd?.[k] ?? b.look[k], local);
    out[k] = w > 0 ? lerp(v, next.look[k], w) : v;
  }
  if (b.id === 'finale') {
    const x = (local - FINALE.flareAt) / FINALE.flareWidth;
    out.headlights += FINALE.flarePeak * Math.exp(-x * x);
  }
  return out;
}

const _f = new Vector3();
const _d = new Vector3();
const JUMP = 0.04;

/** Chapter index of each district. */
const DISTRICT_CHAPTER = Object.fromEntries(CHAPTERS.map((c, i) => [c.district ?? '', i])) as Record<DistrictId, number>;

/** Is this district's set worth drawing (its chapter or a neighbour, i.e. during a move)? */
export function districtVisible(id: DistrictId) {
  return Math.abs(chapterState.chapter - DISTRICT_CHAPTER[id]) <= 1;
}

/** 0..1: how much this district is the one on screen (fades across the move). */
export function districtWeight(id: DistrictId) {
  const i = DISTRICT_CHAPTER[id];
  const c = chapterState.chapter;
  if (c === i) return 1 - (CHAPTERS[i + 1] ? smoothstep(chapterState.chapterLocal, 1 - CHAPTERS[i].blend * 0.5, 1) : 0);
  if (c === i - 1) return smoothstep(chapterState.chapterLocal, 1 - CHAPTERS[c].blend * 0.5, 1);
  return 0;
}

/** Advances chapterState from the raw global progress. `cameraPos` = last frame's camera. */
export function stepChapters(raw: number, dt: number, cameraPos: Vector3) {
  const st = chapterState;
  st.jumped = st.initialized && Math.abs(raw - st.progress) > JUMP;
  const snap = !st.initialized || st.jumped;
  if (snap) st.progress = raw;
  else easing.damp(st, 'progress', raw, CONFIG.scroll.progressSmooth, dt);

  const p = st.progress;
  const ci = chapterIndexAt(p);
  const ch = CHAPTERS[ci];
  st.chapter = ci;
  st.chapterLocal = clamp((p - ch.start) / (ch.end - ch.start), 0, 1);

  const prevBeat = st.beat;
  const bi = beatIndexAt(p);
  st.beat = bi;
  st.drift = bi < 0;
  st.beatLocal = bi >= 0 ? clamp((p - BEATS[bi].start) / (BEATS[bi].end - BEATS[bi].start), 0, 1) : 0;
  const later = Math.max(bi, prevBeat);
  st.cut =
    snap ||
    (st.initialized && bi !== prevBeat && bi >= 0 && prevBeat >= 0 && BEATS[later].enter === 'dissolve');

  // Environment: target for this point of the chapter, damped so nothing jumps
  targetEnv(ci, st.chapterLocal, _env);
  const e = st.env;
  for (const k of NUM_KEYS) {
    if (snap) e[k] = _env[k];
    else easing.damp(e, k, _env[k], 0.35, dt);
  }
  for (const k of COLOR_KEYS) {
    if (snap) e[k].copy(_env[k]);
    else easing.dampC(e[k], _env[k], 0.35, dt);
  }

  // Per-beat effects
  if (bi >= 0) {
    targetLook(bi, st.beatLocal, _look);
    if (snap) Object.assign(st.look, _look);
    else {
      if (prevBeat < 0 && st.initialized) {
        // out of the drift: start from the smoke the drift has built up
        st.look.smoke = smoothstep(carState.progress, CONFIG.smoke.fillStart, CONFIG.smoke.fillFull);
      }
      for (const k of LOOK_KEYS) easing.damp(st.look, k, _look[k], k === 'headlights' ? 0.12 : 0.4, dt);
    }
  } else {
    st.look.headlights = 1;
    st.look.accent = 0;
    st.look.smoke = 0;
  }

  // Ignition (chapter II): engine catches, lights come up with a flicker
  const ignite = beatById('ignite');
  const igniteAt = ignite.start + IGNITION.at * (ignite.end - ignite.start);
  const lightsTo = igniteAt + IGNITION.lightsIn * (ignite.end - ignite.start);
  st.ignition = smoothstep(p, igniteAt, lightsTo);
  st.engineOn = p >= igniteAt;
  if (p < igniteAt - 0.002) st.igniteArmed = true;
  if (st.engineOn && st.igniteArmed && !snap) {
    st.igniteArmed = false;
    engine.ignite();
  }
  if (snap && st.engineOn) st.igniteArmed = false;

  // Car staging: waiting (I), pulling away (II), the drift (III), parked (IV, V)
  const launch = beatById('launch');
  const turn = chapterById('turn');
  if (raw < launch.start) {
    st.driftRaw = DRIFT.launchFrom;
  } else if (raw < turn.start) {
    const u = clamp((raw - launch.start) / (launch.end - launch.start), 0, 1);
    st.driftRaw = lerp(DRIFT.launchFrom, 0, u);
  } else {
    st.driftRaw = driftLocal(raw);
  }
  const uLaunch = clamp((p - launch.start) / (launch.end - launch.start), 0, 1);
  const approach = p < turn.start ? -DRIFT.approach * (1 - uLaunch * uLaunch) : 0;

  // Finale: launch distance, wheelspin smoke, engine sounds
  const fin = beatById('finale');
  if (p < fin.start - 0.003) {
    st.revArmed = true;
    st.launchArmed = true;
  }
  let launchS = 0;
  st.burnout = 0;
  if (bi >= 0 && BEATS[bi].id === 'finale') {
    const local = st.beatLocal;
    const t = clamp((local - FINALE.launchFrom) / (FINALE.launchTo - FINALE.launchFrom), 0, 1);
    launchS = Math.pow(t, 2.4) * FINALE.launchDistance;
    const bx = (local - FINALE.burnoutAt) / FINALE.burnoutWidth;
    st.burnout = FINALE.burnoutPeak * Math.exp(-bx * bx);
    if (local >= FINALE.revAt && st.revArmed && !snap) {
      st.revArmed = false;
      engine.rev();
    }
    if (local >= FINALE.launchFrom && st.launchArmed && !snap) {
      st.launchArmed = false;
      engine.launch();
    }
    if (snap) st.revArmed = st.launchArmed = false;
  }
  st.extraS = approach + launchS;

  st.initialized = true;
}

const _sf = new Vector3();
const _sl = new Vector3();
/** Sun direction (unit, toward the sun): azimuth from straight down the road at the parked car. */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out: Vector3) {
  const f = getParkedFrame();
  forwardOf(f.heading, _sf);
  leftOf(f.heading, _sl);
  const az = degToRad(azimuthDeg);
  const el = degToRad(elevationDeg);
  return out
    .copy(_sf)
    .multiplyScalar(Math.cos(el) * Math.cos(az))
    .addScaledVector(_sl, Math.cos(el) * Math.sin(az))
    .setY(Math.sin(el))
    .normalize();
}

/* ------------------------------------------------------------------ camera */

export type LocalPose = { pos: Vector3; look: Vector3; fov: number; shift: number };
export const localPose = (): LocalPose => ({ pos: new Vector3(), look: new Vector3(), fov: 40, shift: 0 });

const followFrame: Frame = { origin: new Vector3(), heading: 0 };

/** World frame for a beat's camera. */
export function frameFor(kind: FrameKind): Frame {
  if (kind === 'start') return getStartFrame();
  if (kind === 'parked') return getParkedFrame();
  if (isDistrict(kind)) return getDistrictFrame(kind);
  // 'follow' matches the drift's 'path' frame, so the launch hands over without a seam
  followFrame.origin.copy(carState.position);
  followFrame.heading = carState.pathHeading;
  return followFrame;
}

const _l = new Vector3();
/** Frame-local (x left, y up, z forward) to world. */
export function frameToWorld(f: Frame, v: Vector3, out: Vector3) {
  forwardOf(f.heading, _f);
  leftOf(f.heading, _l);
  return out.copy(f.origin).addScaledVector(_l, v.x).addScaledVector(_f, v.z).setY(f.origin.y + v.y);
}
/** World to frame-local. */
export function worldToFrame(f: Frame, w: Vector3, out: Vector3) {
  forwardOf(f.heading, _f);
  leftOf(f.heading, _l);
  _d.copy(w).sub(f.origin);
  return out.set(_d.dot(_l), w.y - f.origin.y, _d.dot(_f));
}

const _a = localPose();
const _b = localPose();
function fromWaypoint(w: Waypoint, out: LocalPose) {
  out.pos.set(...w.position);
  out.look.set(...w.lookAt);
  out.fov = w.fov;
  out.shift = w.screenShift ?? 0;
  return out;
}

/** 'orbit': interpolated round the car (cylindrical) so moves never cut through it. */
function lerpPose(a: LocalPose, b: LocalPose, w: number, out: LocalPose, move: 'orbit' | 'line' = 'orbit') {
  if (move === 'line') {
    out.pos.lerpVectors(a.pos, b.pos, w);
  } else {
    const azA = Math.atan2(a.pos.x, a.pos.z);
    const azB = Math.atan2(b.pos.x, b.pos.z);
    const dAz = Math.atan2(Math.sin(azB - azA), Math.cos(azB - azA));
    const az = azA + dAz * w;
    const r = lerp(Math.hypot(a.pos.x, a.pos.z), Math.hypot(b.pos.x, b.pos.z), w);
    out.pos.set(Math.sin(az) * r, lerp(a.pos.y, b.pos.y, w), Math.cos(az) * r);
  }
  out.look.lerpVectors(a.look, b.look, w);
  out.fov = lerp(a.fov, b.fov, w);
  out.shift = lerp(a.shift, b.shift, w);
  return out;
}

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

const pathOf = (bi: number, mobile: boolean) => {
  const b = BEATS[bi];
  return mobile ? [b.mobileCamera ?? b.camera[0]] : b.camera;
};

export type BeatTarget = {
  /** Frame-local pose. */
  pose: LocalPose;
  frame: FrameKind;
  dof: number;
  focusRange: number;
  /** 0..1: how far the launch beat has handed over to the drift camera. */
  toDrift: number;
};

const _next = localPose();
const _cur = localPose();
const _w1 = new Vector3();
const _w2 = new Vector3();

/** Where the camera wants to be for the current beat (frame-local). */
export function beatCameraTarget(mobile: boolean, out: BeatTarget) {
  const bi = Math.max(0, chapterState.beat);
  const b = BEATS[bi];
  const next = BEATS[bi + 1];
  const local = chapterState.beatLocal;
  samplePath(pathOf(bi, mobile), local, _cur, b.move);
  let dof = b.dof ?? 0;
  let focusRange = b.focusRange ?? 3;
  // ease into the next beat's first waypoint; across frames (a district hop) it's a
  // straight move through the fog, carried into this beat's frame
  if (next && next.enter !== 'dissolve' && !(b.id === 'launch')) {
    const w = smoothstep(local, 1 - (b.blend ?? 0.18), 1);
    if (w > 0) {
      samplePath(pathOf(bi + 1, mobile), 0, _next);
      const across = next.frame !== b.frame;
      if (across) {
        const from = frameFor(next.frame);
        const to = frameFor(b.frame);
        worldToFrame(to, frameToWorld(from, _next.pos, _w1), _next.pos);
        worldToFrame(to, frameToWorld(from, _next.look, _w2), _next.look);
      }
      const ww = across ? w * w * (3 - 2 * w) : w;
      lerpPose({ pos: _cur.pos.clone(), look: _cur.look.clone(), fov: _cur.fov, shift: _cur.shift }, _next, ww, _cur, across ? 'line' : 'orbit');
      dof = lerp(dof, next.dof ?? 0, w);
      focusRange = lerp(focusRange, next.focusRange ?? 3, w);
    }
  }
  out.pose.pos.copy(_cur.pos);
  out.pose.look.copy(_cur.look);
  out.pose.fov = _cur.fov;
  out.pose.shift = _cur.shift;
  out.frame = b.frame;
  out.dof = dof;
  out.focusRange = focusRange;
  out.toDrift = b.id === 'launch' ? smoothstep(local, 0.7, 1) : 0;
  return out;
}
