/**
 * What the DOM layout solver (src/components/Overlay.tsx, Stops.tsx) needs from the 3D
 * frame: where the car and the billboard on show are on screen, in CSS pixels, and how
 * calm the shot is. Written every frame by CameraRig after the camera has moved.
 */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export const layoutState = {
  /** Canvas size, CSS pixels. */
  w: 1,
  h: 1,
  car: null as Rect | null,
  board: null as Rect | null,
  /** The stop panel on screen (set by Stops.tsx), so a title never lands on it. */
  panel: null as Rect | null,
  /** A chapter title is on screen (set by Overlay.tsx): the drive-past cards wait. */
  titleUp: false,
  /** 1 when the car is slow enough for titles, 0 at speed. */
  calm: 1,
  /** The camera has settled on a stop's shot (titles and panels may come in). */
  atStop: false,
  /** Route metres and speed (m/s), for the HUD. */
  s: 0,
  speed: 0,
};

/** Overlap area of two rects (0 if either is missing). */
export function overlap(a: Rect | null, b: Rect | null) {
  if (!a || !b) return 0;
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
