/**
 * CHAPTERS
 * ========
 * The page is one scroll and one global `progress` (0..1), split into chapters. It is one
 * continuous drive through one world: the car never leaves the city route
 * (src/lib/cityRoute.ts), and nothing on screen ever cuts.
 *
 *   I    Stillness     night, rain, the car parked on a city street, engine off
 *   II   Ignition      lights and engine come on, the car pulls away
 *   III  The Turn      the drift, through the plaza and down the long left-hander
 *   IV   Wake          the smoke hangs in the street behind it; the title forms in it
 *   V    Arrival       \
 *   VI   Robowars      |
 *   VII  Competitions  |  stops along the drive through the city: each one an LED
 *   VIII Speakers      |  billboard on a facade, framed by the camera, with its panel
 *   IX   TechExpo      |
 *   X    DKMS          |
 *   XI   TWMUN         /
 *        Finale        up the ramp onto the bridge and out over the sea as dawn breaks; the CTA
 *
 * Where the car is at each point of the scroll is src/lib/cityDrive.ts; the camera is
 * src/scene/city/director.ts.
 *
 * Each chapter has a scroll length in viewport heights (`pages`), an environment at its
 * start (`env`) and optionally at its end (`envEnd`). The runtime eases from one chapter's
 * environment into the next over the last `blend` of the chapter, so rain, fog, light
 * colour and exposure never jump.
 */

export type StopId = 'arrival' | 'robowars' | 'competitions' | 'speakers' | 'expo' | 'dkms' | 'twmun' | 'finale';
export type ChapterId = 'stillness' | 'ignition' | 'turn' | 'wake' | StopId;

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
  /** Degrees, 0 = straight down the bridge, negative = to its right. */
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
  /** Lit windows, neon, signs and billboards 0..1. */
  city: number;
  /** How wet the asphalt looks (reflection strength multiplier). */
  wet: number;
  /** Env reflection level on the asphalt and the sea. */
  groundEnv: number;
  seaEnv: number;
  bloom: number;
};

/** Per-chapter effects (eased). */
export type ChapterLook = {
  /** Headlight level (emissive + beams); the ignition and the toggle multiply it. */
  headlights: number;
};

export type Chapter = {
  id: ChapterId;
  numeral: string;
  title: string;
  /** Scroll length in viewport heights. */
  pages: number;
  env: Env;
  envEnd?: Partial<Env>;
  /** Fraction of the chapter spent easing into the next chapter's environment. */
  blend: number;
  look: ChapterLook;
  /** Chapters V onwards: a stop on the city route. */
  stop?: StopId;
  /** Where envEnd is reached, as [from, to] inside the chapter (default [0.04, 0.92]). */
  envSpan?: [number, number];
  /** Where the mini-map / navbar jump lands, 0..1 inside the chapter. */
  anchor: number;
  start: number;
  end: number;
};

/* ------------------------------------------------------------ environments */

/**
 * The city at night in the rain: sodium and neon under low cloud. The city's own lights
 * do most of the work (src/scene/city), so the sky and the moon stay dim.
 */
const CITY: Env = {
  rain: 0.7,
  fog: 0.0105,
  fogColor: '#141018',
  exposure: 1.02,
  skyTop: '#05060b',
  skyHorizon: '#1d1720',
  skyGlow: '#5a3320',
  clouds: 1,
  sun: '#9fc2d6',
  sunIntensity: 0.18,
  sunAzimuth: 140,
  sunElevation: 50,
  hemiSky: '#4a4c60',
  hemiGround: '#1a1008',
  hemi: 0.32,
  env: 0.55,
  day: 0,
  lamps: 1,
  city: 1,
  wet: 1,
  groundEnv: 0.05,
  seaEnv: 0.25,
  bloom: 1.05,
};

/** I: a dark street, the engine off; a little more mist, a little less light. */
const STILL: Env = { ...CITY, rain: 0.75, fog: 0.0125, exposure: 0.88, env: 0.45, bloom: 0.95 };
/** III: the rain comes down harder for the drift. */
const STORM: Env = { ...CITY, rain: 1, fog: 0.011, fogColor: '#16121a', bloom: 1.1 };
/** IV: the rain eases, the smoke hangs. */
const WAKE: Env = { ...CITY, rain: 0.6, fog: 0.0115 };

/** Small shifts per stop, so each block of the city has its own air. */
const ROBOWARS_AIR: Env = { ...CITY, fogColor: '#1c1009', skyGlow: '#7a3a12', bloom: 1.15 };
const SPEAKERS_AIR: Env = { ...CITY, fogColor: '#0c1020', skyGlow: '#2a3a6a' };
const EXPO_AIR: Env = { ...CITY, fogColor: '#081416', skyGlow: '#1a5a60', bloom: 1.15 };
const DKMS_AIR: Env = { ...CITY, rain: 0.45, fog: 0.012, fogColor: '#1e0f0c', skyGlow: '#6a3020', exposure: 0.96, bloom: 0.95 };
const TWMUN_AIR: Env = { ...CITY, rain: 0.45, fogColor: '#130c1e', skyGlow: '#4a2a6a' };

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
  wet: 0.8,
  groundEnv: 0.22,
  seaEnv: 0.95,
  bloom: 0.55,
};

/* ---------------------------------------------------------------- chapters */

const LIT: ChapterLook = { headlights: 1 };

const chapterList: Omit<Chapter, 'start' | 'end'>[] = [
  { id: 'stillness', numeral: 'I', title: 'Stillness', pages: 1.4, env: STILL, blend: 0.4, look: { headlights: 0 }, anchor: 0.02 },
  { id: 'ignition', numeral: 'II', title: 'Ignition', pages: 1.6, env: CITY, blend: 0.3, look: LIT, anchor: 0.05 },
  { id: 'turn', numeral: 'III', title: 'The Turn', pages: 4.2, env: STORM, blend: 0.15, look: LIT, anchor: 0.02 },
  { id: 'wake', numeral: 'IV', title: 'Wake', pages: 2.4, env: WAKE, blend: 0.3, look: LIT, anchor: 0.1 },
  { id: 'arrival', numeral: 'V', title: 'Arrival', pages: 2, env: CITY, blend: 0.25, look: LIT, stop: 'arrival', anchor: 0.4 },
  { id: 'robowars', numeral: 'VI', title: 'Robowars', pages: 2.4, env: ROBOWARS_AIR, blend: 0.25, look: LIT, stop: 'robowars', anchor: 0.4 },
  { id: 'competitions', numeral: 'VII', title: 'Competitions', pages: 3, env: CITY, blend: 0.25, look: LIT, stop: 'competitions', anchor: 0.4 },
  { id: 'speakers', numeral: 'VIII', title: 'Speakers', pages: 2.4, env: SPEAKERS_AIR, blend: 0.25, look: LIT, stop: 'speakers', anchor: 0.4 },
  { id: 'expo', numeral: 'IX', title: 'TechExpo', pages: 2.4, env: EXPO_AIR, blend: 0.25, look: LIT, stop: 'expo', anchor: 0.4 },
  { id: 'dkms', numeral: 'X', title: 'DKMS', pages: 2.4, env: DKMS_AIR, blend: 0.3, look: LIT, stop: 'dkms', anchor: 0.4 },
  { id: 'twmun', numeral: 'XI', title: 'TWMUN', pages: 2.2, env: TWMUN_AIR, blend: 0.3, look: LIT, stop: 'twmun', anchor: 0.4 },
  // up the ramp and over the sea: the rain stops and dawn comes up while the car crosses;
  // the CTA lands at FINALE.ctaAt
  { id: 'finale', numeral: 'Fin', title: 'Finale', pages: 4.2, env: { ...CITY, rain: 0.3 }, envEnd: DAWN, envSpan: [0.08, 0.66], blend: 0, look: LIT, stop: 'finale', anchor: 0.7 },
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

export const chapterById = (id: ChapterId) => CHAPTERS.find((c) => c.id === id)!;

export function chapterIndexAt(p: number) {
  for (let i = CHAPTERS.length - 1; i > 0; i--) if (p >= CHAPTERS[i].start) return i;
  return 0;
}

/** Global progress at a fraction of a chapter. */
export const chapterAt = (id: ChapterId, f: number) => {
  const c = chapterById(id);
  return c.start + f * (c.end - c.start);
};

/** Global progress the mini-map jumps to. */
export const chapterAnchor = (id: ChapterId) => chapterAt(id, chapterById(id).anchor);

/* ----------------------------------------------------------- set moments */

/** Timings inside the finale (0..1 of the chapter). */
export const FINALE = {
  /** The CTA comes up as the sun clears the horizon. */
  ctaAt: 0.62,
};

/** Chapter II: when the engine catches and the lights come up (0..1 of the chapter). */
export const IGNITION = { at: 0.16, lightsIn: 0.12, /** the car pulls away */ driveAt: 0.36 };

export const isStop = (k: string): k is StopId => CHAPTERS.some((c) => c.stop === k);
