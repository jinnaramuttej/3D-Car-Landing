import { Vector3 } from 'three';
import { getTrack, sAtProgress, sampleTrack, type Frame } from './motion';
import type { Vec3 } from './script';

/**
 * CHAPTERS
 * ========
 * The page is one scroll and one global `progress` (0..1), split into five chapters:
 *
 *   I    Stillness   night, heavy rain, the car parked with the engine off
 *   II   Ignition    lights and engine come on, the car pulls away into the first bend
 *   III  The Turn    the drift scene (src/lib/script.ts), untouched, at its original pace
 *   IV   Clearing    the smoke settles, the rain thins, dawn breaks, the title forms
 *   V    Arrival     warm morning; the festival content, then the car leaves
 *
 * Each chapter has a scroll length in viewport heights (`pages`), an environment at its
 * start (`env`) and optionally at its end (`envEnd`). The runtime eases from one chapter's
 * environment into the next over the last `blend` of the chapter, so rain, fog, light
 * colour and exposure never jump.
 *
 * Every chapter except III is made of camera BEATS: waypoints in a frame (x = left,
 * y = up, z = forward, metres), like the old sections. Frames:
 *   start   where the car waits before the drift (chapters I and II)
 *   follow  rides with the car along the road, facing down it (the launch in II)
 *   parked  where the drift leaves the car (chapters IV and V)
 * `enter: 'dissolve'` cuts the camera to the beat and cross-dissolves over the cut.
 */

export type ChapterId = 'stillness' | 'ignition' | 'turn' | 'clearing' | 'arrival';
export type BeatId =
  | 'still'
  | 'ignite'
  | 'launch'
  | 'clearing'
  | 'arrive'
  | 'numbers'
  | 'pitlane'
  | 'markers'
  | 'partners'
  | 'finale';
export type FrameKind = 'start' | 'follow' | 'parked';

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

const DAWN: Partial<Env> = {
  rain: 0,
  fog: 0.0065,
  fogColor: '#6d5a62',
  exposure: 1.05,
  skyTop: '#2b3658',
  skyHorizon: '#d4886a',
  skyGlow: '#ffae78',
  clouds: 0.45,
  sun: '#ff9c66',
  sunIntensity: 1.6,
  sunAzimuth: -38,
  sunElevation: 4,
  hemiSky: '#8a93b8',
  hemiGround: '#3a2a24',
  hemi: 0.6,
  env: 0.75,
  day: 1,
  lamps: 0.25,
  city: 0.3,
  buildings: '#3b3c43',
  ground: '#1a1a1e',
  wet: 0.9,
  groundEnv: 0.22,
  seaEnv: 0.6,
  bloom: 0.8,
};

const MORNING: Env = {
  ...NIGHT,
  ...DAWN,
  fog: 0.005,
  fogColor: '#cbb69c',
  exposure: 1.18,
  skyTop: '#5c86b8',
  skyHorizon: '#f1c69a',
  skyGlow: '#ffd59c',
  clouds: 0.3,
  sun: '#ffd29a',
  sunIntensity: 3,
  sunAzimuth: -34,
  sunElevation: 12,
  hemiSky: '#c4d7ec',
  hemiGround: '#6a5642',
  hemi: 1.5,
  env: 1.05,
  lamps: 0,
  city: 0.04,
  buildings: '#8d8a83',
  ground: '#2c2b2a',
  wet: 0.65,
  groundEnv: 0.3,
  seaEnv: 0.9,
  bloom: 0.55,
} as Env;

/* ---------------------------------------------------------------- chapters */

const chapterList: Omit<Chapter, 'start' | 'end'>[] = [
  { id: 'stillness', numeral: 'I', title: 'Stillness', pages: 1.4, env: STILL, blend: 0.4 },
  { id: 'ignition', numeral: 'II', title: 'Ignition', pages: 1.6, env: NIGHT, blend: 0.1 },
  { id: 'turn', numeral: 'III', title: 'The Turn', pages: 4.2, env: NIGHT, blend: 0.02 },
  // the env map flips to daylight right at the start, under the smoke cover
  {
    id: 'clearing',
    numeral: 'IV',
    title: 'Clearing',
    pages: 2,
    env: { ...NIGHT, rain: 0.85, day: 1, env: 0.35, groundEnv: 0.12 },
    envEnd: DAWN,
    blend: 0.25,
  },
  { id: 'arrival', numeral: 'V', title: 'Arrival', pages: 9.6, env: MORNING, envEnd: { sunElevation: 18, sunIntensity: 2.8, fog: 0.004 }, blend: 0 },
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
    // The drift leaves the car in its own smoke; it thins as dawn comes up.
    id: 'clearing',
    chapter: 'clearing',
    pages: 2,
    frame: 'parked',
    camera: [
      { position: [6.55, 1.1, 10.66], lookAt: [0.2, 2.25, 0], fov: 32 },
      { position: [5.5, 1.0, 9.0], lookAt: [0.1, 2.15, 0], fov: 30 },
    ],
    look: { headlights: 1, accent: 0.3, smoke: 1 },
    lookEnd: { smoke: 0, accent: 0.6 },
    anchor: 0.62,
  },
  {
    // Slow orbit from the front-left to the rear-left.
    id: 'arrive',
    chapter: 'arrival',
    pages: 1.4,
    frame: 'parked',
    camera: [
      { position: [6.85, 1.5, 5.58], lookAt: [0, 0.7, 0], fov: 32, screenShift: 1.9 },
      { position: [8.38, 1.8, -1.52], lookAt: [0, 0.7, 0], fov: 32, screenShift: 1.9 },
      { position: [4.32, 2.0, -7.87], lookAt: [0, 0.7, 0], fov: 32, screenShift: 1.9 },
    ],
    mobileCamera: { position: [7.32, 1.9, 4.18], lookAt: [0, 0.6, 0], fov: 36 },
    look: { headlights: 0.8, accent: 0.6, smoke: 0 },
    anchor: 0.3,
  },
  {
    // Tight on the headlight while the numbers come up.
    id: 'numbers',
    chapter: 'arrival',
    pages: 1.2,
    frame: 'parked',
    camera: [
      { position: [2.15, 0.7, 3.05], lookAt: [0.62, 0.84, 1.85], fov: 30, screenShift: 0.32 },
      { position: [1.85, 0.68, 2.8], lookAt: [0.62, 0.82, 1.85], fov: 28, screenShift: 0.32 },
    ],
    mobileCamera: { position: [1.85, 0.9, 5.13], lookAt: [0.3, 0.6, 1.8], fov: 34 },
    look: { headlights: 1, accent: 0.3, smoke: 0 },
    dof: 1.8,
    focusRange: 0.8,
    anchor: 0.35,
  },
  {
    // Pinned: the garage bays slide sideways while the camera tracks the flank.
    id: 'pitlane',
    chapter: 'arrival',
    pages: 2.4,
    frame: 'parked',
    camera: [
      { position: [3.9, 1.35, 3.88], lookAt: [0.3, 0.55, 2.2], fov: 32 },
      { position: [3.9, 1.45, -3.68], lookAt: [0.3, 0.65, -2.0], fov: 32 },
    ],
    move: 'line',
    mobileCamera: { position: [5.69, 2.2, 1.35], lookAt: [0, 0.4, 0], fov: 38 },
    look: { headlights: 0.8, accent: 0.5, smoke: 0 },
    dof: 1.4,
    focusRange: 2.5,
    anchor: 0.12,
  },
  {
    // Down the road past one mile marker per day.
    id: 'markers',
    chapter: 'arrival',
    pages: 1.6,
    frame: 'parked',
    camera: [
      { position: [-3, 1.3, -6], lookAt: [-6.5, 0.8, 22], fov: 36 },
      { position: [-3, 1.4, 58], lookAt: [-6.5, 0.8, 86], fov: 36 },
    ],
    move: 'line',
    mobileCamera: { position: [-3.2, 1.6, -5], lookAt: [-7, 1.0, 30], fov: 40 },
    blend: 0.2,
    look: { headlights: 0.8, accent: 0, smoke: 0 },
    anchor: 0.15,
  },
  {
    // On down the road past the partner billboards.
    id: 'partners',
    chapter: 'arrival',
    pages: 1.4,
    frame: 'parked',
    camera: [
      { position: [-2.8, 1.5, 60], lookAt: [-9, 3.4, 92], fov: 34 },
      { position: [-2.6, 1.7, 112], lookAt: [-10, 3.6, 150], fov: 34 },
    ],
    move: 'line',
    mobileCamera: { position: [-3, 1.8, 62], lookAt: [-10, 3.4, 104], fov: 40 },
    look: { headlights: 0.8, accent: 0, smoke: 0 },
    anchor: 0.2,
  },
  {
    // Back at the car (dissolve): rev, flare, it leaves toward the sun.
    id: 'finale',
    chapter: 'arrival',
    pages: 1.6,
    frame: 'parked',
    enter: 'dissolve',
    camera: [
      { t: 0, position: [4.52, 0.8, 8.26], lookAt: [0, 0.65, 0.4], fov: 34 },
      { t: 0.18, position: [3.72, 0.72, 7.0], lookAt: [0, 0.65, 0.4], fov: 32 },
      { t: 0.28, position: [-1.06, 0.62, -12.85], lookAt: [0, 0.8, 22], fov: 36 },
      { t: 1, position: [-0.83, 0.95, -17.86], lookAt: [0, 0.8, 40], fov: 34 },
    ],
    mobileCamera: { position: [-1.08, 1.0, -22.82], lookAt: [0, 0.8, 30], fov: 38 },
    look: { headlights: 1, accent: 0, smoke: 0 },
    anchor: 0.82,
  },
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

/** Timings inside the finale beat (0..1). */
export const FINALE = {
  revAt: 0.03,
  flareAt: 0.13,
  flareWidth: 0.06,
  flarePeak: 3.2,
  launchFrom: 0.28,
  launchTo: 0.86,
  launchDistance: 175,
  burnoutAt: 0.31,
  burnoutWidth: 0.03,
  burnoutPeak: 0.35,
  ctaAt: 0.6,
};

/** Chapter II: when the engine catches and the lights come up (0..1 of the ignite beat). */
export const IGNITION = { at: 0.32, lightsIn: 0.22 };

/** Mile markers (schedule), parked-car frame: right-hand roadside, one per day. */
export const MARKERS = { x: -8.4, firstZ: 18, spacing: 18, showFrom: 16, showTo: 8 };

/** Partner billboards, parked-car frame, on the city side. */
export const BILLBOARDS = { x: -12.5, firstZ: 82, spacing: 26, yawDeg: 28 };

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

/** Where the drift leaves the car (chapters IV and V). */
export function getParkedFrame(): Frame {
  const track = getTrack();
  if (parkedFrame.key !== track.key) {
    parkedFrame.heading = sampleTrack(track, sAtProgress(track, DRIFT.localEnd), parkedFrame.origin);
    parkedFrame.key = track.key;
  }
  return parkedFrame;
}
