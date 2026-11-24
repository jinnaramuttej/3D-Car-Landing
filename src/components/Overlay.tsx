'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { chapters, credits, hints, SITE, UI } from '@/content';
import { CHAPTERS, chapterById, type ChapterId } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { layoutState, overlap, type Rect } from '@/lib/layout';
import { pointer } from '@/lib/pointer';
import { useStore } from '@/lib/store';
import { LIVERIES } from '@/scene/livery';

const [TITLE_WORD, TITLE_YEAR] = SITE.name.split(' ');
const TITLE_META = [SITE.edition, SITE.dates, SITE.venue];

/** Global progress at a fraction of a chapter, and a duration in chapter fractions. */
const at = (id: ChapterId, f: number) => {
  const c = chapterById(id);
  return c.start + f * (c.end - c.start);
};
const len = (id: ChapterId, f: number) => {
  const c = chapterById(id);
  return f * (c.end - c.start);
};

/* ------------------------------------------------------------- layout solver */

export type Slot = 'tl' | 'tr' | 'tc' | 'bl';
const SLOT_PREF: Record<Slot, number> = { tl: 0, bl: 0.04, tr: 0.07, tc: 0.1 };

/** Gutter, as the CSS works it out (clamp(16px, 4vw, 56px)). */
const gutter = (w: number) => Math.max(16, Math.min(56, w * 0.04));

/** Where an element of size ew x eh would sit in each slot (CSS px). */
export function slotRect(slot: Slot, ew: number, eh: number): Rect {
  const { w, h } = layoutState;
  const g = gutter(w);
  const top = 92;
  const bottom = 128;
  const x0 = slot === 'tl' || slot === 'bl' ? g : slot === 'tr' ? w - g - 56 - ew : (w - ew) / 2;
  const y0 = slot === 'bl' ? h - bottom - eh : top;
  return { x0, y0, x1: x0 + ew, y1: y0 + eh };
}

/**
 * Picks the slot that keeps an element of size ew x eh off the car (weighted 12: nothing
 * may cover it), the stop panel on screen (4) and the billboard on show (2), with a small
 * preference order and a bonus for staying put.
 */
export function pickSlot(slots: Slot[], ew: number, eh: number, current: Slot) {
  let best = current;
  let score = Infinity;
  const area = Math.max(1, ew * eh);
  for (const slot of slots) {
    const r = slotRect(slot, ew, eh);
    const v = (12 * overlap(r, layoutState.car) + 2 * overlap(r, layoutState.board) + 4 * overlap(r, layoutState.panel)) / area + SLOT_PREF[slot] - (slot === current ? 0.12 : 0);
    if (v < score) {
      score = v;
      best = slot;
    }
  }
  return best;
}

/** Splits a line into masked words for the kinetic reveal. */
function KineticLine({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={i}>
          <span className="kl">
            <span style={{ '--i': i } as React.CSSProperties}>{word}</span>
          </span>{' '}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Page-wide DOM layer: the chapter cards (numeral, title, one line), the first-screen
 * hints, the cinema bars during the drift, the Techfest title that forms in the smoke in
 * chapter IV, the progress line, the livery toast and the footer credit. One paused GSAP
 * timeline on the global progress scale, played by the journey on screen (store.view), so
 * it scrubs both ways and never runs ahead of the car.
 *
 * On top of the timeline, a layout loop: only one title is ever up, it fades while the car
 * is fast (and, at a stop, waits until the camera has settled on it), and it sits in
 * whichever slot (top-left, top-right, upper-centre, lower-left) keeps it off the car and
 * the billboard. Its words rise out of masks as it arrives, with a little depth parallax.
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
    // III: lands as the car reaches the plaza, gone before the flick; cinema bars through the slide
    tl.fromTo(q('.letterbox'), { scaleY: 0 }, { scaleY: 1, duration: len('turn', 0.03), ease: 'power2.out' }, at('turn', -0.02));
    cardIn('turn', -0.02, 0.03);
    cardOut('turn', 0.06, 0.05);
    tl.to(q('.letterbox'), { scaleY: 0, duration: len('turn', 0.1), ease: 'power2.inOut' }, at('turn', 0.86));
    // IV: the card, then the title forms in the smoke the drift left behind
    const cl = (f: number) => at('wake', f);
    const cll = (f: number) => len('wake', f);
    cardIn('wake', 0.04);
    cardOut('wake', 0.22);
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
    // V-XI: the card as the car reaches the billboard, then it makes way for the panel;
    // the finale's as the bridge opens up, gone before the CTA
    for (const c of CHAPTERS.slice(CHAPTERS.findIndex((x) => x.id === 'arrival'))) {
      if (c.id === 'finale') {
        cardIn(c.id, 0.3, 0.05);
        cardOut(c.id, 0.5);
      } else {
        cardIn(c.id, 0.2, 0.04);
        cardOut(c.id, 0.36, 0.05);
      }
    }
    tl.set({}, {}, 1);

    const bar = q('.progress')[0] as HTMLElement | undefined;
    const render = (p: number) => {
      tl.progress(p);
      if (bar) bar.style.transform = `scaleX(${p})`;
    };
    render(useStore.getState().view);
    const unsubscribe = useStore.subscribe((s) => render(s.view));

    // the layout loop: gate, slot, reveal, parallax
    const cardsEl = q('.cards')[0] as HTMLElement;
    const titleEl = q('.title-block')[0] as HTMLElement;
    const cardEls = q('.chapter-card') as HTMLElement[];
    const lay = { gate: 1, slot: 'tl' as Slot, pending: null as Slot | null, fadeUntil: 0, titleSlot: 'tc' as Slot, px: 0, py: 0 };
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = layoutState;
      const ch = CHAPTERS[chapterState.chapter];
      // titles: only when calm; at a stop, only once the camera has settled on it
      const want = (ch.stop ? (L.atStop ? 1 : 0) : 1) * L.calm;
      lay.gate += (want - lay.gate) * (1 - Math.exp(-dt / (want > lay.gate ? 0.35 : 0.18)));
      // the card on screen (the timeline shows one at a time)
      let active: HTMLElement | null = null;
      for (const el of cardEls) {
        const on = Number(el.style.opacity || getComputedStyle(el).opacity) > 0.02;
        el.classList.toggle('is-in', on && lay.gate > 0.3);
        if (on) active = el;
      }
      if (active && now > lay.fadeUntil && !lay.pending) {
        const slot = pickSlot(['tl', 'tr', 'tc', 'bl'], active.offsetWidth, active.offsetHeight, lay.slot);
        if (slot !== lay.slot) {
          // never slide across the car: fade out, move, fade in
          lay.pending = slot;
          lay.fadeUntil = now + 260;
          cardsEl.style.setProperty('--slotfade', '0');
        }
      }
      if (lay.pending && now > lay.fadeUntil) {
        lay.slot = lay.pending;
        lay.pending = null;
        cardsEl.dataset.slot = lay.slot;
        cardsEl.style.setProperty('--slotfade', '1');
        lay.fadeUntil = now + 900; // and stay a moment
      }
      cardsEl.style.setProperty('--gate', lay.gate.toFixed(3));
      // the Techfest title in the wake: upper-centre unless the car is there
      if (titleEl && Number(titleEl.style.opacity || 0) > 0.02) {
        const ts = pickSlot(['tc', 'tl', 'tr'], titleEl.offsetWidth, titleEl.offsetHeight, lay.titleSlot);
        if (ts !== lay.titleSlot) {
          lay.titleSlot = ts;
          titleEl.dataset.slot = ts;
        }
      }
      // depth parallax (the line moves more than the numeral)
      lay.px += (pointer.x - lay.px) * (1 - Math.exp(-dt / 0.4));
      lay.py += (pointer.y - lay.py) * (1 - Math.exp(-dt / 0.4));
      cardsEl.style.setProperty('--px', lay.px.toFixed(3));
      cardsEl.style.setProperty('--py', lay.py.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
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

      <div className="cards" data-slot="tl">
        {CHAPTERS.map((c) => (
          <header key={c.id} className="chapter-card" data-chapter={c.id}>
            <p className="chapter-num">
              <span>{c.numeral}</span>
              {c.title}
            </p>
            <h2 className="chapter-line" aria-label={chapters[c.id].line}>
              <KineticLine text={chapters[c.id].line} />
            </h2>
          </header>
        ))}
      </div>

      <ul className="hints" aria-label="How to play">
        {hints.map((h, i) => (
          <li key={h} className={i === 0 || i === 3 ? '' : 'desktop-only'}>
            {h}
          </li>
        ))}
      </ul>

      <section className="title-block" data-slot="tc" aria-label={SITE.name}>
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
        {' · '}
        <a href={credits.city.href} target="_blank" rel="noreferrer">
          {credits.city.text}
        </a>
      </p>
    </div>
  );
}
