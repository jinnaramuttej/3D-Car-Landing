import { Vector3 } from 'three';
import { sampleRoute } from './cityRoute';
import { CORRIDOR_BARRIERS } from './corridor.data';
import { leftOf } from './motion';

/** One concrete barrier block (CorridorBarriers.tsx): width across the road, height, length along it. */
export const BLOCK = { w: 0.5, h: 0.8, l: 2 };
const GAP = 0.06;

export type Block = { pos: Vector3; yaw: number; side: number };

/**
 * Where the corridor barriers stand (world, on the route line's height): blocks along each
 * line scripts/clear-corridor.ts laid just outside the corridor, inner face on the line.
 * Pure, so the build's corridor check tests the same blocks the scene draws.
 */
export function barrierBlocks(): Block[] {
  const out: Block[] = [];
  const p = new Vector3();
  const l = new Vector3();
  for (const b of CORRIDOR_BARRIERS) {
    const latAt = (s: number) => {
      const pts = b.lat;
      let i = 0;
      while (i < pts.length - 2 && pts[i + 1][0] < s) i++;
      const [s0, l0] = pts[i];
      const [s1, l1] = pts[Math.min(pts.length - 1, i + 1)];
      const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
      return l0 + (l1 - l0) * t;
    };
    for (let s = b.s[0]; s <= b.s[1] + 0.01; s += BLOCK.l + GAP) {
      const h = sampleRoute(s + BLOCK.l / 2, p);
      leftOf(h, l);
      const lat = latAt(s + BLOCK.l / 2) + b.side * (BLOCK.w / 2);
      out.push({ pos: p.clone().addScaledVector(l, lat), yaw: h, side: b.side });
    }
  }
  return out;
}
