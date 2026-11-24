'use client';

import { useEffect, useRef, useState } from 'react';
import { autoplayLength, timeAtProgress } from '@/lib/autoplay';
import { useStore } from '@/lib/store';
import { togglePlay } from '@/lib/useScrollTimeline';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /> : <path d="M7 4.5v15l12-7.5z" fill="currentColor" />}
    </svg>
  );
}

export function CinemaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9.5h18M3 14.5h18" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
    </svg>
  );
}

/**
 * The Play button's other half: the progress bar along the top while it runs (time and
 * total), cinematic mode (the navbar and the mini-map step aside; Esc or the dock brings
 * them back, and 2.39:1 bars come in), and a small dock with play/pause and the way out of cinematic mode, which
 * wakes up on mouse movement.
 */
export function PlayControls() {
  const auto = useStore((s) => s.auto);
  const cinematic = useStore((s) => s.cinematic);
  const bar = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const [awake, setAwake] = useState(false);

  // the bar follows what is on screen
  useEffect(() => {
    const total = autoplayLength();
    const render = (p: number) => {
      if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
      if (time.current) time.current.textContent = `${clock(timeAtProgress(p))} / ${clock(total)}`;
    };
    render(useStore.getState().view);
    return useStore.subscribe((s) => render(s.view));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('is-cinematic', cinematic);
    if (!cinematic) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().setCinematic(false);
    };
    let timer = 0;
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), 2200);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', wake, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', wake);
      window.clearTimeout(timer);
      document.documentElement.classList.remove('is-cinematic');
    };
  }, [cinematic]);

  const on = auto !== 'off';
  return (
    <>
      <div className={`play-bar${on || cinematic ? ' is-on' : ''}`} aria-hidden>
        <div ref={bar} />
      </div>
      {/* 2.39:1 bars in cinematic mode (the camera widens its lens to match, CameraRig) */}
      <div className="cine-bars" aria-hidden>
        <i />
        <i />
      </div>
      {cinematic && (
        <div className={`play-dock${awake || auto !== 'playing' ? ' is-awake' : ''}`} role="toolbar" aria-label="Playback">
          <button type="button" className="icon-btn" onClick={togglePlay} aria-label={auto === 'playing' ? 'Pause (Space)' : 'Play (Space)'}>
            <PlayIcon playing={auto === 'playing'} />
          </button>
          <span ref={time} className="play-time" />
          <button type="button" className="icon-btn" onClick={() => useStore.getState().setCinematic(false)} aria-label="Leave cinematic mode (Esc)">
            <CinemaIcon />
            <span className="play-exit">Exit</span>
          </button>
        </div>
      )}
    </>
  );
}
