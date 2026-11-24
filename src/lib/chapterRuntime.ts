import { Color, MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { CONFIG } from './config';
import { engine } from './engineAudio';
import { forwardOf, leftOf } from './motion';
import { CHAPTERS, type ChapterLook, chapterById, chapterIndexAt, type Env, IGNITION, type StopId } from './chapters';
import { citySAt } from './cityDrive';
import { getRoute, sampleRoute } from './cityRoute';

const { clamp, degToRad, lerp, smoothstep } = MathUtils;

const NUM_KEYS = [
  'rain',
  'fog',
  'exposure',
  'clouds',
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
  'haze',
] as const;
const COLOR_KEYS = ['fogColor', 'skyTop', 'skyHorizon', 'skyGlow', 'sun', 'hemiSky', 'hemiGround'] as const;

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
 * Shared, mutable, never re-rendered. stepChapters (Scene, priority -3, before the drive)
 * fills it; Car, Rain, Smoke, the city, Effects, the camera and the DOM read it.
 */
export const chapterState = {
  initialized: false,
  /**
   * Where the journey is on screen (0..1). It chases the scroll (`useStore.progress`) like a
   * car chasing a marker: the car never faster than CONFIG.drive.maxSpeed, the journey never
   * faster than maxRate or accelerating harder than maxAccel, so a flick of the wheel or a
   * mini-map click is a fast drive there, never a jump.
   */
  progress: 0,
  /** d(progress)/dt of the above, per second. */
  rate: 0,
  chapter: 0,
  chapterLocal: 0,
  /** Inside chapter III (the drift). */
  drift: false,
  /** Damped environment (night -> dawn). */
  env: makeEnv(),
  /** Damped per-chapter effects. */
  look: { headlights: 0 } as ChapterLook,
  /** 0 = engine off and dark .. 1 = lights fully up (chapter II ignition). */
  ignition: 0,
  engineOn: false,
  /** 0..1 bell across a chapter-to-chapter move (peaks halfway). */
  transition: 0,
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
  const span = c.envSpan ?? [0.04, 0.92];
  const u = smoothstep(local, span[0], span[1]);
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
  return out;
}

/** Chapter index of each stop. */
const STOP_CHAPTER = Object.fromEntries(CHAPTERS.map((c, i) => [c.stop ?? '', i])) as Record<StopId, number>;

/** 0..1: how much this stop is the one on screen (up through its hold, down as the car leaves). */
export function stopWeight(id: StopId) {
  const i = STOP_CHAPTER[id];
  if (chapterState.chapter !== i) return 0;
  const l = chapterState.chapterLocal;
  return smoothstep(l, 0.08, 0.24) * (1 - smoothstep(l, 0.74, 0.9));
}

/**
 * The journey's driver: moves `progress` toward the scroll target `raw` with a speed and
 * acceleration limit (and brakes in time, so it never overshoots).
 */
function drive(raw: number, dt: number) {
  const st = chapterState;
  const d = CONFIG.drive;
  const diff = raw - st.progress;
  if (Math.abs(diff) < 1e-6 && Math.abs(st.rate) < 1e-4) {
    st.progress = raw;
    st.rate = 0;
    return;
  }
  const dist = Math.abs(diff);
  // metres of route per unit of journey here (and one frame on): the car's speed limit as
  // a journey rate
  const h = 2e-4;
  const dir = Math.sign(diff);
  let dsdp = 0;
  for (const ahead of [0, dt]) {
    const p = st.progress + dir * Math.min(dist, Math.abs(st.rate) * ahead);
    dsdp = Math.max(dsdp, Math.abs(citySAt(p + h) - citySAt(p - h)) / (2 * h));
  }
  const cap = Math.min(d.maxRate, d.maxSpeed / Math.max(dsdp, 1));
  // as fast as allowed, slow enough to stop in time, and an exponential settle at the end
  const want = Math.sign(diff) * Math.min(cap, Math.sqrt(2 * d.maxAccel * dist) * 0.92, dist / Math.max(1e-3, d.settle));
  const dv = clamp(want - st.rate, -d.maxAccel * dt, d.maxAccel * dt);
  // (dropping to the cap is not braking: it only keeps the car's speed where it is)
  st.rate = clamp(st.rate + dv, -cap, cap);
  const next = st.progress + st.rate * dt;
  if ((raw - next) * diff < 0) {
    st.progress = raw;
    st.rate = 0;
  } else st.progress = next;
}

/** Advances chapterState from the raw global progress (the scroll target). */
export function stepChapters(raw: number, dt: number) {
  const st = chapterState;
  const snap = !st.initialized;
  if (snap) {
    st.progress = raw;
    st.rate = 0;
  } else drive(raw, dt);

  const p = st.progress;
  const ci = chapterIndexAt(p);
  const ch = CHAPTERS[ci];
  st.chapter = ci;
  st.chapterLocal = clamp((p - ch.start) / (ch.end - ch.start), 0, 1);
  st.drift = ch.id === 'turn';

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

  // Per-chapter effects, eased into the next chapter's
  const next = CHAPTERS[ci + 1];
  const w = next ? smoothstep(st.chapterLocal, 1 - ch.blend, 1) : 0;
  const head = lerp(ch.look.headlights, next?.look.headlights ?? ch.look.headlights, w);
  if (snap) st.look.headlights = head;
  else easing.damp(st.look, 'headlights', head, 0.12, dt);

  // Ignition (chapter II): engine catches, lights come up with a flicker
  const ign = chapterById('ignition');
  const len = ign.end - ign.start;
  const igniteAt = ign.start + IGNITION.at * len;
  st.ignition = smoothstep(p, igniteAt, igniteAt + IGNITION.lightsIn * len);
  st.engineOn = p >= igniteAt;
  if (p < igniteAt - 0.002) st.igniteArmed = true;
  if (st.engineOn && st.igniteArmed && !snap) {
    st.igniteArmed = false;
    engine.ignite();
  }
  if (snap && st.engineOn) st.igniteArmed = false;

  st.initialized = true;
}

const _sf = new Vector3();
const _sl = new Vector3();
const _rp = new Vector3();
/** Sun direction (unit, toward the sun). Azimuth is measured from straight down the bridge. */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out: Vector3) {
  const heading = sampleRoute(getRoute().bridgeStart + 200, _rp);
  forwardOf(heading, _sf);
  leftOf(heading, _sl);
  const az = degToRad(azimuthDeg);
  const el = degToRad(elevationDeg);
  return out
    .copy(_sf)
    .multiplyScalar(Math.cos(el) * Math.cos(az))
    .addScaledVector(_sl, Math.cos(el) * Math.sin(az))
    .setY(Math.sin(el))
    .normalize();
}
