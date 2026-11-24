/**
 * The warm-up behind the loader (src/scene/Warmup.tsx): while it runs, the journey is driven
 * through every chapter once. Anything that piles up state on the way (the smoke, the skid
 * marks, the camera director's blends) registers a reset here, called when it ends.
 */
export const warmup = {
  active: true,
  resets: new Set<() => void>(),
  /** For the debug HUD and the hitch report. */
  compileMs: 0,
  totalMs: 0,
  textures: 0,
};

/** Registers a reset for the end of the warm-up; returns the unregister. */
export function onWarmupEnd(fn: () => void) {
  warmup.resets.add(fn);
  return () => {
    warmup.resets.delete(fn);
  };
}
