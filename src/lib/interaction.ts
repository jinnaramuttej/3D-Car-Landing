import { CanvasTexture, LinearFilter, type Object3D } from 'three';

/**
 * Visitor input, read by the frame loop (never re-rendered):
 *   hold the mouse button or Space  -> rev (engine pitch, camera shake, the rain reacts)
 *   move the cursor                 -> wipes the wet lens
 *   click the car                   -> next livery (store.livery)
 *   H or the navbar button          -> headlights (store.headlights)
 * Listeners live in src/scene/Interaction.tsx (needs the camera for the car raycast).
 */
export const interaction = {
  /** Mouse button / Space held down (after a short delay, so clicks don't rev). */
  holding: false,
  /** Damped 0..1 rev amount. */
  rev: 0,
  /** Wet-lens wipe mask (white = wiped), drawn by the cursor, fading back as it rains. */
  wipe: null as CanvasTexture | null,
  wipeCanvas: null as HTMLCanvasElement | null,
  /** The car's root group, for the click raycast (set by Car). */
  carObject: null as Object3D | null,
};

export const WIPE_W = 160;
export const WIPE_H = 90;

/** Lazily creates the wipe mask (browser only). */
export function getWipeTexture() {
  if (interaction.wipe || typeof document === 'undefined') return interaction.wipe;
  const canvas = document.createElement('canvas');
  canvas.width = WIPE_W;
  canvas.height = WIPE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIPE_W, WIPE_H);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  interaction.wipe = tex;
  interaction.wipeCanvas = canvas;
  return tex;
}

/** Interactive elements in the DOM overlay: presses on these never rev or pick the car. */
export const isUiTarget = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('a, button, input, select, textarea, label, [role="button"], [class^="leva-"], [data-ui]');
