import { Pass } from 'postprocessing';
import { HalfFloatType, NoBlending, ShaderMaterial, Uniform, type WebGLRenderer, WebGLRenderTarget } from 'three';

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

/*
 * Cross-dissolve over a camera cut. Every clean frame is kept in `history`; when a cut
 * is triggered, the frame before it is held and faded out over the new shot.
 * Runs on the HDR image right after the NaN scrub, so the rest of the chain (bloom,
 * grade, grain) treats both shots alike.
 */
export class DissolvePass extends Pass {
  /** seconds */
  duration = 0.9;
  private amount = 0;
  private history = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private mix: ShaderMaterial;
  private copy: ShaderMaterial;

  constructor() {
    super('DissolvePass');
    this.mix = new ShaderMaterial({
      uniforms: { inputBuffer: new Uniform(null), historyBuffer: new Uniform(null), amount: new Uniform(0) },
      vertexShader: vertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        uniform sampler2D historyBuffer;
        uniform float amount;
        varying vec2 vUv;
        void main() {
          vec4 a = texture2D(inputBuffer, vUv);
          vec4 b = texture2D(historyBuffer, vUv);
          gl_FragColor = mix(a, b, amount);
        }
      `,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new ShaderMaterial({
      uniforms: { inputBuffer: new Uniform(null) },
      vertexShader: vertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(inputBuffer, vUv); }
      `,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.mix;
  }

  /** Hold the last frame and fade it out over the next `duration` seconds. */
  trigger() {
    if (this.duration > 0.01) this.amount = 1;
  }

  get active() {
    return this.amount > 0;
  }

  setSize(width: number, height: number) {
    this.history.setSize(width, height);
  }

  render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget, deltaTime = 1 / 60) {
    const a = this.amount;
    this.fullscreenMaterial = this.mix;
    this.mix.uniforms.inputBuffer.value = inputBuffer.texture;
    this.mix.uniforms.historyBuffer.value = this.history.texture;
    this.mix.uniforms.amount.value = a * a * (3 - 2 * a);
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    if (a > 0) {
      this.amount = Math.max(0, a - deltaTime / Math.max(0.01, this.duration));
    } else {
      // keep the last clean frame for the next cut
      this.fullscreenMaterial = this.copy;
      this.copy.uniforms.inputBuffer.value = inputBuffer.texture;
      renderer.setRenderTarget(this.history);
      renderer.render(this.scene, this.camera);
      this.fullscreenMaterial = this.mix;
    }
  }

  dispose() {
    this.history.dispose();
    this.mix.dispose();
    this.copy.dispose();
    super.dispose();
  }
}
