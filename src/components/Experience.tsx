'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Leva } from 'leva';
import { PAGES } from '@/lib/chapters';
import { useStore } from '@/lib/store';
import { useScrollTimeline } from '@/lib/useScrollTimeline';
import { Scene } from '@/scene/Scene';
import { Warmup } from '@/scene/Warmup';
import { ColdOpen } from './ColdOpen';
import { DebugPanel } from './DebugPanel';
import { Extras } from './Extras';
import { Loader } from './Loader';

import { MiniMap } from './MiniMap';
import { Navbar } from './Navbar';
import { Overlay } from './Overlay';
import { PlayControls } from './PlayControls';
import { RouteHud } from './RouteHud';
import { Stops } from './Stops';

/** Lowest and highest share of the full resolution the auto quality may pick. */
const SCALE_MIN = 0.75;

/**
 * Auto quality, once the loader is gone: when the frame rate sags under ~52 fps for a few
 * seconds the canvas drops its resolution (down to 75%), and climbs back when there is
 * room. A few steps at most: each change re-sizes the render targets.
 */
function AutoQuality({ onScale }: { onScale: (scale: number) => void }) {
  const ready = useStore((s) => s.load === 'ready');
  if (!ready) return null;
  return (
    <PerformanceMonitor
      factor={1}
      step={0.25}
      flipflops={4}
      bounds={() => [52, 58]}
      onChange={({ factor }) => onScale(SCALE_MIN + (1 - SCALE_MIN) * factor)}
      onFallback={() => onScale(SCALE_MIN)}
    />
  );
}

/**
 * Fixed full-screen canvas, a tall scroll container above it (PAGES x 100vh, see
 * src/lib/chapters.ts), and the DOM overlay on top. The scroll container is empty: it only gives Lenis/ScrollTrigger
 * a distance to scrub.
 */
export default function Experience() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [debug, setDebug] = useState(false);
  // the device's pixel ratio (1 to 1.5), times the auto quality's scale; ?dpr=1.5 pins it
  // (and turns the auto quality off) to measure at a known size
  const [base, setBase] = useState(1);
  const [pinned, setPinned] = useState(false);
  const [scale, setScale] = useState(1);

  useScrollTimeline(trackRef);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setDebug(q.has('debug'));
    const pin = Number(q.get('dpr'));
    if (pin > 0) {
      setBase(pin);
      setPinned(true);
    } else setBase(Math.min(1.5, Math.max(1, window.devicePixelRatio || 1)));
  }, []);

  return (
    <>
      <div className="stage">
        <Canvas
          dpr={pinned ? base : base * scale}
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 34, near: 0.1, far: 2200, position: [6, 1, 6] }}
        >
          <Suspense fallback={null}>
            <Scene />
            <Warmup />
          </Suspense>
          {!pinned && <AutoQuality onScale={setScale} />}
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

      <ColdOpen />
      <Loader />
      <Leva hidden={!debug} collapsed={false} titleBar={{ title: 'GT3 R tuning' }} />
      {debug && <DebugPanel />}
    </>
  );
}
