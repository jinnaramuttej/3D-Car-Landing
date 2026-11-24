'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type Material, type Object3D, type Texture, WebGLRenderTarget } from 'three';
import { chapterAt, IGNITION } from '@/lib/chapters';
import { DRIFT, progressAtTime, progressAtZone, timeAtS, ZONES } from '@/lib/pacing';
import { chapterState } from '@/lib/chapterRuntime';
import { carState } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { warmup } from '@/lib/warmup';
import { smokeLayer } from './postfx/SoftSmokeEffect';

/** Every texture a material holds (maps and texture uniforms). */
function texturesOf(m: Material, out: Set<Texture>) {
  for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && (v as Texture).isTexture) out.add(v as Texture);
  const u = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (u) for (const { value } of Object.values(u)) if (value && (value as Texture).isTexture) out.add(value as Texture);
}

/** Places the warm-up drives through (journey progress), a few frames at each. */
function warmupStops() {
  const atS = (s: number) => progressAtTime(timeAtS(s));
  const out = [IGNITION.at * 0.5, IGNITION.at + 0.004, IGNITION.driveAt + 0.004];
  for (const s of [DRIFT.from, DRIFT.flick, DRIFT.full + 20, (DRIFT.full + DRIFT.hold) / 2, DRIFT.hold, DRIFT.to + 30, DRIFT.to + 90]) out.push(atS(s));
  // every stop: rolling in, at the board, launching out
  for (const z of ZONES) for (const f of [0.1, 0.5, 0.9]) out.push(progressAtZone(z.id, f));
  out.push(chapterAt('finale', 0.2), chapterAt('finale', 0.35), chapterAt('finale', 0.9));
  return out;
}

const FRAMES_EACH = 3;

/**
 * Behind the loader, once everything has loaded: compile every shader for the state the
 * scene really renders in (into the composer's render target, every light in place), upload
 * every texture, then drive the journey once through every chapter, a few frames at each
 * place, so the billboards draw, the reflection and the smoke buffers are built and anything
 * the compile missed is caught. Then it puts everything back (the smoke, the skid marks, the
 * camera), lands where the page is and lets the loader go. Nothing builds mid-scroll.
 */
export function Warmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const run = useMemo(() => ({ phase: 'compile' as 'compile' | 'drive' | 'done', stops: warmupStops(), i: 0, frame: 0, t0: 0 }), []);

  useEffect(() => {
    let dead = false;
    run.t0 = performance.now();
    useStore.getState().setLoad('warming', 0);
    void (async () => {
      // the composer renders the scene into a render target (linear, no tone mapping):
      // compile for exactly that, or every material compiles again on the first frame
      const rt = new WebGLRenderTarget(4, 4);
      const was = gl.getRenderTarget();
      gl.setRenderTarget(rt);
      try {
        await gl.compileAsync(scene, camera);
        await gl.compileAsync(smokeLayer.scene, camera);
      } finally {
        gl.setRenderTarget(was);
        rt.dispose();
      }
      if (dead) return;
      const tex = new Set<Texture>();
      const visit = (o: Object3D) => {
        const m = (o as Object3D & { material?: Material | Material[] }).material;
        if (Array.isArray(m)) m.forEach((x) => texturesOf(x, tex));
        else if (m) texturesOf(m, tex);
      };
      scene.traverse(visit);
      smokeLayer.scene.traverse(visit);
      if (scene.environment) tex.add(scene.environment);
      for (const t of tex) gl.initTexture(t);
      // the billboards redraw once the display font is in: let that happen now, not on the road
      await document.fonts?.ready;
      if (dead) return;
      warmup.compileMs = performance.now() - run.t0;
      warmup.textures = tex.size;
      useStore.getState().setLoad('warming', 0.3);
      useStore.getState().setManual(true);
      run.phase = 'drive';
    })();
    return () => {
      dead = true;
    };
  }, [gl, scene, camera, run]);

  // before the scene's own frame (priority -3): put the journey where the warm-up wants it
  useFrame(() => {
    if (run.phase !== 'drive') return;
    const st = useStore.getState();
    if (run.i < run.stops.length) {
      const p = run.stops[run.i];
      st.setProgress(p);
      chapterState.progress = p;
      chapterState.rate = 0;
      if (run.frame === 0) {
        // land with everything as it is there (the dawn sky and its materials, the full slide)
        chapterState.initialized = false;
        carState.initialized = false;
      }
      if (++run.frame >= FRAMES_EACH) {
        run.frame = 0;
        run.i++;
        st.setLoad('warming', 0.3 + (0.7 * run.i) / run.stops.length);
      }
      return;
    }
    // done: back to where the page is, as if nothing had happened
    run.phase = 'done';
    st.setManual(false); // (hands progress back to the scroll position)
    chapterState.initialized = false;
    carState.initialized = false;
    for (const reset of warmup.resets) reset();
    warmup.active = false;
    warmup.totalMs = performance.now() - run.t0;
    st.setLoad('ready', 1);
  }, -4);

  return null;
}
