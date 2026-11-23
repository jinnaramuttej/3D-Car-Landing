/** Phones and small tablets: halve particles, lighter reflections, no MSAA. */
export function isMobile() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
}
