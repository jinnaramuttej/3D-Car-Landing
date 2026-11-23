import { BlendFunction, Effect } from 'postprocessing';
import { Uniform } from 'three';

/*
 * Film grain: zero-mean noise, strongest in the midtones and faint in the highlights and
 * blacks (like film), so bright paint never sparkles. Runs after the grade, in display
 * values. A new pattern every frame.
 */
const fragment = /* glsl */ `
uniform float grainAmount;

float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 px = uv * resolution + fract(time * 7.13) * vec2(113.0, 71.0);
  float n = grainHash(px) + grainHash(px + 17.3) - 1.0; // triangular, -1..1
  float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float mid = 0.2 + 0.8 * clamp(4.0 * l * (1.0 - l), 0.0, 1.0);
  outputColor = vec4(inputColor.rgb + n * grainAmount * mid, inputColor.a);
}
`;

export class FilmGrainEffect extends Effect {
  constructor() {
    super('FilmGrainEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([['grainAmount', new Uniform(0.04)]]),
    });
  }

  /** 0..1 knob (CONFIG.post.grain) -> noise amplitude */
  set amount(v: number) {
    this.uniforms.get('grainAmount')!.value = v * 0.12;
  }
}
