'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { arrival, chapters, credits, type EventTag, finale, numbers, partners, pitlane, schedule, site } from '@/content';
import { beatById, type BeatId, FINALE } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { useStore } from '@/lib/store';

const MOBILE_Q = '(max-width: 767px), (pointer: coarse)';
const DESKTOP_Q = '(min-width: 768px) and (pointer: fine)';

/** Global progress at a fraction of a beat, and a duration in beat fractions. */
const at = (id: BeatId, f: number) => {
  const b = beatById(id);
  return b.start + f * (b.end - b.start);
};
const len = (id: BeatId, f: number) => {
  const b = beatById(id);
  return f * (b.end - b.start);
};

type Q = (sel: string) => Element[];

const fmt = (v: number, decimals: number, plain?: boolean) =>
  plain ? v.toFixed(0) : v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** One paused timeline on the global 0..1 scale: every block is pinned and scrubbable. */
function buildTimeline(q: Q, mobile: boolean) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  const show = (id: BeatId, inAt: number, outAt = 2) => {
    const layer = q(`.v-${id}`);
    tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: len(id, 0.06) }, at(id, inAt));
    if (outAt <= 1) tl.to(layer, { autoAlpha: 0, duration: len(id, 0.08) }, at(id, outAt));
  };
  const rise = (sel: string, id: BeatId, f: number, d = 0.1, y = 24) =>
    tl.fromTo(q(sel), { autoAlpha: 0, y }, { autoAlpha: 1, y: 0, duration: len(id, d), ease: 'power2.out', stagger: len(id, 0.03) }, at(id, f));

  // ARRIVE: the facts, beside the orbit
  show('arrive', 0.18, 0.92);
  rise('.v-arrive .fact', 'arrive', 0.22, 0.12, 16);

  // NUMBERS: gauges sweep and count up
  show('numbers', 0.03, 0.9);
  rise('.v-numbers .block-head > *', 'numbers', 0.05, 0.1);
  rise('.gauge', 'numbers', 0.1, 0.1, 18);
  q('.gauge').forEach((g, i) => {
    const item = numbers.items[i];
    const value = g.querySelector('.gauge-value');
    const box = { v: 0 };
    tl.fromTo(
      box,
      { v: 0 },
      {
        v: item.value,
        duration: len('numbers', 0.42),
        ease: 'power2.out',
        onUpdate: () => {
          if (value) value.textContent = `${item.prefix}${fmt(box.v, item.decimals, item.plain)}${item.suffix}`;
          (g as HTMLElement).style.setProperty('--sweep', (box.v / item.max).toFixed(3));
        },
      },
      at('numbers', 0.14 + i * 0.05),
    );
  });

  // PIT LANE: pinned; scroll slides the bays (vertically on mobile)
  show('pitlane', 0.02, 0.92);
  rise('.v-pitlane .block-head > *', 'pitlane', 0.04, 0.08);
  tl.fromTo(q('.bays'), { '--p': 0 }, { '--p': 1, duration: len('pitlane', mobile ? 0.78 : 0.8) }, at('pitlane', 0.1));

  // MARKERS: heading; the days come up as the camera reaches each stone (rAF below)
  show('markers', 0.03, 0.9);
  rise('.v-markers .block-head > *', 'markers', 0.05, 0.1);

  // PARTNERS
  show('partners', 0.04, 0.88);
  rise('.v-partners .block-head > *', 'partners', 0.06, 0.1);
  rise('.board', 'partners', 0.12, 0.12, 14);

  // FINALE: the line through the rev, the CTA as the car leaves
  show('finale', 0.02);
  tl.fromTo(q('.finale-line'), { autoAlpha: 0 }, { autoAlpha: 1, duration: len('finale', 0.05) }, at('finale', 0.04));
  tl.to(q('.finale-line'), { autoAlpha: 0, duration: len('finale', 0.06) }, at('finale', 0.26));
  tl.fromTo(
    q('.finale-cta > *'),
    { autoAlpha: 0, filter: 'blur(16px)', y: 20 },
    { autoAlpha: 1, filter: 'blur(0px)', y: 0, duration: len('finale', 0.12), stagger: len('finale', 0.035), ease: 'power2.out' },
    at('finale', FINALE.ctaAt),
  );

  tl.set({}, {}, 1);
  return tl;
}

/**
 * Chapter V in the DOM: the facts, the dashboard, the pit lane (garage bays with filter
 * chips), the mile-marker schedule, the roadside partners and the finale CTA.
 */
export function Arrival() {
  const root = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<(typeof pitlane.filters)[number]>('All');
  const bays = useMemo(
    () => pitlane.bays.map((b, i) => ({ ...b, bay: i + 1 })).filter((b) => filter === 'All' || b.tag === (filter as EventTag)),
    [filter],
  );

  // Distance the bays travel (px): recomputed on resize and when the filter changes
  const measure = useRef<() => void>(() => {});
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const track = el.querySelector<HTMLElement>('.bays');
    measure.current = () => {
      if (!track) return;
      const mobile = window.matchMedia(MOBILE_Q).matches;
      const travel = mobile ? track.scrollHeight - 0.2 * window.innerHeight : track.scrollWidth - 0.34 * window.innerWidth;
      track.style.setProperty('--travel', `${Math.max(0, travel)}px`);
    };
    const m = () => measure.current();
    window.addEventListener('resize', m);
    return () => window.removeEventListener('resize', m);
  }, []);
  useEffect(() => measure.current(), [bays]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el) as Q;
    let tl: gsap.core.Timeline | null = null;
    const mm = gsap.matchMedia();
    mm.add({ mobile: MOBILE_Q, desktop: DESKTOP_Q }, (ctx) => {
      tl = buildTimeline(q, Boolean(ctx.conditions?.mobile));
      tl.progress(useStore.getState().progress);
      measure.current();
      return () => {
        tl?.kill();
        tl = null;
      };
    });
    const unsubscribe = useStore.subscribe((s) => tl?.progress(s.progress));

    // the schedule days follow the mile markers in 3D
    const days = q('.marker-day') as HTMLElement[];
    let raf = 0;
    const tick = () => {
      days.forEach((d, i) => {
        const lit = chapterState.markers[i] ?? 0;
        d.style.setProperty('--lit', lit.toFixed(3));
        d.classList.toggle('is-lit', lit > 0.5);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      unsubscribe();
      mm.revert();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={root} className="arrival">
      {/* ARRIVE */}
      <section className="v-block v-arrive" aria-label={arrival.kicker}>
        <dl className="facts glass">
          {arrival.facts.map((f) => (
            <div key={f.label} className="fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* NUMBERS */}
      <section className="v-block v-numbers" aria-label={numbers.kicker}>
        <div className="block-head">
          <p className="kicker">{numbers.kicker}</p>
          <h2 className="heading">{numbers.heading}</h2>
        </div>
        <ul className="gauges">
          {numbers.items.map((n) => (
            <li key={n.label} className="gauge">
              <svg viewBox="0 0 120 120" aria-hidden>
                <circle className="gauge-track" cx="60" cy="60" r="50" pathLength="100" />
                <circle className="gauge-arc" cx="60" cy="60" r="50" pathLength="100" />
              </svg>
              <span className="gauge-value">
                {n.prefix}0{n.suffix}
              </span>
              <span className="gauge-label">{n.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* PIT LANE */}
      <section className="v-block v-pitlane" aria-label={pitlane.kicker}>
        <div className="block-head">
          <p className="kicker">{pitlane.kicker}</p>
          <h2 className="heading">{pitlane.heading}</h2>
          <div className="chips" role="group" aria-label="Filter events">
            {pitlane.filters.map((f) => (
              <button key={f} type="button" className={`chip${filter === f ? ' is-on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="bays-window">
          <ol className="bays">
            {bays.map((b) => (
              <li key={b.name} className="bay">
                <div className="bay-door" aria-hidden>
                  <span>BAY {String(b.bay).padStart(2, '0')}</span>
                </div>
                <div className="bay-body">
                  <span className="bay-tag">{b.tag}</span>
                  <h3>{b.name}</h3>
                  <p className="bay-line">{b.line}</p>
                  {(b.with || b.prize) && (
                    <p className="bay-meta">
                      {b.with && <span>{b.with}</span>}
                      {b.prize && <strong>{b.prize}</strong>}
                    </p>
                  )}
                  <a className="bay-link" href={site.url} target="_blank" rel="noopener noreferrer">
                    {pitlane.status}
                    <span aria-hidden>↗</span>
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* MARKERS */}
      <section className="v-block v-markers" aria-label={schedule.kicker}>
        <div className="block-head">
          <p className="kicker">{schedule.kicker}</p>
          <h2 className="heading">{schedule.heading}</h2>
        </div>
        <ol className="marker-days">
          {schedule.days.map((d) => (
            <li key={d.date} className="marker-day">
              <span className="marker-date">{d.date}</span>
              <span className="marker-label">{d.day}</span>
              <span className="marker-line">{d.line}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* PARTNERS */}
      <section className="v-block v-partners" aria-label={partners.kicker}>
        <div className="block-head">
          <p className="kicker">{partners.kicker}</p>
          <h2 className="heading">{partners.heading}</h2>
        </div>
        <ul className="boards">
          {partners.boards.map((b) => (
            <li key={b.name} className="board">
              <strong>{b.name}</strong>
              <span>{b.line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* FINALE */}
      <section className="v-block v-finale" aria-label={finale.cta}>
        <p className="finale-line">{finale.line}</p>
        <div className="finale-cta">
          <div className="scrim" aria-hidden />
          <h2 className="finale-title">{chapters.arrival.line}</h2>
          <a className="btn btn-accent btn-lg" href={site.url} target="_blank" rel="noopener noreferrer">
            {finale.cta}
            <span aria-hidden>↗</span>
          </a>
          <p className="finale-sub">{finale.sub}</p>
          <footer className="finale-foot">
            <p>{site.disclaimer}</p>
            <p>
              <a href={credits.model.href} target="_blank" rel="noreferrer">
                {credits.model.text}
              </a>
              {' · '}
              <a href={credits.hdri.href} target="_blank" rel="noreferrer">
                {credits.hdri.text}
              </a>
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}
