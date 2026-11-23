import { Effect, EffectAttribute } from 'postprocessing';
import { Matrix4, type PerspectiveCamera, Quaternion, Uniform, Vector3 } from 'three';

/*
 * Camera motion blur by reprojection: each pixel's world position (from depth) is
 * projected with last frame's view-projection, and the colour is smeared along the
 * difference. The car is the one thing that moves on its own, so pixels inside its box
 * are carried back with the car's own frame-to-frame motion first; a tracking shot keeps
 * the car sharp while the road and the city streak past.
 */
const fragment = /* glsl */ `
uniform mat4 invViewProj;
uniform mat4 prevViewProj;
uniform mat4 carInverse;
uniform mat4 carDelta;
uniform vec3 carHalf;
uniform float strength;
uniform float maxBlur;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 w = invViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 wp = w.xyz / w.w;
  vec3 lp = (carInverse * vec4(wp, 1.0)).xyz - vec3(0.0, carHalf.y, 0.0);
  if (all(lessThan(abs(lp), carHalf))) wp = (carDelta * vec4(wp, 1.0)).xyz;
  vec4 pc = prevViewProj * vec4(wp, 1.0);
  vec2 vel = pc.w > 0.0 ? (uv - (pc.xy / pc.w * 0.5 + 0.5)) * strength : vec2(0.0);
  float len = length(vel * vec2(aspect, 1.0));
  if (len > maxBlur) vel *= maxBlur / len;
  if (len < 0.0004) {
    outputColor = inputColor;
    return;
  }
  vec3 acc = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES - 1) - 0.5;
    acc += texture2D(inputBuffer, uv - vel * t).rgb;
  }
  outputColor = vec4(acc / float(SAMPLES), inputColor.a);
}
`;

export type CarPose = { position: Vector3; heading: number };

const _q = new Quaternion();
const _y = new Vector3(0, 1, 0);
const _one = new Vector3(1, 1, 1);

export class MotionBlurEffect extends Effect {
  camera: PerspectiveCamera;
  /** fraction of the per-frame motion that gets smeared (0.5 ~ a 180 degree shutter) */
  strength = 0.45;
  /** longest smear, in screen heights */
  maxBlur = 0.025;
  /** camera jump (metres) or turn (radians) in one frame that counts as a cut */
  cutDistance = 2.5;
  cutAngle = 0.35;
  private car: CarPose;
  private prevViewProj = new Matrix4();
  private prevCar = new Matrix4();
  private prevPos = new Vector3();
  private prevDir = new Vector3();
  private hasPrev = false;
  private viewProj = new Matrix4();
  private carMatrix = new Matrix4();
  private pos = new Vector3();
  private dir = new Vector3();

  constructor(camera: PerspectiveCamera, car: CarPose, samples = 8) {
    super('MotionBlurEffect', fragment, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      defines: new Map([['SAMPLES', String(Math.max(2, Math.round(samples)))]]),
      uniforms: new Map<string, Uniform>([
        ['invViewProj', new Uniform(new Matrix4())],
        ['prevViewProj', new Uniform(new Matrix4())],
        ['carInverse', new Uniform(new Matrix4())],
        ['carDelta', new Uniform(new Matrix4())],
        ['carHalf', new Uniform(new Vector3(1.12, 0.78, 2.5))],
        ['strength', new Uniform(0)],
        ['maxBlur', new Uniform(0.025)],
      ]),
    });
    this.camera = camera;
    this.car = car;
  }

  update() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.carMatrix.compose(this.car.position, _q.setFromAxisAngle(_y, this.car.heading), _one);
    cam.getWorldPosition(this.pos);
    cam.getWorldDirection(this.dir);

    const u = this.uniforms;
    (u.get('invViewProj')!.value as Matrix4).copy(cam.matrixWorld).multiply(cam.projectionMatrixInverse);
    const carInverse = (u.get('carInverse')!.value as Matrix4).copy(this.carMatrix).invert();
    const cut =
      !this.hasPrev ||
      this.pos.distanceTo(this.prevPos) > this.cutDistance ||
      this.dir.angleTo(this.prevDir) > this.cutAngle;
    if (cut) {
      this.prevViewProj.copy(this.viewProj);
      this.prevCar.copy(this.carMatrix);
    }
    (u.get('prevViewProj')!.value as Matrix4).copy(this.prevViewProj);
    (u.get('carDelta')!.value as Matrix4).copy(this.prevCar).multiply(carInverse);
    u.get('strength')!.value = cut ? 0 : this.strength;
    u.get('maxBlur')!.value = this.maxBlur;

    this.prevViewProj.copy(this.viewProj);
    this.prevCar.copy(this.carMatrix);
    this.prevPos.copy(this.pos);
    this.prevDir.copy(this.dir);
    this.hasPrev = true;
  }
}
