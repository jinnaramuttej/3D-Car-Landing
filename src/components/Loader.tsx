'use client';

import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useStore } from '@/lib/store';

/**
 * The first-load screen (the only fade on the site): real download progress (drei's loading
 * manager) for the first three quarters, then the warm-up behind it (src/scene/Warmup.tsx:
 * shaders, textures, a drive through every chapter). Fades out once the scene is ready.
 */
export function Loader() {
  const { progress } = useProgress();
  const load = useStore((s) => s.load);
  const warm = useStore((s) => s.warm);
  const [gone, setGone] = useState(false);
  const done = load === 'ready';

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setGone(true), 1400);
    return () => window.clearTimeout(t);
  }, [done]);

  if (gone) return null;
  const pct = load === 'assets' ? progress * 0.75 : 75 + warm * 25;
  return (
    <div className={`loader${done ? ' is-done' : ''}`} role="status" aria-live="polite" aria-busy={!done}>
      <p className="loader-label">
        {load === 'assets' ? 'Waiting out the rain' : 'Warming the engine'}
        <span>{Math.round(pct)}%</span>
      </p>
      <div className="loader-bar" aria-hidden>
        <i style={{ transform: `scaleX(${(pct / 100).toFixed(3)})` }} />
      </div>
    </div>
  );
}
