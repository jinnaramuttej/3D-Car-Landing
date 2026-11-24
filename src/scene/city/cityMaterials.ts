import type { Material, MeshStandardMaterial, Object3D, WebGLProgramParametersWithUniforms } from 'three';
import { Mesh } from 'three';
import { reflectionUniforms } from './cityReflection';

/**
 * THE CITY AT NIGHT, IN THE RAIN
 * ==============================
 * The model's materials are daylight PBR. scripts/optimize-city.mjs tags each one with a
 * kind ("road:", "window:", "sign:" ...), and this patches them in place (onBeforeCompile,
 * one program per kind):
 *
 *   everything   darker at night (uNight), wet: up-facing surfaces darken, get smoother and
 *                pool into puddles (world-space noise), and pick up the street reflection
 *                (cityReflection.ts) near the reflection plane, with a Fresnel falloff
 *   road         more and bigger puddles than pavements and roofs
 *   window       lit windows: a floor-by-bay grid in world space on vertical faces, about a
 *                third of them on, warm or cool, brighter where the texture is glass-dark
 *   sign         the texture itself glows (shop fronts, neon), with a slow flicker
 *   ledpalm/tree the generated LED textures: the bright dots glow
 *   metal        lamp posts and bollards: smoother, a little metallic
 */

export const cityUniforms = {
  uTime: { value: 0 },
  /** 0 dry .. 1 soaked (chapter env `wet`). */
  uWet: { value: 1 },
  /** Lit windows, signs and LEDs (chapter env `city`: dims as the sun comes up). */
  uCity: { value: 1 },
  /** Albedo multiplier: dark at night, back toward 1 at dawn. */
  uNight: { value: 0.45 },
  uPuddles: { value: 1 },
  uWindowGlow: { value: 2.2 },
  uSignGlow: { value: 2.4 },
  uLedGlow: { value: 5 },
  uReflStrength: { value: 1 },
  ...reflectionUniforms,
};

const KINDS = ['road', 'ground', 'window', 'sign', 'metal', 'foliage', 'ledpalm', 'ledtree', 'plain'] as const;
export type CityKind = (typeof KINDS)[number];

export const kindOf = (m: Material): CityKind => {
  const k = m.name.split(':')[0] as CityKind;
  return KINDS.includes(k) ? k : 'plain';
};

const vertPars = /* glsl */ `
varying vec3 vCityPos;
varying vec3 vCityNormal;
`;

const vertMain = /* glsl */ `
{
  vec4 cityWP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cityWP = instanceMatrix * cityWP;
  #endif
  vCityPos = (modelMatrix * cityWP).xyz;
  vCityNormal = normalize(mat3(modelMatrix) * objectNormal);
}
`;

const fragPars = /* glsl */ `
uniform float uTime;
uniform float uWet;
uniform float uCity;
uniform float uNight;
uniform float uPuddles;
uniform float uWindowGlow;
uniform float uSignGlow;
uniform float uLedGlow;
uniform float uReflStrength;
uniform float uReflOn;
uniform float uReflPlaneY;
uniform sampler2D uReflMap;
uniform mat4 uReflMatrix;
varying vec3 vCityPos;
varying vec3 vCityNormal;

float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cityNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cityHash(i), cityHash(i + vec2(1.0, 0.0)), u.x), mix(cityHash(i + vec2(0.0, 1.0)), cityHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const fragMain = /* glsl */ `
{
  vec3 cn = normalize(vCityNormal);
  vec3 albedo = diffuseColor.rgb;
  float luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722));

  #ifdef CITY_SIGN
    float flick = 0.86 + 0.14 * sin(uTime * 2.3 + cityHash(floor(vCityPos.xz / 6.0)) * 40.0);
    totalEmissiveRadiance += albedo * uSignGlow * uCity * flick;
  #endif

  #ifdef CITY_LED
    totalEmissiveRadiance += albedo * smoothstep(0.3, 0.75, luma) * uLedGlow * uCity;
  #endif

  #ifdef CITY_WINDOW
    if (abs(cn.y) < 0.35) {
      vec2 t2 = normalize(vec2(-cn.z, cn.x) + 1e-5);
      float h = dot(vCityPos.xz, t2);
      vec2 cell = vec2(floor(h / 3.6), floor(vCityPos.y / 3.3));
      vec2 f = vec2(fract(h / 3.6), fract(vCityPos.y / 3.3));
      float win = smoothstep(0.14, 0.18, f.x) * smoothstep(0.86, 0.82, f.x) * smoothstep(0.2, 0.25, f.y) * smoothstep(0.88, 0.84, f.y);
      // one seed per facade plane, per window
      float facade = floor(dot(vCityPos.xz, cn.xz) * 0.25);
      float seed = cityHash(cell + vec2(facade * 7.13, facade * 3.71) + cn.xz * 31.0);
      // whole floors go dark together now and then; a quarter of the rest are lit
      float floorOn = step(0.28, cityHash(vec2(cell.y, facade * 1.3)));
      float lit = step(seed, 0.26) * floorOn;
      float tone = cityHash(cell * 1.7 + facade);
      vec3 tint = tone < 0.62 ? vec3(1.0, 0.66, 0.36) : tone < 0.88 ? vec3(1.0, 0.86, 0.66) : vec3(0.7, 0.82, 1.0);
      float glass = 1.0 - smoothstep(0.3, 0.75, luma);
      float level = 0.25 + 0.9 * pow(cityHash(cell * 3.1 + facade), 2.0);
      totalEmissiveRadiance += win * lit * tint * level * (0.4 + 0.6 * glass) * uWindowGlow * uCity;
    }
  #endif

  // night: everything that is not a light source is darker
  diffuseColor.rgb *= uNight;

  #ifndef CITY_LED
  float up = smoothstep(0.55, 0.85, cn.y);
  if (up > 0.0) {
    // rain: darker, smoother, and pooled into puddles
    float nz = cityNoise(vCityPos.xz * 0.11) * 0.65 + cityNoise(vCityPos.xz * 0.47) * 0.35;
    #ifdef CITY_ROAD
      float puddle = smoothstep(0.5, 0.58, nz) * uPuddles;
    #else
      float puddle = smoothstep(0.62, 0.7, nz) * uPuddles * 0.6;
    #endif
    float wet = uWet * up;
    diffuseColor.rgb *= mix(1.0, 0.55, wet) * mix(1.0, 0.55, puddle * wet);
    roughnessFactor = mix(roughnessFactor, mix(0.3, 0.04, puddle), wet);

    // the street reflected in the wet surface (only near the mirror's plane)
    float nearPlane = 1.0 - smoothstep(0.35, 1.4, abs(vCityPos.y - uReflPlaneY));
    float k = uReflOn * wet * nearPlane * mix(0.25, 1.0, puddle) * uReflStrength;
    if (k > 0.001) {
      vec4 rc = uReflMatrix * vec4(vCityPos, 1.0);
      vec2 ruv = rc.xy / rc.w;
      vec2 jit = (vec2(cityNoise(vCityPos.xz * 2.7 + uTime * 1.3), cityNoise(vCityPos.zx * 2.7 - uTime * 1.1)) - 0.5) * mix(0.014, 0.004, puddle);
      vec3 r = texture2D(uReflMap, ruv + jit).rgb + texture2D(uReflMap, ruv + jit * 1.8 + vec2(0.0, 0.005)).rgb;
      vec3 V = normalize(cameraPosition - vCityPos);
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(V, cn), 0.0), 5.0);
      totalEmissiveRadiance += r * 0.5 * k * mix(0.3, 1.0, fres);
    }
  }
  #endif
}
`;

const DEFINE: Partial<Record<CityKind, string>> = {
  road: 'CITY_ROAD',
  window: 'CITY_WINDOW',
  sign: 'CITY_SIGN',
  ledpalm: 'CITY_LED',
  ledtree: 'CITY_LED',
};

/** Patches one material in place for its kind. */
export function patchCityMaterial(mat: MeshStandardMaterial) {
  const kind = kindOf(mat);
  if (mat.userData.cityPatched) return kind;
  mat.userData.cityPatched = true;
  const def = DEFINE[kind];
  if (def) mat.defines = { ...(mat.defines ?? {}), [def]: '' };
  if (kind === 'metal') {
    mat.roughness = 0.35;
    mat.metalness = 0.7;
  }
  if (kind === 'road' || kind === 'ground') mat.metalness = 0;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertPars}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${vertMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragPars}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${fragMain}`);
  };
  mat.customProgramCacheKey = () => `city-${kind}`;
  mat.needsUpdate = true;
  return kind;
}

/** Patches every material under `root`; returns them with their kinds. */
export function patchCity(root: Object3D) {
  const out: { mat: MeshStandardMaterial; kind: CityKind }[] = [];
  const seen = new Set<Material>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as MeshStandardMaterial[];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push({ mat: m, kind: patchCityMaterial(m) });
    }
  });
  return out;
}
