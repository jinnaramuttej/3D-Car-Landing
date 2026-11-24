import { Vector3 } from 'three';
import { getTrack, sAtProgress, sampleTrack, type Frame } from './motion';
import type { Vec3 } from './script';

/**
 * CHAPTERS
 * ========
 * The page is one scroll and one global `progress` (0..1), split into chapters:
 *
 *   I    Stillness     night, heavy rain, the car parked on the waterfront, engine off
 *   II   Ignition      lights and engine come on, the car pulls away into the first bend
 *   III  The Turn      the drift scene (src/lib/script.ts), untouched, at its original pace
 *   IV   Clearing      the smoke settles, the title forms, the camera rises into the cloud
 *   V    Arrival       down out of the cloud into a city at night, in the rain
 *   VI   Robowars      \
 *   VII  Competitions  |
 *   VIII Speakers      |  stops along the drive through the city: each one an LED
 *   IX   Expo          |  billboard on a facade, framed by the camera, with its panel
 *   X    DKMS          |
 *   XI   TWMUN         /
 *        Finale        out over the sea on the bridge as dawn breaks; the CTA
 *
 * Chapters I-IV happen on the waterfront road (src/lib/motion.ts), V onwards on the
 * city route (src/lib/cityRoute.ts). The two are far apart in the world: at the end of
 * IV the camera climbs into cloud while the fog thickens to nothing but grey, the scene
 * switches stage at the thickest point, and the camera comes down out of the cloud over
 * the city. No cut, just weather.
 *
 * Each chapter has a scroll length in viewport heights (`pages`), an environment at its
 * start (`env`) and optionally at its end (`envEnd`). The runtime eases from one chapter's
 * environment into the next over the last `blend` of the chapter, so rain, fog, light
 * colour and exposure never jump.
 *
 * Chapters I, II and IV are made of camera BEATS: waypoints in a frame (x = left,
 * y = up, z = forward, metres):
 *   start    where the car waits before the drift (chapters I and II)
 *   follow   rides with the car along the road, facing down it (the launch in II)
 *   parked   where the drift leaves the car (IV)
 *   city     the city chapters: the camera director owns these (src/lib/director.ts)
 */

export type StopId = 'arrival' | 'robowars' | 'competitions' | 'speakers' | 'expo' | 'dkms' | 'twmun' | 'finale';
export type ChapterId = 'stillness' | 'ignition' | 'turn' | 'clearing' | StopId;
export type BeatId = 'still' | 'ignite' | 'launch' | 'clearing' | StopId;
export type FrameKind = 'start' | 'follow' | 'parked' | 'city';

/** Everything about the world that changes from night to morning. Colours are hex. */
export type Env = {
  /** Multiplier on CONFIG.rain.intensity (streaks, splashes, lens drops, spray). */
  rain: number;
  fog: number;
  fogColor: string;
  /** Scene exposure, applied before tone mapping. */
  exposure: number;
  skyTop: string;
  skyHorizon: string;
  /** Low glow on the city side: sodium at night, sunrise at dawn. */
  skyGlow: string;
  /** Cloud cover in the sky shader, 0 clear .. 1 rain clouds. */
  clouds: number;
  /** 0 clear .. 1 inside the cloud: the sky and everything far goes to the fog colour. */
  mist: number;
  sun: string;
  sunIntensity: number;
  /** Degrees, 0 = straight down the road from the parked car, negative = over the city. */
  sunAzimuth: number;
  sunElevation: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  /** Environment map intensity. */
  env: number;
  /** 0 = the night HDRI, 1 = the generated daylight sky (switched, not blended). */
  day: number;
  /** Sodium street lamps 0..1. */
  lamps: number;
  /** Lit windows, neon, far-shore and bridge lights 0..1. */
  city: number;
  /** Facade colour of the city and the bridge. */
  buildings: string;
  /** Asphalt base colour (dark when soaked at night, lighter by morning). */
  ground: string;
  /** How wet the asphalt looks (reflection strength multiplier). */
  wet: number;
  /** Env reflection level on the asphalt and the sea. */
  groundEnv: number;
  seaEnv: number;
  bloom: number;
};

/** Per-beat effects (eased between beats). */
export type BeatLook = {
  /** Headlight level (emissive + beams); the ignition and the toggle multiply it. */
  headlights: number;
  /** Accent rim light behind the parked car. */
  accent: number;
  /** Smoke cover after the drift, 0 clear .. 1 screen full. */
  smoke: number;
};

export type Waypoint = {
  /** 0..1 inside the beat. Omit to spread waypoints evenly. */
  t?: number;
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  /** Metres to push the subject toward screen-right (negative = left), to leave room for text. */
  screenShift?: number;
};

export type Beat = {
  id: BeatId;
  chapter: ChapterId;
  /** Scroll length in viewport heights. */
  pages: number;
  frame: FrameKind;
  camera: Waypoint[];
  /** 'orbit' swings round the car, 'line' goes straight. */
  move?: 'orbit' | 'line';
  mobileCamera?: Waypoint;
  /** Fraction of the beat spent easing into the next beat's first waypoint. */
  blend?: number;
  /** Arrive with a cut covered by a cross-dissolve instead of a camera move. */
  enter?: 'move' | 'dissolve';
  look: BeatLook;
  lookEnd?: Partial<BeatLook>;
  dof?: number;
  focusRange?: number;
  /** Where the mini-map / navbar jump lands, 0..1 inside the beat. */
  anchor?: number;
  /** Filled in below. */
  start: number;
  end: number;
};

export type Chapter = {
  id: ChapterId;
  numeral: string;
  title: string;
  /** Scroll length in viewport heights (the drift chapter keeps the drift's original pace). */
  pages: number;
  env: Env;
  envEnd?: Partial<Env>;
  /** Fraction of the chapter spent easing into the next chapter's environment. */
  blend: number;
  /** Chapters V onwards: a stop on the city route. */
  stop?: StopId;
  /** The move into the next chapter goes through cloud (the fog closes in completely). */
  cloud?: boolean;
  /** Where envEnd is reached, as [from, to] inside the chapter (default [0.04, 0.92]). */
  envSpan?: [number, number];
  start: number;
  end: number;
};

/* ------------------------------------------------------------ environments */

const NIGHT: Env = {
  rain: 1,
  fog: 0.009,
  fogColor: '#0c1016',
  exposure: 1,
  skyTop: '#020307',
  skyHorizon: '#131922',
  skyGlow: '#4a2f1d',
  clouds: 1,
  mist: 0,
  sun: '#9fc2d6',
  sunIntensity: 0.25,
  sunAzimuth: 140,
  sunElevation: 50,
  hemiSky: '#4b6378',
  hemiGround: '#120c08',
  hemi: 0.3,
  env: 0.9,
  day: 0,
  lamps: 1,
  city: 1,
  buildings: '#0c0e12',
  ground: '#0e1014',
  wet: 1,
  groundEnv: 0.06,
  seaEnv: 0.22,
  bloom: 1,
};

const STILL: Env = { ...NIGHT, fog: 0.012, exposure: 0.82, env: 0.55, bloom: 0.85 };

/** The waterfront after the drift: still night, the rain easing off. */
const CLEARING: Env = { ...NIGHT, rain: 0.7, fog: 0.011, env: 0.6, groundEnv: 0.08, bloom: 0.9 };

/**
 * The city at night in the rain: sodium and neon under low cloud. The city's own lights
 * do most of the work (src/scene/city), so the sky and the moon stay dim.
 */
const CITY: Env = {
  ...NIGHT,
  rain: 0.7,
  fog: 0.0105,
  fogColor: '#141018',
  exposure: 1.02,
  skyTop: '#05060b',
  skyHorizon: '#1d1720',
  skyGlow: '#5a3320',
  clouds: 1,
  sunIntensity: 0.18,
  hemiSky: '#4a4c60',
  hemiGround: '#1a1008',
  hemi: 0.32,
  env: 0.55,
  lamps: 1,
  city: 1,
  ground: '#0b0c10',
  wet: 1,
  groundEnv: 0.05,
  seaEnv: 0.25,
  bloom: 1.05,
};

/** Small shifts per stop, so each block of the city has its own air. */
const ROBOWARS_AIR: Env = { ...CITY, fogColor: '#1c1009', skyGlow: '#7a3a12', bloom: 1.15 };
const SPEAKERS_AIR: Env = { ...CITY, fogColor: '#0c1020', skyGlow: '#2a3a6a' };
const EXPO_AIR: Env = { ...CITY, fogColor: '#081416', skyGlow: '#1a5a60', bloom: 1.15 };
const DKMS_AIR: Env = { ...CITY, rain: 0.45, fog: 0.012, fogColor: '#1e0f0c', skyGlow: '#6a3020', exposure: 0.96, bloom: 0.95 };
const TWMUN_AIR: Env = { ...CITY, fogColor: '#130c1e', skyGlow: '#4a2a6a' };

/** Out over the sea on the bridge as the sun comes up. */
const DAWN: Env = {
  ...CITY,
  rain: 0,
  fog: 0.0019,
  fogColor: '#8c7a80',
  exposure: 0.92,
  skyTop: '#2c3d66',
  skyHorizon: '#e5946c',
  skyGlow: '#ff9a5a',
  clouds: 0.4,
  sun: '#ffb27a',
  sunIntensity: 2.2,
  sunAzimuth: -28,
  sunElevation: 4,
  hemiSky: '#9aa8cc',
  hemiGround: '#5a4038',
  hemi: 1,
  env: 0.85,
  day: 1,
  lamps: 0.35,
  city: 0.35,
  buildings: '#4a4648',
  ground: '#1c1c20',
  wet: 0.8,
  groundEnv: 0.22,
  seaEnv: 0.95,
  bloom: 0.55,
};

/* ---------------------------------------------------------------- chapters */

const chapterList: Omit<Chapter, 'start' | 'end'>[] = [
  { id: 'stillness', numeral: 'I', title: 'Stillness', pages: 1.4, env: STILL, blend: 0.4 },
  { id: 'ignition', numeral: 'II', title: 'Ignition', pages: 1.6, env: NIGHT, blend: 0.1 },
  { id: 'turn', numeral: 'III', title: 'The Turn', pages: 4.2, env: NIGHT, blend: 0.02 },
  { id: 'clearing', numeral: 'IV', title: 'Clearing', pages: 2.4, env: CLEARING, blend: 0.3, cloud: true },
  { id: 'arrival', numeral: 'V', title: 'Arrival', pages: 2, env: CITY, blend: 0.25, stop: 'arrival' },
  { id: 'robowars', numeral: 'VI', title: 'Robowars', pages: 2.4, env: ROBOWARS_AIR, blend: 0.25, stop: 'robowars' },
  { id: 'competitions', numeral: 'VII', title: 'Competitions', pages: 3, env: CITY, blend: 0.25, stop: 'competitions' },
  { id: 'speakers', numeral: 'VIII', title: 'Speakers', pages: 2.4, env: SPEAKERS_AIR, blend: 0.25, stop: 'speakers' },
  { id: 'expo', numeral: 'IX', title: 'Expo', pages: 2.4, env: EXPO_AIR, blend: 0.25, stop: 'expo' },
  { id: 'dkms', numeral: 'X', title: 'DKMS', pages: 2.4, env: DKMS_AIR, blend: 0.3, stop: 'dkms' },
  { id: 'twmun', numeral: 'XI', title: 'TWMUN', pages: 2.2, env: TWMUN_AIR, blend: 0.3, stop: 'twmun' },
  // dawn comes up over the sea while the car crosses; the CTA lands at FINALE.ctaAt
  { id: 'finale', numeral: 'Fin', title: 'Finale', pages: 3, env: CITY, envEnd: DAWN, envSpan: [0.2, 0.7], blend: 0, stop: 'finale' },
];

const beatList: Omit<Beat, 'start' | 'end'>[] = [
  {
    // Rain on a parked car, engine off. A slow push from the sea side.
    id: 'still',
    chapter: 'stillness',
    pages: 1.4,
    frame: 'start',
    camera: [
      { position: [7.8, 1.15, 9.6], lookAt: [0.4, 0.75, 0.2], fov: 34, screenShift: -0.6 },
      { position: [5.4, 0.82, 6.6], lookAt: [0.3, 0.65, 0.6], fov: 30, screenShift: -0.5 },
    ],
    mobileCamera: { position: [7.4, 1.4, 8.6], lookAt: [0, 0.6, 0.4], fov: 36 },
    blend: 0.25,
    look: { headlights: 0, accent: 0, smoke: 0 },
    dof: 1.6,
    focusRange: 2.5,
  },
  {
    // Close on the left headlight as it wakes up.
    id: 'ignite',
    chapter: 'ignition',
    pages: 0.7,
    frame: 'start',
    camera: [
      { position: [3.5, 0.66, 5.7], lookAt: [0.55, 0.66, 1.9], fov: 30, screenShift: -0.25 },
      { position: [3.9, 0.6, 7.6], lookAt: [0.2, 0.62, 1.6], fov: 31, screenShift: -0.25 },
    ],
    mobileCamera: { position: [3.6, 0.9, 7.4], lookAt: [0.3, 0.6, 1.4], fov: 34 },
    blend: 0.3,
    look: { headlights: 1, accent: 0, smoke: 0 },
    dof: 2.2,
    focusRange: 1.4,
  },
  {
    // A camera car ahead of it as it pulls away; ends exactly on the drift's first frame.
    id: 'launch',
    chapter: 'ignition',
    pages: 0.9,
    frame: 'follow',
    camera: [
      { position: [4.6, 0.55, 10.4], lookAt: [-0.6, 0.55, 1.4], fov: 32 },
      { position: [5.91, 0.42, 8.94], lookAt: [-0.9, 0.55, 1.1], fov: 30 },
    ],
    move: 'line',
    look: { headlights: 1, accent: 0, smoke: 0 },
    dof: 2,
    focusRange: 3,
  },
  {
    // The drift leaves the car in its own smoke; the title forms as it clears, then the
    // camera rises into the cloud (the fog closes in: the move to the city, see top).
    id: 'clearing',
    chapter: 'clearing',
    pages: 2.4,
    frame: 'parked',
    camera: [
      { t: 0, position: [6.55, 1.1, 10.66], lookAt: [0.2, 2.25, 0], fov: 32 },
      { t: 0.55, position: [5.5, 1.0, 9.0], lookAt: [0.1, 2.15, 0], fov: 30 },
      { t: 1, position: [4, 36, 14], lookAt: [0, 34, 70], fov: 36 },
    ],
    move: 'line',
    look: { headlights: 1, accent: 0.3, smoke: 1 },
    lookEnd: { smoke: 0, accent: 0.6 },
    anchor: 0.5,
  },
  // V onwards: the camera director drives the camera (src/lib/director.ts); a beat here
  // only carries the headlights and where the mini-map lands (the stop itself).
  ...(['arrival', 'robowars', 'competitions', 'speakers', 'expo', 'dkms', 'twmun', 'finale'] as const).map(
    (id): Omit<Beat, 'start' | 'end'> => ({
      id,
      chapter: id,
      pages: 1,
      frame: 'city',
      camera: [],
      look: { headlights: 1, accent: 0, smoke: 0 },
      anchor: id === 'finale' ? 0.62 : 0.4,
    }),
  ),
];

/* ------------------------------------------------------------------ layout */

/** Total scroll height in viewport heights (the scroll track is PAGES * 100vh). */
export const PAGES = chapterList.reduce((sum, c) => sum + c.pages, 0);

export const CHAPTERS: Chapter[] = (() => {
  let at = 0;
  return chapterList.map((c) => {
    const start = at / PAGES;
    at += c.pages;
    return { ...c, start, end: at / PAGES };
  });
})();

export const BEATS: Beat[] = (() => {
  const out: Beat[] = [];
  for (const ch of CHAPTERS) {
    const beats = beatList.filter((b) => b.chapter === ch.id);
    const total = beats.reduce((s, b) => s + b.pages, 0);
    let at = ch.start;
    for (const b of beats) {
      const len = ((ch.end - ch.start) * b.pages) / total;
      out.push({ ...b, start: at, end: at + len });
      at += len;
    }
  }
  return out;
})();

export const chapterById = (id: ChapterId) => CHAPTERS.find((c) => c.id === id)!;
export const beatById = (id: BeatId) => BEATS.find((b) => b.id === id)!;

export function chapterIndexAt(p: number) {
  for (let i = CHAPTERS.length - 1; i > 0; i--) if (p >= CHAPTERS[i].start) return i;
  return 0;
}

/** Beat index at global progress p, or -1 inside the drift chapter. */
export function beatIndexAt(p: number) {
  const turn = chapterById('turn');
  if (p >= turn.start && p < turn.end) return -1;
  for (let i = BEATS.length - 1; i >= 0; i--) if (p >= BEATS[i].start) return i;
  return 0;
}

/** Global progress the mini-map jumps to. */
export function chapterAnchor(id: ChapterId) {
  const c = chapterById(id);
  const first = BEATS.find((b) => b.chapter === id);
  if (!first) return c.start + 0.002;
  return first.start + (first.anchor ?? 0.05) * (first.end - first.start);
}

/* ------------------------------------------------------------- drift link */

export const DRIFT = {
  /** The drift scene's own progress reached at the end of chapter III (it parks the car there). */
  localEnd: 0.78,
  /** Metres before the drift's first position where the car waits in chapters I-II. */
  approach: 20,
  /** Drift progress the launch starts from: below introDrift.start, so no yaw until the flick. */
  launchFrom: -0.08,
};

/** Global progress -> the drift scene's own progress (0..localEnd across chapter III). */
export function driftLocal(global: number) {
  const c = chapterById('turn');
  return Math.min(Math.max((global - c.start) / (c.end - c.start), 0), 1) * DRIFT.localEnd;
}

/** Drift-scene progress -> global progress (for debug jumps and labels). */
export function fromDriftLocal(local: number) {
  const c = chapterById('turn');
  return c.start + (local / DRIFT.localEnd) * (c.end - c.start);
}

/* ------------------------------------------------------------- finale etc */

/** Timings inside the finale (0..1 of the chapter). */
export const FINALE = {
  /** The CTA comes up as the sun clears the horizon. */
  ctaAt: 0.6,
};

/** Chapter II: when the engine catches and the lights come up (0..1 of the ignite beat). */
export const IGNITION = { at: 0.32, lightsIn: 0.22 };

/** Global progress where the stage switches from the waterfront to the city (inside the cloud). */
export function stageSwitchAt() {
  const c = chapterById('clearing');
  return c.end - (c.blend / 2) * (c.end - c.start);
}

/* ------------------------------------------------------------------ frames */

const startFrame: Frame & { key: string } = { origin: new Vector3(), heading: 0, key: '' };
const parkedFrame: Frame & { key: string } = { origin: new Vector3(), heading: 0, key: '' };

/** Where the car waits before the drift (chapters I and II). */
export function getStartFrame(): Frame {
  const track = getTrack();
  if (startFrame.key !== track.key) {
    startFrame.heading = sampleTrack(track, sAtProgress(track, 0) - DRIFT.approach, startFrame.origin);
    startFrame.key = track.key;
  }
  return startFrame;
}

/** Where the drift leaves the car (chapter IV). */
export function getParkedFrame(): Frame {
  const track = getTrack();
  if (parkedFrame.key !== track.key) {
    parkedFrame.heading = sampleTrack(track, sAtProgress(track, DRIFT.localEnd), parkedFrame.origin);
    parkedFrame.key = track.key;
  }
  return parkedFrame;
}

export const isStop = (k: string): k is StopId => CHAPTERS.some((c) => c.stop === k);
