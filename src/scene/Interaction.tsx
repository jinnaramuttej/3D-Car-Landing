'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Raycaster, Vector2 } from 'three';
import { chapterState, rainLevel } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { engine } from '@/lib/engineAudio';
import { getWipeTexture, interaction, isUiTarget, WIPE_H, WIPE_W } from '@/lib/interaction';
import { useStore } from '@/lib/store';
import { cycleShot } from './city/director';
import { LIVERIES } from './livery';

/** Flips the headlights against whatever they show right now (H key and the navbar button). */
export function toggleHeadlights() {
  const st = useStore.getState();
  const on = st.headlights === 'on' || (st.headlights === 'auto' && chapterState.ignition > 0.5);
  st.setHeadlights(on ? 'off' : 'on');
}

/**
 * Visitor input (see src/lib/interaction.ts): hold to rev, wipe the lens with the cursor,
 * click the car for the next livery, H for headlights. Listens on window so it works
 * through the DOM overlay; presses on links and buttons are left alone.
 */
export function Interaction() {
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);
  // the district sets live on layer 1 (out of the road reflection): let pointer events reach them
  useEffect(() => {
    raycaster.layers.enable(1);
  }, [raycaster]);
  const mobile = useMemo(() => isMobile(), []);
  const state = useMemo(
    () => ({
      down: false,
      downAt: 0,
      x: 0,
      y: 0,
      moved: 0,
      space: false,
      last: null as Vector2 | null,
      wipeDirty: false,
      decay: 0,
      raycaster: new Raycaster(),
      ndc: new Vector2(),
      cycledAt: 0,
    }),
    [],
  );

  useEffect(() => {
    getWipeTexture();
    const pick = (clientX: number, clientY: number) => {
      const car = interaction.carObject;
      if (!car) return false;
      state.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      state.raycaster.setFromCamera(state.ndc, camera);
      return state.raycaster.intersectObject(car, true).length > 0;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || isUiTarget(e.target)) return;
      state.down = true;
      state.downAt = performance.now();
      state.x = e.clientX;
      state.y = e.clientY;
      state.moved = 0;
    };
    const onUp = (e: PointerEvent) => {
      if (!state.down) return;
      const held = (performance.now() - state.downAt) / 1000 >= CONFIG.interaction.holdDelay;
      state.down = false;
      if (!held && state.moved < 8 && pick(e.clientX, e.clientY)) {
        const st = useStore.getState();
        st.setLivery((st.livery + 1) % LIVERIES.length);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (state.down) state.moved += Math.hypot(e.movementX, e.movementY);
      if (e.pointerType !== 'mouse') return;
      // wipe the lens: a soft stroke in the mask from the last cursor position
      const ctx = interaction.wipeCanvas?.getContext('2d');
      if (!ctx || rainLevel() < 0.02) {
        state.last = null;
        return;
      }
      const p = new Vector2((e.clientX / window.innerWidth) * WIPE_W, (e.clientY / window.innerHeight) * WIPE_H);
      const from = state.last ?? p;
      const r = CONFIG.interaction.wipeRadius * WIPE_H;
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 2;
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = r;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x + 0.01, p.y);
      ctx.stroke();
      ctx.restore();
      state.last = p;
      state.wipeDirty = true;
    };
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault(); // hold Space to rev, not to scroll
        state.space = e.type === 'keydown';
      } else if (e.type === 'keydown' && !e.repeat && e.code === 'KeyH') {
        toggleHeadlights();
      } else if (e.type === 'keydown' && e.code === 'KeyC') {
        // tap C for the next shot; hold it and the shots keep stepping
        const now = performance.now();
        if (!e.repeat || now - state.cycledAt > 900) {
          state.cycledAt = now;
          cycleShot();
        }
      }
    };
    const onBlur = () => {
      state.down = false;
      state.space = false;
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onBlur);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onBlur);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, state]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const c = CONFIG.interaction;
    // hold (after a short delay, so a click on the car doesn't rev) or Space
    const pressHeld = state.down && !mobile && (performance.now() - state.downAt) / 1000 >= c.holdDelay && state.moved < 40;
    interaction.holding = pressHeld || state.space;
    const target = interaction.holding ? 1 : 0;
    const tau = target > interaction.rev ? c.revRise : c.revFall;
    interaction.rev += (target - interaction.rev) * (1 - Math.exp(-dt / Math.max(0.01, tau)));
    if (interaction.rev < 1e-4) interaction.rev = 0;

    // engine: idles once it has started, follows the rev (a rev before ignition starts it)
    const running = chapterState.engineOn || interaction.rev > 0.02;
    engine.setLive(running && !useStore.getState().muted, interaction.rev);

    // the drops come back as it keeps raining
    const ctx = interaction.wipeCanvas?.getContext('2d');
    const tex = interaction.wipe;
    if (ctx && tex) {
      // (in coarse steps: tiny alphas round to nothing in an 8-bit canvas)
      state.decay += c.wipeReturn * Math.max(0.15, rainLevel()) * dt;
      if (state.decay > 0.06) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(1, state.decay)})`;
        ctx.fillRect(0, 0, WIPE_W, WIPE_H);
        state.decay = 0;
        state.wipeDirty = true;
      }
      if (state.wipeDirty) {
        tex.needsUpdate = true;
        state.wipeDirty = false;
      }
    }
  }, -1);

  return null;
}
