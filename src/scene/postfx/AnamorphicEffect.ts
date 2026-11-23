import { BlendFunction, Effect } from 'postprocessing';
import {
  Color,
  HalfFloatType,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector2,
  type WebGLRenderer,
  type WebGLRenderTarget as RT,
  WebGLRenderTarget,
} from 'three';

/*
 * Anamorphic lens streaks: the brightest pixels (street lamps, headlights, neon) are
 * pulled out at quarter resolution and smeared sideways by a few widening horizontal
 * blur passes, then added back with a cool tint, like the flares of an anamorphic lens.
 */
const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const thresholdFrag = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
void main() {
  // 4 taps: a cheap box filter for the downsample
  vec3 c = texture2D(tInput, vUv + texel * vec2(-0.5, -0.5)).rgb
    + texture2D(tInput, vUv + texel * vec2(0.5, -0.5)).rgb
    + texture2D(tInput, vUv + texel * vec2(-0.5, 0.5)).rgb
    + texture2D(tInput, vUv + texel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - threshold, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}
`;

const blurFrag = /* glsl */ `
uniform sampler2D tInput;
uniform float stepX;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.2;
  c += (texture2D(tInput, vUv + vec2(stepX, 0.0)).rgb + texture2D(tInput, vUv - vec2(stepX, 0.0)).rgb) * 0.17;
  c += (texture2D(tInput, vUv + vec2(stepX * 2.0, 0.0)).rgb + texture2D(tInput, vUv - vec2(stepX * 2.0, 0.0)).rgb) * 0.13;
  c += (texture2D(tInput, vUv + vec2(stepX * 3.0, 0.0)).rgb + texture2D(tInput, vUv - vec2(stepX * 3.0, 0.0)).rgb) * 0.1;
  gl_FragColor = vec4(c, 1.0);
}
`;

const fragment = /* glsl */ `
uniform sampler2D streakMap;
uniform vec3 tint;
uniform float intensity;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 s = texture2D(streakMap, uv).rgb;
  outputColor = vec4(inputColor.rgb + s * tint * intensity, inputColor.a);
}
`;

export class AnamorphicEffect extends Effect {
  threshold = 2.2;
  /** scales the blur step: longer or shorter streaks */
  length = 1;
  private passes = 5;
  private a: RT;
  private b: RT;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private thresholdMat: ShaderMaterial;
  private blurMat: ShaderMaterial;

  constructor() {
    super('AnamorphicEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['streakMap', new Uniform(null)],
        ['tint', new Uniform(new Color('#7fb0ff'))],
        ['intensity', new Uniform(0.5)],
      ]),
    });
    const opts = { type: HalfFloatType, depthBuffer: false };
    this.a = new WebGLRenderTarget(1, 1, opts);
    this.b = new WebGLRenderTarget(1, 1, opts);
    this.thresholdMat = new ShaderMaterial({
      uniforms: { tInput: { value: null }, texel: { value: new Vector2() }, threshold: { value: 2 } },
      vertexShader: vertex,
      fragmentShader: thresholdFrag,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new ShaderMaterial({
      uniforms: { tInput: { value: null }, stepX: { value: 0 } },
      vertexShader: vertex,
      fragmentShader: blurFrag,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.thresholdMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get tint() {
    return this.uniforms.get('tint')!.value as Color;
  }
  set intensity(v: number) {
    this.uniforms.get('intensity')!.value = v;
  }
  get intensity() {
    return this.uniforms.get('intensity')!.value as number;
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 4));
    const h = Math.max(1, Math.round(height / 4));
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }

  update(renderer: WebGLRenderer, inputBuffer: RT) {
    if (this.intensity <= 0) return;
    const w = this.a.width;
    const t = this.thresholdMat.uniforms;
    t.tInput.value = inputBuffer.texture;
    (t.texel.value as Vector2).set(1 / inputBuffer.width, 1 / inputBuffer.height);
    t.threshold.value = this.threshold;
    this.quad.material = this.thresholdMat;
    renderer.setRenderTarget(this.a);
    renderer.render(this.scene, this.camera);

    // widening steps (1, 2, 4, 8, 16 texels) give a long streak with a soft falloff
    let src = this.a;
    let dst = this.b;
    this.quad.material = this.blurMat;
    for (let i = 0; i < this.passes; i++) {
      this.blurMat.uniforms.tInput.value = src.texture;
      this.blurMat.uniforms.stepX.value = (Math.pow(2, i) * this.length) / w;
      renderer.setRenderTarget(dst);
      renderer.render(this.scene, this.camera);
      [src, dst] = [dst, src];
    }
    this.uniforms.get('streakMap')!.value = src.texture as Texture;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.thresholdMat.dispose();
    this.blurMat.dispose();
    this.quad.geometry.dispose();
    super.dispose();
  }
}
