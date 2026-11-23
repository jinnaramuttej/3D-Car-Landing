'use client';

import { useEffect, useState } from 'react';
import { nav, site } from '@/content';
import { engine } from '@/lib/engineAudio';
import { anchorProgress, SECTIONS, type SectionId } from '@/lib/sections';
import { useStore } from '@/lib/store';
import { scrollToProgress } from '@/lib/useScrollTimeline';

const LINKS = SECTIONS.map((s) => s.id).filter((id) => id !== 'finale') as SectionId[];

function activeSection(p: number): SectionId | null {
  for (let i = SECTIONS.length - 1; i >= 0; i--) if (p >= SECTIONS[i].start) return SECTIONS[i].id;
  return null;
}

/** Sticky minimal navbar: anchors scroll through Lenis, sound toggle, register. */
export function Navbar() {
  const [active, setActive] = useState<SectionId | null>(null);
  const [open, setOpen] = useState(false);
  const muted = useStore((s) => s.muted);

  useEffect(
    () =>
      useStore.subscribe((s) => {
        const id = activeSection(s.progress);
        setActive((prev) => (prev === id ? prev : id));
      }),
    [],
  );

  const go = (id: SectionId) => {
    setOpen(false);
    scrollToProgress(anchorProgress(id));
  };

  const toggleSound = () => {
    const next = !muted;
    useStore.getState().setMuted(next);
    engine.setMuted(next); // runs inside the click: browsers allow audio to start here
  };

  return (
    <nav className={`navbar${open ? ' is-open' : ''}`} aria-label="Sections">
      <button type="button" className="brand" onClick={() => (setOpen(false), scrollToProgress(0))}>
        {site.name}
        <span>{site.edition}</span>
      </button>

      <ul className="nav-links">
        {LINKS.map((id) => (
          <li key={id}>
            <button type="button" className={active === id ? 'is-active' : ''} onClick={() => go(id)}>
              {nav[id]}
            </button>
          </li>
        ))}
      </ul>

      <div className="nav-actions">
        <button
          type="button"
          className={`sound${muted ? '' : ' is-on'}`}
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
          title={muted ? 'Sound off' : 'Sound on'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            {muted ? (
              <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path
                d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
            )}
          </svg>
          <span className="sound-bars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </button>
        <button type="button" className="btn btn-accent btn-sm nav-register" onClick={() => go('finale')}>
          {nav.finale}
        </button>
        <button
          type="button"
          className="menu"
          aria-expanded={open}
          aria-label="Menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
      </div>
    </nav>
  );
}
