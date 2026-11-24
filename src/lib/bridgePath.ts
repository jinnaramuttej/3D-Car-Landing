import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { BRIDGE, getRoute, sampleRoute } from './cityRoute';
import { ROUTE_PATCHES } from './cityRoute.data';
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

/** Strips that fill the holes in the model's road under the route (ROUTE_PATCHES), world space. */
export function patchGeometry() {
  return ROUTE_PATCHES.map(([a, b]) => deckStrip(a, b, 5, 0.015, -5, 0.015, 30));
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
