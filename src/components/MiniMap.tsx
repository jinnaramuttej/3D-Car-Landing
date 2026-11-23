'use client';

import { useEffect, useRef } from 'react';
import { chapterAnchor, CHAPTERS, chapterIndexAt } from '@/lib/chapters';
import { useStore } from '@/lib/store';
import { scrollToProgress } from '@/lib/useScrollTimeline';

/**
 * Chapter mini-map: one dot per chapter down the right edge, filled as you scroll
 * through it. Clicking jumps straight there (the scene cross-dissolves over the jump).
 */
export function MiniMap() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const dots = Array.from(el.querySelectorAll<HTMLElement>('.mm-dot'));
    const render = (p: number) => {
      const active = chapterIndexAt(p);
      dots.forEach((d, i) => {
        const c = CHAPTERS[i];
        const fill = Math.min(1, Math.max(0, (p - c.start) / (c.end - c.start)));
        d.style.setProperty('--fill', fill.toFixed(3));
        d.classList.toggle('is-active', i === active);
        d.classList.toggle('is-done', i < active);
        if (i === active) d.setAttribute('aria-current', 'step');
        else d.removeAttribute('aria-current');
      });
    };
    render(useStore.getState().progress);
    return useStore.subscribe((s) => render(s.progress));
  }, []);

  return (
    <nav ref={root} className="minimap" aria-label="Chapters">
      <ol>
        {CHAPTERS.map((c) => (
          <li key={c.id}>
            <button type="button" className="mm-dot" onClick={() => scrollToProgress(chapterAnchor(c.id), true)}>
              <span className="mm-num">{c.numeral}</span>
              <span className="mm-title">{c.title}</span>
              <span className="mm-track" aria-hidden>
                <i />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
