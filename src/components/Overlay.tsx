'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { chapters, credits, hints, SITE, UI } from '@/content';
import { beatById, CHAPTERS, chapterById, type ChapterId, fromDriftLocal } from '@/lib/chapters';

const [TITLE_WORD, TITLE_YEAR] = SITE.name.split(' ');
const TITLE_META = [SITE.edition, SITE.dates, SITE.venue];
import { PHASES } from '@/lib/script';
import { useStore } from '@/lib/store';
import { LIVERIES } from '@/scene/livery';

/** Global progress at a fraction of a chapter, and a duration in chapter fractions. */
const at = (id: ChapterId, f: number) => {
  const c = chapterById(id);
  return c.start + f * (c.end - c.start);
};
const len = (id: ChapterId, f: number) => {
  const c = chapterById(id);
  return f * (c.end - c.start);
};

/**
 * Page-wide DOM layer: the chapter cards (numeral, title, one line), the first-screen
 * hints, the cinema bars during the drift, the Techfest title that forms in chapter IV,
 * the progress line, the livery toast and the footer credit. One paused GSAP timeline on
 * the global progress scale, so it scrubs both ways (and with the debug slider).
 */
export function Overlay() {
  const root = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    const card = (id: ChapterId) => q(`.chapter-card[data-chapter="${id}"]`);
    const cardIn = (id: ChapterId, f: number, d = 0.08) =>
      tl.fromTo(
        card(id),
        { autoAlpha: 0, y: 18, filter: 'blur(10px)' },
        { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: len(id, d), ease: 'power2.out' },
        at(id, f),
      );
    const cardOut = (id: ChapterId, f: number, d = 0.08) =>
      tl.to(card(id), { autoAlpha: 0, y: -14, filter: 'blur(8px)', duration: len(id, d) }, at(id, f));

    // I: on screen from the first frame, with the hints
    cardOut('stillness', 0.62, 0.12);
    tl.to(q('.hints'), { autoAlpha: 0, y: 10, duration: len('stillness', 0.12) }, at('stillness', 0.5));
    // II
    cardIn('ignition', 0.06);
    cardOut('ignition', 0.5);
    // III: over the cold open, gone as the flank shot starts; cinema bars through shots 1-5
    tl.fromTo(q('.letterbox'), { scaleY: 0 }, { scaleY: 1, duration: len('turn', 0.015), ease: 'power2.out' }, at('turn', 0) - len('turn', 0.015));
    cardIn('turn', -0.035, 0.03); // lands as the launch hands over to the cold open
    tl.to(card('turn'), { autoAlpha: 0, y: -14, filter: 'blur(8px)', duration: fromDriftLocal(PHASES.introOutTo) - fromDriftLocal(PHASES.introOutFrom) }, fromDriftLocal(PHASES.introOutFrom));
    tl.to(
      q('.letterbox'),
      { scaleY: 0, duration: fromDriftLocal(PHASES.letterboxOutTo) - fromDriftLocal(PHASES.letterboxOutFrom), ease: 'power2.inOut' },
      fromDriftLocal(PHASES.letterboxOutFrom),
    );
    // IV: the card, then the title forms out of the smoke as it clears
    const clearing = beatById('clearing');
    const cl = (f: number) => clearing.start + f * (clearing.end - clearing.start);
    const cll = (f: number) => f * (clearing.end - clearing.start);
    cardIn('clearing', 0.04);
    cardOut('clearing', 0.32);
    tl.fromTo(q('.title-block'), { autoAlpha: 0 }, { autoAlpha: 1, duration: cll(0.04) }, cl(0.24));
    tl.fromTo(
      q('.title-word'),
      { autoAlpha: 0, filter: 'blur(30px)', scale: 1.12, letterSpacing: '0.4em' },
      { autoAlpha: 1, filter: 'blur(0px)', scale: 1, letterSpacing: '0.02em', duration: cll(0.3), ease: 'power3.out' },
      cl(0.26),
    );
    tl.fromTo(q('.title-year'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: cll(0.12), ease: 'power2.out' }, cl(0.42));
    tl.fromTo(
      q('.title-meta > *'),
      { autoAlpha: 0, filter: 'blur(10px)' },
      { autoAlpha: 1, filter: 'blur(0px)', duration: cll(0.1), stagger: cll(0.04) },
      cl(0.5),
    );
    tl.fromTo(q('.title-cta'), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: cll(0.1), ease: 'power2.out' }, cl(0.6));
    tl.to(q('.title-block'), { autoAlpha: 0, y: -24, filter: 'blur(10px)', duration: cll(0.1) }, cl(0.92));
    // V-XI and the finale: the card opens each chapter, then makes way for its panel
    for (const c of CHAPTERS.slice(CHAPTERS.findIndex((x) => x.id === 'arrival'))) {
      cardIn(c.id, 0.03, 0.06);
      if (c.id === 'finale') cardOut(c.id, 0.4);
      else cardOut(c.id, 0.24, 0.06);
    }
    tl.set({}, {}, 1);

    const bar = q('.progress')[0] as HTMLElement | undefined;
    const render = (p: number) => {
      tl.progress(p);
      if (bar) bar.style.transform = `scaleX(${p})`;
    };
    render(useStore.getState().progress);
    const unsubscribe = useStore.subscribe((s) => render(s.progress));
    return () => {
      unsubscribe();
      tl.kill();
    };
  }, []);

  // "Livery: ..." for a moment after each click on the car
  useEffect(() => {
    let timer = 0;
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.livery === prev.livery) return;
      setToast(LIVERIES[s.livery % LIVERIES.length].name);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 1800);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={root} className="overlay">
      <div className="letterbox letterbox-top" aria-hidden />
      <div className="letterbox letterbox-bottom" aria-hidden />

      {CHAPTERS.map((c) => (
        <header key={c.id} className="chapter-card" data-chapter={c.id}>
          <p className="chapter-num">
            <span>{c.numeral}</span>
            {c.title}
          </p>
          <h2 className="chapter-line">{chapters[c.id].line}</h2>
        </header>
      ))}

      <ul className="hints" aria-label="How to play">
        {hints.map((h, i) => (
          <li key={h} className={i === 0 || i === 3 ? '' : 'desktop-only'}>
            {h}
          </li>
        ))}
      </ul>

      <section className="title-block" aria-label={SITE.name}>
        <h1>
          <span className="title-word">{TITLE_WORD}</span>
          <span className="title-year">{TITLE_YEAR}</span>
        </h1>
        <p className="title-meta">
          {TITLE_META.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </p>
        <a className="btn btn-accent title-cta" href={SITE.home} target="_blank" rel="noopener noreferrer">
          {UI.cta}
          <span aria-hidden>↗</span>
        </a>
      </section>

      <p className={`toast${toast ? ' is-on' : ''}`} role="status" aria-live="polite">
        {toast ? `Livery: ${toast}` : ''}
      </p>

      <div className="progress" aria-hidden />
      <p className="credit">
        {SITE.disclaimer}{' '}
        <a href={credits.model.href} target="_blank" rel="noreferrer">
          {credits.model.text}
        </a>
      </p>
    </div>
  );
}
