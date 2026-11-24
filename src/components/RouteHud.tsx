'use client';

import { useEffect, useRef } from 'react';
import { CHAPTERS } from '@/lib/chapters';
import { getRoute, STOPS } from '@/lib/cityRoute';
import { layoutState } from '@/lib/layout';

/**
 * A thin route HUD in the corner: how far along the route the car is, its speed, and the
 * route as a hairline with a tick at each stop. Reads the 3D frame's layoutState in its own
 * rAF loop (no React renders).
 */
export function RouteHud() {
  const dist = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // (pure maths from the route data: the same on the server and in the browser; the deck
  // runs on past the finale into the haze, so the HUD stops short of its end)
  const total = getRoute().length - 380;

  useEffect(() => {
    let raf = 0;
    let shown = '';
    const loop = () => {
      const s = Math.max(0, layoutState.s);
      const kmh = Math.round(layoutState.speed * 3.6);
      const text = `${(s / 1000).toFixed(2)}|${kmh}`;
      if (text !== shown) {
        shown = text;
        if (dist.current) dist.current.textContent = (s / 1000).toFixed(2);
        if (speed.current) speed.current.textContent = String(kmh);
        if (fill.current) fill.current.style.transform = `scaleX(${Math.min(1, s / total).toFixed(4)})`;
        // the readout glows a little at speed
        root.current?.style.setProperty('--hot', Math.min(1, layoutState.speed / 90).toFixed(2));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [total]);

  return (
    <div ref={root} className="route-hud" aria-hidden>
      <p>
        <span ref={dist}>0.00</span>
        <em>/ {(total / 1000).toFixed(2)} km</em>
        <span ref={speed} className="hud-speed">
          0
        </span>
        <em>km/h</em>
      </p>
      <div className="hud-line">
        <div ref={fill} />
        {CHAPTERS.filter((c) => c.stop).map((c) => (
          <i key={c.id} style={{ left: `${(Math.min(1, STOPS[c.stop!].s / total) * 100).toFixed(2)}%` }} />
        ))}
      </div>
    </div>
  );
}
