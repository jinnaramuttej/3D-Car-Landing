import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { easing } from 'maath';
import { CONFIG } from './config';

const { clamp, degToRad, smootherstep } = MathUtils;
const UP = new Vector3(0, 1, 0);

/* ------------------------------------------------------------------ track */

/** A constant-radius bend on the track. sign: +1 left-hander, -1 right-hander. */
export type TrackArc = { sFrom: number; sTo: number; sign: number };

export type Track = {
  key: string;
  curve: CatmullRomCurve3;
  length: number;
  /** Arc-length where the car starts (progress 0) and stops (progress 1). */
  sStart: number;
  sEnd: number;
  /** [bend A (cold open), bend B (main drift)] */
  arcs: [TrackArc, TrackArc];
};

let cachedTrack: Track | null = null;

type Segment = { len: number; radius?: number; sign?: number };

/**
 * Builds the centre line from segments: lead straight, bend A, straight, bend B, exit.
 * Car-local convention (from the model): +Z forward, +X left, +Y up.
 * Heading ψ is rotation about +Y; ψ = 0 faces +Z and positive ψ turns left.
 * Integrated in 25 cm steps, sampled every 4 m, threaded with a centripetal Catmull-Rom.
 */
export function getTrack(): Track {
  const t = CONFIG.track;
  const key = [
    t.lead,
    t.arcARadius,
    t.arcADeg,
    t.startInto,
    t.straightMid,
    t.arcBRadius,
    t.arcBDeg,
    t.straightOut,
    t.tail,
  ].join('|');
  if (cachedTrack?.key === key) return cachedTrack;

  const arc = (radius: number, deg: number): Segment => ({
    len: radius * degToRad(Math.abs(deg)),
    radius,
    sign: Math.sign(deg) || 1,
  });
  const a = arc(t.arcARadius, t.arcADeg);
  const b = arc(t.arcBRadius, t.arcBDeg);
  const segments: Segment[] = [{ len: t.lead }, a, { len: t.straightMid }, b, { len: t.straightOut + t.tail }];

  const pts: Vector3[] = [new Vector3()];
  const spacing = 4;
  const ds = 0.25;
  let x = 0;
  let z = 0;
  let h = 0;
  let s = 0;
  let next = spacing;
  for (const seg of segments) {
    for (let d = 0; d < seg.len - 1e-6; d += ds) {
      const step = Math.min(ds, seg.len - d);
      const dh = seg.radius ? ((seg.sign ?? 1) * step) / seg.radius : 0;
      const mid = h + dh / 2;
      x += Math.sin(mid) * step;
      z += Math.cos(mid) * step;
      h += dh;
      s += step;
      if (s >= next - 1e-6) {
        pts.push(new Vector3(x, 0, z));
        next += spacing;
      }
    }
  }
  if (pts[pts.length - 1].distanceTo(new Vector3(x, 0, z)) > 0.5) pts.push(new Vector3(x, 0, z));

  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = 4000;

  const aFrom = t.lead;
  const bFrom = aFrom + a.len + t.straightMid;
  cachedTrack = {
    key,
    curve,
    length: curve.getLength(),
    sStart: aFrom + t.startInto,
    sEnd: bFrom + b.len + t.straightOut,
    arcs: [
      { sFrom: aFrom, sTo: aFrom + a.len, sign: a.sign ?? 1 },
      { sFrom: bFrom, sTo: bFrom + b.len, sign: b.sign ?? 1 },
    ],
  };
  return cachedTrack;
}

/** Arc-length along the track for a given scene progress. */
export function sAtProgress(track: Track, p: number) {
  return track.sStart + clamp(p, 0, 1) * (track.sEnd - track.sStart);
}

const _tan = new Vector3();
/** Point and heading on the centre line at arc-length s. */
export function sampleTrack(track: Track, s: number, outPoint: Vector3) {
  const u = clamp(s / track.length, 0, 1);
  track.curve.getPointAt(u, outPoint);
  track.curve.getTangentAt(u, _tan);
  return Math.atan2(_tan.x, _tan.z);
}

/** Unit vector pointing to the left of heading ψ. */
export function leftOf(heading: number, out: Vector3) {
  return out.set(Math.cos(heading), 0, -Math.sin(heading));
}
export function forwardOf(heading: number, out: Vector3) {
  return out.set(Math.sin(heading), 0, Math.cos(heading));
}

/* ------------------------------------------------------------ drift curve */

type DriftTiming = { start: number; peakAt: number; holdUntil: number; end: number };

/**
 * 0 until `start`, eases up to 1 by `peakAt`, holds until `holdUntil`,
 * eases back to 0 by `end`. yawOffset = driftShape * yawPeak.
 */
export function driftShape(p: number, d: DriftTiming = CONFIG.drift) {
  if (p <= d.start || p >= d.end) return 0;
  if (p < d.peakAt) return smootherstep(p, d.start, d.peakAt);
  if (p <= d.holdUntil) return 1;
  return 1 - smootherstep(p, d.holdUntil, d.end);
}

/* -------------------------------------------------------------- car state */

/**
 * Shared, mutable, never re-rendered. `stepDrive` (Scene, priority -3) fills the
 * kinematics; Car (priority -2) fills the world-space wheel contacts; Smoke,
 * SkidMarks and CameraRig (priority -1) read it.
 */
export const carState = {
  initialized: false,
  /** Damped progress. Everything in the 3D scene keys off this one. */
  progress: 0,
  s: 0,
  position: new Vector3(),
  pathPoint: new Vector3(),
  pathHeading: 0,
  /** Body heading = pathHeading + driftYaw. */
  heading: 0,
  driftYaw: 0,
  roll: 0,
  steer: 0,
  /** 0..1, |driftYaw| / slipRefDeg. Drives smoke, skids, shake, brake lights. */
  slip: 0,
  /** 0..1, tail-light flare: max of slip and the braking flare before turn-in. */
  brake: 0,
  /** 0..1, straight-line wheelspin (finale launch): rear spin + tyre smoke without yaw. */
  burnout: 0,
  /** Signed ground speed along the path, m/s (damped). */
  speed: 0,
  frontSpin: 0,
  rearSpin: 0,
  frontSpinRate: 0,
  rearSpinRate: 0,
  frontRadius: 0.34,
  rearRadius: 0.35,
  forward: new Vector3(0, 0, 1),
  /** Unit vector toward the outside of the turn (where the tail swings). */
  outward: new Vector3(-1, 0, 0),
  /** Written by Car: rear tyre contact patches in world space [left, right]. */
  rearContacts: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  tailLight: new Vector3(),
  /** Written by Car: headlight positions, beam direction and brightness multiplier. */
  headPos: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  headDir: new Vector3(0, 0, 1),
  headLevel: 1,
  carReady: false,
};

export type CarState = typeof carState;

const WHEELBASE = 2.5;
const _p = new Vector3();
const _l = new Vector3();

/**
 * Advances carState from the drift scene's raw progress. Pure kinematics, no physics.
 * `extraS` (metres further down the track) and `burnout` (0..1 wheelspin) come from the
 * sections after the drift (the finale launch); both are 0 during the drift scene.
 */
export function stepDrive(rawProgress: number, dt: number, extraS = 0, burnout = 0) {
  const s = carState;
  const d = CONFIG.drift;
  const track = getTrack();

  if (!s.initialized) {
    // Land exactly where the page is (e.g. reload mid-scroll), no fly-through.
    s.progress = rawProgress;
  } else {
    easing.damp(s, 'progress', rawProgress, CONFIG.scroll.progressSmooth, dt);
  }
  const p = s.progress;

  // Path frame
  const prevS = s.s;
  s.s = sAtProgress(track, p) + extraS;
  s.burnout = burnout;
  s.pathHeading = sampleTrack(track, s.s, s.pathPoint);

  // Geometric steering from path curvature (positive = left)
  const h0 = sampleTrack(track, s.s - 1, _p);
  const h1 = sampleTrack(track, s.s + 1, _p);
  const curvature = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / 2;
  const geomSteer = Math.atan(WHEELBASE * curvature);

  // Each value damped on its own clock; on the very first frame, snap (no swing-in on load).
  const damp = (key: 'driftYaw' | 'steer' | 'roll', target: number, smooth: number) => {
    if (s.initialized) easing.damp(s, key, target, smooth, dt);
    else s[key] = target;
  };

  // Two slides: the cold open through bend A, the main drift through bend B.
  // Each yaws toward the inside of its own bend.
  const intro = CONFIG.introDrift;
  const [arcA, arcB] = track.arcs;
  const yawTarget =
    arcA.sign * driftShape(p, intro) * degToRad(intro.yawPeakDeg) +
    arcB.sign * driftShape(p, d) * degToRad(d.yawPeakDeg);
  damp('driftYaw', yawTarget, d.yawSmooth);
  s.slip = clamp(Math.abs(s.driftYaw) / degToRad(Math.max(1, d.slipRefDeg)), 0, 1);
  const slideSign = Math.sign(s.driftYaw) || 1;
  const cornerSign = Math.sign(curvature);

  const steerTarget = geomSteer * (1 - s.slip) - slideSign * degToRad(d.counterSteerDeg) * s.slip;
  damp('steer', steerTarget, d.steerSmooth);

  const turnLoad = clamp(Math.abs(curvature) * 25, 0, 1) * 0.35; // a little roll from the corner alone
  const rollTarget = degToRad(d.rollDeg) * (slideSign * s.slip + cornerSign * turnLoad * (1 - s.slip));
  damp('roll', rollTarget, d.rollSmooth);

  // Brake flare before turn-in, read by the tail lights
  const c = CONFIG.car;
  const bx = (p - c.brakeAt) / Math.max(1e-3, c.brakeWidth);
  s.brake = Math.max(s.slip, Math.exp(-bx * bx));

  // Position: keep a point `pivotZ` ahead of centre on the line, let the tail swing out
  s.heading = s.pathHeading + s.driftYaw;
  leftOf(s.pathHeading, _l);
  s.outward.copy(_l).multiplyScalar(-slideSign);
  s.position.set(
    s.pathPoint.x + d.pivotZ * (Math.sin(s.pathHeading) - Math.sin(s.heading)),
    0,
    s.pathPoint.z + d.pivotZ * (Math.cos(s.pathHeading) - Math.cos(s.heading)),
  );
  s.position.addScaledVector(s.outward, d.widen * s.slip);
  forwardOf(s.heading, s.forward);

  // Speed and wheel spin. Distance comes from scroll, the burnout part from time,
  // so the rear tyres keep spinning (and smoking) if the user pauses mid-drift.
  const ds = s.initialized ? s.s - prevS : 0;
  const safeDt = Math.max(dt, 1e-4);
  easing.damp(s, 'speed', ds / safeDt, 0.15, dt);
  s.frontSpinRate = s.speed / s.frontRadius;
  const spin = Math.max(s.slip, s.burnout);
  s.rearSpinRate = s.speed / s.rearRadius + spin * d.rearSpinBoost;
  s.frontSpin += ds / s.frontRadius;
  s.rearSpin += ds / s.rearRadius + spin * d.rearSpinBoost * dt;

  s.initialized = true;
}

/** Camera shake strength in metres: a bell around `camera.shakeAt`, scaled by slip. */
export function shakeAmount(p: number, slip: number) {
  const c = CONFIG.camera;
  const x = (p - c.shakeAt) / Math.max(1e-3, c.shakeWidth);
  return c.shakePeak * Math.exp(-x * x) * (0.35 + 0.65 * slip);
}

/* --------------------------------------------------------- final-shot frame */

export type Frame = { origin: Vector3; heading: number };
const fixedFrame: Frame = { origin: new Vector3(), heading: 0 };

/** Fixed world frame on the path at `camera.anchorP`; the smoke cloud lives here. */
export function getAnchorFrame(): Frame {
  const track = getTrack();
  fixedFrame.heading = sampleTrack(track, sAtProgress(track, CONFIG.camera.anchorP), fixedFrame.origin);
  return fixedFrame;
}

const _o = new Vector3();
/** Centre of the smoke cloud the camera dives into: anchor, a little outside and up. */
export function getCloudCenter(out: Vector3) {
  const f = getAnchorFrame();
  const track = getTrack();
  leftOf(f.heading, _o).multiplyScalar(-track.arcs[1].sign * 2.5);
  return out.copy(f.origin).add(_o).addScaledVector(UP, 1.3);
}
