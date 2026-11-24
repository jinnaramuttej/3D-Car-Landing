import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { ROUTE_LENGTH, ROUTE_POINTS, ROUTE_ROOM } from './cityRoute.data';

/**
 * THE CITY ROUTE
 * ==============
 * Chapters V to the finale drive one curve: down through the city (the points come
 * from scripts/build-route.mjs, which follows the road surfaces of the model), out over
 * the southern edge and across the sea on the bridge.
 *
 * Coordinates: the city stage sits at CITY_ORIGIN in the world, far from the seafront
 * of chapters I-IV (the move between them goes through cloud, see chapters.ts). Route
 * points are city-local metres; `sampleRoute` returns world positions.
 */

export const CITY_ORIGIN = new Vector3(6000, 0, 0);

/** Sea level south of the city (city-local y). */
export const SEA_LEVEL = -2;

/** The bridge: straight on from the end of the flyover. */
export const BRIDGE = {
  /** Metres of deck from the end of the flyover to the far shore (lost in the haze). */
  length: 760,
  /** Deck height rises by this much at the main span. */
  crest: 6,
  /** Pylons, metres along the deck from its start. */
  pylons: [240, 560] as const,
  pylonHeight: 112,
  /** Half the deck width (three lanes each way plus a walkway). */
  halfWidth: 13,
};

export type StopSpec = {
  /** Metres along the route where the car is closest to the billboard. */
  s: number;
  /** Fraction of the chapter where the car reaches the stop (later = a longer drive in). */
  arrive?: number;
  /** Which side of the road the billboard stands on: 1 = left, -1 = right. */
  side: 1 | -1;
  /** Billboard size (m) and height of its bottom edge above the road. */
  width: number;
  height: number;
  lift: number;
};

/**
 * The eight stops. `s` is in route metres: 0 is the start of the drive, the city part
 * ends at ROUTE_LENGTH and the bridge starts there. Each city stop sits where a scan of
 * the model found a flat, road-facing wall big enough for its billboard (side 1 = left of
 * the road, -1 = right); the billboard finds that wall by itself (raycast, Billboards.tsx)
 * and stands on legs if it can't. Between robowars and competitions there is no such wall
 * for 200 m (the big curve), so that leg is a longer drive.
 */
export const STOPS = {
  arrival: { s: 58, side: -1, width: 16, height: 9, lift: 9.5 },
  robowars: { s: 134, side: 1, width: 16, height: 9, lift: 6.5 },
  competitions: { s: 336, side: -1, width: 14, height: 7.9, lift: 6.5, arrive: 0.34 },
  speakers: { s: 462, side: -1, width: 16, height: 9, lift: 6.5 },
  expo: { s: 562, side: -1, width: 16, height: 9, lift: 6.5 },
  dkms: { s: 638, side: -1, width: 14, height: 7.9, lift: 6.5 },
  twmun: { s: 746, side: -1, width: 16, height: 9, lift: 6.5 },
  finale: { s: ROUTE_LENGTH + 400, side: 1, width: 18, height: 10, lift: 0 },
} satisfies Record<string, StopSpec>;

export type StopKey = keyof typeof STOPS;

export type Route = {
  curve: CatmullRomCurve3;
  length: number;
  /** Where the bridge deck starts (end of the city data). */
  bridgeStart: number;
  /** Free road either side [left, right] at route metres s (city part only). */
  room: (s: number) => [number, number];
  /** Arc-length of each input point. */
  pointS: number[];
};

let cached: Route | null = null;

/** Bridge points straight on from the last two route points, every 20 m. */
function bridgePoints() {
  const n = ROUTE_POINTS.length;
  const a = ROUTE_POINTS[n - 3];
  const b = ROUTE_POINTS[n - 1];
  const dir = new Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize();
  const out: Vector3[] = [];
  const { length, crest } = BRIDGE;
  for (let d = 20; d <= length; d += 20) {
    const u = d / length;
    // gentle crest over the main span
    const y = b[1] + crest * Math.sin(Math.PI * Math.min(1, u * 1.15));
    out.push(new Vector3(b[0] + dir.x * d, y, b[2] + dir.z * d));
  }
  return out;
}

export function getRoute(): Route {
  if (cached) return cached;
  const pts = ROUTE_POINTS.map(([x, y, z]) => new Vector3(x, y, z));
  const all = [...pts, ...bridgePoints()];
  const curve = new CatmullRomCurve3(all, false, 'centripetal', 0.5);
  curve.arcLengthDivisions = 6000;
  const lengths = curve.getLengths(all.length * 40);
  // arc-length of each input point (CatmullRom passes through them at u = i / (n - 1))
  const pointS = all.map((_, i) => lengths[Math.round((i / (all.length - 1)) * (lengths.length - 1))]);
  const bridgeStart = pointS[pts.length - 1];
  const room = (s: number): [number, number] => {
    if (s >= bridgeStart) return [BRIDGE.halfWidth, BRIDGE.halfWidth];
    let i = 0;
    while (i < pts.length - 2 && pointS[i + 1] < s) i++;
    return ROUTE_ROOM[Math.min(i, ROUTE_ROOM.length - 1)];
  };
  cached = { curve, length: curve.getLength(), bridgeStart, room, pointS };
  return cached;
}

const _t = new Vector3();

/**
 * World position (road surface) and heading at route metres s. Returns the heading
 * (radians about +Y, 0 = +Z); `pitch` gets the slope (positive = climbing).
 */
export function sampleRoute(s: number, out: Vector3, pitchOut?: { pitch: number }) {
  const r = getRoute();
  const u = MathUtils.clamp(s / r.length, 0, 1);
  r.curve.getPointAt(u, out).add(CITY_ORIGIN);
  r.curve.getTangentAt(u, _t);
  if (pitchOut) pitchOut.pitch = Math.atan2(_t.y, Math.hypot(_t.x, _t.z));
  return Math.atan2(_t.x, _t.z);
}

/** Signed curvature (1/m, positive = turning left) at s, from the heading change over ±d. */
export function routeCurvature(s: number, d = 4) {
  const h0 = sampleRoute(s - d, _a);
  const h1 = sampleRoute(s + d, _a);
  return Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / (2 * d);
}
const _a = new Vector3();
