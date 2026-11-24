import {
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  type Scene,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * WET-STREET REFLECTION
 * =====================
 * One planar reflection for the whole city: the scene is rendered once per frame from a
 * camera mirrored about a horizontal plane, and every wet, up-facing city surface near
 * that plane (roads, pavements, the sea) samples it in projective texture space (see
 * cityMaterials.ts). The plane follows the road under the car, so the street around the
 * camera reflects correctly on a city that climbs 30 m; on the bridge it drops to sea level.
 *
 * Adapted from three's Reflector (mirrored camera + Lengyel's oblique near plane).
 */

/** Shared by every patched city material (same objects, so one write updates all). */
export const reflectionUniforms = {
  uReflMap: { value: null as unknown as import('three').Texture },
  uReflMatrix: { value: new Matrix4() },
  uReflPlaneY: { value: 0 },
  /** The mirror plane: a point on it and its normal (it follows the road under the car, tilted with it). */
  uReflPoint: { value: new Vector3() },
  uReflNormal: { value: new Vector3(0, 1, 0) },
  /** 0 = off (mobile, or while rendering the reflection itself). */
  uReflOn: { value: 0 },
};

const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;
reflectionUniforms.uReflMap.value = black;

const mirror = new PerspectiveCamera();
// the city's own layer (City.tsx CITY_LAYER) and the sky: never the car or the rain
mirror.layers.set(3);
const plane = new Plane();
const clipPlane = new Vector4();
const q = new Vector4();
const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const camPos = new Vector3();
const lookAt = new Vector3();
const target = new Vector3();
const normal = new Vector3(0, 1, 0);
const onPlane = new Vector3();
const rot = new Matrix4();
const view = new Vector3();

let rt: WebGLRenderTarget | null = null;

/**
 * Renders the mirrored view into the shared texture. `scale` = fraction of the canvas width.
 * The mirror is the plane through `point` with `up` as its normal: the road under the car,
 * tilted with it (on a climb a level mirror reflects the street from the wrong height, and
 * the reflections seem to hover over it), or the sea.
 */
export function renderReflection(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, point: Vector3, up: Vector3, scale: number, far: number) {
  const w = Math.max(64, Math.round(gl.domElement.width * scale));
  const h = Math.max(64, Math.round(gl.domElement.height * scale));
  if (!rt) {
    rt = new WebGLRenderTarget(w, h, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });
    rt.texture.generateMipmaps = false;
  } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

  normal.copy(up).normalize();
  camera.getWorldPosition(camPos);
  const above = view.subVectors(camPos, point).dot(normal);
  if (above < 0.05) {
    // under the mirror (never on screen, but keep it sane)
    reflectionUniforms.uReflOn.value = 0;
    return;
  }
  // the camera's foot on the mirror
  onPlane.copy(camPos).addScaledVector(normal, -above);

  // mirrored position and target
  view.subVectors(onPlane, camPos).reflect(normal).negate().add(onPlane);
  rot.extractRotation(camera.matrixWorld);
  lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
  target.subVectors(onPlane, lookAt).reflect(normal).negate().add(onPlane);

  mirror.position.copy(view);
  mirror.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
  mirror.lookAt(target);
  mirror.far = far;
  mirror.near = camera.near;
  mirror.updateMatrixWorld();
  mirror.projectionMatrix.copy(camera.projectionMatrix);
  mirror.projectionMatrix.elements[8] *= -1;
  mirror.projectionMatrix.elements[12] *= -1;
  // world -> reflection texture space (before the oblique clip below changes the projection)
  reflectionUniforms.uReflMatrix.value.copy(bias).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

  // oblique near plane: nothing below the mirror ends up in the reflection
  plane.setFromNormalAndCoplanarPoint(normal, onPlane);
  plane.applyMatrix4(mirror.matrixWorldInverse);
  clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const pm = mirror.projectionMatrix;
  q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
  q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
  q.z = -1;
  q.w = (1 + pm.elements[10]) / pm.elements[14];
  clipPlane.multiplyScalar(2 / clipPlane.dot(q));
  pm.elements[2] = clipPlane.x;
  pm.elements[6] = clipPlane.y;
  pm.elements[10] = clipPlane.z + 1 - 0.003;
  pm.elements[14] = clipPlane.w;
  mirror.projectionMatrixInverse.copy(pm).invert();

  // the city must not sample the texture it is being drawn into
  reflectionUniforms.uReflOn.value = 0;
  reflectionUniforms.uReflMap.value = black;
  const prev = gl.getRenderTarget();
  const prevXr = gl.xr.enabled;
  gl.xr.enabled = false;
  gl.setRenderTarget(rt);
  gl.state.buffers.depth.setMask(true);
  gl.clear();
  gl.render(scene, mirror);
  gl.setRenderTarget(prev);
  gl.xr.enabled = prevXr;

  reflectionUniforms.uReflMap.value = rt.texture;
  reflectionUniforms.uReflPlaneY.value = point.y;
  reflectionUniforms.uReflPoint.value.copy(point);
  reflectionUniforms.uReflNormal.value.copy(normal);
  reflectionUniforms.uReflOn.value = 1;
}

export function disposeReflection() {
  rt?.dispose();
  rt = null;
}
