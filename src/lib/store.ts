import { create } from 'zustand';

/**
 * The value the whole scene is driven by, plus a little UI state.
 *
 * - The scroll timeline (useScrollTimeline) writes `progress`: where the visitor wants to be.
 * - The scene's journey driver chases it (src/lib/chapterRuntime.ts) and writes `view` every
 *   frame: where the journey is on screen. The DOM layers follow `view`, so panels and
 *   titles stay with the car however fast the scroll moves.
 * - While `manual` is true (leva "Scrub" panel), the timeline stops writing and the
 *   slider owns `progress` instead, so you can test the scene without scrolling.
 * - R3F components read it transiently with `useStore.getState()` inside useFrame.
 *   Never subscribe to `progress` in a React render: it changes every frame.
 */
export type Headlights = 'auto' | 'on' | 'off';

type ExperienceState = {
  /** Global 0..1 over the whole page (see src/lib/chapters.ts): the scroll target. */
  progress: number;
  /** Global 0..1 on screen (the driver's position, chasing `progress`). */
  view: number;
  manual: boolean;
  /** Engine sound. Off until the visitor turns it on (browser autoplay rules). */
  muted: boolean;
  /** 'auto' follows the chapter (off until the ignition); the toggle forces on or off. */
  headlights: Headlights;
  /** Index into LIVERIES (src/scene/livery.ts). */
  livery: number;
  setProgress: (progress: number) => void;
  setView: (view: number) => void;
  setManual: (manual: boolean) => void;
  setMuted: (muted: boolean) => void;
  setHeadlights: (headlights: Headlights) => void;
  setLivery: (livery: number) => void;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const useStore = create<ExperienceState>()((set) => ({
  progress: 0,
  view: 0,
  manual: false,
  muted: true,
  headlights: 'auto',
  livery: 0,
  setProgress: (progress) => set({ progress: clamp01(progress) }),
  setView: (view) => set({ view: clamp01(view) }),
  setManual: (manual) => set({ manual }),
  setMuted: (muted) => set({ muted }),
  setHeadlights: (headlights) => set({ headlights }),
  setLivery: (livery) => set({ livery }),
}));
