'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import {
  type BloomEffect,
  type ChromaticAberrationEffect,
  type DepthOfFieldEffect,
  ToneMappingMode,
  type VignetteEffect,
} from 'postprocessing';
import { Vector2 } from 'three';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { sectionState } from '@/lib/sectionRuntime';
import { cameraState } from './CameraRig';
import { createSanitizePass } from './postfx/SanitizePass';

/**
 * Depth of field focuses on whatever the current shot looks at (cameraState.focus),
 * with per-shot bokeh. Bloom picks up the emissive lights. The composer turns
 * renderer tone mapping off, so ToneMapping runs here. Chromatic aberration widens
 * with the camera shake. Depth of field is skipped on mobile.
 */
export function Effects() {
  const mobile = useMemo(() => isMobile(), []);
  const dof = useRef<DepthOfFieldEffect>(null!);
  const bloom = useRef<BloomEffect>(null!);
  const ca = useRef<ChromaticAberrationEffect>(null!);
  const vignette = useRef<VignetteEffect>(null!);
  const caOffset = useMemo(() => new Vector2(CONFIG.look.chromaticOffset, CONFIG.look.chromaticOffset * 0.6), []);
  const sanitize = useMemo(() => createSanitizePass(), []);

  useFrame(() => {
    const l = CONFIG.look;
    if (dof.current) {
      dof.current.target = cameraState.focus;
      dof.current.bokehScale = cameraState.dof;
      dof.current.cocMaterial.focusRange = cameraState.focusRange;
    }
    if (bloom.current) {
      bloom.current.intensity = l.bloomIntensity * (sectionState.active ? sectionState.look.bloom : 1);
      bloom.current.luminanceMaterial.threshold = l.bloomThreshold;
      bloom.current.luminanceMaterial.smoothing = l.bloomSmoothing;
    }
    if (ca.current) {
      const shake = cameraState.shake / Math.max(1e-3, CONFIG.camera.shakePeak);
      const off = l.chromaticOffset + l.chromaticShake * shake;
      ca.current.offset.set(off, off * 0.6);
    }
    if (vignette.current) {
      vignette.current.offset = l.vignetteOffset;
      vignette.current.darkness = l.vignetteDarkness;
    }
  });

  return (
    <EffectComposer multisampling={mobile ? 0 : 4}>
      <primitive object={sanitize} />
      {mobile ? (
        <></>
      ) : (
        <DepthOfField ref={dof} focusDistance={5} focusRange={3} bokehScale={0} resolutionScale={0.5} />
      )}
      <Bloom
        ref={bloom}
        mipmapBlur
        intensity={CONFIG.look.bloomIntensity}
        luminanceThreshold={CONFIG.look.bloomThreshold}
        luminanceSmoothing={CONFIG.look.bloomSmoothing}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <ChromaticAberration ref={ca} offset={caOffset} radialModulation modulationOffset={0.2} />
      <Vignette ref={vignette} offset={CONFIG.look.vignetteOffset} darkness={CONFIG.look.vignetteDarkness} />
    </EffectComposer>
  );
}
