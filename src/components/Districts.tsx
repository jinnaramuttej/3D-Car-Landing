'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { COMMITTEE_NAMES, COMPETITIONS, EXPO, HEARTBEAT, ROBOWARS, SITE, TWMUN, UI, VOICES } from '@/content';
import { beatById, type BeatId, FINALE } from '@/lib/chapters';
import { chapterState, districtWeight } from '@/lib/chapterRuntime';
import { districtFx, initials, useDistricts, VOICE_CATEGORIES } from '@/lib/districtState';
import { useStore } from '@/lib/store';

gsap.registerPlugin(Flip);

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

/** "1.5M+" -> 1.5, "M+"; "₹10,00,000" -> 1000000. */
function parseStat(v: string) {
  const m = v.match(/^([^\d]*)([\d.,]+)(.*)$/);
  if (!m) return { prefix: '', value: 0, suffix: v, decimals: 0 };
  const num = m[2].replace(/,/g, '');
  return { prefix: m[1], value: parseFloat(num), suffix: m[3], decimals: num.includes('.') ? 1 : 0 };
}

/** One paused timeline on the global 0..1 scale: every panel is pinned and scrubbable. */
function buildTimeline(q: Q, mobile: boolean) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  const show = (id: BeatId, inAt: number, outAt = 2) => {
    const layer = q(`.d-${id}`);
    tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: len(id, 0.06) }, at(id, inAt));
    if (outAt <= 1) tl.to(layer, { autoAlpha: 0, duration: len(id, 0.07) }, at(id, outAt));
  };
  const rise = (sel: string, id: BeatId, f: number, d = 0.1, y = 22) =>
    tl.fromTo(q(sel), { autoAlpha: 0, y }, { autoAlpha: 1, y: 0, duration: len(id, d), ease: 'power2.out', stagger: len(id, 0.025) }, at(id, f));

  // V arrival: the facts beside the orbit
  show('arrive', 0.16, 0.66);
  rise('.d-arrive .fact', 'arrive', 0.18, 0.1, 14);

  // VI arena: prize, classes, stats counting up, zonals
  show('arena', 0.16, 0.7);
  rise('.d-arena .panel > *', 'arena', 0.18, 0.1, 16);
  q('.arena-stat').forEach((el, i) => {
    const s = parseStat(ROBOWARS.stats[i].value);
    const out = el.querySelector('.stat-value');
    const box = { v: 0 };
    tl.fromTo(
      box,
      { v: 0 },
      {
        v: s.value,
        duration: len('arena', 0.3),
        ease: 'power2.out',
        onUpdate: () => {
          if (out) out.textContent = `${s.prefix}${box.v.toFixed(s.decimals)}${s.suffix}`;
        },
      },
      at('arena', 0.22 + i * 0.04),
    );
  });

  // VII pit lane: pinned, the bays slide (vertically on phones)
  show('pitlane', 0.14, 0.76);
  rise('.d-pitlane .block-head > *', 'pitlane', 0.16, 0.08);
  tl.fromTo(q('.bays'), { '--p': 0 }, { '--p': 1, duration: len('pitlane', mobile ? 0.5 : 0.52) }, at('pitlane', 0.2));

  // VIII voices
  show('voices', 0.16, 0.7);
  rise('.d-voices .block-head > *', 'voices', 0.18, 0.1);

  // IX expo
  show('expo', 0.06, 0.78);
  rise('.d-expo .block-head > *', 'expo', 0.08, 0.06);

  // X heartbeat: slow fades only
  show('heartbeat', 0.18, 0.7);
  tl.fromTo(q('.d-heartbeat .hb > *'), { autoAlpha: 0 }, { autoAlpha: 1, duration: len('heartbeat', 0.12), stagger: len('heartbeat', 0.05) }, at('heartbeat', 0.2));

  // XI chamber
  show('chamber', 0.16, 0.66);
  rise('.d-chamber .block-head > *', 'chamber', 0.18, 0.08);
  rise('.committee', 'chamber', 0.22, 0.1, 18);

  // finale: one CTA as the car leaves
  show('finale', 0.02);
  tl.fromTo(
    q('.finale-cta > *'),
    { autoAlpha: 0, filter: 'blur(14px)', y: 18 },
    { autoAlpha: 1, filter: 'blur(0px)', y: 0, duration: len('finale', 0.12), stagger: len('finale', 0.04), ease: 'power2.out' },
    at('finale', FINALE.ctaAt),
  );

  tl.set({}, {}, 1);
  return tl;
}

/* ------------------------------------------------------------------- panels */

function ArenaPanel() {
  const kg = useDistricts((s) => s.arenaClass);
  return (
    <section className="d-block d-arena" aria-label={UI.arena.kicker}>
      <div className="panel glass">
        <p className="kicker">{UI.arena.kicker}</p>
        <p className="prize">
          <span>{UI.arena.prizeLabel}</span>
          <strong>{ROBOWARS.prizePool}</strong>
        </p>
        <div className="classes" role="radiogroup" aria-label={UI.arena.classLabel}>
          <span className="classes-label">{UI.arena.classLabel}</span>
          {ROBOWARS.classes.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={kg === c} className={`chip${kg === c ? ' is-on' : ''}`} onClick={() => useDistricts.getState().setArenaClass(c)}>
              {c} kg
            </button>
          ))}
        </div>
        <ul className="arena-stats">
          {ROBOWARS.stats.map((s) => (
            <li key={s.label} className="arena-stat">
              <span className="stat-value">0</span>
              <span className="stat-label">{s.label}</span>
            </li>
          ))}
        </ul>
        <p className="zonals">
          <span>{UI.arena.zonalsLabel}</span>
          {ROBOWARS.zonals.map((z) => (
            <em key={z}>{z}</em>
          ))}
        </p>
        <p className="note">{ROBOWARS.note}</p>
        <p className="hint desktop-only">{UI.arena.hint}</p>
        <a className="text-link" href={SITE.home} target="_blank" rel="noopener noreferrer">
          {UI.checkStatus} <span aria-hidden>↗</span>
        </a>
      </div>
    </section>
  );
}

const TAGS = ['All', ...Array.from(new Set(COMPETITIONS.map((c) => c.tag)))];

function PitLanePanel({ measure }: { measure: () => void }) {
  const [filter, setFilter] = useState('All');
  const flip = useRef<Flip.FlipState | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const pick = (f: string) => {
    if (f === filter) return;
    if (list.current) flip.current = Flip.getState(list.current.querySelectorAll('.bay'));
    setFilter(f);
  };

  // animate the cards from where they were to where the filter puts them
  useLayoutEffect(() => {
    measure();
    const state = flip.current;
    if (!state) return;
    flip.current = null;
    Flip.from(state, {
      duration: 0.55,
      ease: 'power3.inOut',
      absolute: true,
      scale: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'power2.out' }),
      onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.86, duration: 0.3 }),
    });
  }, [filter, measure]);

  return (
    <section className="d-block d-pitlane" aria-label={UI.pitlane.kicker}>
      <div className="block-head">
        <p className="kicker">{UI.pitlane.kicker}</p>
        <div className="chips" role="group" aria-label="Filter competitions">
          {TAGS.map((t) => (
            <button key={t} type="button" className={`chip${filter === t ? ' is-on' : ''}`} aria-pressed={filter === t} onClick={() => pick(t)}>
              {t === 'All' ? UI.pitlane.all : t}
            </button>
          ))}
        </div>
      </div>
      <div className="bays-window">
        <ol className="bays" ref={list}>
          {COMPETITIONS.map((c, i) => {
            const on = filter === 'All' || c.tag === filter;
            const x = c as { by?: string; prize?: string; finale?: string; blurb?: string };
            return (
              <li key={c.name} className="bay" style={on ? undefined : { display: 'none' }} data-flip-id={c.name}>
                <div className="bay-door" aria-hidden>
                  <span>BAY {String(i + 1).padStart(2, '0')}</span>
                </div>
                <div className="bay-body">
                  <span className="bay-tag">{c.tag}</span>
                  <h3>{c.name}</h3>
                  {x.blurb && <p className="bay-line">{x.blurb}</p>}
                  <p className="bay-meta">
                    {x.by && <span>{x.by}</span>}
                    {x.prize && <strong>{x.prize}</strong>}
                    {x.finale && (
                      <span>
                        {UI.pitlane.finale}: {x.finale}
                      </span>
                    )}
                  </p>
                  <a className="bay-link" href={SITE.home} target="_blank" rel="noopener noreferrer">
                    {UI.checkStatus} <span aria-hidden>↗</span>
                  </a>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function VoicesPanel() {
  const category = useDistricts((s) => s.voiceCategory);
  const hover = useDistricts((s) => s.hoverVoice);
  const pinned = useDistricts((s) => s.pinnedVoice);
  const people = VOICES.categories[category];
  const active = pinned ?? hover;
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = card.current;
      if (el) {
        const v = districtFx.voiceCard;
        // sit right of the marker, or left of it near the right edge (clear of the mini-map)
        const w = el.offsetWidth + 36;
        const x = v.x + w > window.innerWidth - 70 ? v.x - w : v.x;
        el.style.transform = `translate(${x.toFixed(1)}px, ${v.y.toFixed(1)}px)`;
        el.classList.toggle('is-on', v.visible && active !== null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const person = active !== null ? people[active] : null;
  return (
    <section className="d-block d-voices" aria-label={VOICES.heading}>
      <div className="block-head">
        <p className="kicker">{UI.voices.kicker}</p>
        <h2 className="heading">{VOICES.heading}</h2>
        <div className="chips" role="tablist" aria-label="Speaker categories">
          {VOICE_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={`chip${category === c ? ' is-on' : ''}`} onClick={() => useDistricts.getState().setVoiceCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <p className="hint desktop-only">{UI.voices.hint}</p>
        {/* phones: a plain list instead of the globe */}
        <ul className="voice-list mobile-only">
          {people.map(([name, title]) => (
            <li key={name}>
              <span className="monogram" aria-hidden>
                {initials(name)}
              </span>
              <span>
                <strong>{name}</strong>
                <em>{title}</em>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div ref={card} className="voice-card" aria-live="polite">
        {person && (
          <>
            <span className="monogram" aria-hidden>
              {initials(person[0])}
            </span>
            <span>
              <strong>{person[0]}</strong>
              <em>{person[1]}</em>
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function ExpoPanel() {
  const open = useDistricts((s) => s.expoOpen);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const b = beatById('expo');
      const local = chapterState.progress < b.start ? 0 : Math.min(1, (chapterState.progress - b.start) / (b.end - b.start));
      const i = Math.max(0, Math.min(3, Math.round(local * 3)));
      if (i !== last) {
        last = i;
        setFocus(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const ex = EXPO.exhibits[focus];
  const detail = open !== null ? EXPO.exhibits[open] : null;
  const set = useDistricts.getState;
  return (
    <section className="d-block d-expo" aria-label={EXPO.heading}>
      <div className="block-head">
        <p className="kicker">{UI.expo.kicker}</p>
        <h2 className="heading">{EXPO.heading}</h2>
      </div>
      <div className="exhibit-now">
        <span className="exhibit-index">{String(focus + 1).padStart(2, '0')} / 04</span>
        <strong>{ex.name}</strong>
        <em>{ex.from}</em>
        <button type="button" className="chip" onClick={() => set().setExpoOpen(set().expoOpen === focus ? null : focus)}>
          Details
        </button>
        <p className="hint desktop-only">{UI.expo.hint}</p>
      </div>
      <aside className={`exhibit-detail glass${detail ? ' is-open' : ''}`} aria-hidden={!detail}>
        {detail && (
          <>
            <p className="kicker">{detail.from}</p>
            <h3>{detail.name}</h3>
            <p>{detail.blurb}</p>
            <button type="button" className="chip" onClick={() => set().setExpoOpen(null)}>
              {UI.expo.close}
            </button>
          </>
        )}
      </aside>
    </section>
  );
}

const SWAB = 180; // seconds

function HeartbeatPanel() {
  const [started, setStarted] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const ring = useRef<SVGCircleElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // starts on its own the first time you arrive here; "start again" any time
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (started === null && districtWeight('heartbeat') > 0.85) setStarted(performance.now());
      const t = started === null ? 0 : Math.min(SWAB, (performance.now() - started) / 1000);
      if (ring.current) ring.current.style.strokeDasharray = `${((t / SWAB) * 100).toFixed(2)} 100`;
      if (clock.current) {
        const left = Math.ceil(SWAB - t);
        clock.current.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      }
      if (wrap.current) wrap.current.style.setProperty('--beat', districtFx.heartbeat.toFixed(3));
      if (started !== null && t >= SWAB && !done) setDone(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, done]);

  return (
    <section className="d-block d-heartbeat" aria-label={HEARTBEAT.campaign}>
      <div className="hb">
        <p className="kicker">{HEARTBEAT.campaign}</p>
        <h2 className="hb-headline">{HEARTBEAT.headline}</h2>
        <p className="hb-body">{HEARTBEAT.body}</p>
        <div className="hb-timer" ref={wrap}>
          <svg viewBox="0 0 120 120" aria-hidden>
            <circle className="hb-track" cx="60" cy="60" r="52" pathLength="100" />
            <circle ref={ring} className="hb-ring" cx="60" cy="60" r="52" pathLength="100" />
          </svg>
          <div className="hb-clock">
            <span ref={clock}>3:00</span>
            <em>{done ? UI.heartbeat.done : UI.heartbeat.timer}</em>
          </div>
        </div>
        <button
          type="button"
          className="chip"
          onClick={() => {
            setDone(false);
            setStarted(performance.now());
          }}
        >
          {started === null ? UI.heartbeat.start : UI.heartbeat.restart}
        </button>
        <ul className="hb-stats">
          {HEARTBEAT.stats.map((s) => (
            <li key={s.label}>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ChamberPanel() {
  const [flipped, setFlipped] = useState<string | null>(null);
  return (
    <section className="d-block d-chamber" aria-label={TWMUN.name}>
      <div className="block-head">
        <p className="kicker">{UI.chamber.kicker}</p>
        <h2 className="heading">{TWMUN.name}</h2>
        <p className="tagline">{TWMUN.tagline}</p>
        <p className="hint desktop-only">{UI.chamber.hint}</p>
      </div>
      <ul className="committees">
        {TWMUN.committees.map((c) => {
          const code = c.replace(/\s*\(.*\)$/, '');
          const back = COMMITTEE_NAMES[code] ?? c.match(/\((.*)\)/)?.[1] ?? c;
          return (
            <li key={c} className={`committee${flipped === c ? ' is-flipped' : ''}`}>
              <button type="button" aria-label={`${code}: ${back}`} onClick={() => setFlipped(flipped === c ? null : c)}>
                <span className="face front">{code}</span>
                <span className="face back">{back}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Chapters V-XI and the finale in the DOM. One paused GSAP timeline on the global
 * progress scale shows each panel during its district; the panels' own controls (weight
 * classes, filters, tabs, details, timer, flip cards) talk to the 3D through
 * src/lib/districtState.ts.
 */
export function Districts() {
  const root = useRef<HTMLDivElement>(null);

  // pit lane: distance the bays travel (px), re-measured on resize and on every filter
  const measure = useMemo(
    () => () => {
      const track = root.current?.querySelector<HTMLElement>('.bays');
      if (!track) return;
      const mobile = window.matchMedia(MOBILE_Q).matches;
      const travel = mobile ? track.scrollHeight - 0.24 * window.innerHeight : track.scrollWidth - 0.3 * window.innerWidth;
      track.style.setProperty('--travel', `${Math.max(0, travel)}px`);
    },
    [],
  );

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el) as Q;
    let tl: gsap.core.Timeline | null = null;
    const mm = gsap.matchMedia();
    mm.add({ mobile: MOBILE_Q, desktop: DESKTOP_Q }, (ctx) => {
      tl = buildTimeline(q, Boolean(ctx.conditions?.mobile));
      tl.progress(useStore.getState().progress);
      measure();
      return () => {
        tl?.kill();
        tl = null;
      };
    });
    const unsubscribe = useStore.subscribe((s) => tl?.progress(s.progress));
    window.addEventListener('resize', measure);
    return () => {
      unsubscribe();
      mm.revert();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <div ref={root} className="districts">
      <section className="d-block d-arrive" aria-label={UI.arrival.kicker}>
        <dl className="facts glass">
          {[
            ['Edition', SITE.edition],
            ['Dates', SITE.dates],
            ['Venue', SITE.venue],
          ].map(([k, v]) => (
            <div key={k} className="fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <ArenaPanel />
      <PitLanePanel measure={measure} />
      <VoicesPanel />
      <ExpoPanel />
      <HeartbeatPanel />
      <ChamberPanel />
      <section className="d-block d-finale" aria-label={UI.cta}>
        <div className="finale-cta">
          <div className="scrim" aria-hidden />
          <a className="btn btn-accent btn-lg" href={SITE.home} target="_blank" rel="noopener noreferrer">
            {UI.cta}
            <span aria-hidden>↗</span>
          </a>
          <p className="finale-sub">{SITE.disclaimer}</p>
        </div>
      </section>
    </div>
  );
}
