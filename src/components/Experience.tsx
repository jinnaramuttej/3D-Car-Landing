'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Leva } from 'leva';
import { PAGES } from '@/lib/chapters';
import { useScrollTimeline } from '@/lib/useScrollTimeline';
import { Scene } from '@/scene/Scene';
import { Warmup } from '@/scene/Warmup';
import { DebugPanel } from './DebugPanel';
import { Extras } from './Extras';
import { Loader } from './Loader';

import { MiniMap } from './MiniMap';
import { Navbar } from './Navbar';
import { Overlay } from './Overlay';
import { PlayControls } from './PlayControls';
import { RouteHud } from './RouteHud';
import { Stops } from './Stops';

/**
 * Fixed full-screen canvas, a tall scroll container above it (PAGES x 100vh, see
 * src/lib/chapters.ts), and the DOM overlay on top. The scroll container is empty: it only gives Lenis/ScrollTrigger
 * a distance to scrub.
 */
export default function Experience() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [debug, setDebug] = useState(false);
  // ?dpr=1.5 pins the canvas resolution (to measure at a known size)
  const [dpr, setDprProp] = useState<number | [number, number]>([1, 1.5]);

  useScrollTimeline(trackRef);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setDebug(q.has('debug'));
    const pinned = Number(q.get('dpr'));
    if (pinned > 0) setDprProp(pinned);
  }, []);

  return (
    <>
      <div className="stage">
        <Canvas
          dpr={dpr}
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 34, near: 0.1, far: 2200, position: [6, 1, 6] }}
        >
          <Suspense fallback={null}>
            <Scene />
            <Warmup />
          </Suspense>
        </Canvas>
      </div>

      <Overlay />
      <Stops />
      <Extras />
      <Navbar />
      <MiniMap />
      <PlayControls />
      <RouteHud />
      <div ref={trackRef} className="scroll-track" style={{ height: `${PAGES * 100}vh` }} />

      <Loader />
      <Leva hidden={!debug} collapsed={false} titleBar={{ title: 'GT3 R tuning' }} />
      {debug && <DebugPanel />}
    </>
  );
}
