import { Color, type MeshPhysicalMaterial, Uniform } from 'three';

/**
 * Click the car to cycle these. Each is a recolour of the one livery texture (decals and
 * numbers stay readable): a hue turn, saturation and brightness, and a tint mixed in.
 */
export const LIVERIES = [
  { name: 'Race gold', hue: 0, sat: 1, value: 1, tint: '#ffffff', tintMix: 0 },
  { name: 'Monsoon teal', hue: -2.37, sat: 1.2, value: 0.85, tint: '#ffffff', tintMix: 0 },
  { name: 'Signal red', hue: 0.77, sat: 1.4, value: 0.78, tint: '#ffffff', tintMix: 0 },
  { name: 'Midnight', hue: 0, sat: 0.25, value: 0.32, tint: '#1c2c48', tintMix: 0.4 },
  { name: 'Pearl', hue: 0, sat: 0.12, value: 1.2, tint: '#f3efe6', tintMix: 0.3 },
] as const;

export type LiveryUniforms = {
  hue: Uniform<number>;
  sat: Uniform<number>;
  value: Uniform<number>;
  tint: Uniform<Color>;
  tintMix: Uniform<number>;
};

export function createLiveryUniforms(): LiveryUniforms {
  return {
    hue: new Uniform(0),
    sat: new Uniform(1),
    value: new Uniform(1),
    tint: new Uniform(new Color('#ffffff')),
    tintMix: new Uniform(0),
  };
}

/** Patches the paint so the livery can be recoloured live (YIQ hue rotation). */
export function patchPaint(material: MeshPhysicalMaterial, u: LiveryUniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLiveryHue = u.hue;
    shader.uniforms.uLiverySat = u.sat;
    shader.uniforms.uLiveryValue = u.value;
    shader.uniforms.uLiveryTint = u.tint;
    shader.uniforms.uLiveryTintMix = u.tintMix;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uLiveryHue;
        uniform float uLiverySat;
        uniform float uLiveryValue;
        uniform vec3 uLiveryTint;
        uniform float uLiveryTintMix;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float yy = dot(c, vec3(0.299, 0.587, 0.114));
          float ii = dot(c, vec3(0.596, -0.274, -0.322));
          float qq = dot(c, vec3(0.211, -0.523, 0.312));
          float h = atan(qq, ii + 1e-6) + uLiveryHue;
          float ch = sqrt(ii * ii + qq * qq) * uLiverySat;
          ii = ch * cos(h);
          qq = ch * sin(h);
          c = vec3(yy + 0.956 * ii + 0.621 * qq, yy - 0.272 * ii - 0.647 * qq, yy - 1.106 * ii + 1.703 * qq);
          c = max(c, 0.0) * uLiveryValue;
          diffuseColor.rgb = mix(c, uLiveryTint * (0.25 + yy * 1.5), uLiveryTintMix);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'gt3r-livery';
  material.needsUpdate = true;
}
