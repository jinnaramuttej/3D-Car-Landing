import { create } from 'zustand';
import { ROBOWARS, VOICES } from '@/content';

export type VoiceCategory = keyof typeof VOICES.categories;
export const VOICE_CATEGORIES = Object.keys(VOICES.categories) as VoiceCategory[];

/** UI state shared by the district panels (DOM) and the sets (3D). Changes rarely. */
type DistrictUi = {
  /** Robowars weight class shown in the arena, kg. */
  arenaClass: number;
  voiceCategory: VoiceCategory;
  /** Index (in the current category) of the marker under the cursor / pinned by a click. */
  hoverVoice: number | null;
  pinnedVoice: number | null;
  /** Expo exhibit whose detail panel is open. */
  expoOpen: number | null;
  setArenaClass: (kg: number) => void;
  setVoiceCategory: (c: VoiceCategory) => void;
  setHoverVoice: (i: number | null) => void;
  setPinnedVoice: (i: number | null) => void;
  setExpoOpen: (i: number | null) => void;
};

export const useDistricts = create<DistrictUi>()((set) => ({
  arenaClass: ROBOWARS.classes[0],
  voiceCategory: VOICE_CATEGORIES[0],
  hoverVoice: null,
  pinnedVoice: null,
  expoOpen: null,
  setArenaClass: (arenaClass) => set({ arenaClass }),
  setVoiceCategory: (voiceCategory) => set({ voiceCategory, hoverVoice: null, pinnedVoice: null }),
  setHoverVoice: (hoverVoice) => set({ hoverVoice }),
  setPinnedVoice: (pinnedVoice) => set({ pinnedVoice }),
  setExpoOpen: (expoOpen) => set({ expoOpen }),
}));

/** Per-frame values the DOM reads in its own rAF loop (never re-rendered). */
export const districtFx = {
  /** Where the hovered/pinned speaker marker is on screen (CSS px). */
  voiceCard: { x: 0, y: 0, visible: false },
  /** 0..1 heartbeat envelope (lub-dub), for the light and the timer ring. */
  heartbeat: 0,
};

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
