'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
  EffectPass,
  LUT3DEffect,
  ToneMappingMode,
  type VignetteEffect,
} from 'postprocessing';
import { MathUtils, type PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState } from '@/lib/motion';
import { chapterState, rainLevel } from '@/lib/chapterRuntime';
import { getWipeTexture, interaction } from '@/lib/interaction';
import { cameraState } from './CameraRig';
import { AnamorphicEffect } from './postfx/AnamorphicEffect';
import { createTealOrangeLut } from './postfx/gradeLut';
import { LensDropsEffect } from './postfx/LensDropsEffect';
import { MotionBlurEffect } from './postfx/MotionBlurEffect';
import { FilmGrainEffect } from './postfx/FilmGrainEffect';
import { createSanitizePass } from './postfx/SanitizePass';
import { SoftSmokeEffect } from './postfx/SoftSmokeEffect';

/**
 * The post chain, in order (the composer splits it into passes where effects that
 * sample neighbouring pixels would collide):
 *   sanitize     NaN/Inf scrub (the reflector throws the odd NaN), chapter exposure
 *   smoke        the tyre smoke, soft against the scene's depth (postfx/SoftSmokeEffect)
 *   DOF          focused on the car during the drift, on the section's subject after
 *   motion blur  camera reprojection, with the car carried by its own motion
 *   bloom        + anamorphic streaks on the brightest lights
 *   lens drops   rain on the glass, streaked by camera motion
 *   tone map     ACES, then the teal/orange LUT
 *   CA, grain, vignette
 * Mobile keeps bloom, tone mapping, the grade, grain and vignette only.
 */
export function Effects() {
  const mobile = useMemo(() => isMobile(), []);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const dof = useRef<DepthOfFieldEffect>(null!);
  const bloom = useRef<BloomEffect>(null!);
  const ca = useRef<ChromaticAberrationEffect>(null!);
  const vignette = useRef<VignetteEffect>(null!);
  const caOffset = useMemo(() => new Vector2(CONFIG.look.chromaticOffset, CONFIG.look.chromaticOffset * 0.6), []);

  const fx = useMemo(() => {
    const p = CONFIG.post;
    const lut = new LUT3DEffect(createTealOrangeLut(32));
    const grain = new FilmGrainEffect();
    // its own pass: merged with depth of field, the blur would be built without the smoke
    const smoke = new SoftSmokeEffect(camera, 0.5);
    return {
      sanitize: createSanitizePass(),
      smoke,
      smokePass: new EffectPass(camera, smoke),
      motionBlur: new MotionBlurEffect(camera, carState, p.motionBlurSamples),
      anamorphic: new AnamorphicEffect(),
      drops: new LensDropsEffect(),
      lut,
      grain,
    };
  }, [camera]);

  useEffect(
    () => () => {
      fx.motionBlur.dispose();
      fx.anamorphic.dispose();
      fx.drops.dispose();
      fx.lut.dispose();
      fx.grain.dispose();
      fx.smokePass.dispose();
    },
    [fx],
  );

  // camera velocity for the lens drops (camera space, m/s), smoothed and cut-aware
  const motion = useMemo(
    () => ({
      prev: new Vector3(),
      has: false,
      vel: new Vector3(),
      push: new Vector2(),
      radial: 0,
      clock: 0,
    }),
    [],
  );
  const _pos = useMemo(() => new Vector3(), []);
  const _d = useMemo(() => new Vector3(), []);
  const _focus = useMemo(() => new Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.max(1e-3, Math.min(rawDt, 1 / 20));
    const l = CONFIG.look;
    const p = CONFIG.post;

    // Depth of field: during the drift, focus on the car (the look point when it is a
    // detail on the car, like the tyre; the car's centre when the shot looks past it).
    if (dof.current) {
      _focus.copy(cameraState.focus);
      if (chapterState.drift && carState.carReady && p.focusOnCar) {
        _d.copy(carState.position).setY(carState.position.y + 0.6);
        if (_focus.distanceTo(_d) > 2.6) _focus.copy(_d);
      }
      dof.current.target = _focus;
      dof.current.bokehScale = cameraState.dof // camera.dofScale is already applied by the rig;
      dof.current.cocMaterial.focusRange = cameraState.focusRange;
    }
    if (bloom.current) {
      bloom.current.intensity = l.bloomIntensity * chapterState.env.bloom;
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

    fx.sanitize.exposure.value = chapterState.env.exposure;

    camera.getWorldPosition(_pos);

    const mb = fx.motionBlur;
    mb.strength = p.motionBlur;
    mb.maxBlur = p.motionBlurMax;
    mb.cutDistance = p.cutDistance;

    const an = fx.anamorphic;
    an.intensity = p.anamorphic;
    an.threshold = p.anamorphicThreshold;
    an.length = p.anamorphicLength;
    an.tint.set(p.anamorphicTint);

    fx.lut.blendMode.opacity.value = p.grade;
    fx.grain.amount = p.grain;

    // Lens drops: air pushes them against the camera's sideways motion; moving forward
    // spreads them out from the centre. A cut (big jump in one frame) is ignored.
    if (motion.has) {
      _d.subVectors(_pos, motion.prev);
      if (_d.length() < p.cutDistance) {
        _d.divideScalar(dt).applyQuaternion(_q.copy(camera.quaternion).invert());
        motion.vel.lerp(_d, 1 - Math.exp(-6 * dt));
      }
    }
    motion.prev.copy(_pos);
    motion.has = true;
    const k = p.lensDropStreak;
    motion.push.set(-motion.vel.x * k, -motion.vel.y * k);
    if (motion.push.length() > 2.2) motion.push.setLength(2.2);
    motion.radial = MathUtils.clamp(-motion.vel.z * k * 1.5, 0, 3);
    motion.clock += dt;
    const dr = fx.drops;
    dr.amount = p.lensDrops * rainLevel();
    dr.wipe = getWipeTexture();
    // a rev rattles the glass
    const rr = interaction.rev * CONFIG.interaction.revRain;
    if (rr > 0.01) motion.push.x += Math.sin(motion.clock * 57) * 0.35 * rr;
    dr.refract = p.lensDropRefract;
    dr.push.copy(motion.push);
    dr.radial = motion.radial;
    dr.clock = motion.clock;
  });

  return (
    <EffectComposer multisampling={mobile ? 0 : 4}>
      <primitive object={fx.sanitize.pass} />
      {/* tyre smoke, drawn in its own pass against the scene's depth (soft particles) */}
      <primitive object={fx.smokePass} />
      {mobile ? (
        <></>
      ) : (
        <>
          <DepthOfField ref={dof} focusDistance={5} focusRange={3} bokehScale={0} resolutionScale={0.5} />
          <primitive object={fx.motionBlur} />
        </>
      )}
      <Bloom
        ref={bloom}
        mipmapBlur
        intensity={CONFIG.look.bloomIntensity}
        luminanceThreshold={CONFIG.look.bloomThreshold}
        luminanceSmoothing={CONFIG.look.bloomSmoothing}
      />
      {mobile ? (
        <></>
      ) : (
        <>
          <primitive object={fx.anamorphic} />
          <primitive object={fx.drops} />
        </>
      )}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={fx.lut} />
      <ChromaticAberration ref={ca} offset={caOffset} radialModulation modulationOffset={0.2} />
      <primitive object={fx.grain} />
      <Vignette ref={vignette} offset={CONFIG.look.vignetteOffset} darkness={CONFIG.look.vignetteDarkness} />
    </EffectComposer>
  );
}

const _q = new Quaternion();
