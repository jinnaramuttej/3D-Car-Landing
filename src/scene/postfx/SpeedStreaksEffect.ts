import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

/*
 * Light-speed streaks at peak speed: a radial zoom smear out from the middle of the frame,
 * plus thin streaks of light racing outward in random lanes. Nothing at cruising speed;
 * it comes in only when the car is flat out (a mini-map hop, a hard flick of the wheel).
 */
const fragment = /* glsl */ `
uniform float uAmount;
uniform float uTime;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uAmount < 0.002) {
    outputColor = inputColor;
    return;
  }
  vec2 c = vec2(0.5, 0.47);
  vec2 d = uv - c;
  float r = length(d * vec2(aspect, 1.0));
  // zoom smear, none in the middle (the car stays sharp)
  vec3 acc = inputColor.rgb;
  float wsum = 1.0;
  for (int i = 1; i < 8; i++) {
    float k = float(i) / 8.0;
    float w = 1.0 - k;
    acc += texture2D(inputBuffer, c + d * (1.0 - k * 0.07 * uAmount)).rgb * w;
    wsum += w;
  }
  float edge = smoothstep(0.12, 0.55, r);
  vec3 col = mix(inputColor.rgb, acc / wsum, edge * uAmount);
  // streaks: a few lit lanes round the circle, each with a dash running outward
  float a = atan(d.y, d.x) / 6.2831853 + 0.5;
  float lanes = 90.0;
  float lane = floor(a * lanes);
  float h = hash(lane + 1.7);
  float across = abs(fract(a * lanes) - 0.5) * 2.0;
  float dash = fract(r * 1.4 - uTime * (1.6 + 2.4 * h) - h * 9.0);
  float streak = step(0.7, h) * smoothstep(1.0, 0.0, across) * smoothstep(0.0, 0.04, dash) * smoothstep(0.32, 0.04, dash);
  col += vec3(0.82, 0.9, 1.0) * streak * smoothstep(0.18, 0.7, r) * uAmount * 0.55;
  outputColor = vec4(col, inputColor.a);
}
`;

export class SpeedStreaksEffect extends Effect {
  constructor() {
    super('SpeedStreaksEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uAmount', new Uniform(0)],
        ['uTime', new Uniform(0)],
      ]),
    });
  }

  set amount(v: number) {
    this.uniforms.get('uAmount')!.value = v;
  }

  set time(v: number) {
    this.uniforms.get('uTime')!.value = v;
  }
}
