/** Normalised pointer position, -1..1 (x right, y up). Read in useFrame for camera parallax. */
export const pointer = { x: 0, y: 0 };

/** Listens on window so it works over the DOM overlay too. Returns the cleanup. */
export function trackPointer() {
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  const onLeave = () => {
    pointer.x = 0;
    pointer.y = 0;
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
  };
}
