'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { chapters, credits, hints, SITE, UI } from '@/content';
import { CHAPTERS, chapterById, type ChapterId, IGNITION } from '@/lib/chapters';
import { DRIFTS, progressAtTime, progressAtZone, timeAtS, ZONES } from '@/lib/pacing';
import { FINALE_CARD, TITLE_CARD } from '@/lib/playhead';
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
 * Page-wide DOM layer: the Techfest title over the parked car with the first-screen hints,
 * the cinema bars during the drift, the stops' cards (numeral, title, one line), the
 * progress line, the livery toast and the footer credit. One paused GSAP
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

    // the intro: the Techfest title over the parked car from the first frame (it comes in at
    // the end of the cold open), with the hints; both go as the engine catches and the car
    // pulls away
    const atS = (m: number) => progressAtTime(timeAtS(m));
    tl.to(q('.hints'), { autoAlpha: 0, y: 10, duration: IGNITION.lightsIn }, IGNITION.at - IGNITION.lightsIn);
    // (no transform on the block: its slot is placed with CSS translate, which a GSAP y would take over)
    tl.to(q('.title-block'), { autoAlpha: 0, filter: 'blur(10px)', duration: IGNITION.driveAt - IGNITION.at }, IGNITION.at);
    // cinema bars through the slide
    for (const d of DRIFTS) {
      tl.fromTo(q('.letterbox'), { scaleY: 0 }, { scaleY: 1, duration: atS(d.flick) - atS(d.from), ease: 'power2.out', immediateRender: false }, atS(d.from));
      tl.to(q('.letterbox'), { scaleY: 0, duration: atS(d.to) - atS(d.hold), ease: 'power2.inOut' }, atS(d.hold));
    }
    // a stop's title follows its slow zone: in at 0.1, out by 0.85 as the car launches
    // (the Stage's board shot fills the right of the frame from 0.35: its title makes way
    // for it first)
    for (const z of ZONES) {
      const id = z.id as ChapterId;
      const zf = (f: number) => progressAtZone(z.id, f);
      const out = TITLE_CARD.outFor[z.id] ?? TITLE_CARD.out;
      tl.fromTo(card(id), { autoAlpha: 0, y: 18, filter: 'blur(10px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: zf(TITLE_CARD.in + 0.06) - zf(TITLE_CARD.in), ease: 'power2.out' }, zf(TITLE_CARD.in));
      tl.to(card(id), { autoAlpha: 0, y: -14, filter: 'blur(8px)', duration: zf(out + 0.06) - zf(out) }, zf(out));
    }
    // the finale's as the bridge opens up, gone before the CTA
    cardIn('finale', FINALE_CARD.in, 0.04);
    cardOut('finale', FINALE_CARD.out, 0.05);
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
      layoutState.titleUp = !!active && lay.gate > 0.3;
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
      // the Techfest title over the parked car: upper-centre unless the car is there
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
        {CHAPTERS.filter((c) => c.id !== 'intro').map((c) => (
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
