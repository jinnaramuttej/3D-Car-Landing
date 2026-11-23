'use client';

import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { CONFIG } from './config';
import { SHOTS } from './script';
import { CHAPTERS, fromDriftLocal } from './chapters';
import { useStore } from './store';

let lenisRef: Lenis | null = null;
let trackEl: HTMLElement | null = null;

/**
 * Scrolls (through Lenis) to a global progress value. `immediate` jumps there in one
 * frame (the mini-map: the scene snaps and cross-dissolves); otherwise it glides.
 * If the debug slider owns progress, it hands control back to the scroll first.
 */
export function scrollToProgress(p: number, immediate = false, duration = 2.4) {
  if (!lenisRef || !trackEl) return;
  useStore.getState().setManual(false);
  const max = trackEl.offsetHeight - window.innerHeight;
  const y = Math.max(0, Math.min(1, p)) * max;
  if (immediate) {
    lenisRef.scrollTo(y, { immediate: true, force: true });
    return;
  }
  lenisRef.scrollTo(y, {
    duration,
    easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  });
}

/**
 * Lenis smooth scroll + one GSAP timeline scrubbed by ScrollTrigger.
 * The timeline tweens a proxy from 0 to 1 and writes it into the zustand store.
 * This is the only scroll listener in the app.
 */
export function useScrollTimeline(trackRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({ lerp: CONFIG.scroll.lenisLerp, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenisRef = lenis;
    trackEl = track;

    const proxy = { progress: 0 };
    const write = () => {
      const { manual, setProgress } = useStore.getState();
      if (!manual) setProgress(proxy.progress);
    };

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: track,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true, // Lenis already smooths; R3F damps on top of that
      },
    });
    tl.to(proxy, { progress: 1, duration: 1, onUpdate: write }, 0);
    // Labels: every chapter and every drift shot (mapped to global progress)
    for (const chapter of CHAPTERS) tl.addLabel(chapter.id, chapter.start);
    for (const shot of SHOTS) if (shot.from <= 0.78) tl.addLabel(`shot:${shot.id}`, fromDriftLocal(shot.from));

    // Leaving manual mode: hand progress back to the scroll position.
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (prev.manual && !state.manual) state.setProgress(proxy.progress);
    });

    return () => {
      unsubscribe();
      tl.scrollTrigger?.kill();
      tl.kill();
      gsap.ticker.remove(raf);
      lenis.destroy();
      if (lenisRef === lenis) lenisRef = null;
      trackEl = null;
    };
  }, [trackRef]);
}
