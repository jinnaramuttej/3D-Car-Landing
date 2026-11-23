'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { button, useControls } from 'leva';
import { advance } from '@react-three/fiber';
import { CONFIG, RANGES, type Config } from '@/lib/config';
import { carState } from '@/lib/motion';
import { SHOTS } from '@/lib/script';
import { sectionState } from '@/lib/sectionRuntime';
import { anchorProgress, DRIFT, fromDriftLocal, SECTIONS } from '@/lib/sections';
import { useStore } from '@/lib/store';
import { cameraState } from '@/scene/CameraRig';

type LevaSchema = Exclude<Parameters<typeof useControls>[0], string | ((...args: never[]) => unknown)>;
type Range = readonly [number, number, number?];

/** One leva folder per CONFIG group. onChange writes straight into CONFIG (no re-render). */
function configSchema(group: keyof Config): LevaSchema {
  const values = CONFIG[group] as Record<string, number | string | boolean>;
  const ranges = (RANGES[group] ?? {}) as Record<string, Range | undefined>;
  const schema: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const onChange = (v: number | string | boolean) => {
      values[key] = v;
    };
    const r = ranges[key];
    schema[key] =
      typeof value === 'number' && r ? { value, min: r[0], max: r[1], step: r[2], onChange } : { value, onChange };
  }
  return schema as LevaSchema;
}

const DRIVES = 'slider drives';

/**
 * Open the page with `?debug`.
 * "Scrub" lets you test the whole sequence without scrolling: drag `progress`
 * (that switches the slider into control), jump to a phase, or press play.
 */
export function DebugPanel() {
  const tween = useRef<gsap.core.Tween | null>(null);
  const hud = useRef<HTMLDivElement>(null);

  const [, set] = useControls('Scrub', () => ({
    [DRIVES]: {
      value: false,
      onChange: (v: boolean) => {
        if (!v) tween.current?.kill();
        useStore.getState().setManual(v);
      },
    },
    progress: {
      value: 0,
      min: 0,
      max: 1,
      step: 0.001,
      onChange: (v: number, _path: string, ctx: { initial: boolean; fromPanel: boolean }) => {
        if (ctx.initial || !ctx.fromPanel) return;
        const st = useStore.getState();
        if (!st.manual) set({ [DRIVES]: true });
        st.setManual(true);
        st.setProgress(v);
      },
    },
    // One button per drift shot and per section (no dots in leva keys: a dot means "nested folder")
    ...Object.fromEntries(
      SHOTS.filter((shot) => shot.from < DRIFT.localEnd).map((shot, i) => [
        `shot ${i + 1}: ${shot.title}`,
        button(() => jump(fromDriftLocal(shot.from + 0.002))),
      ]),
    ),
    ...Object.fromEntries(SECTIONS.map((s) => [`section: ${s.id}`, button(() => jump(anchorProgress(s.id)))])),
    'play 0 to 1 (60 s)': button(() => play()),
    'back to scroll': button(() => {
      tween.current?.kill();
      set({ [DRIVES]: false });
    }),
    'copy config': button(() => {
      const json = JSON.stringify(CONFIG, null, 2);
      navigator.clipboard?.writeText(json).catch(() => undefined);
      console.log('[gt3r] CONFIG\n', json);
    }),
  }));

  function jump(p: number) {
    tween.current?.kill();
    useStore.getState().setManual(true);
    useStore.getState().setProgress(p);
    set({ [DRIVES]: true, progress: p });
  }

  function play() {
    tween.current?.kill();
    const proxy = { p: 0 };
    useStore.getState().setManual(true);
    set({ [DRIVES]: true });
    tween.current = gsap.to(proxy, {
      p: 1,
      duration: 60,
      ease: 'none',
      onUpdate: () => {
        useStore.getState().setProgress(proxy.p);
        set({ progress: proxy.p });
      },
    });
  }

  useControls('Cold-open drift', configSchema('introDrift'), { collapsed: true });
  useControls('Drift', configSchema('drift'), { collapsed: true });
  useControls('Camera', configSchema('camera'), { collapsed: true });
  useControls('Smoke', configSchema('smoke'), { collapsed: true });
  useControls('Skid marks', configSchema('skid'), { collapsed: true });
  useControls('Car', configSchema('car'), { collapsed: true });
  useControls('Look', configSchema('look'), { collapsed: true });
  useControls('Track', configSchema('track'), { collapsed: true });
  useControls('Scroll', configSchema('scroll'), { collapsed: true });

  useEffect(() => {
    // Console access while debugging: __gt3r.store.getState().setProgress(0.5)
    // `advance(performance.now())` renders one frame by hand (useful when the tab is throttled).
    const w = window as unknown as { __gt3r?: unknown };
    w.__gt3r = { store: useStore, config: CONFIG, carState, cameraState, sectionState, advance };

    // HUD: which drift shot or section is on screen right now
    const id = window.setInterval(() => {
      if (!hud.current) return;
      const g = useStore.getState().progress.toFixed(3);
      if (sectionState.active) {
        const s = SECTIONS[sectionState.index];
        hud.current.textContent = `SECTION ${s.id.toUpperCase()}  ${(sectionState.local * 100).toFixed(0)}%   global ${g}`;
      } else {
        const shot = SHOTS[Math.max(0, cameraState.shot)];
        hud.current.textContent = `SHOT ${cameraState.shot + 1}  ${shot.title.toUpperCase()}   drift ${carState.progress.toFixed(3)}  global ${g}`;
      }
    }, 100);
    return () => {
      window.clearInterval(id);
      tween.current?.kill();
      delete w.__gt3r;
    };
  }, []);

  return <div ref={hud} className="shot-hud" aria-hidden />;
}
