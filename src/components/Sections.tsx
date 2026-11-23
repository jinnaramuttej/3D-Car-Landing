'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { about, events, finale, hero, prizes, schedule, site } from '@/content';
import { sectionState } from '@/lib/sectionRuntime';
import { anchorProgress, FINALE, sectionById, type SectionId } from '@/lib/sections';
import { useStore } from '@/lib/store';
import { scrollToProgress } from '@/lib/useScrollTimeline';

const MOBILE_Q = '(max-width: 767px), (pointer: coarse)';
const DESKTOP_Q = '(min-width: 768px) and (pointer: fine)';

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Global progress at a fraction of a section, and a duration in section fractions. */
const at = (id: SectionId, f: number) => {
  const s = sectionById(id);
  return s.start + f * (s.end - s.start);
};
const len = (id: SectionId, f: number) => {
  const s = sectionById(id);
  return f * (s.end - s.start);
};

type Q = (sel: string) => Element[];

/**
 * One paused timeline on the global 0..1 scale (same as the scroll timeline), so every
 * section is effectively pinned and fully scrubbable, including with the debug slider.
 */
function buildTimeline(q: Q, mobile: boolean) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  const show = (id: SectionId, inAt: number, outAt = 2) => {
    const layer = q(`.sec-${id}`);
    tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: len(id, 0.06) }, at(id, inAt));
    if (outAt <= 1) tl.to(layer, { autoAlpha: 0, duration: len(id, 0.08) }, at(id, outAt));
  };
  const rise = (sel: string, id: SectionId, f: number, d = 0.1, y = 24) =>
    tl.fromTo(q(sel), { autoAlpha: 0, y }, { autoAlpha: 1, y: 0, duration: len(id, d), ease: 'power2.out', stagger: len(id, 0.03) }, at(id, f));

  // HERO: smoke thins (3D), title/date/venue/CTA blur to sharp
  show('hero', 0.1, 0.88);
  rise('.hero-kicker', 'hero', 0.14, 0.1, 12);
  tl.fromTo(
    q('.hero-title'),
    { autoAlpha: 0, filter: 'blur(30px)', scale: 1.1, letterSpacing: '0.35em' },
    { autoAlpha: 1, filter: 'blur(0px)', scale: 1, letterSpacing: '0.02em', duration: len('hero', 0.3), ease: 'power3.out' },
    at('hero', 0.18),
  );
  tl.fromTo(
    q('.hero-meta > *'),
    { autoAlpha: 0, filter: 'blur(12px)' },
    { autoAlpha: 1, filter: 'blur(0px)', duration: len('hero', 0.14), stagger: len('hero', 0.05) },
    at('hero', 0.34),
  );
  rise('.hero-ctas > *', 'hero', 0.45, 0.12, 18);

  // ABOUT: copy, then the three counters
  show('about', 0.03, 0.88);
  rise('.about-copy > *', 'about', 0.06, 0.12);
  rise('.stat', 'about', 0.18, 0.12);
  q('.stat-value').forEach((el, i) => {
    const stat = about.stats[i];
    const box = { v: 0 };
    tl.fromTo(
      box,
      { v: 0 },
      {
        v: stat.value,
        duration: len('about', 0.4),
        ease: 'power2.out',
        onUpdate: () => {
          el.textContent = `${stat.prefix}${fmt(box.v)}${stat.suffix}`;
        },
      },
      at('about', 0.2 + i * 0.04),
    );
  });

  // EVENTS: pinned; scroll slides the glass cards (vertically on mobile)
  show('events', 0.02, 0.9);
  rise('.events-head > *', 'events', 0.04, 0.1);
  tl.fromTo(q('.events-track'), { '--p': 0 }, { '--p': 1, duration: len('events', mobile ? 0.78 : 0.8) }, at('events', 0.08));

  // SCHEDULE: heading; the days light up from the 3D (see the rAF loop below)
  show('schedule', 0.03, 0.88);
  rise('.schedule-head > *', 'schedule', 0.05, 0.1);
  rise('.day', 'schedule', 0.08, 0.1, 16);

  // PRIZES: tier cards + sponsor marquee
  show('prizes', 0.05, 0.9);
  rise('.prizes-head > *', 'prizes', 0.08, 0.1);
  rise('.tier', 'prizes', 0.14, 0.12, 30);
  rise('.marquee', 'prizes', 0.24, 0.1, 0);

  // FINALE: a line during the rev, then the CTA as the tail lights disappear
  show('finale', 0.02);
  tl.fromTo(q('.finale-kicker'), { autoAlpha: 0 }, { autoAlpha: 1, duration: len('finale', 0.05) }, at('finale', 0.04));
  tl.to(q('.finale-kicker'), { autoAlpha: 0, duration: len('finale', 0.06) }, at('finale', 0.26));
  tl.fromTo(
    q('.finale-cta > *'),
    { autoAlpha: 0, filter: 'blur(16px)', y: 20 },
    { autoAlpha: 1, filter: 'blur(0px)', y: 0, duration: len('finale', 0.12), stagger: len('finale', 0.035), ease: 'power2.out' },
    at('finale', FINALE.ctaAt),
  );

  tl.set({}, {}, 1);
  return tl;
}

export function Sections() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el) as Q;
    const track = q('.events-track')[0] as HTMLElement | undefined;

    // Distance the event cards travel (px), recomputed on resize
    const measure = () => {
      if (!track) return;
      const mobile = window.matchMedia(MOBILE_Q).matches;
      const travel = mobile ? track.scrollHeight - 0.18 * window.innerHeight : track.scrollWidth - 0.32 * window.innerWidth;
      track.style.setProperty('--travel', `${Math.max(0, travel)}px`);
    };
    measure();
    window.addEventListener('resize', measure);

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

    // Schedule days follow the neon posts in 3D (lit as the camera passes them)
    const days = q('.day') as HTMLElement[];
    let raf = 0;
    const tick = () => {
      days.forEach((d, i) => {
        const lit = sectionState.scheduleLit[i] ?? 0;
        d.style.setProperty('--lit', lit.toFixed(3));
        d.classList.toggle('is-lit', lit > 0.5);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Hover tilt on the prize cards (mouse only)
    const tilts = q('.tilt') as HTMLElement[];
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const off: (() => void)[] = [];
    if (fine) {
      for (const card of tilts) {
        const move = (e: PointerEvent) => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          card.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
          card.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
          card.style.setProperty('--gx', `${x * 100}%`);
          card.style.setProperty('--gy', `${y * 100}%`);
        };
        const leave = () => {
          card.style.setProperty('--rx', '0deg');
          card.style.setProperty('--ry', '0deg');
        };
        card.addEventListener('pointermove', move);
        card.addEventListener('pointerleave', leave);
        off.push(() => {
          card.removeEventListener('pointermove', move);
          card.removeEventListener('pointerleave', leave);
        });
      }
    }

    return () => {
      unsubscribe();
      mm.revert();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      off.forEach((f) => f());
    };
  }, []);

  const go = (id: SectionId) => () => scrollToProgress(anchorProgress(id));

  return (
    <div ref={root} className="sections">
      {/* HERO */}
      <section id="hero" className="sec sec-hero" aria-label={hero.title}>
        <p className="kicker hero-kicker">{hero.kicker}</p>
        <h2 className="hero-title">
          {hero.title}
          <span className="hero-edition">{hero.edition}</span>
        </h2>
        <p className="hero-meta">
          <span>{site.dates}</span>
          <span className="dot" aria-hidden />
          <span>{site.venue}</span>
        </p>
        <div className="hero-ctas">
          <a className="btn btn-accent" href={hero.primaryCta.href}>
            {hero.primaryCta.label}
          </a>
          <button type="button" className="btn btn-ghost" onClick={go(hero.secondaryCta.section)}>
            {hero.secondaryCta.label}
          </button>
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="sec sec-about" aria-label={about.kicker}>
        <div className="about-copy">
          <p className="kicker">{about.kicker}</p>
          <h2 className="heading">{about.heading}</h2>
          <p className="body">{about.body}</p>
        </div>
        <div className="stats">
          {about.stats.map((s) => (
            <div key={s.label} className="glass stat">
              <span className="stat-value">
                {s.prefix}0{s.suffix}
              </span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* EVENTS */}
      <section id="events" className="sec sec-events" aria-label={events.kicker}>
        <div className="events-head">
          <p className="kicker">{events.kicker}</p>
          <h2 className="heading">{events.heading}</h2>
        </div>
        <div className="events-track">
          {events.items.map((e, i) => (
            <article key={e.title} className="glass event-card">
              <div className="event-top">
                <span className="event-index">{String(i + 1).padStart(2, '0')}</span>
                <span className="chip">{e.category}</span>
              </div>
              <h3 className="event-title">{e.title}</h3>
              <p className="event-blurb">{e.blurb}</p>
              <div className="event-foot">
                <span>{e.day}</span>
                <span className="event-prize">{e.prize}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* SCHEDULE */}
      <section id="schedule" className="sec sec-schedule" aria-label={schedule.kicker}>
        <div className="schedule-head">
          <p className="kicker">{schedule.kicker}</p>
          <h2 className="heading">{schedule.heading}</h2>
        </div>
        <ol className="days">
          {schedule.days.map((d) => (
            <li key={d.day} className="day">
              <span className="day-dot" aria-hidden />
              <div className="day-body">
                <p className="day-label">
                  {d.day} <span>{d.date}</span>
                </p>
                <ul>
                  {d.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* PRIZES / SPONSORS */}
      <section id="prizes" className="sec sec-prizes" aria-label={prizes.kicker}>
        <div className="prizes-head">
          <p className="kicker">{prizes.kicker}</p>
          <h2 className="heading">{prizes.heading}</h2>
        </div>
        <div className="tiers">
          {prizes.tiers.map((t, i) => (
            <div key={t.name} className={`glass tier tilt tier-${i}`}>
              <span className="tier-glare" aria-hidden />
              <p className="tier-name">{t.name}</p>
              <p className="tier-amount">{t.amount}</p>
              <ul>
                {t.perks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="marquee" aria-label={prizes.sponsorsHeading}>
          <span className="marquee-label">{prizes.sponsorsHeading}</span>
          <div className="marquee-window">
            <div className="marquee-track">
              {[0, 1].map((copy) => (
                <div key={copy} className="marquee-set" aria-hidden={copy === 1}>
                  {prizes.sponsors.map((s) =>
                    s.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={s.name} className="sponsor-logo" src={s.logo} alt={s.name} />
                    ) : (
                      <span key={s.name} className="sponsor">
                        {s.name}
                      </span>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FINALE */}
      <section id="finale" className="sec sec-finale" aria-label={finale.heading}>
        <p className="kicker finale-kicker">{finale.kicker}</p>
        <div className="finale-cta">
          <h2 className="heading finale-heading">{finale.heading}</h2>
          <p className="body">{finale.body}</p>
          <a className="btn btn-accent btn-lg" href={finale.cta.href}>
            {finale.cta.label}
          </a>
        </div>
      </section>
    </div>
  );
}
