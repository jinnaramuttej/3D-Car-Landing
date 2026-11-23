import { ShaderPass } from 'postprocessing';
import { NoBlending, ShaderMaterial, Uniform } from 'three';

/**
 * First pass in the post chain: replaces NaN/Inf pixels with black, clamps extreme
 * HDR values and applies the chapter's exposure (uniform `exposure`). A single NaN pixel (MeshReflectorMaterial produces a few at
 * grazing angles) would otherwise be smeared over the whole frame by bloom and
 * depth of field, turning the screen black.
 */
export function createSanitizePass() {
  const material = new ShaderMaterial({
    name: 'SanitizeMaterial',
    uniforms: { inputBuffer: new Uniform(null), exposure: new Uniform(1) },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer;
      uniform float exposure;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(inputBuffer, vUv);
        bvec4 bad = isnan(c);
        if (any(bad) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = vec4(min(c.rgb * exposure, vec3(6e4)), c.a);
      }
    `,
    blending: NoBlending,
    depthWrite: false,
    depthTest: false,
  });
  const pass = new ShaderPass(material, 'inputBuffer');
  return { pass, exposure: material.uniforms.exposure as Uniform<number> };
}
