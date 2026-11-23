'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { intro } from '@/content';
import { PHASES } from '@/lib/script';
import { driftLocal } from '@/lib/sections';
import { useStore } from '@/lib/store';

/**
 * DOM layer of the drift scene (intro title, cinema bars), plus the page-wide
 * progress line and the model credit. Its paused GSAP timeline is laid out on the
 * drift scene's own 0..1 scale, so the drift timing is unchanged inside the longer page.
 */
export function Overlay() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);

    const P = PHASES;
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    tl.to(q('.scroll-hint'), { autoAlpha: 0, duration: 0.03 }, 0)
      .to(q('.intro'), { autoAlpha: 0, y: -24, duration: P.introOutTo - P.introOutFrom }, P.introOutFrom)
      // cinema bars for the shots, opening up as the smoke takes over
      .to(q('.letterbox'), { scaleY: 0, duration: P.letterboxOutTo - P.letterboxOutFrom, ease: 'power2.inOut' }, P.letterboxOutFrom)
      .set({}, {}, 1);

    const bar = q('.progress')[0] as HTMLElement | undefined;
    const render = (p: number) => {
      tl.progress(driftLocal(p));
      if (bar) bar.style.transform = `scaleX(${p})`;
    };
    render(useStore.getState().progress);
    const unsubscribe = useStore.subscribe((s) => render(s.progress));
    return () => {
      unsubscribe();
      tl.kill();
    };
  }, []);

  return (
    <div ref={root} className="overlay">
      <div className="letterbox letterbox-top" aria-hidden />
      <div className="letterbox letterbox-bottom" aria-hidden />
      <header className="intro">
        <p className="eyebrow">{intro.eyebrow}</p>
        <h1 className="intro-title">
          {intro.titleTop}
          <br />
          <span>{intro.titleAccent}</span>
        </h1>
      </header>
      <div className="scroll-hint" aria-hidden>
        {intro.hint}
      </div>

      <div className="progress" aria-hidden />
      <p className="credit">
        Porsche 992 GT3 R model by{' '}
        <a href="https://sketchfab.com/3d-models/porsche-992-gt3-r-03ea07f7972648aa9350853b2a1a942a" target="_blank" rel="noreferrer">
          MattDoesBlender
        </a>
        , CC BY-NC-SA 4.0
      </p>
    </div>
  );
}
