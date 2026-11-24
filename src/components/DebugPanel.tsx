'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { button, useControls } from 'leva';
import { advance } from '@react-three/fiber';
import { CONFIG, RANGES, type Config } from '@/lib/config';
import { carState } from '@/lib/motion';
import { chapterAnchor, CHAPTERS, IGNITION } from '@/lib/chapters';
import { DRIFT, PARK_S, progressAtTime, progressAtZone, timeAtProgress, timeAtS, zoneAtS, ZONES, zoneProgress } from '@/lib/pacing';
import { glideTo, playhead } from '@/lib/playhead';
import { carContact, contactState } from '@/lib/cityDrive';
import { cameraCollision } from '@/lib/collide';
import { debugContact } from '@/scene/DebugContact';
import { chapterState } from '@/lib/chapterRuntime';
import { interaction } from '@/lib/interaction';
import { useStore } from '@/lib/store';
import { cameraState } from '@/scene/CameraRig';
import { engine } from '@/lib/engineAudio';
import { coldOpen } from '@/lib/coldOpen';
import { feel } from '@/lib/feel';
import { powertrain } from '@/lib/powertrain';
import { reflectionUniforms } from '@/scene/city/cityReflection';
import { smokeLayer } from '@/scene/postfx/SoftSmokeEffect';
import { director, getSchedule } from '@/scene/city/director';
import { driftAt } from '@/lib/cityDrive';
import { warmup } from '@/lib/warmup';

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
    '00: engine catches': button(() => jump(IGNITION.at + 0.002)),
    '00: the flick': button(() => jump(progressAtTime(timeAtS(DRIFT.flick)))),
    '00: mid-drift': button(() => jump(progressAtTime(timeAtS((DRIFT.full + DRIFT.hold) / 2)))),
    '01: in the smoke': button(() => jump(progressAtTime(timeAtS(DRIFT.to + 30)))),
    ...Object.fromEntries(ZONES.map((z) => [`zone ${z.id}: board`, button(() => jump(progressAtZone(z.id, z.before / (z.before + z.after))))])),
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
    glideTo(timeAtProgress(p));
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

  useControls('Playhead', configSchema('playhead'), { collapsed: true });
  useControls('Director', configSchema('director'), { collapsed: true });
  useControls('Drift', configSchema('drift'), { collapsed: true });
  useControls('Camera', configSchema('camera'), { collapsed: true });
  useControls('Feel', configSchema('feel'), { collapsed: true });
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
      feel,
      coldOpen,
      warmup,
      // where the director's scheduled rigs start, with the slide at each (none above ~0.3)
      schedule: () => getSchedule().map((c) => ({ ...c, drift: +driftAt(c.s).toFixed(2) })),
    };

    // HUD: chapter, camera rig (and the blend into it), route metre, journey time, zone and
    // its progress, speed, the wheels' contact, what is inside the car's box, the camera sphere
    const id = window.setInterval(() => {
      if (!hud.current) return;
      const c = CHAPTERS[chapterState.chapter];
      const blend = director.blend < 1 ? ` (blend ${(director.blend * 100).toFixed(0)}%)` : '';
      const z = zoneAtS(carState.s, 0);
      const zone = z ? `${z.id} p ${zoneProgress(z, carState.s).toFixed(2)}` : '-';
      const hits = carContact.hit.filter(Boolean).length;
      const twist = Math.max(...carContact.residual.map(Math.abs)) * 100;
      hud.current.textContent =
        `${c.numeral} ${c.title.toUpperCase()} / ${cameraState.shotId}${blend}  s ${carState.s.toFixed(1)} m  t ${timeAtProgress(chapterState.progress).toFixed(1)} s  zone ${zone}  ${(carState.speed * 3.6).toFixed(0)} km/h` +
        `  wheels ${contactState.ok ? hits : 0}/4 twist ${twist.toFixed(1)} cm  box ${debugContact.boxHits ? `HIT ${debugContact.boxHits}` : 'clear'}  cam ${cameraCollision.hit ? `HIT -${cameraCollision.pulled.toFixed(1)} m` : 'clear'}` +
        `  scroll ${useStore.getState().progress.toFixed(3)} screen ${chapterState.progress.toFixed(3)}  x${chapterState.rate.toFixed(2)}${playhead.glide ? (playhead.hidden ? ' GLIDE' : ' glide in') : ''}${playhead.pull > 0.05 ? ` magnet ${playhead.pull.toFixed(2)}` : ''}`;
    }, 100);
    // jump to a route metre: /?debug&s=510, or [ and ] for -/+10 m (with Shift: 50 m), or __gt3r.goS(510)
    const goS = (m: number) => jump(progressAtTime(timeAtS(Math.max(PARK_S, m))));
    (w.__gt3r as Record<string, unknown>).goS = goS;
    const qs = Number(new URLSearchParams(window.location.search).get('s'));
    let pending = qs > 0;
    const unready = useStore.subscribe((st) => {
      if (pending && st.load === 'ready') {
        pending = false;
        goS(qs);
      }
    });
    if (pending && useStore.getState().load === 'ready') {
      pending = false;
      goS(qs);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' && e.key !== ']' && e.key !== '{' && e.key !== '}') return;
      const step = (e.shiftKey ? 50 : 10) * (e.key === '[' || e.key === '{' ? -1 : 1);
      goS(carState.s + step);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unready();
      window.removeEventListener('keydown', onKey);
      window.clearInterval(id);
      tween.current?.kill();
      delete w.__gt3r;
    };
  }, []);

  return <div ref={hud} className="shot-hud" aria-hidden />;
}
