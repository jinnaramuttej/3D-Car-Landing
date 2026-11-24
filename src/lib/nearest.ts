import type { Vector3 } from 'three';

/**
 * The k points nearest to `from`, nearest first, without allocating: indices into `points`
 * land in `outIdx` (-1 where there are fewer than k) and squared distances in `outD`.
 * An insertion into a k-long list: fine for the few dozen lamps along the route.
 */
export function nearestK(points: readonly Vector3[], from: Vector3, outIdx: Int32Array, outD: Float64Array) {
  const k = outIdx.length;
  outIdx.fill(-1);
  outD.fill(Infinity);
  for (let i = 0; i < points.length; i++) {
    const d = points[i].distanceToSquared(from);
    if (d >= outD[k - 1]) continue;
    let j = k - 1;
    while (j > 0 && outD[j - 1] > d) {
      outD[j] = outD[j - 1];
      outIdx[j] = outIdx[j - 1];
      j--;
    }
    outD[j] = d;
    outIdx[j] = i;
  }
}
