import { create } from 'zustand';

/**
 * The single value the whole scene is driven by.
 *
 * - The scroll timeline (useScrollTimeline) writes `progress`.
 * - While `manual` is true (leva "Scrub" panel), the timeline stops writing and the
 *   slider owns `progress` instead, so you can test the drift without scrolling.
 * - R3F components read it transiently with `useStore.getState().progress` inside
 *   useFrame. Never subscribe to it in a React render: it changes every frame.
 */
type ExperienceState = {
  /** Global 0..1 over the whole page (drift scene + sections, see sections.ts). */
  progress: number;
  manual: boolean;
  /** Engine sound. Off until the visitor turns it on (browser autoplay rules). */
  muted: boolean;
  setProgress: (progress: number) => void;
  setManual: (manual: boolean) => void;
  setMuted: (muted: boolean) => void;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const useStore = create<ExperienceState>()((set) => ({
  progress: 0,
  manual: false,
  muted: true,
  setProgress: (progress) => set({ progress: clamp01(progress) }),
  setManual: (manual) => set({ manual }),
  setMuted: (muted) => set({ muted }),
}));
