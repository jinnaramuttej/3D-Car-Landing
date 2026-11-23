'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import { Leva } from 'leva';
import { CONFIG } from '@/lib/config';
import { SHOTS } from '@/lib/script';
import { useScrollTimeline } from '@/lib/useScrollTimeline';
import { Scene } from '@/scene/Scene';
import { DebugPanel } from './DebugPanel';
import { Navbar } from './Navbar';
import { Overlay } from './Overlay';
import { Sections } from './Sections';

/**
 * Fixed full-screen canvas, a tall (600vh) scroll container above it, and the DOM
 * overlay on top. The scroll container is empty: it only gives Lenis/ScrollTrigger
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
          camera={{ fov: SHOTS[0].keys[0].fov, near: 0.05, far: 600, position: [6, 1, 6] }}
        >
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </Canvas>
      </div>

      <Overlay />
      <Sections />
      <Navbar />
      <div ref={trackRef} className="scroll-track" style={{ height: `${CONFIG.scroll.pages * 100}vh` }} />

      <Loader
        containerStyles={{ background: '#04050a' }}
        barStyles={{ background: '#ff2a1a' }}
        dataInterpolation={(p) => `Warming tyres ${p.toFixed(0)}%`}
      />
      <Leva hidden={!debug} collapsed={false} titleBar={{ title: 'GT3 R tuning' }} />
      {debug && <DebugPanel />}
    </>
  );
}
