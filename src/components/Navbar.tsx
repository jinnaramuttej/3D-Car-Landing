'use client';

import { site } from '@/content';
import { chapterState } from '@/lib/chapterRuntime';
import { engine } from '@/lib/engineAudio';
import { useStore } from '@/lib/store';
import { scrollToProgress } from '@/lib/useScrollTimeline';
import { toggleHeadlights } from '@/scene/Interaction';

/** Minimal bar: the name (back to the top), headlights, sound, and the way out to techfest.org. */
export function Navbar() {
  const muted = useStore((s) => s.muted);
  const headlights = useStore((s) => s.headlights);
  const lightsOn = headlights === 'on' || (headlights === 'auto' && chapterState.ignition > 0.5);

  const toggleSound = () => {
    const next = !muted;
    useStore.getState().setMuted(next);
    engine.setMuted(next); // runs inside the click: browsers allow audio to start here
  };

  return (
    <nav className="navbar" aria-label="Site">
      <button type="button" className="brand" onClick={() => scrollToProgress(0, true)}>
        {site.name}
        <span>{site.year}</span>
        <em>{site.concept}</em>
      </button>

      <div className="nav-actions">
        <button
          type="button"
          className={`icon-btn${headlights === 'auto' ? '' : lightsOn ? ' is-on' : ' is-off'}`}
          onClick={toggleHeadlights}
          aria-pressed={headlights !== 'auto' ? lightsOn : undefined}
          aria-label="Toggle headlights (H)"
          title="Headlights (H)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M10 6c-3.3 0-6 2.7-6 6s2.7 6 6 6h1V6h-1z" fill="currentColor" />
            <path d="M14 8h6M14 12h7M14 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={`icon-btn sound${muted ? '' : ' is-on'}`}
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
              <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            )}
          </svg>
          <span className="sound-bars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </button>
        <a className="btn btn-accent btn-sm nav-cta" href={site.url} target="_blank" rel="noopener noreferrer" aria-label="Open techfest.org">
          <span className="cta-label">techfest.org</span>
          <span aria-hidden>↗</span>
        </a>
      </div>
    </nav>
  );
}
