import { MathUtils } from 'three';
import { CONFIG } from './config';
import { CHAPTERS } from './chapters';
import { progressAtZone, timeAtProgress, timeAtS, ZONES, type ZoneId, zoneSpan } from './pacing';

const { clamp, smoothstep } = MathUtils;

/**
 * THE PLAYHEAD
 * ============
 * The scroll is a time axis: it sets a target journey time, and the playhead (the journey on
 * screen: the car, the camera and every DOM cue, through chapterState.progress) chases it at
 * no more than CONFIG.playhead.chase times real time, either way. So a flick of the wheel
 * plays the journey through, a little quicker than its own pace, rather than skipping it.
 *
 *  - Inside a stop, each phase (its title, its details, its way out) runs slower still if it
 *    has to: it stays up for at least its minimum dwell (STOP_PHASES) at the fastest rate.
 *  - A jump (the mini-map, the brand, a debug jump) glides at up to CONFIG.playhead.glide
 *    times, the titles and panels hidden on the way, and slows to 1x as it reaches the
 *    destination's stop zone, where they come back.
 *  - When the scroll rests a little short of a stop, a soft magnet draws the playhead onto
 *    the stop's title cue: an easing of the target, never a snap (and never back out of a
 *    stop the visitor has scrolled into).
 *
 * Pure (no DOM, no three.js scene): chapterRuntime steps it every frame, and
 * scripts/test-pacing.ts flicks it in Node.
 */

export type PhaseName = 'title' | 'details' | 'outro';

/** A stop's phases (fractions of its slow zone) and the least real time each must stay up. */
export const STOP_PHASES: { name: PhaseName; from: number; to: number; min: number }[] = [
  { name: 'title', from: 0.1, to: 0.3, min: 1.5 },
  { name: 'details', from: 0.3, to: 0.7, min: 4 },
  { name: 'outro', from: 0.7, to: 0.85, min: 1.2 },
];

/**
 * A stop's title card (Overlay.tsx): in at 0.1 of its slow zone, out at 0.79 (the Stage's
 * board shot fills the right of the frame from 0.35: its title makes way first). Up for at
 * least TITLE_MIN seconds.
 */
export const TITLE_CARD = { in: 0.1, out: 0.79, outFor: { speakers: 0.26 } as Partial<Record<ZoneId, number>> };
export const TITLE_MIN = 1.2;
/** The finale's card (Overlay.tsx), as fractions of its chapter, and its least time up. */
export const FINALE_CARD = { in: 0.3, out: 0.46 };
export const FINALE_MIN = 1.5;

export type Phase = { zone: ZoneId; name: PhaseName; from: number; to: number; min: number; cap: number };

let phaseList: Phase[] | null = null;

/** Every stop's phases in journey seconds, with the fastest rate each allows. */
export function stopPhases(): Phase[] {
  if (phaseList) return phaseList;
  const at = (id: ZoneId, f: number) => timeAtProgress(progressAtZone(id, f));
  phaseList = ZONES.flatMap((z) =>
    STOP_PHASES.map((p) => {
      const from = at(z.id, p.from);
      const to = at(z.id, p.to);
      return { zone: z.id, name: p.name, from, to, min: p.min, cap: (to - from) / p.min };
    }),
  );
  return phaseList;
}

export type Cue = { id: string; zone?: ZoneId; from: number; to: number; min: number; cap: number };
let cueList: Cue[] | null = null;

/**
 * Every cue the playhead keeps up for its minimum, in journey seconds, with the fastest rate
 * each allows: the stops' phases, their title cards and the finale's card.
 */
export function cueWindows(): Cue[] {
  if (cueList) return cueList;
  const at = (id: ZoneId, f: number) => timeAtProgress(progressAtZone(id, f));
  const cue = (id: string, from: number, to: number, min: number, zone?: ZoneId): Cue => ({ id, zone, from, to, min, cap: (to - from) / min });
  const fin = CHAPTERS[CHAPTERS.length - 1];
  const ft = (f: number) => timeAtProgress(fin.start + f * (fin.end - fin.start));
  cueList = [
    ...stopPhases().map((p) => cue(`${p.zone} ${p.name}`, p.from, p.to, p.min, p.zone)),
    ...ZONES.map((z) => cue(`${z.id} title card`, at(z.id, TITLE_CARD.in), at(z.id, TITLE_CARD.outFor[z.id] ?? TITLE_CARD.out), TITLE_MIN, z.id)),
    cue('finale card', ft(FINALE_CARD.in), ft(FINALE_CARD.out), FINALE_MIN),
  ];
  return cueList;
}

/** Where the magnet holds: each stop's title cue, just into its slow zone. */
export const magnets = () => stopPhases().filter((p) => p.name === 'title').map((p) => p.from);

/** Where a glide to journey time `to` slows to 1x and the content comes back (heading `dir`). */
function entryFor(to: number, dir: number) {
  for (const z of ZONES) {
    const [a, b] = zoneSpan(z);
    const t0 = timeAtS(a);
    const t1 = timeAtS(b);
    if (to >= t0 - 0.5 && to <= t1) return dir > 0 ? Math.min(to, t0) : Math.max(to, t1);
  }
  return to - dir * CONFIG.playhead.enterSeconds;
}

export const playhead = {
  /** Journey seconds on screen. */
  t: 0,
  /** Playback rate: journey seconds per real second (1 = the journey's own pace), signed. */
  rate: 0,
  /** A jump under way: its destination and where it slows to 1x and shows the content again. */
  glide: null as null | { to: number; entry: number; dir: number },
  /** Titles and panels are hidden (a glide, before its destination). */
  hidden: false,
  /** Seconds the scroll target has been still. */
  idle: 0,
  lastTarget: -1,
  /** 0..1: how hard the magnet is holding right now. */
  pull: 0,
  /** The target the playhead actually chases (the scroll's, eased by the magnet). */
  aim: 0,
};

/** Starts a glide to journey time `to` (the scroll target jumps there at the same moment). */
export function glideTo(to: number) {
  const dir = Math.sign(to - playhead.t) || 1;
  playhead.glide = { to, entry: entryFor(to, dir), dir };
}

/** The fastest any cue up at journey time t allows (Infinity between cues). */
export function capAt(t: number) {
  let v = Infinity;
  for (const c of cueWindows()) if (t >= c.from && t < c.to) v = Math.min(v, c.cap);
  return v;
}

/**
 * The fastest the playhead may move at t heading `dir`: the mode's cap, every slower
 * stretch ahead within braking distance (a stop's phase, a glide's entry), and stopping in
 * time at `aim`.
 */
function allowed(t: number, dir: number, aim: number, cap: number, accel: number, dt: number) {
  // (measured from where this frame will end, so the limit holds the moment a stretch begins)
  const ahead = Math.abs(playhead.rate) * dt;
  let v = cap;
  const glide = playhead.glide;
  const showing = !glide || dir * (t - glide.entry) >= 0;
  // (a glide's hidden stretch passes the stops on the way at speed: only the destination's count)
  const counts = (p: Cue) => !glide || dir * ((dir > 0 ? p.to : p.from) - glide.entry) > 0;
  if (showing) v = Math.min(v, capAt(t));
  for (const p of cueWindows()) {
    if (!counts(p)) continue;
    const d = dir > 0 ? p.from - t : t - p.to;
    if (d > 0 && d < 30) v = Math.min(v, Math.sqrt(p.cap * p.cap + 2 * accel * Math.max(0, d - ahead)));
  }
  if (glide && !showing) {
    const d = dir * (glide.entry - t);
    if (d > 0) v = Math.min(v, Math.sqrt(CONFIG.playhead.enter ** 2 + 2 * accel * Math.max(0, d - ahead)));
  }
  // stop at the aim: brake in time, and settle the last bit like a damped spring
  const dist = Math.abs(aim - t);
  v = Math.min(v, Math.sqrt(2 * accel * dist) * 0.92, dist / Math.max(1e-3, CONFIG.playhead.settle));
  return v;
}

/**
 * One frame: chase `target` (journey seconds, from the scroll). `snap` lands there at once
 * (the first frame, the warm-up); `playing` is the Play button (the magnet leaves it be).
 */
export function stepPlayhead(target: number, dt: number, snap = false, playing = false) {
  const c = CONFIG.playhead;
  const ph = playhead;
  if (snap) {
    ph.t = target;
    ph.rate = 0;
    ph.glide = null;
    ph.hidden = false;
    ph.pull = 0;
    ph.idle = 0;
    ph.lastTarget = target;
    ph.aim = target;
    return;
  }
  // a hand on the scroll mid-glide takes over (the glide's destination isn't the target any more)
  if (ph.glide && Math.abs(target - ph.glide.to) > 0.25) ph.glide = null;

  // the magnet: the scroll resting near a stop's start draws the playhead onto its title cue
  ph.idle = Math.abs(target - ph.lastTarget) > 1e-4 ? 0 : ph.idle + dt;
  ph.lastTarget = target;
  let near = 0;
  let want = 0;
  if (!playing && !ph.glide) {
    // (only from the approach: a scroll resting inside a stop, on its details, stays put)
    for (const m of magnets()) {
      const d = m - target;
      if (d >= 0 && d < c.magnet) {
        near = m;
        want = smoothstep(ph.idle, c.magnetIdle, c.magnetIdle + 0.5) * (1 - smoothstep(d, c.magnet * 0.4, c.magnet));
      }
    }
  }
  ph.pull += (want - ph.pull) * (1 - Math.exp(-dt / 0.3));
  ph.aim = want > 0 || ph.pull > 1e-3 ? target + ((near || target) - target) * ph.pull : target;

  const diff = ph.aim - ph.t;
  if (Math.abs(diff) < 1e-5 && Math.abs(ph.rate) < 1e-4) {
    ph.t = ph.aim;
    ph.rate = 0;
  } else {
    const dir = Math.sign(diff);
    const gliding = !!ph.glide;
    // (a glide that has reached its destination's zone plays it at no more than 1x)
    const arrived = gliding && ph.glide!.dir * (ph.t - ph.glide!.entry) >= 0;
    const cap = gliding ? (arrived ? c.enter : c.glide) : c.chase;
    const accel = gliding ? c.glideAccel : c.accel;
    const v = allowed(ph.t, dir, ph.aim, cap, accel, dt);
    const dv = clamp(dir * v - ph.rate, -accel * dt, accel * dt);
    // (never over the limit here, whatever the acceleration: the dwell holds)
    ph.rate = clamp(ph.rate + dv, -v, v);
    const next = ph.t + ph.rate * dt;
    if ((ph.aim - next) * diff < 0) {
      ph.t = ph.aim;
      ph.rate = 0;
    } else ph.t = next;
  }

  if (ph.glide) {
    const g = ph.glide;
    if (Math.abs(ph.t - g.to) < 0.05 && Math.abs(ph.rate) < 0.05) ph.glide = null;
  }
  ph.hidden = !!ph.glide && ph.glide.dir * (ph.t - ph.glide.entry) < 0;
}
