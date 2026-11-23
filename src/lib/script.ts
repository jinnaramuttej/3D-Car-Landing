/**
 * THE SHOT SCRIPT
 * ===============
 * One scroll = one take, cut like a film. Every shot owns a slice of progress.
 *
 *  #  progress     shot            what the viewer sees
 *  1  0.00-0.13    COLD OPEN       Car already sideways through the right-hander, rears
 *                                  lit up, smoke rolling. Low front 3/4 from the outside, slow push.
 *  2  0.13-0.30    THE FLANK       CUT. Tight tracking shot down the right side, nose to
 *                                  tail (screen right to left): headlight, arch, #91, rear arch, wing.
 *  3  0.30-0.40    THE TAIL        Swings round the rear: tail lights flare under braking,
 *                                  camera pulls back and rises as it turns in.
 *  4  0.40-0.48    THE TYRE        CUT. Right-rear tyre at hub height. It lights up, the slide
 *                                  starts, smoke erupts at the lens.
 *  5  0.48-0.66    THE DRIFT       CUT. Full slide through the long left-hander on a long lens:
 *                                  swings from the flank (smoke streaming back) to the front 3/4,
 *                                  the car coming at the lens sideways. Shake peaks mid-shot.
 *  6  0.66-1.00    INTO THE SMOKE  Pull back and rise over the cloud, then push into it. Smoke covers
 *                                  the frame by 0.82, the title emerges.
 *
 * Camera keys are in the shot's frame, metres:  x = left, y = up, z = forward.
 *   body   = moves and yaws with the car body (car-mounted rig: close-ups)
 *   path   = moves with the car, faces along the road (so the drift angle reads)
 *   anchor = fixed on the track where the smoke cloud hangs (CONFIG.camera.anchorP)
 *
 * The car motion that goes with this lives in CONFIG.introDrift / CONFIG.drift / CONFIG.track.
 */

export type Vec3 = readonly [number, number, number];
export type ShotFrame = 'body' | 'path' | 'anchor';
export type Ease = 'linear' | 'in' | 'out' | 'inOut';

export type CamKey = {
  /** 0..1 inside the shot. Omit to spread keys evenly. */
  t?: number;
  pos: Vec3;
  look: Vec3;
  fov: number;
};

export type Shot = {
  id: string;
  title: string;
  from: number;
  to: number;
  /** How we arrive from the previous shot. */
  enter: 'cut' | 'blend';
  /** Progress spent blending in from the previous shot (enter = 'blend'). */
  blend?: number;
  frame: ShotFrame;
  ease?: Ease;
  keys: CamKey[];
  /** Multiplier on the drift camera shake (CONFIG.camera.shakePeak). */
  shake?: number;
  /** Slow hand-held float, 0..1. */
  handheld?: number;
  /** Depth of field bokeh scale (0 = off) and in-focus range in metres around the subject. */
  dof?: number;
  focusRange?: number;
  /** Smoke puffs fade between these camera distances (close shots let smoke reach the lens). */
  nearFade?: readonly [number, number];
};

export const SHOTS: Shot[] = [
  {
    id: 'cold-open',
    title: 'Cold open',
    from: 0,
    to: 0.13,
    enter: 'cut',
    frame: 'path',
    ease: 'out',
    // look target sits off the car toward screen-left, so the car fills the right
    // two-thirds and the intro title has the left third
    keys: [
      { pos: [4.4, 0.42, 7.2], look: [-0.9, 0.55, 1.1], fov: 38 },
      { pos: [3.3, 0.5, 5.4], look: [-0.8, 0.6, 0.6], fov: 34 },
    ],
    handheld: 0.6,
    dof: 2,
    focusRange: 3,
  },
  {
    id: 'flank',
    title: 'The flank',
    from: 0.13,
    to: 0.3,
    enter: 'cut',
    frame: 'body',
    ease: 'linear',
    keys: [
      { pos: [-2.0, 0.62, 2.6], look: [-0.6, 0.5, 2.1], fov: 32 },
      { pos: [-2.6, 0.85, 0.2], look: [-0.5, 0.55, -0.4], fov: 34 },
      { pos: [-2.0, 0.95, -2.7], look: [-0.5, 0.85, -2.3], fov: 32 },
    ],
    handheld: 0.4,
    dof: 3.5,
    focusRange: 1.2,
  },
  {
    id: 'tail',
    title: 'The tail',
    from: 0.3,
    to: 0.4,
    enter: 'blend',
    blend: 0.03,
    frame: 'body',
    ease: 'inOut',
    keys: [
      { pos: [-0.9, 0.55, -4.6], look: [0, 0.75, -1.6], fov: 40 },
      { pos: [0.3, 1.25, -7.2], look: [0, 0.8, 1], fov: 46 },
    ],
    handheld: 0.5,
    dof: 2,
    focusRange: 2.5,
  },
  {
    id: 'tyre',
    title: 'The tyre',
    from: 0.4,
    to: 0.48,
    enter: 'cut',
    frame: 'body',
    ease: 'out',
    keys: [
      { pos: [-2.3, 0.3, 0.05], look: [-0.86, 0.32, -1.25], fov: 36 },
      { pos: [-1.95, 0.33, -0.4], look: [-0.86, 0.32, -1.25], fov: 31 },
    ],
    shake: 0.5,
    dof: 4,
    focusRange: 0.8,
    nearFade: [0.05, 0.45],
  },
  {
    id: 'drift',
    title: 'The drift',
    from: 0.48,
    to: 0.66,
    enter: 'cut',
    frame: 'path',
    ease: 'inOut',
    // Telephoto swing from the flank (smoke streaming back) round to the front 3/4
    // (the car comes at the lens sideways). Long lens, low, compressed background.
    keys: [
      { pos: [-11.3, 0.5, 6.5], look: [0, 0.6, 1.0], fov: 40 },
      { pos: [-7.7, 0.6, 9.9], look: [0, 0.6, 0.8], fov: 38 },
      { pos: [-3.1, 0.9, 11.6], look: [0, 0.65, 0.5], fov: 42 },
    ],
    shake: 1,
    dof: 1.5,
    focusRange: 5,
  },
  {
    id: 'smoke',
    title: 'Into the smoke',
    from: 0.66,
    to: 1,
    enter: 'blend',
    blend: 0.06,
    frame: 'anchor',
    ease: 'linear',
    keys: [
      { t: 0, pos: [-12, 3, 4.5], look: [0, 0.8, 3], fov: 55 },
      { t: 0.18, pos: [-17.9, 7.5, 6.5], look: [0, 0.8, 4], fov: 55 },
      { t: 0.47, pos: [-8, 3, 2.9], look: [0, 1.1, 2], fov: 58 },
      { t: 1, pos: [-0.56, 1.4, 0.2], look: [0, 1.3, 0], fov: 62 },
    ],
  },
];

/** Index of the shot that owns this progress value. */
export function shotIndexAt(p: number) {
  for (let i = SHOTS.length - 1; i > 0; i--) if (p >= SHOTS[i].from) return i;
  return 0;
}

/** DOM landmarks of the drift scene (its own 0..1 scale), kept next to the shots. */
export const PHASES = {
  introOutFrom: 0.02,
  introOutTo: 0.09,
  letterboxOutFrom: 0.64,
  letterboxOutTo: 0.72,
} as const;
