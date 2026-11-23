import { Effect, EffectAttribute } from 'postprocessing';
import { type Texture, Uniform, Vector2 } from 'three';

/*
 * Rain on the lens. Two layers of procedural drops (big sparse, small dense) that land,
 * sit and fade on a slow cycle. Each drop is a tiny lens: it shows a flipped, defocused
 * patch of the frame with a dark rim and a soft highlight. When the camera moves the
 * drops are pushed by the air and stretch into streaks (dropPush), and forward motion
 * pushes them out from the centre (dropRadial).
 */
const fragment = /* glsl */ `
uniform float dropAmount;
uniform float dropRefract;
uniform vec2 dropPush;
uniform float dropRadial;
uniform float dropClock;
uniform sampler2D dropWipe;

float dropHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// one layer of drops: xy = lens normal (-1..1), z = coverage
vec3 dropLayer(vec2 p, float cells, float density, float seed, vec2 push) {
  vec2 q = p * cells;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  // each cell lands a new drop every few seconds; it fades in, sits, then dries off
  float life = dropClock * mix(0.08, 0.16, dropHash(id + seed * 3.1)) + dropHash(id + seed);
  float cycle = floor(life);
  float age = fract(life);
  vec2 cid = id + cycle * 17.31;
  float present = step(1.0 - density, dropHash(cid + seed + 0.5));
  float fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.7, 1.0, age));
  vec2 c = (vec2(dropHash(cid + seed + 1.7), dropHash(cid + seed + 4.3)) - 0.5) * 0.46;
  float r = mix(0.1, 0.24, dropHash(cid + seed + 9.1));
  vec2 d = f - c;
  // pushed drops trail a tail behind them
  float pl = length(push);
  if (pl > 1e-3) {
    vec2 dir = push / pl;
    float along = dot(d, dir);
    vec2 side = d - dir * along;
    float k = 1.0 + min(pl, 2.2) * 2.0;
    if (along < 0.0) {
      along /= k;
      side *= 1.0 + 0.6 * smoothstep(0.0, r * 2.0, -along * k) * min(pl, 1.0);
    }
    d = side + dir * along;
  }
  float dist = length(d);
  float m = smoothstep(r, r * 0.6, dist) * present * fade;
  return vec3(d / r * m, m);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (dropAmount <= 0.001) {
    outputColor = inputColor;
    return;
  }
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 push = dropPush + (uv - 0.5) * dropRadial;
  vec3 dr = dropLayer(p, 7.0, 0.3, 1.0, push) + dropLayer(p + vec2(0.37, 0.71), 15.0, 0.26, 7.0, push * 1.4);
  // the visitor's cursor wipes the glass (white in the mask = wiped)
  float m = clamp(dr.z, 0.0, 1.0) * dropAmount * (1.0 - texture2D(dropWipe, uv).r);
  if (m < 0.002) {
    outputColor = inputColor;
    return;
  }
  vec2 n = dr.xy;
  // a drop flips and shrinks what is behind it, out of focus
  vec2 ruv = clamp(uv - n * dropRefract, 0.0, 1.0);
  vec2 o = texelSize * 3.0;
  vec3 col = texture2D(inputBuffer, ruv).rgb * 0.36
    + texture2D(inputBuffer, ruv + vec2(o.x, o.y)).rgb * 0.16
    + texture2D(inputBuffer, ruv + vec2(-o.x, o.y)).rgb * 0.16
    + texture2D(inputBuffer, ruv + vec2(o.x, -o.y)).rgb * 0.16
    + texture2D(inputBuffer, ruv + vec2(-o.x, -o.y)).rgb * 0.16;
  float nl = min(length(n), 1.0);
  col *= mix(1.1, 0.5, smoothstep(0.55, 1.0, nl));
  vec3 normal = normalize(vec3(n, sqrt(max(1.0 - nl * nl, 0.0)) + 0.2));
  float spec = pow(max(dot(normal, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 24.0);
  col += spec * (0.08 + 0.4 * dot(col, vec3(0.2126, 0.7152, 0.0722)));
  outputColor = vec4(mix(inputColor.rgb, col, m), inputColor.a);
}
`;

export class LensDropsEffect extends Effect {
  constructor() {
    super('LensDropsEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['dropAmount', new Uniform(0.7)],
        ['dropRefract', new Uniform(0.035)],
        ['dropPush', new Uniform(new Vector2())],
        ['dropRadial', new Uniform(0)],
        ['dropClock', new Uniform(0)],
        ['dropWipe', new Uniform<Texture | null>(null)],
      ]),
    });
  }

  set amount(v: number) {
    this.uniforms.get('dropAmount')!.value = v;
  }
  set refract(v: number) {
    this.uniforms.get('dropRefract')!.value = v;
  }
  set radial(v: number) {
    this.uniforms.get('dropRadial')!.value = v;
  }
  set clock(v: number) {
    this.uniforms.get('dropClock')!.value = v;
  }
  set wipe(t: Texture | null) {
    this.uniforms.get('dropWipe')!.value = t;
  }
  get push() {
    return this.uniforms.get('dropPush')!.value as Vector2;
  }
}
