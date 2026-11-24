'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { ALSO, CATALYST, CES2027, COMPETITIONS, EXPO, HEARTBEAT, ROBOWARS, SITE, TECHEXPO, TWMUN, UI, VOICES } from '@/content';
import { CHAPTERS, chapterById, FINALE } from '@/lib/chapters';
import { chapterState, stopWeight } from '@/lib/chapterRuntime';
import { citySAt } from '@/lib/cityDrive';
import { progressAtZone, type ZoneId, zoneById, zoneProgress } from '@/lib/pacing';
import { COMPETITION_TAGS, expoIndexAt, heartbeatPulse, initials, SPEAKER_CATEGORIES, useStops } from '@/lib/stops';
import { layoutState, overlap, type Rect } from '@/lib/layout';
import { useStore } from '@/lib/store';

gsap.registerPlugin(Flip);

const MOBILE_Q = '(max-width: 767px), (pointer: coarse)';
const DESKTOP_Q = '(min-width: 768px) and (pointer: fine)';

/** Global progress at zone progress f of a stop (the car rolling past its billboard). */
const zf = (id: ZoneId, f: number) => progressAtZone(id, f);
/** A span of zone progress as global progress. */
const zd = (id: ZoneId, f: number, d: number) => zf(id, f + d) - zf(id, f);
/** Finale: global progress at a fraction of its chapter. */
const fin = (f: number) => {
  const c = chapterById('finale');
  return c.start + f * (c.end - c.start);
};
const finLen = (f: number) => {
  const c = chapterById('finale');
  return f * (c.end - c.start);
};

type Q = (sel: string) => Element[];

/** "1.5M+" -> 1.5, "M+"; "₹10,00,000" -> 1000000. */
function parseStat(v: string) {
  const m = v.match(/^([^\d]*)([\d.,]+)(.*)$/);
  if (!m) return { prefix: '', value: 0, suffix: v, decimals: 0 };
  const num = m[2].replace(/,/g, '');
  return { prefix: m[1], value: parseFloat(num), suffix: m[3], decimals: num.includes('.') ? 1 : 0 };
}

/**
 * One paused timeline on the global 0..1 scale, scrubbed by the journey on screen. Each
 * stop's panel follows its slow zone (src/lib/pacing.ts: zone progress 0 -> 1 as the car
 * rolls past the billboard): the stop's title comes in at 0.1 (Overlay.tsx), the panel's
 * details stagger in from 0.3 to 0.7, and everything is gone by 0.85 as the car launches.
 */
function buildTimeline(q: Q, mobile: boolean) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  const show = (sel: string, id: ZoneId, inAt = 0.1, outAt = 0.8) => {
    const layer = q(sel);
    tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: zd(id, inAt, 0.06) }, zf(id, inAt));
    tl.to(layer, { autoAlpha: 0, duration: zd(id, outAt, 0.05) }, zf(id, outAt));
  };
  /** Details rise in one after another between `from` and `to` of the zone. */
  const stagger = (sel: string, id: ZoneId, from = 0.3, to = 0.7, y = 18) => {
    const els = q(sel);
    if (!els.length) return;
    const step = (to - from) / Math.max(1, els.length);
    els.forEach((el, i) => {
      const f = from + i * step;
      tl.fromTo(el, { autoAlpha: 0, y }, { autoAlpha: 1, y: 0, duration: zd(id, f, Math.min(0.08, step * 1.5)), ease: 'power2.out' }, zf(id, f));
    });
  };

  // The Arena: prize, classes, the stats counting up, zonals
  show('.d-robowars', 'robowars');
  stagger('.d-robowars .panel > *', 'robowars');
  q('.arena-stat').forEach((el, i) => {
    const st = parseStat(ROBOWARS.stats[i].value);
    const out = el.querySelector('.stat-value');
    const box = { v: 0 };
    tl.fromTo(
      box,
      { v: 0 },
      {
        v: st.value,
        duration: zd('robowars', 0.4, 0.22),
        ease: 'power2.out',
        onUpdate: () => {
          if (out) out.textContent = `${st.prefix}${box.v.toFixed(st.decimals)}${st.suffix}`;
        },
      },
      zf('robowars', 0.4 + i * 0.04),
    );
  });

  // The Pit Lane: the head, then the seven lanes slide past (vertically on phones)
  show('.d-competitions', 'competitions');
  stagger('.d-competitions .block-head > *', 'competitions', 0.3, 0.45);
  tl.fromTo(q('.bays'), { '--p': 0 }, { '--p': 1, duration: zd('competitions', 0.35, mobile ? 0.4 : 0.42) }, zf('competitions', 0.35));

  // The Stage: past speakers first, then the exhibits brought to campus before
  show('.d-speakers', 'speakers', 0.1, 0.46);
  stagger('.d-speakers .block-head > *', 'speakers', 0.22, 0.4);
  show('.d-expo', 'speakers', 0.44, 0.8);
  stagger('.d-expo .block-head > *', 'speakers', 0.46, 0.58);
  stagger('.d-expo .exhibit-now > *', 'speakers', 0.5, 0.7, 12);

  // The Heartbeat: slow fades only
  show('.d-dkms', 'dkms', 0.1, 0.8);
  tl.fromTo(q('.d-dkms .hb > *'), { autoAlpha: 0 }, { autoAlpha: 1, duration: zd('dkms', 0.3, 0.12), stagger: zd('dkms', 0.3, 0.06) }, zf('dkms', 0.3));

  // the finale: one CTA as the car eases off under the far pylon, then the rest of Techfest
  const layer = q('.d-finale');
  tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: finLen(0.04) }, fin(0.02));
  tl.fromTo(
    q('.finale-cta > *'),
    { autoAlpha: 0, filter: 'blur(14px)', y: 18 },
    { autoAlpha: 1, filter: 'blur(0px)', y: 0, duration: finLen(0.08), stagger: finLen(0.025), ease: 'power2.out' },
    FINALE.ctaAt,
  );
  tl.fromTo(q('.more > *'), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: finLen(0.06), stagger: finLen(0.02), ease: 'power2.out' }, FINALE.ctaAt + finLen(0.06));

  tl.set({}, {}, 1);
  return tl;
}

/* ------------------------------------------------------------------- panels */

function RobowarsPanel() {
  const kg = useStops((s) => s.robowarsClass);
  return (
    <section className="d-block d-robowars" aria-label={UI.robowars.kicker}>
      <div className="panel glass col">
        <p className="kicker">{UI.robowars.kicker}</p>
        <p className="prize">
          <span>{UI.robowars.prizeLabel}</span>
          <strong>{ROBOWARS.prizePool}</strong>
        </p>
        <div className="classes" role="radiogroup" aria-label={UI.robowars.classLabel}>
          <span className="classes-label">{UI.robowars.classLabel}</span>
          {ROBOWARS.classes.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={kg === c} className={`chip${kg === c ? ' is-on' : ''}`} onClick={() => useStops.getState().setRobowarsClass(c)}>
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
          <span>{UI.robowars.zonalsLabel}</span>
          {ROBOWARS.zonals.map((z) => (
            <em key={z}>{z}</em>
          ))}
        </p>
        <p className="note">{ROBOWARS.note}</p>
        <p className="hint desktop-only">{UI.robowars.hint}</p>
        <a className="text-link" href={SITE.home} target="_blank" rel="noopener noreferrer">
          {UI.checkStatus} <span aria-hidden>↗</span>
        </a>
      </div>
    </section>
  );
}

function CompetitionsPanel({ measure }: { measure: () => void }) {
  const filter = useStops((s) => s.competitionFilter);
  const flip = useRef<Flip.FlipState | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const pick = (f: string) => {
    if (f === filter) return;
    if (list.current) flip.current = Flip.getState(list.current.querySelectorAll('.bay'));
    useStops.getState().setCompetitionFilter(f);
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
    <section className="d-block d-competitions" data-open="0" aria-label={UI.competitions.kicker}>
      <div className="block-head col">
        <p className="kicker">{UI.competitions.kicker}</p>
        <div className="chips" role="group" aria-label="Filter competitions">
          {COMPETITION_TAGS.map((t) => (
            <button key={t} type="button" className={`chip${filter === t ? ' is-on' : ''}`} aria-pressed={filter === t} onClick={() => pick(t)}>
              {t === 'All' ? UI.competitions.all : t}
            </button>
          ))}
        </div>
        <p className="hint desktop-only">{UI.competitions.hint}</p>
      </div>
      <div className="bays-window">
        <ol className="bays" ref={list}>
          {COMPETITIONS.map((c, i) => {
            const on = filter === 'All' || c.tag === filter;
            const x = c as { by?: string; prize?: string; finale?: string; blurb?: string };
            return (
              <li key={c.name} className="bay" style={on ? undefined : { display: 'none' }} data-flip-id={c.name}>
                <div className="bay-door" aria-hidden>
                  <span>LANE {String(i + 1).padStart(2, '0')}</span>
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
                        {UI.competitions.finale}: {x.finale}
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

/** Seconds per category while the speakers' billboard rotates on its own. */
const ROTATE = 4.5;

function SpeakersPanel() {
  const category = useStops((s) => s.speakerCategory);
  const pinned = useStops((s) => s.speakerPinned);
  const people = VOICES.categories[category];

  // the categories turn over on their own while the stop is on screen, until one is picked
  useEffect(() => {
    if (pinned) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      if (stopWeight('speakers') < 0.5) {
        last = performance.now();
        return;
      }
      if (performance.now() - last < ROTATE * 1000) return;
      last = performance.now();
      const st = useStops.getState();
      const i = SPEAKER_CATEGORIES.indexOf(st.speakerCategory);
      st.setSpeakerCategory(SPEAKER_CATEGORIES[(i + 1) % SPEAKER_CATEGORIES.length]);
    }, 250);
    return () => window.clearInterval(id);
  }, [pinned]);

  return (
    <section className="d-block d-speakers" aria-label={VOICES.heading}>
      <div className="block-head col">
        <p className="kicker">{UI.speakers.kicker}</p>
        <h2 className="heading">{VOICES.heading}</h2>
        <div className="chips" role="tablist" aria-label="Speaker categories">
          {SPEAKER_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={`chip${category === c ? ' is-on' : ''}`} onClick={() => useStops.getState().setSpeakerCategory(c, true)}>
              {c}
            </button>
          ))}
        </div>
        <ul className="voice-list" aria-live="polite">
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
        <p className="hint desktop-only">{UI.speakers.hint}</p>
      </div>
    </section>
  );
}

function ExpoPanel() {
  const open = useStops((s) => s.expoOpen);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const i = expoIndexAt(zoneProgress(zoneById('speakers'), citySAt(chapterState.progress)), EXPO.exhibits.length);
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
  const set = useStops.getState;
  return (
    <section className="d-block d-expo" aria-label={EXPO.heading}>
      <div className="block-head col">
        <p className="kicker">
          {TECHEXPO.name} · {TECHEXPO.pavilion}
        </p>
        <h2 className="heading">{EXPO.heading}</h2>
        <p className="tagline">{UI.expo.past}</p>
      </div>
      <div className="exhibit-now">
        <span className="exhibit-index">
          {String(focus + 1).padStart(2, '0')} / {String(EXPO.exhibits.length).padStart(2, '0')}
        </span>
        <strong>{ex.name}</strong>
        <em>{ex.from}</em>
        <button type="button" className="chip" onClick={() => set().setExpoOpen(set().expoOpen === focus ? null : focus)}>
          {UI.expo.details}
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

function DkmsPanel() {
  const [started, setStarted] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const ring = useRef<SVGCircleElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // starts on its own the first time you arrive here; "start again" any time
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (started === null && stopWeight('dkms') > 0.85) setStarted(performance.now());
      const t = started === null ? 0 : Math.min(SWAB, (performance.now() - started) / 1000);
      if (ring.current) ring.current.style.strokeDasharray = `${((t / SWAB) * 100).toFixed(2)} 100`;
      if (clock.current) {
        const left = Math.ceil(SWAB - t);
        clock.current.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      }
      if (wrap.current) wrap.current.style.setProperty('--beat', heartbeatPulse(performance.now() / 1000).toFixed(3));
      if (started !== null && t >= SWAB && !done) setDone(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, done]);

  return (
    <section className="d-block d-dkms" aria-label={HEARTBEAT.campaign}>
      <div className="hb col">
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
            <em>{done ? UI.dkms.done : UI.dkms.timer}</em>
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
          {started === null ? UI.dkms.start : UI.dkms.restart}
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

/** The finale's compact row: the rest of Techfest, each one line and a way in. */
function MoreRow() {
  const workshops = ALSO.items.find((it) => 'href' in it) as { name: string; href: string } | undefined;
  const items = [
    { kicker: CATALYST.name, line: CATALYST.items.map((it) => it.label).join(' · '), href: SITE.home },
    { kicker: TWMUN.name, line: `${TWMUN.tagline} · ${TWMUN.committees.length} committees`, href: SITE.home },
    { kicker: UI.extras.workshops, line: workshops?.name ?? 'Hands-on workshops', href: workshops?.href ?? SITE.home },
    { kicker: CES2027.name, line: CES2027.line, href: SITE.home },
  ];
  return (
    <section className="more" aria-label={UI.more}>
      <p className="more-head">{UI.more}</p>
      {items.map((it) => (
        <a key={it.kicker} className="more-item glass" href={it.href} target="_blank" rel="noopener noreferrer">
          <strong>{it.kicker}</strong>
          <span>{it.line}</span>
          <em aria-hidden>↗</em>
        </a>
      ))}
    </section>
  );
}

/**
 * The four stops and the finale in the DOM: one panel per stop on the city route, on screen
 * while the car rolls past that stop's billboard (its slow zone). The panels' controls
 * (weight class, filter, speaker category, exhibit details) share state with the
 * billboards (src/lib/stops.ts).
 */
export function Stops() {
  const root = useRef<HTMLDivElement>(null);

  // competitions: distance the cards travel (px), re-measured on resize and on every filter
  const measure = useMemo(
    () => () => {
      const track = root.current?.querySelector<HTMLElement>('.bays');
      if (!track) return;
      // a vertical strip on both: it slides up through its window while the car holds
      const win = track.parentElement;
      const mobile = window.matchMedia(MOBILE_Q).matches;
      const travel = mobile ? track.scrollHeight - 0.24 * window.innerHeight : track.scrollHeight - (win?.clientHeight ?? 0);
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
      tl.progress(useStore.getState().view);
      measure();
      return () => {
        tl?.kill();
        tl = null;
      };
    });
    const unsubscribe = useStore.subscribe((s) => tl?.progress(s.view));
    window.addEventListener('resize', measure);

    // layout: panels wait for the camera to settle on the stop, sit on whichever side keeps
    // them off the car and the billboard, and the competition strip opens only at the stop
    const comp = el.querySelector<HTMLElement>('.d-competitions');
    const lay = { gate: 0, side: 'left' as 'left' | 'right', open: '0', until: 0 };
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = layoutState;
      const id = CHAPTERS[chapterState.chapter].stop;
      const want = !id ? 0 : id === 'finale' ? 1 : L.atStop ? 1 : 0;
      lay.gate += (want - lay.gate) * (1 - Math.exp(-dt / (want > lay.gate ? 0.3 : 0.15)));
      el.style.setProperty('--gate', lay.gate.toFixed(3));
      if (id && id !== 'finale' && now > lay.until) {
        const col = el.querySelector<HTMLElement>(`.d-${id} .col`);
        if (col && col.offsetWidth) {
          const w = col.offsetWidth;
          const g = Math.max(16, Math.min(56, L.w * 0.04));
          const r = (x0: number) => ({ x0, y0: 84, x1: x0 + w, y1: L.h - 100 });
          // (nothing may cover the car: it outweighs the billboard many times over)
          const score = (x0: number) => 12 * overlap(r(x0), L.car) + 2 * overlap(r(x0), L.board);
          const left = score(g) + (lay.side === 'left' ? -1500 : 0);
          const right = score(L.w - g - 56 - w) + (lay.side === 'right' ? -1500 : 0) + 800;
          const side = left <= right ? 'left' : 'right';
          if (side !== lay.side) {
            lay.side = side;
            el.dataset.side = side;
            lay.until = now + 1200;
          }
        }
      }
      // tell the title solver where the panel is
      const shown = id && id !== 'finale' && lay.gate > 0.05 ? el.querySelector<HTMLElement>(`.d-${id}`) : null;
      const parts = shown && getComputedStyle(shown).visibility !== 'hidden' ? shown.querySelectorAll<HTMLElement>('.col, .bays-window') : null;
      let panel: Rect | null = null;
      if (parts) {
        for (const part of parts) {
          const b = part.getBoundingClientRect();
          if (!b.width) continue;
          panel = panel
            ? { x0: Math.min(panel.x0, b.left), y0: Math.min(panel.y0, b.top), x1: Math.max(panel.x1, b.right), y1: Math.max(panel.y1, b.bottom) }
            : { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
        }
      }
      L.panel = panel;
      const open = id === 'competitions' && L.atStop ? '1' : '0';
      if (comp && open !== lay.open) {
        lay.open = open;
        comp.dataset.open = open;
        requestAnimationFrame(measure);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      mm.revert();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <div ref={root} className="stops" data-side="left">
      <RobowarsPanel />
      <CompetitionsPanel measure={measure} />
      <SpeakersPanel />
      <ExpoPanel />
      <DkmsPanel />
      <section className="d-block d-finale" aria-label={UI.cta}>
        <div className="finale-cta">
          <div className="scrim" aria-hidden />
          <a className="btn btn-accent btn-lg" href={SITE.home} target="_blank" rel="noopener noreferrer">
            {UI.cta}
            <span aria-hidden>↗</span>
          </a>
          <p className="finale-sub">{SITE.disclaimer}</p>
        </div>
        <MoreRow />
      </section>
    </div>
  );
}
