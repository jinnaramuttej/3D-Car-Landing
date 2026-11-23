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
 *   V    Arrival     warm morning beside the parked car
 *   VI   Arena       Robowars: dark steel, orange rim light, a robot you can resize
 *   VII  Pit Lane    the competitions as garage bays
 *   VIII Voices      past speakers on a globe
 *   IX   Expo        four holographic pedestals
 *   X    Heartbeat   the stem cell donor drive: slow, warm, quiet
 *   XI   Chamber     the MUN in a purple hall
 *        Finale      back at the car; it leaves into the sunrise
 *
 * Chapters VI-XI are DISTRICTS: sets on platforms out over the sea, a hop of roughly
 * 100 m apart. Moving between them is always a camera move with a fog/light cross-fade
 * (the fog thickens mid-move), never a cut.
 *
 * Each chapter has a scroll length in viewport heights (`pages`), an environment at its
 * start (`env`) and optionally at its end (`envEnd`). The runtime eases from one chapter's
 * environment into the next over the last `blend` of the chapter, so rain, fog, light
 * colour and exposure never jump.
 *
 * Every chapter except III is made of camera BEATS: waypoints in a frame (x = left,
 * y = up, z = forward, metres). Frames:
 *   start    where the car waits before the drift (chapters I and II)
 *   follow   rides with the car along the road, facing down it (the launch in II)
 *   parked   where the drift leaves the car (IV, V and the finale)
 *   <district id>  the district's own platform (VI-XI)
 * A beat eases into the next beat's first waypoint over its last `blend`, across frames
 * too, so the camera always travels. (A mini-map jump still cross-dissolves.)
 */

export type DistrictId = 'arena' | 'pitlane' | 'voices' | 'expo' | 'heartbeat' | 'chamber';
export type ChapterId = 'stillness' | 'ignition' | 'turn' | 'clearing' | 'arrival' | DistrictId | 'finale';
export type BeatId = 'still' | 'ignite' | 'launch' | 'clearing' | 'arrive' | DistrictId | 'finale';
export type FrameKind = 'start' | 'follow' | 'parked' | DistrictId;

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
  /** 0 outdoors .. 1 inside a district hall: the sky, the far city and the bridge go to fog. */
  enclosed: number;
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
  /** Districts (VI-XI): the set this chapter lives in. */
  district?: DistrictId;
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
  enclosed: 0,
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

/** Inside a district hall: no sky, no sun, no rain; its own fog and a little sky light. */
const hall = (fog: number, fogColor: string, hemiSky: string, hemiGround: string, extra: Partial<Env> = {}): Env => ({
  ...MORNING,
  rain: 0,
  enclosed: 1,
  fog,
  fogColor,
  clouds: 0,
  sunIntensity: 0,
  hemiSky,
  hemiGround,
  hemi: 0.3,
  env: 0.6, // of the dark hall env map (see dayEnvironment.ts)
  lamps: 0,
  city: 0,
  wet: 0,
  groundEnv: 0,
  exposure: 1.05,
  bloom: 1.1,
  ...extra,
});

const ARENA = hall(0.03, '#0d0a09', '#4a4f58', '#1a0f08', { hemi: 0.22, env: 0.9, bloom: 1.2 });
const PITLANE = hall(0.022, '#16181c', '#9aa4b0', '#2a2620', { hemi: 0.5, env: 0.7, bloom: 0.9 });
const VOICES_HALL = hall(0.028, '#060914', '#3b4c7a', '#0a0c14', { hemi: 0.2, bloom: 1.25 });
const EXPO_HALL = hall(0.026, '#04090c', '#3a6a7a', '#05080a', { hemi: 0.2, bloom: 1.3 });
const HEARTBEAT_HALL = hall(0.03, '#1e0c09', '#7a4636', '#140806', { hemi: 0.32, exposure: 1 });
const CHAMBER_HALL = hall(0.026, '#120a1c', '#6a4a9a', '#0e0814', { hemi: 0.3, bloom: 1.15 });

/** The finale: back outside, the sun just up, straight down the road. */
const SUNRISE: Env = {
  ...MORNING,
  enclosed: 0,
  fog: 0.0028,
  fogColor: '#b98a6c',
  exposure: 0.9,
  skyTop: '#2f4874',
  skyHorizon: '#e89a6a',
  skyGlow: '#ff8a4a',
  clouds: 0.35,
  sun: '#ffb070',
  sunIntensity: 2.1,
  sunAzimuth: 0,
  sunElevation: 3,
  hemiSky: '#9fb4d6',
  hemiGround: '#6a4a38',
  hemi: 1.1,
  env: 0.9,
  buildings: '#7a7068',
  ground: '#2a2624',
  wet: 0.75,
  groundEnv: 0.28,
  seaEnv: 0.9,
  bloom: 0.45,
};

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
  { id: 'arrival', numeral: 'V', title: 'Arrival', pages: 1.8, env: MORNING, blend: 0.3 },
  { id: 'arena', numeral: 'VI', title: 'Arena', pages: 2.4, env: ARENA, blend: 0.3, district: 'arena' },
  { id: 'pitlane', numeral: 'VII', title: 'Pit Lane', pages: 2.8, env: PITLANE, blend: 0.25, district: 'pitlane' },
  { id: 'voices', numeral: 'VIII', title: 'Hall of Voices', pages: 2.4, env: VOICES_HALL, blend: 0.3, district: 'voices' },
  { id: 'expo', numeral: 'IX', title: 'Expo', pages: 3, env: EXPO_HALL, blend: 0.25, district: 'expo' },
  { id: 'heartbeat', numeral: 'X', title: 'Heartbeat', pages: 2.2, env: HEARTBEAT_HALL, blend: 0.3, district: 'heartbeat' },
  { id: 'chamber', numeral: 'XI', title: 'Chamber', pages: 2.2, env: CHAMBER_HALL, blend: 0.35, district: 'chamber' },
  { id: 'finale', numeral: 'Fin', title: 'Finale', pages: 2, env: SUNRISE, blend: 0 },
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
    // Slow orbit from the front-left to the rear-left; leaves toward the arena.
    id: 'arrive',
    chapter: 'arrival',
    pages: 1.8,
    frame: 'parked',
    camera: [
      { position: [6.85, 1.5, 5.58], lookAt: [0, 0.7, 0], fov: 32, screenShift: 1.9 },
      { position: [8.38, 1.8, -1.52], lookAt: [0, 0.7, 0], fov: 32, screenShift: 1.9 },
    ],
    mobileCamera: { position: [7.32, 1.9, 4.18], lookAt: [0, 0.6, 0], fov: 36 },
    blend: 0.3,
    look: { headlights: 0.8, accent: 0.6, smoke: 0 },
    anchor: 0.2,
  },
  {
    // Round the octagon; the robot sits centre-right of frame.
    id: 'arena',
    chapter: 'arena',
    pages: 2.4,
    frame: 'arena',
    camera: [
      { position: [0, 3.4, 13.5], lookAt: [0, 0.7, 0], fov: 32, screenShift: 1.4 },
      { position: [6.5, 2.8, 10.5], lookAt: [0, 0.7, 0], fov: 30, screenShift: 1.4 },
    ],
    mobileCamera: { position: [0, 4.4, 15], lookAt: [0, 0.6, 0], fov: 38 },
    blend: 0.3,
    look: { headlights: 0, accent: 0, smoke: 0 },
    dof: 1.2,
    focusRange: 4,
    anchor: 0.25,
  },
  {
    // Down the row of garages while the bays slide past.
    id: 'pitlane',
    chapter: 'pitlane',
    pages: 2.8,
    frame: 'pitlane',
    camera: [
      { position: [12, 1.7, 8], lookAt: [8, 1.3, -3], fov: 32 },
      { position: [-12, 1.7, 8], lookAt: [-16, 1.3, -3], fov: 32 },
    ],
    move: 'line',
    mobileCamera: { position: [0, 2.4, 14], lookAt: [0, 1.4, -3], fov: 40 },
    blend: 0.25,
    look: { headlights: 0, accent: 0, smoke: 0 },
    anchor: 0.1,
  },
  {
    // The globe right of frame, the speakers' panel on the left.
    id: 'voices',
    chapter: 'voices',
    pages: 2.4,
    frame: 'voices',
    camera: [
      { position: [0, 3.2, 12], lookAt: [0, 3, 0], fov: 32, screenShift: 1.8 },
      { position: [1.8, 3.3, 11], lookAt: [0, 3, 0], fov: 30, screenShift: 1.8 },
    ],
    mobileCamera: { position: [0, 3.2, 12], lookAt: [0, 3, 0], fov: 38 },
    blend: 0.3,
    look: { headlights: 0, accent: 0, smoke: 0 },
    anchor: 0.25,
  },
  {
    // A dolly along the four pedestals, a beat at each.
    id: 'expo',
    chapter: 'expo',
    pages: 3,
    frame: 'expo',
    camera: [
      { t: 0, position: [-9, 2.2, 7.6], lookAt: [-9, 1.95, 0], fov: 32 },
      { t: 0.33, position: [-3, 2.2, 7.6], lookAt: [-3, 1.95, 0], fov: 32 },
      { t: 0.66, position: [3, 2.2, 7.6], lookAt: [3, 1.95, 0], fov: 32 },
      { t: 1, position: [9, 2.2, 7.6], lookAt: [9, 1.95, 0], fov: 32 },
    ],
    move: 'line',
    mobileCamera: { position: [0, 2.6, 15], lookAt: [0, 1.6, 0], fov: 40 },
    blend: 0.25,
    look: { headlights: 0, accent: 0, smoke: 0 },
    dof: 1.4,
    focusRange: 2.5,
    anchor: 0.08,
  },
  {
    // A slow push toward the pulse. Nothing else moves.
    id: 'heartbeat',
    chapter: 'heartbeat',
    pages: 2.2,
    frame: 'heartbeat',
    camera: [
      { position: [0, 1.5, 9], lookAt: [0, 1.5, 0], fov: 32, screenShift: -1.6 },
      { position: [0, 1.5, 7.2], lookAt: [0, 1.5, 0], fov: 30, screenShift: -1.6 },
    ],
    mobileCamera: { position: [0, 1.8, 10], lookAt: [0, 1.5, 0], fov: 38 },
    blend: 0.3,
    look: { headlights: 0, accent: 0, smoke: 0 },
    anchor: 0.25,
  },
  {
    // The chamber from the back benches, drifting toward the dais.
    id: 'chamber',
    chapter: 'chamber',
    pages: 2.2,
    frame: 'chamber',
    camera: [
      { position: [0, 2.6, 12], lookAt: [0, 1.4, -4], fov: 34 },
      { position: [4.5, 2.3, 8], lookAt: [0, 1.4, -4], fov: 32 },
    ],
    mobileCamera: { position: [0, 3, 14], lookAt: [0, 1.4, -4], fov: 40 },
    blend: 0.35,
    look: { headlights: 0, accent: 0, smoke: 0 },
    anchor: 0.25,
  },
  {
    // Back at the car: rev, flare, and it leaves into the sunrise.
    id: 'finale',
    chapter: 'finale',
    pages: 2,
    frame: 'parked',
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

/**
 * Where the district platforms sit, in the parked car's frame (x = left toward the sea,
 * z = down the road), and how each set is turned. A loop out over the water and back:
 * car -> arena -> pit lane -> voices -> expo -> heartbeat -> chamber -> car.
 */
export const DISTRICTS: Record<DistrictId, { x: number; z: number; yawDeg: number; radius: number }> = {
  arena: { x: 62, z: 70, yawDeg: 0, radius: 16 },
  pitlane: { x: 82, z: 178, yawDeg: 0, radius: 24 },
  voices: { x: 178, z: 218, yawDeg: 0, radius: 16 },
  expo: { x: 205, z: 110, yawDeg: 0, radius: 20 },
  heartbeat: { x: 172, z: 12, yawDeg: 0, radius: 14 },
  chamber: { x: 104, z: 24, yawDeg: 0, radius: 18 },
};

/* ------------------------------------------------------------------ frames */

const startFrame: Frame & { key: string } = { origin: new Vector3(), heading: 0, key: '' };
const districtFrames = new Map<DistrictId, Frame & { key: string }>();
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

/** A district's set: origin and heading in the world. */
export function getDistrictFrame(id: DistrictId): Frame {
  const track = getTrack();
  let f = districtFrames.get(id);
  if (!f) {
    f = { origin: new Vector3(), heading: 0, key: '' };
    districtFrames.set(id, f);
  }
  if (f.key !== track.key) {
    const p = getParkedFrame();
    const d = DISTRICTS[id];
    const fwd = new Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    const left = new Vector3(Math.cos(p.heading), 0, -Math.sin(p.heading));
    f.origin.copy(p.origin).addScaledVector(left, d.x).addScaledVector(fwd, d.z).setY(0);
    f.heading = p.heading + (d.yawDeg * Math.PI) / 180;
    f.key = track.key;
  }
  return f;
}

export const isDistrict = (k: string): k is DistrictId => k in DISTRICTS;
