'use client';

import { useEffect, useRef, useState } from 'react';
import { MathUtils } from 'three';
import { COLD, coldOpen, startColdOpen } from '@/lib/coldOpen';
import { useStore } from '@/lib/store';

/**
 * The cold open's black (src/lib/coldOpen.ts has the timeline): under the loader as it
 * fades, it holds the screen dark while the engine wakes, then lifts with the headlights,
 * and the chapter card and the controls come in after. It follows the scene's own clock,
 * so the black and the lights stay in step. Only from the top of the page: a reload
 * further down goes straight in.
 */
export function ColdOpen() {
  const load = useStore((s) => s.load);
  const [gone, setGone] = useState(false);
  const black = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (load !== 'ready') return;
    if (useStore.getState().progress > 0.02) {
      setGone(true);
      return;
    }
    startColdOpen();
    const root = document.documentElement;
    root.classList.add('is-cold');
    let raf = 0;
    const tick = () => {
      const t = coldOpen.t;
      if (black.current) black.current.style.opacity = (1 - MathUtils.smoothstep(t, COLD.lights, COLD.lift)).toFixed(3);
      if (t >= COLD.title && root.classList.contains('is-cold')) {
        root.classList.remove('is-cold');
        root.classList.add('title-in');
      }
      if (t >= Math.max(COLD.lift, COLD.title)) {
        setGone(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove('is-cold');
      root.classList.add('title-in');
    };
  }, [load]);

  if (gone) return null;
  return <div ref={black} className="cold-open" aria-hidden />;
}
