'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { button, useControls } from 'leva';
import { advance } from '@react-three/fiber';
import { CONFIG, RANGES, type Config } from '@/lib/config';
import { carState } from '@/lib/motion';
import { SHOTS } from '@/lib/script';
import { BEATS, CHAPTERS, DRIFT, fromDriftLocal } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { interaction } from '@/lib/interaction';
import { useStore } from '@/lib/store';
import { cameraState } from '@/scene/CameraRig';
import { engine } from '@/lib/engineAudio';
import { powertrain } from '@/lib/powertrain';
import { reflectionUniforms } from '@/scene/city/cityReflection';
import { director, getSchedule } from '@/scene/city/director';
import { driftAt } from '@/lib/cityDrive';

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
    // One button per beat and per drift shot (no dots in leva keys: a dot means "nested folder")
    ...Object.fromEntries(
      BEATS.map((b) => {
        const c = CHAPTERS.find((ch) => ch.id === b.chapter)!;
        return [`${c.numeral}: ${b.id}`, button(() => jump(b.start + (b.anchor ?? 0.05) * (b.end - b.start)))];
      }),
    ),
    ...Object.fromEntries(
      SHOTS.filter((shot) => shot.from < DRIFT.localEnd).map((shot, i) => [
        `III shot ${i + 1}: ${shot.title}`,
        button(() => jump(fromDriftLocal(shot.from + 0.002))),
      ]),
    ),
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
  useControls('Interaction', configSchema('interaction'), { collapsed: true });
  useControls('Post', configSchema('post'), { collapsed: true });
  useControls('Rain', configSchema('rain'), { collapsed: true });
  useControls('City', configSchema('city'), { collapsed: true });
  useControls('Coast', configSchema('coast'), { collapsed: true });
  useControls('Track', configSchema('track'), { collapsed: true });
  useControls('Scroll', configSchema('scroll'), { collapsed: true });

  useEffect(() => {
    // Console access while debugging: __gt3r.store.getState().setProgress(0.5)
    // `advance(performance.now())` renders one frame by hand (useful when the tab is throttled).
    const w = window as unknown as { __gt3r?: unknown };
    w.__gt3r = {
      store: useStore,
      config: CONFIG,
      carState,
      cameraState,
      chapterState,
      interaction,
      advance,
      director,
      reflection: reflectionUniforms,
      engine,
      powertrain,
      // the camera director's cuts with the slide at each (none should land above ~0.3)
      schedule: () => getSchedule().map((c) => ({ ...c, drift: +driftAt(c.s).toFixed(2) })),
    };

    // HUD: which drift shot or section is on screen right now
    const id = window.setInterval(() => {
      if (!hud.current) return;
      const g = useStore.getState().progress.toFixed(3);
      const c = CHAPTERS[chapterState.chapter];
      if (chapterState.stage === 'city') {
        hud.current.textContent = `${c.numeral} ${c.title.toUpperCase()} / ${cameraState.shotId}  route ${carState.s.toFixed(0)} m  ${(carState.speed * 3.6).toFixed(0)} km/h   global ${g}`;
      } else if (!chapterState.drift) {
        const b = BEATS[Math.max(0, chapterState.beat)];
        hud.current.textContent = `${c.numeral} ${c.title.toUpperCase()} / ${b.id}  ${(chapterState.beatLocal * 100).toFixed(0)}%   global ${g}`;
      } else {
        const shot = SHOTS[Math.max(0, cameraState.shot)];
        hud.current.textContent = `${c.numeral} / SHOT ${cameraState.shot + 1}  ${shot.title.toUpperCase()}   drift ${carState.progress.toFixed(3)}  global ${g}`;
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
