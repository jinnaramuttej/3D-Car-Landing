import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import {
  Color,
  HalfFloatType,
  LinearFilter,
  type PerspectiveCamera,
  Scene,
  type Texture,
  Uniform,
  Vector2,
  type WebGLRenderer,
  type WebGLRenderTarget,
  WebGLRenderTarget as RenderTarget,
} from 'three';

/**
 * SOFT SMOKE
 * ==========
 * The tyre smoke lives in its own little scene (src/scene/Smoke.tsx adds its particles to
 * `smokeLayer.scene`), drawn here, after the main render, into a half-resolution target
 * while the particles read the main render's depth: each puff fades where it meets the
 * asphalt, the car or a wall (soft particles) instead of cutting a hard line through it.
 * The result is laid over the frame (premultiplied alpha), early in the chain, so depth
 * of field, bloom and the grade treat it like everything else.
 */

export const smokeLayer = {
  scene: new Scene(),
  /** The main render's depth (set by the composer through setDepthTexture). */
  depth: null as Texture | null,
  /** Size of the smoke target in pixels (the particles need it for their depth lookup). */
  resolution: new Vector2(1, 1),
  /** Fraction of the canvas resolution the smoke renders at. */
  scale: 0.5,
};

const fragment = /* glsl */ `
uniform sampler2D tSmoke;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 s = texture2D(tSmoke, uv);
  // opaque result: the frame's own alpha is not reliably 1 (additive rain, the sky), and
  // the effect pass would blend the smoke away wherever it isn't
  outputColor = vec4(inputColor.rgb * (1.0 - s.a) + s.rgb, 1.0);
}
`;

const _clear = new Color();

export class SoftSmokeEffect extends Effect {
  private target: WebGLRenderTarget;
  private camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, scale = 0.5) {
    super('SoftSmokeEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([['tSmoke', new Uniform(null)]]),
    });
    this.camera = camera;
    smokeLayer.scale = scale;
    this.target = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
    this.target.texture.generateMipmaps = false;
    this.uniforms.get('tSmoke')!.value = this.target.texture;
  }

  setDepthTexture(depthTexture: Texture) {
    smokeLayer.depth = depthTexture;
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width * smokeLayer.scale));
    const h = Math.max(1, Math.round(height * smokeLayer.scale));
    this.target.setSize(w, h);
    smokeLayer.resolution.set(w, h);
  }

  update(renderer: WebGLRenderer) {
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(_clear);
    const alpha = renderer.getClearAlpha();
    const auto = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(smokeLayer.scene, this.camera);
    renderer.autoClear = auto;
    renderer.setClearColor(_clear, alpha);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.target.dispose();
    super.dispose();
  }
}
