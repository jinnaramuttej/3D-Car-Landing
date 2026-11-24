import { Vector3 } from 'three';
import { create } from 'zustand';
import { COMPETITIONS, ROBOWARS, VOICES } from '@/content';
import { type StopId } from './chapters';
import { BRIDGE, EXTRAS, type ExtraId, getRoute, sampleRoute, STOPS } from './cityRoute';
import { forwardOf, leftOf } from './motion';

/** Every LED billboard: the stops' and the ones the car drives past (cityRoute.EXTRAS). */
export type BoardId = StopId | ExtraId;
export const isExtra = (id: BoardId): id is ExtraId => id in EXTRAS;
const specOf = (id: BoardId) => (isExtra(id) ? EXTRAS[id] : STOPS[id]);
/** Route metres of a billboard. */
export const boardS = (id: BoardId) => {
  const spec = specOf(id);
  return spec.boardS ?? spec.s;
};
/** How a billboard is hung: on a facade, a gantry across the road, or a pylon's cross-beam. */
export const mountOf = (id: BoardId) => specOf(id).mount ?? (id === 'finale' ? 'pylon' : 'wall');

export type SpeakerCategory = keyof typeof VOICES.categories;
export const SPEAKER_CATEGORIES = Object.keys(VOICES.categories) as SpeakerCategory[];
export const COMPETITION_TAGS = ['All', ...Array.from(new Set(COMPETITIONS.map((c) => c.tag)))];

/**
 * UI state shared by the stop panels (DOM) and the billboards (3D). Changes rarely.
 * The billboards redraw their canvas when it changes.
 */
type StopUi = {
  /** Robowars weight class highlighted on the billboard, kg. */
  robowarsClass: number;
  /** Competition filter chip (the billboard list animates to it). */
  competitionFilter: string;
  /** Speaker category: rotates on its own until the visitor picks one. */
  speakerCategory: SpeakerCategory;
  speakerPinned: boolean;
  /** Expo exhibit whose detail panel is open. */
  expoOpen: number | null;
  setRobowarsClass: (kg: number) => void;
  setCompetitionFilter: (f: string) => void;
  setSpeakerCategory: (c: SpeakerCategory, pinned?: boolean) => void;
  setExpoOpen: (i: number | null) => void;
};

export const useStops = create<StopUi>()((set) => ({
  robowarsClass: ROBOWARS.classes[0],
  competitionFilter: 'All',
  speakerCategory: SPEAKER_CATEGORIES[0],
  speakerPinned: false,
  expoOpen: null,
  setRobowarsClass: (robowarsClass) => set({ robowarsClass }),
  setCompetitionFilter: (competitionFilter) => set({ competitionFilter }),
  setSpeakerCategory: (speakerCategory, pinned = false) => set((s) => ({ speakerCategory, speakerPinned: pinned || s.speakerPinned })),
  setExpoOpen: (expoOpen) => set({ expoOpen }),
}));

/** Per-frame values the DOM reads in its own rAF loop (never re-rendered). */
export const stopFx = {
  /** 0..1 heartbeat envelope (lub-dub) at the DKMS stop, for its light and the timer ring. */
  heartbeat: 0,
  /** Expo exhibit on the billboard right now (follows the scroll through the stop). */
  expoIndex: 0,
};

/**
 * Where each stop's billboard hangs, in world space: the centre of its face, the way it
 * faces (unit, horizontal) and its size. Starts as a guess from the route (beside the
 * road at the stop); the billboards replace it with the facade they find (raycast).
 */
export type StopAnchor = { centre: Vector3; normal: Vector3; width: number; height: number; placed: boolean };

const anchors = new Map<BoardId, StopAnchor>();
const _p = new Vector3();
const _l = new Vector3();

export function stopAnchor(id: BoardId): StopAnchor {
  let a = anchors.get(id);
  if (a) return a;
  const spec = specOf(id);
  const r = getRoute();
  const mount = mountOf(id);
  if (mount === 'pylon') {
    // across a pylon's cross-beam (the far one for the finale), facing back down the deck
    const h = sampleRoute(r.bridgeStart + (id === 'finale' ? BRIDGE.pylons[1] : BRIDGE.pylons[0]), _p);
    const centre = _p.clone();
    centre.y += 30;
    a = { centre, normal: new Vector3(-Math.sin(h), 0, -Math.cos(h)), width: spec.width, height: spec.height, placed: true };
  } else if (mount === 'gantry') {
    // over the middle of the road (or the deck), facing the oncoming car
    const h = sampleRoute(boardS(id), _p);
    const centre = _p.clone();
    centre.y += spec.lift + spec.height / 2;
    a = { centre, normal: forwardOf(h, new Vector3()).negate(), width: spec.width, height: spec.height, placed: true };
  } else {
    const h = sampleRoute(spec.s, _p);
    leftOf(h, _l);
    const [roomL, roomR] = r.room(spec.s);
    const out = spec.side === 1 ? roomL : roomR;
    const centre = _p.clone().addScaledVector(_l, spec.side * (out + 6));
    centre.y += spec.lift + spec.height / 2;
    a = { centre, normal: _l.clone().multiplyScalar(-spec.side), width: spec.width, height: spec.height, placed: false };
  }
  anchors.set(id, a);
  return a;
}

/** The Stage's second half: the exhibit on show at zone progress p steps through them across 0.45-0.8. */
export const EXPO_SPAN: [number, number] = [0.45, 0.8];
export function expoIndexAt(p: number, count: number) {
  return Math.max(0, Math.min(count - 1, Math.floor(((p - EXPO_SPAN[0]) / (EXPO_SPAN[1] - EXPO_SPAN[0])) * count)));
}

/** Lub-dub: two soft bells per beat, the second smaller, 0..1, at `bpm`. */
export function heartbeatPulse(seconds: number, bpm = 56) {
  const period = 60 / bpm;
  const phase = (seconds % period) / period;
  const a = Math.exp(-((phase - 0.04) ** 2) / 0.0016);
  const b = 0.6 * Math.exp(-((phase - 0.3) ** 2) / 0.0022);
  return Math.min(1, a + b);
}

/** "Dr. A. P. J. Abdul Kalam" -> "AK", "The 14th Dalai Lama" -> "DL". */
export function initials(name: string) {
  const words = name
    .replace(/^(Dr\.|The)\s+/i, '')
    .split(/\s+/)
    .filter((w) => !/^\d/.test(w) && !/^[A-Z]\.$/.test(w));
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] : (name.match(/[A-Z]/g) ?? []).slice(-1)[0] ?? '';
  return (first + last).toUpperCase();
}
