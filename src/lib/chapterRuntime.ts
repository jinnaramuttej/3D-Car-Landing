import { Color, MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { CONFIG } from './config';
import { engine } from './engineAudio';
import { forwardOf, leftOf } from './motion';
import { CHAPTERS, type ChapterLook, chapterIndexAt, type Env, IGNITION, type StopId } from './chapters';
import { citySAt } from './cityDrive';
import { DRIFT, journeySeconds, zoneById, zoneProgress } from './pacing';
import { playhead, stepPlayhead } from './playhead';
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
   * Where the journey is on screen (0..1): the playhead (src/lib/playhead.ts), chasing the
   * scroll (`useStore.progress`) at no more than 1.5x the journey's own pace (a jump glides at
   * up to 4x), so a flick of the wheel plays the stops through instead of skipping them.
   */
  progress: 0,
  /** The playback rate: journey seconds per real second (1 = the journey's own pace), signed. */
  rate: 0,
  chapter: 0,
  chapterLocal: 0,
  /** On the drift (the first run's slide through the plaza and down the long left-hander). */
  drift: false,
  /** Damped environment (night -> dawn). */
  env: makeEnv(),
  /** Damped per-chapter effects. */
  look: { headlights: 0 } as ChapterLook,
  /** 0 = engine off and dark .. 1 = lights fully up (the ignition, end of the intro's parked beat). */
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

/** Where the car is on the route right now (the journey on screen), for the zone weights. */
const carS = () => citySAt(chapterState.progress);

/**
 * 0..1: how much this stop is the one on screen: up as the car rolls into its slow zone,
 * down as it launches out (zone progress 0.02-0.12 in, 0.84-0.95 out). The finale: across
 * its chapter.
 */
export function stopWeight(id: StopId) {
  if (id === 'finale') {
    if (chapterState.chapter !== STOP_CHAPTER.finale) return 0;
    return smoothstep(chapterState.chapterLocal, 0.08, 0.24);
  }
  const p = zoneProgress(zoneById(id), carS());
  return smoothstep(p, 0.02, 0.12) * (1 - smoothstep(p, 0.84, 0.95));
}

/**
 * Advances chapterState from the raw global progress (the scroll target). `playing`: the
 * Play button is driving the scroll (the playhead's magnet leaves it be).
 */
export function stepChapters(raw: number, dt: number, playing = false) {
  const st = chapterState;
  const snap = !st.initialized;
  // the playhead works in journey seconds; it picks up wherever anything else (the warm-up)
  // has put the journey
  const T = journeySeconds();
  if (Math.abs(playhead.t - st.progress * T) > 1e-3) {
    playhead.t = st.progress * T;
    playhead.rate = 0;
  }
  stepPlayhead(raw * T, dt, snap, playing);
  st.progress = clamp(playhead.t / T, 0, 1);
  st.rate = playhead.rate;

  const p = st.progress;
  const ci = chapterIndexAt(p);
  const ch = CHAPTERS[ci];
  st.chapter = ci;
  st.chapterLocal = clamp((p - ch.start) / (ch.end - ch.start), 0, 1);
  const s = citySAt(p);
  st.drift = s >= DRIFT.from && s <= DRIFT.to + 20;

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

  // Ignition (the end of the intro's parked beat): engine catches, lights come up with a flicker
  const igniteAt = IGNITION.at;
  st.ignition = smoothstep(p, igniteAt, igniteAt + IGNITION.lightsIn);
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
