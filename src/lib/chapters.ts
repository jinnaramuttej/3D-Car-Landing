import { DRIFT, GO_AT, IGNITE_AT, journeySeconds, moments, progressAtTime, timeAtS } from './pacing';

/**
 * CHAPTERS
 * ========
 * The page is one scroll and one global `progress` (0..1): a time axis, progress =
 * t / journeySeconds() (src/lib/pacing.ts has the speed curve the car drives to). It is one
 * continuous drive through one world: the car never leaves the city route
 * (src/lib/cityRoute.ts), and nothing on screen ever cuts. Fast runs, slow zones:
 *
 *   00   Techfest 2026  the car parked on a rainy street under the title; the engine
 *                       catches, it pulls away and takes the plaza sideways
 *   01   The Arena      Robowars          \
 *   02   The Pit Lane   competitions      |  a run, then a slow zone: the car rolls past
 *   03   The Stage      past speakers,    |  the stop's billboard at walking pace while its
 *                       TechExpo / Ignite |  panel plays out, then launches
 *   04   The Heartbeat  DKMS, the slowest /
 *   Fin  Finale         up the ramp and out over the sea as dawn breaks; the CTA and the
 *                       rest of Techfest (Catalyst, TWMUN, workshops, CES 2027)
 *
 * A stop's chapter is the run into it plus its zone; it ends as the car launches out.
 * Where the car is at each moment is src/lib/cityDrive.ts; the camera is
 * src/scene/city/director.ts.
 *
 * Each chapter has a scroll length (`pages`, in viewport heights, proportional to its
 * time, so an even scroll is an even pace), an environment at its start (`env`) and
 * optionally at its end (`envEnd`). The runtime eases from one chapter's environment into
 * the next over the last `blend` of the chapter, so rain, fog, light colour and exposure
 * never jump.
 */

export type StopId = 'robowars' | 'competitions' | 'speakers' | 'dkms' | 'finale';
export type ChapterId = 'intro' | StopId;

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
  /** The four stops and the finale. */
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

/** Parked: a dark street, the engine off; a little more mist, a little less light. */
const STILL: Env = { ...CITY, rain: 0.75, fog: 0.0125, exposure: 0.88, env: 0.45, bloom: 0.95 };
/** The drift: the rain comes down harder. */
const STORM: Env = { ...CITY, rain: 1, fog: 0.011, fogColor: '#16121a', bloom: 1.1 };
/** After it: the rain eases, the smoke hangs. */
const WAKE: Env = { ...CITY, rain: 0.6, fog: 0.0115 };

/**
 * The stops share one grade (the city's fog colour, sky glow, bloom and exposure, with the
 * page's one accent on the boards): only the weather moves between them, and the
 * Heartbeat is the quietest.
 */
const DKMS_AIR: Env = { ...CITY, rain: 0.45, fog: 0.012 };

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

/** Journey time where each chapter ends: the intro once the drift is done, a stop as the car launches out of its zone. */
const ends = () => {
  const m = moments();
  return {
    intro: timeAtS(DRIFT.to),
    robowars: m.zones.robowars.t1,
    competitions: m.zones.competitions.t1,
    speakers: m.zones.speakers.t1,
    dkms: m.zones.dkms.t1,
    finale: m.duration,
  } as Record<ChapterId, number>;
};

type ChapterDef = Omit<Chapter, 'start' | 'end' | 'pages'>;
const chapterList: ChapterDef[] = [
  // parked under the title, the engine catches, the launch and the drift (the rain comes
  // down harder for it)
  { id: 'intro', numeral: '00', title: 'Techfest 2026', env: STILL, envEnd: STORM, envSpan: [0.3, 0.55], blend: 0.2, look: { headlights: 0 }, anchor: 0.02 },
  { id: 'robowars', numeral: '01', title: 'The Arena', env: WAKE, envEnd: CITY, envSpan: [0.1, 0.5], blend: 0.2, look: LIT, stop: 'robowars', anchor: 0.62 },
  { id: 'competitions', numeral: '02', title: 'The Pit Lane', env: CITY, blend: 0.2, look: LIT, stop: 'competitions', anchor: 0.45 },
  { id: 'speakers', numeral: '03', title: 'The Stage', env: CITY, blend: 0.25, look: LIT, stop: 'speakers', anchor: 0.45 },
  { id: 'dkms', numeral: '04', title: 'The Heartbeat', env: DKMS_AIR, blend: 0.3, look: LIT, stop: 'dkms', anchor: 0.45 },
  // up the ramp and over the sea: the rain stops and dawn comes up while the car crosses
  { id: 'finale', numeral: 'Fin', title: 'Finale', env: { ...CITY, rain: 0.3 }, envEnd: DAWN, envSpan: [0.06, 0.62], blend: 0, look: LIT, stop: 'finale', anchor: 0.8 },
];

/* ------------------------------------------------------------------ layout */

/** Scroll length per second of the drive, viewport heights (an even scroll, an even pace). */
const PAGES_PER_SECOND = 0.22;

/** Total scroll height in viewport heights (the chapters' `pages`; the track itself is SCROLL_PX). */
export const PAGES = journeySeconds() * PAGES_PER_SECOND;

/**
 * Scroll pixels per second of the journey: a wheel notch (about 100 px) is about 0.4 s of
 * it, whatever the window's height. The scroll track is SCROLL_PX plus one screen.
 */
export const PX_PER_SECOND = 250;
export const SCROLL_PX = Math.round(journeySeconds() * PX_PER_SECOND);

export const CHAPTERS: Chapter[] = (() => {
  const e = ends();
  let t0 = 0;
  return chapterList.map((c) => {
    const t1 = e[c.id];
    const out = { ...c, pages: (t1 - t0) * PAGES_PER_SECOND, start: progressAtTime(t0), end: progressAtTime(t1) };
    t0 = t1;
    return out;
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

/** The finale: the CTA comes up as the car eases off under the far pylon (global progress). */
export const FINALE = {
  ctaAt: progressAtTime(moments().finaleRollAt - 1.5),
};

/** The engine catches and the lights come up, then the car pulls away (global progress). */
export const IGNITION = {
  at: progressAtTime(IGNITE_AT),
  lightsIn: progressAtTime(IGNITE_AT + 0.9) - progressAtTime(IGNITE_AT),
  driveAt: progressAtTime(GO_AT),
};

export const isStop = (k: string): k is StopId => CHAPTERS.some((c) => c.stop === k);
