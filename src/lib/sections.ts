import { Vector3 } from 'three';
import { getTrack, sAtProgress, sampleTrack, type Frame } from './motion';
import type { Vec3 } from './script';

/**
 * SECTIONS CONFIG
 * ===============
 * The page is one scroll (CONFIG.scroll.pages = 14 -> 1400vh) and one global `progress`.
 *
 *   global 0.00 - 0.30   the drift scene, untouched. It plays its own 0 -> 0.78 at the same
 *                        scroll speed as before (390vh), then parks the car on the exit straight.
 *   global 0.30 - 1.00   the sections below, all around that parked car.
 *
 * Camera waypoints are in the PARKED CAR's frame, metres: x = left, y = up, z = forward
 * (down the track). A section can list several waypoints: the camera moves through them
 * across the section, and eases into the next section's first waypoint over the last
 * `blend` of it. Positions are interpolated around the car (cylindrically), so moves
 * orbit the car instead of cutting through it. CameraRig damps the result with maath.
 *
 * `look` sets lighting/fog at the section start, `lookEnd` (optional) where it ends up.
 */

export const DRIFT = {
  /** Global progress where the drift scene hands over to the sections. */
  end: 0.3,
  /** Drift-scene progress reached at that point (its own 0..1 timeline). */
  localEnd: 0.78,
};

/** Global progress -> the drift scene's own progress (holds at localEnd afterwards). */
export function driftLocal(global: number) {
  return Math.min(Math.max(global, 0) / DRIFT.end, 1) * DRIFT.localEnd;
}

/** Drift-scene progress -> global progress (for debug jumps and timeline labels). */
export function fromDriftLocal(local: number) {
  return (local / DRIFT.localEnd) * DRIFT.end;
}

export type SectionId = 'hero' | 'about' | 'events' | 'schedule' | 'prizes' | 'finale';

export type Waypoint = {
  /** 0..1 inside the section. Omit to spread waypoints evenly. */
  t?: number;
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  /** Metres to push the subject toward screen-right (negative = left), to leave room for text. */
  screenShift?: number;
};

export type SectionLook = {
  /** FogExp2 density. */
  fog: number;
  /** Environment (HDRI) intensity. */
  env: number;
  /** Bloom multiplier on CONFIG.look.bloomIntensity. */
  bloom: number;
  /** Headlight multiplier (emissive + beams). */
  headlights: number;
  /** Neon accent rim light behind the car. */
  accent: number;
  /** Smoke density, 0 clear .. 1 screen full (veil + cloud). */
  smoke: number;
};

export type Section = {
  id: SectionId;
  start: number;
  end: number;
  /** Where the navbar scrolls to, 0..1 inside the section. */
  anchor: number;
  camera: Waypoint[];
  /**
   * How the camera travels between this section's waypoints: 'orbit' swings around the
   * car (default), 'line' goes straight (dollies along the car or down the track).
   * Hand-overs between sections always orbit, so they never cut through the car.
   */
  move?: 'orbit' | 'line';
  /** Mobile: one still waypoint instead of the move (defaults to the first). */
  mobileCamera?: Waypoint;
  /** Fraction of the section spent easing into the next section's first waypoint. */
  blend?: number;
  look: SectionLook;
  lookEnd?: Partial<SectionLook>;
  /** Depth of field bokeh and in-focus range (metres) around the look target. */
  dof?: number;
  focusRange?: number;
};

export const SECTIONS: Section[] = [
  {
    // Smoke thins out around the parked car, title/date/venue/CTA come in sharp.
    id: 'hero',
    start: 0.3,
    end: 0.4,
    anchor: 0.55,
    // look target above the car so it sits in the lower third, under the title and CTAs
    camera: [
      { position: [5.2, 1.1, 8.4], lookAt: [0.2, 2.25, 0], fov: 40 },
      { position: [4.3, 1.0, 7.0], lookAt: [0.1, 2.15, 0], fov: 38 },
    ],
    look: { fog: 0.014, env: 0.9, bloom: 1, headlights: 1, accent: 0.4, smoke: 0.85 },
    lookEnd: { smoke: 0, accent: 1 },
  },
  {
    // Slow orbit from the front-left round to the rear-left; stats count up.
    id: 'about',
    start: 0.4,
    end: 0.515,
    anchor: 0.45,
    camera: [
      { position: [5.4, 1.5, 4.4], lookAt: [0, 0.7, 0], fov: 40, screenShift: 1.9 },
      { position: [6.6, 1.8, -1.2], lookAt: [0, 0.7, 0], fov: 40, screenShift: 1.9 },
      { position: [3.4, 2.0, -6.2], lookAt: [0, 0.7, 0], fov: 40, screenShift: 1.9 },
    ],
    mobileCamera: { position: [5.6, 1.9, 3.2], lookAt: [0, 0.6, 0], fov: 46 },
    look: { fog: 0.012, env: 0.95, bloom: 1, headlights: 1, accent: 1.2, smoke: 0 },
  },
  {
    // Pinned: vertical scroll slides the event cards sideways while the camera
    // tracks along the car's left flank, nose to tail.
    id: 'events',
    start: 0.515,
    end: 0.685,
    anchor: 0.2,
    camera: [
      { position: [3.3, 1.35, 3.6], lookAt: [0.3, 0.55, 2.2], fov: 38 },
      { position: [3.3, 1.45, -3.4], lookAt: [0.3, 0.65, -2.0], fov: 38 },
    ],
    move: 'line',
    mobileCamera: { position: [4.2, 2.2, 1.0], lookAt: [0, 0.4, 0], fov: 50 },
    look: { fog: 0.012, env: 0.9, bloom: 1, headlights: 1, accent: 0.8, smoke: 0 },
    dof: 1.4,
    focusRange: 2.5,
  },
  {
    // Camera runs down the track past one neon post per day.
    id: 'schedule',
    start: 0.685,
    end: 0.805,
    anchor: 0.15,
    // right-hand lane, aimed a little toward the posts so each one lights up in frame
    camera: [
      { position: [-3, 1.3, -6], lookAt: [-6, 1.0, 22], fov: 50 },
      { position: [-3, 1.4, 58], lookAt: [-6, 1.0, 86], fov: 50 },
    ],
    move: 'line',
    mobileCamera: { position: [-3.2, 1.6, -5], lookAt: [-7, 1.2, 30], fov: 56 },
    blend: 0.25,
    look: { fog: 0.01, env: 0.8, bloom: 1.15, headlights: 1.25, accent: 0, smoke: 0 },
  },
  {
    // Close-up on the headlights with extra bloom.
    id: 'prizes',
    start: 0.805,
    end: 0.915,
    anchor: 0.4,
    // tight on the left headlight from the front-left corner, light unit right of centre
    camera: [
      // aim above and left of the lamp so it sits low-right, clear of the prize cards
      { position: [2.15, 0.7, 3.05], lookAt: [0.62, 0.84, 1.85], fov: 30, screenShift: 0.32 },
      { position: [1.85, 0.68, 2.8], lookAt: [0.62, 0.82, 1.85], fov: 28, screenShift: 0.32 },
    ],
    mobileCamera: { position: [1.6, 0.9, 4.6], lookAt: [0.3, 0.6, 1.8], fov: 40 },
    look: { fog: 0.016, env: 0.7, bloom: 1.5, headlights: 1.35, accent: 0.5, smoke: 0 },
    dof: 1.8,
    focusRange: 0.8,
  },
  {
    // Rev, headlight flare, launch. Camera swings behind and watches the tail lights go.
    id: 'finale',
    start: 0.915,
    end: 1,
    anchor: 0.9,
    // front 3/4 through the rev and the headlight flare, swing round the left side,
    // then sit low behind it for the launch
    camera: [
      { t: 0, position: [3.8, 0.8, 7.0], lookAt: [0, 0.65, 0.4], fov: 40 },
      { t: 0.18, position: [3.1, 0.72, 5.9], lookAt: [0, 0.65, 0.4], fov: 38 },
      { t: 0.28, position: [-0.9, 0.62, -7.5], lookAt: [0, 0.8, 22], fov: 42 },
      { t: 1, position: [-0.7, 0.95, -8.6], lookAt: [0, 0.8, 40], fov: 40 },
    ],
    mobileCamera: { position: [-0.8, 1.0, -9], lookAt: [0, 0.8, 30], fov: 50 },
    look: { fog: 0.016, env: 0.8, bloom: 1.4, headlights: 1.2, accent: 0, smoke: 0 },
    lookEnd: { fog: 0.024 },
  },
];

/** Timings inside the finale (0..1 of the section). */
export const FINALE = {
  revAt: 0.03, // engine rev sound
  flareAt: 0.13, // headlight flare peak
  flareWidth: 0.06,
  flarePeak: 3.2, // extra headlight multiplier at the peak
  launchFrom: 0.28,
  launchTo: 0.86,
  launchDistance: 175, // metres down the track
  burnoutAt: 0.31, // wheelspin smoke off the line (kept small: it rolls back toward the camera)
  burnoutWidth: 0.03,
  burnoutPeak: 0.35,
  ctaAt: 0.74, // CTA fades in as the tail lights disappear
};

/** Neon schedule posts, one per day: car-local position of the first and the spacing. */
export const SCHEDULE_POSTS = {
  x: -9.5, // right-hand side of the road
  firstZ: 16,
  spacing: 16,
  /** A post lights up while the camera is this many metres short of it (still in frame). */
  lightFrom: 15,
  lightTo: 9,
};

export const DEFAULT_BLEND = 0.18;

export function sectionIndexAt(p: number) {
  if (p < SECTIONS[0].start) return -1;
  for (let i = SECTIONS.length - 1; i >= 0; i--) if (p >= SECTIONS[i].start) return i;
  return -1;
}

export function sectionById(id: SectionId) {
  return SECTIONS.find((s) => s.id === id)!;
}

/** Global progress the navbar scrolls to for a section. */
export function anchorProgress(id: SectionId) {
  const s = sectionById(id);
  return s.start + s.anchor * (s.end - s.start);
}

const parked: Frame & { key: string } = { origin: new Vector3(), heading: 0, key: '' };

/** Where the drift scene leaves the car (DRIFT.localEnd on the track): the sections' origin. */
export function getParkedFrame(): Frame {
  const track = getTrack();
  if (parked.key !== track.key) {
    parked.heading = sampleTrack(track, sAtProgress(track, DRIFT.localEnd), parked.origin);
    parked.key = track.key;
  }
  return parked;
}
