'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { button, useControls } from 'leva';
import { advance } from '@react-three/fiber';
import { CONFIG, RANGES, type Config } from '@/lib/config';
import { carState } from '@/lib/motion';
import { chapterAnchor, chapterAt, CHAPTERS } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { interaction } from '@/lib/interaction';
import { useStore } from '@/lib/store';
import { cameraState } from '@/scene/CameraRig';
import { engine } from '@/lib/engineAudio';
import { powertrain } from '@/lib/powertrain';
import { reflectionUniforms } from '@/scene/city/cityReflection';
import { smokeLayer } from '@/scene/postfx/SoftSmokeEffect';
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
    // One button per chapter, plus the moments of the opening (no dots in leva keys: a
    // dot means "nested folder")
    ...Object.fromEntries(CHAPTERS.map((c) => [`${c.numeral}: ${c.title}`, button(() => jump(chapterAnchor(c.id)))])),
    'II: engine catches': button(() => jump(chapterAt('ignition', 0.17))),
    'III: the flick': button(() => jump(chapterAt('turn', 0.07))),
    'III: mid-drift': button(() => jump(chapterAt('turn', 0.5))),
    'IV: in the smoke': button(() => jump(chapterAt('wake', 0.15))),
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

  useControls('Drive', configSchema('drive'), { collapsed: true });
  useControls('Director', configSchema('director'), { collapsed: true });
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
      smokeLayer,
      powertrain,
      // where the director's scheduled rigs start, with the slide at each (none above ~0.3)
      schedule: () => getSchedule().map((c) => ({ ...c, drift: +driftAt(c.s).toFixed(2) })),
    };

    // HUD: chapter, camera rig (and the blend into it), route metres, speed, scroll vs screen
    const id = window.setInterval(() => {
      if (!hud.current) return;
      const c = CHAPTERS[chapterState.chapter];
      const blend = director.blend < 1 ? ` (blend ${(director.blend * 100).toFixed(0)}%)` : '';
      hud.current.textContent = `${c.numeral} ${c.title.toUpperCase()} ${(chapterState.chapterLocal * 100).toFixed(0)}% / ${cameraState.shotId}${blend}  route ${carState.s.toFixed(0)} m  ${(carState.speed * 3.6).toFixed(0)} km/h  slip ${carState.slip.toFixed(2)}   scroll ${useStore.getState().progress.toFixed(3)} screen ${chapterState.progress.toFixed(3)}`;
    }, 100);
    return () => {
      window.clearInterval(id);
      tween.current?.kill();
      delete w.__gt3r;
    };
  }, []);

  return <div ref={hud} className="shot-hud" aria-hidden />;
}
