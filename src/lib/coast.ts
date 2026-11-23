import { Vector2, Vector3 } from 'three';
import { CONFIG } from './config';
import { forwardOf, leftOf, sampleTrack, type Track } from './motion';

/**
 * The land as a polygon in world XZ (x, z): it follows the sea wall on the road's
 * left and runs far out to the city on the right. The sea is everything outside it.
 */
export function landPolygon(track: Track): Vector2[] {
  const off = CONFIG.coast.seaWallOffset;
  const p = new Vector3();
  const l = new Vector3();
  const f = new Vector3();
  const pts: Vector2[] = [];
  const push = (v: Vector3) => pts.push(new Vector2(v.x, v.z));

  let h = sampleTrack(track, 0, p);
  leftOf(h, l);
  forwardOf(h, f);
  const start = p.clone().addScaledVector(l, off).addScaledVector(f, -500);
  const startRight = l.clone().multiplyScalar(-1);
  push(start);
  for (let s = 0; s <= track.length; s += 4) {
    h = sampleTrack(track, s, p);
    leftOf(h, l);
    push(p.clone().addScaledVector(l, off));
  }
  h = sampleTrack(track, track.length, p);
  leftOf(h, l);
  forwardOf(h, f);
  const end = p.clone().addScaledVector(l, off).addScaledVector(f, 500);
  push(end);
  push(end.clone().addScaledVector(l, -1100));
  push(start.clone().addScaledVector(startRight, 1100));
  return pts;
}

/** Even-odd point-in-polygon test (XZ). */
export function insidePolygon(poly: Vector2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
