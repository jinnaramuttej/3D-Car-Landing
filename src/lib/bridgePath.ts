import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { BRIDGE, getRoute, sampleRoute } from './cityRoute';
import { ROUTE_PATCHES } from './cityRoute.data';
import { CORRIDOR_PATCHES, PATCH_DROP } from './corridor.data';
import { forwardOf, leftOf } from './motion';

/**
 * Where the bridge deck runs along the route, shared by the scene (Bridge.tsx) and the
 * continuity checker (scripts/check-route.ts), so both see the same deck.
 */

/** The deck runs on past the end of the drive, into the haze. */
export const DECK_EXTRA = 420;
export const DECK_T = 2.6;

export type DeckFrame = { p: Vector3; f: Vector3; l: Vector3 };

/** World point (road surface), forward and left at route metres s; straight on past the end. */
export function deckFrameAt(s: number): DeckFrame {
  const route = getRoute();
  const p = new Vector3();
  let h: number;
  if (s <= route.length) h = sampleRoute(s, p);
  else {
    const end = new Vector3();
    h = sampleRoute(route.length, end);
    p.copy(end).addScaledVector(forwardOf(h, new Vector3()), s - route.length);
  }
  return { p, f: forwardOf(h, new Vector3()), l: leftOf(h, new Vector3()) };
}

let range: { from: number; to: number } | null = null;

/**
 * Route metres where the deck starts and ends. It starts just before the last point of
 * the city route (laid over the end of the model's flyover), so the road never breaks.
 */
export function deckRange() {
  if (range) return range;
  const route = getRoute();
  range = { from: route.bridgeStart - 3, to: route.length + DECK_EXTRA };
  return range;
}

/** Route metres the road strips cover: the holes under the route and the corridor's cuts, merged. */
export function patchSpans() {
  const spans = [...ROUTE_PATCHES, ...CORRIDOR_PATCHES].map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** Half the width of a road strip (the car's corridor, slides included), and its columns across. */
export const PATCH_HALF = 4;
export const PATCH_COLS = 9;

/**
 * Strips that fill the holes in the model's road under the route (ROUTE_PATCHES, and where
 * the corridor sweep cut a kerb back, CORRIDOR_PATCHES), world space, laid just under the
 * model's road itself (PATCH_DROP, measured by scripts/clear-corridor.ts a metre apart across
 * and along): where the road is there they stay hidden under it, and across a hole they run
 * from the road on one side to the road on the other. (Laid on the route line instead, they stood above the road wherever the line had
 * been measured on a kerb, and read as a pale slab under the car.)
 */
export function patchGeometry() {
  const drop = new Map(PATCH_DROP.map(([m, ...ys]) => [m, ys]));
  const flat = new Array(PATCH_COLS).fill(-0.04);
  return patchSpans().map(([s0, s1]) => {
    const n = Math.ceil(s1 - s0) + 1;
    const pos = new Float32Array(n * PATCH_COLS * 3);
    const uv = new Float32Array(n * PATCH_COLS * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = s0 + ((s1 - s0) * i) / (n - 1);
      const { p, l } = deckFrameAt(s);
      const ys = drop.get(Math.round(s)) ?? flat;
      for (let j = 0; j < PATCH_COLS; j++) {
        const lat = -PATCH_HALF + (2 * PATCH_HALF * j) / (PATCH_COLS - 1);
        pos.set([p.x + l.x * lat, p.y + (ys[j] ?? -0.04), p.z + l.z * lat], (i * PATCH_COLS + j) * 3);
        uv.set([j / (PATCH_COLS - 1), s / 30], (i * PATCH_COLS + j) * 2);
        if (i < n - 1 && j < PATCH_COLS - 1) {
          const v = i * PATCH_COLS + j;
          idx.push(v, v + PATCH_COLS, v + 1, v + 1, v + PATCH_COLS, v + PATCH_COLS + 1);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/** A strip along the deck between lateral offsets a and b (left positive) at heights ya, yb above the road. */
export function deckStrip(s0: number, s1: number, a: number, ya: number, b: number, yb: number, vScale: number) {
  const step = 6;
  const n = Math.ceil((s1 - s0) / step) + 1;
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / (n - 1);
    const { p, l } = deckFrameAt(s);
    pos.set([p.x + l.x * a, p.y + ya, p.z + l.z * a, p.x + l.x * b, p.y + yb, p.z + l.z * b], i * 6);
    uv.set([0, s / vScale, 1, s / vScale], i * 4);
    if (i < n - 1) {
      const v = i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Road surfaces the scene adds on top of the model (the deck, the patches), world space. */
export function deckExtraGeometry() {
  const { from, to } = deckRange();
  return [deckStrip(from, to, BRIDGE.halfWidth, 0.02, -BRIDGE.halfWidth, 0.02, 30), ...patchGeometry()];
}
