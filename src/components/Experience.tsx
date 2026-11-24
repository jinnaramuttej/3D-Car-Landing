'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import { Leva } from 'leva';
import { PAGES } from '@/lib/chapters';
import { useScrollTimeline } from '@/lib/useScrollTimeline';
import { Scene } from '@/scene/Scene';
import { DebugPanel } from './DebugPanel';

import { MiniMap } from './MiniMap';
import { Navbar } from './Navbar';
import { Overlay } from './Overlay';
import { Stops } from './Stops';

/**
 * Fixed full-screen canvas, a tall scroll container above it (PAGES x 100vh, see
 * src/lib/chapters.ts), and the DOM overlay on top. The scroll container is empty: it only gives Lenis/ScrollTrigger
 * a distance to scrub.
 */
export default function Experience() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [debug, setDebug] = useState(false);

  useScrollTimeline(trackRef);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).has('debug'));
  }, []);

  return (
    <>
      <div className="stage">
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 34, near: 0.1, far: 2200, position: [6, 1, 6] }}
        >
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </Canvas>
      </div>

      <Overlay />
      <Stops />
      <Navbar />
      <MiniMap />
      <div ref={trackRef} className="scroll-track" style={{ height: `${PAGES * 100}vh` }} />

      <Loader
        containerStyles={{ background: '#04050a' }}
        barStyles={{ background: '#ff2a1a' }}
        dataInterpolation={(p) => `Waiting out the rain ${p.toFixed(0)}%`}
      />
      <Leva hidden={!debug} collapsed={false} titleBar={{ title: 'GT3 R tuning' }} />
      {debug && <DebugPanel />}
    </>
  );
}
