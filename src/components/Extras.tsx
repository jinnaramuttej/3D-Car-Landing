'use client';

import { useEffect, useRef } from 'react';
import { ALSO, CATALYST, CES2027, SITE, UI } from '@/content';
import { EXTRAS, type ExtraId } from '@/lib/cityRoute';
import { layoutState } from '@/lib/layout';
import { pickSlot, type Slot } from './Overlay';

const IDS = Object.keys(EXTRAS) as ExtraId[];

/**
 * The billboards the car drives past (Catalyst ahead of the parked car, Also at Techfest on
 * the bridge gantry, CES 2027 on the first pylon) each get a small card while the car is
 * coming up to them. A card never shares the screen with a chapter title, keeps off the car
 * and the billboard (same slot solver as the titles), and waits while the car is flat out.
 */
export function Extras() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cards = Object.fromEntries(IDS.map((id) => [id, el.querySelector<HTMLElement>(`[data-extra="${id}"]`)!])) as Record<ExtraId, HTMLElement>;
    const st = Object.fromEntries(IDS.map((id) => [id, { a: 0, slot: 'bl' as Slot }])) as Record<ExtraId, { a: number; slot: Slot }>;
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = layoutState;
      for (const id of IDS) {
        const ahead = EXTRAS[id].s - L.s;
        const want = ahead > -8 && ahead < 85 && L.speed < 75 && !L.titleUp ? 1 : 0;
        const s = st[id];
        s.a += (want - s.a) * (1 - Math.exp(-dt / (want > s.a ? 0.35 : 0.2)));
        const card = cards[id];
        card.style.opacity = s.a.toFixed(3);
        card.style.visibility = s.a > 0.01 ? 'visible' : 'hidden';
        card.classList.toggle('is-in', s.a > 0.3);
        if (s.a > 0.01) {
          const slot = pickSlot(['bl', 'tr', 'tl'], card.offsetWidth, card.offsetHeight, s.slot);
          if (slot !== s.slot && s.a < 0.05) s.slot = slot; // (only moves while invisible)
          else if (slot !== s.slot && want === 1) s.slot = slot;
          card.dataset.slot = s.slot;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={root} className="extras">
      <aside className="extra glass" data-extra="catalyst" data-slot="bl" aria-label={CATALYST.name}>
        <p className="kicker">{UI.extras.catalyst}</p>
        <dl>
          {CATALYST.items.map((it) => (
            <div key={it.label}>
              <dt>{it.label}</dt>
              <dd>{it.value}</dd>
            </div>
          ))}
        </dl>
        <a className="text-link" href={SITE.home} target="_blank" rel="noopener noreferrer">
          {UI.extras.more} <span aria-hidden>↗</span>
        </a>
      </aside>
      <aside className="extra glass" data-extra="also" data-slot="bl" aria-label={ALSO.heading}>
        <p className="kicker">{ALSO.heading}</p>
        <ul>
          {ALSO.items.map((it) => {
            const x = it as { name: string; href?: string; where?: string };
            return (
              <li key={x.name}>
                {x.href ? (
                  <a className="text-link" href={x.href} target="_blank" rel="noopener noreferrer">
                    {x.name} <span aria-hidden>↗</span>
                  </a>
                ) : (
                  <span>{x.name}</span>
                )}
                {x.where && <em>{x.where}</em>}
              </li>
            );
          })}
        </ul>
        <a className="text-link" href={SITE.home} target="_blank" rel="noopener noreferrer">
          {UI.extras.more} <span aria-hidden>↗</span>
        </a>
      </aside>
      <aside className="extra glass" data-extra="ces" data-slot="bl" aria-label={CES2027.name}>
        <p className="kicker">{CES2027.name}</p>
        <p className="extra-line">{CES2027.line}</p>
        <a className="text-link" href={SITE.home} target="_blank" rel="noopener noreferrer">
          {UI.extras.more} <span aria-hidden>↗</span>
        </a>
      </aside>
    </div>
  );
}
