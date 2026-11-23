import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { Env } from '@/lib/chapters';

/**
 * A daylight environment map for chapters IV and V, generated once from a gradient sky
 * with a low sun (the night HDRI can't be relit into a morning). Scene swaps
 * scene.environment over to it under the smoke at the start of chapter IV.
 */
export function createDayEnvironment(gl: WebGLRenderer, env: Env, sunDir: Vector3): Texture {
  const material = new ShaderMaterial({
    uniforms: {
      uTop: { value: new Color(env.skyTop) },
      uHorizon: { value: new Color(env.skyHorizon) },
      uGlow: { value: new Color(env.skyGlow) },
      uGround: { value: new Color('#3d3a36') },
      uSun: { value: new Color(env.sun).multiplyScalar(40) },
      uSunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uGround;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
        float s = max(dot(d, uSunDir), 0.0);
        sky += uGlow * pow(s, 6.0) * 0.8 * (1.0 - smoothstep(0.0, 0.6, h));
        sky += uSun * pow(s, 900.0);
        vec3 ground = mix(uGround, uHorizon * 0.5, pow(1.0 - min(-h, 1.0), 6.0));
        gl_FragColor = vec4(h >= 0.0 ? sky : ground, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
  });
  const scene = new Scene();
  const sphere = new Mesh(new SphereGeometry(10, 48, 24), material);
  scene.add(sphere);
  const pmrem = new PMREMGenerator(gl);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  material.dispose();
  sphere.geometry.dispose();
  return target.texture;
}
