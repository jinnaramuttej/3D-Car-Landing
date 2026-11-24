'use client';

import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { progressAtTime, timeAtProgress } from './autoplay';
import { CONFIG } from './config';
import { CHAPTERS } from './chapters';
import { useStore } from './store';

let lenisRef: Lenis | null = null;
let trackEl: HTMLElement | null = null;

/** Autoplay: seconds into the run, and where it last put the scroll (to notice a hand on it). */
const play = { t: 0, lastY: -1 };

/** Play / pause (the Play button, a tap of Space). Starts from wherever the page is. */
export function togglePlay() {
  const st = useStore.getState();
  if (st.auto === 'playing') {
    st.setAuto('paused');
    return;
  }
  if (st.auto === 'off') play.t = timeAtProgress(st.view >= 0.995 ? 0 : st.view);
  play.lastY = -1;
  st.setManual(false);
  st.setAuto('playing');
}

/** The visitor has the wheel again (any scroll, the mini-map). */
export function stopPlay() {
  const st = useStore.getState();
  if (st.auto !== 'off') st.setAuto('off');
  play.lastY = -1;
}

/**
 * Scrolls (through Lenis) to a global progress value. `immediate` moves the scroll there in
 * one frame (the mini-map); the scene still drives there (the journey driver never jumps).
 * Otherwise the scroll itself glides. If the debug slider owns progress, it hands control
 * back to the scroll first.
 */
export function scrollToProgress(p: number, immediate = false, duration = 2.4) {
  if (!lenisRef || !trackEl) return;
  stopPlay();
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
    const raf = (time: number, deltaMs: number) => {
      lenis.raf(time * 1000);
      // autoplay: move the scroll at the cinematic pace, as a visitor would
      const st = useStore.getState();
      if (st.auto !== 'playing' || st.load !== 'ready') {
        play.lastY = -1;
        return;
      }
      if (play.lastY >= 0 && Math.abs(lenis.scroll - play.lastY) > 6) {
        stopPlay(); // a hand on the scrollbar
        return;
      }
      play.t += Math.min(deltaMs, 100) / 1000;
      const p = progressAtTime(play.t);
      const y = p * Math.max(0, track.offsetHeight - window.innerHeight);
      lenis.scrollTo(y, { immediate: true, force: true });
      play.lastY = lenis.scroll;
      if (p >= 1) stopPlay();
    };
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenisRef = lenis;
    trackEl = track;
    // any scroll by hand takes over from autoplay (the journey driver smooths the handover)
    const takeOver = () => {
      if (useStore.getState().auto !== 'off') stopPlay();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) takeOver();
    };
    window.addEventListener('wheel', takeOver, { passive: true });
    window.addEventListener('touchstart', takeOver, { passive: true });
    window.addEventListener('keydown', onKey);
    // no scrolling behind the loader: the warm-up is driving
    if (useStore.getState().load !== 'ready') lenis.stop();
    const unready = useStore.subscribe((s, prev) => {
      if (s.load === 'ready' && prev.load !== 'ready') lenis.start();
    });

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
    // Labels: every chapter
    for (const chapter of CHAPTERS) tl.addLabel(chapter.id, chapter.start);

    // Leaving manual mode: hand progress back to the scroll position.
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (prev.manual && !state.manual) state.setProgress(proxy.progress);
    });

    return () => {
      unsubscribe();
      unready();
      window.removeEventListener('wheel', takeOver);
      window.removeEventListener('touchstart', takeOver);
      window.removeEventListener('keydown', onKey);
      tl.scrollTrigger?.kill();
      tl.kill();
      gsap.ticker.remove(raf);
      lenis.destroy();
      if (lenisRef === lenis) lenisRef = null;
      trackEl = null;
    };
  }, [trackRef]);
}
