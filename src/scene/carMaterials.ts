import {
  type Material,
  MeshPhysicalMaterial,
  type MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { CONFIG } from '@/lib/config';

/**
 * The Sketchfab export flattened every material: metalness 0, roughness 0.958,
 * plain grey for anything without a texture. The livery was not embedded at all;
 * it ships next to the model as textures/decals.png (copied to /public/textures).
 * This file puts the look back.
 */

export const LIVERY_URL = '/textures/gt3r-livery-4k.jpg';
export const LIVERY_URL_MOBILE = '/textures/gt3r-livery.jpg';

const EXPORT_DEFAULT_ROUGHNESS = 0.9577;

type Fix = {
  test: RegExp;
  /** Only applied when the material has no base colour texture. */
  color?: string;
  metalness?: number;
  roughness?: number;
  /** Tag so Car can retint it live from CONFIG. */
  role?: 'rim' | 'caliper';
};

/** First match wins. Names come from the model's material list. */
const FIXES: Fix[] = [
  { test: /^EXT_RIM_BLUR/, roughness: 0.5, role: 'rim' }, // tinted with the rims so the blur matches
  { test: /^EXT_RIM/, metalness: 0.85, roughness: 0.32, role: 'rim' },
  { test: /^EXT_CALIPER/, metalness: 0.35, roughness: 0.35, role: 'caliper' },
  { test: /^EXT_Disc/, metalness: 0.85, roughness: 0.42 },
  { test: /Glass_Emissive/, metalness: 0, roughness: 0.05 },
  { test: /^MIRROR/, metalness: 1, roughness: 0.05 },
  { test: /carbon|kevlar/i, color: '#131417', metalness: 0.45, roughness: 0.36 },
  { test: /^EXT_EXALTS/, color: '#8a817a', metalness: 1, roughness: 0.28 },
  {
    test: /^EXT_(Mechanics|RADIATOR|TAMP_FUEL)|^INT_METAL_PARTS|^WorldGridMaterial/,
    color: '#2c2e33',
    metalness: 0.75,
    roughness: 0.45,
  },
  { test: /^EXT_(Details|Banner|Grid)/, metalness: 0.1, roughness: 0.45 },
  { test: /Emissive/, roughness: 0.2 },
  { test: /^(INT_|SEAT_|SPARCO_|STEER_|DISPLAY|LED_|PHISICS|BELT)/, color: '#16171a', metalness: 0, roughness: 0.75 },
];

export type MaterialRoles = { rims: MeshStandardMaterial[]; calipers: MeshStandardMaterial[] };

/** Restores PBR values in place. Idempotent, safe to run on shared materials twice. */
export function fixMaterial(mat: MeshStandardMaterial, roles: MaterialRoles) {
  const name = mat.name ?? '';
  const fix = FIXES.find((f) => f.test.test(name));
  if (fix) {
    if (fix.color && !mat.map) mat.color.set(fix.color);
    if (fix.metalness !== undefined) mat.metalness = fix.metalness;
    if (fix.roughness !== undefined) mat.roughness = fix.roughness;
    if (fix.role === 'rim' && !roles.rims.includes(mat)) roles.rims.push(mat);
    if (fix.role === 'caliper' && !roles.calipers.includes(mat)) roles.calipers.push(mat);
  } else if (Math.abs(mat.roughness - EXPORT_DEFAULT_ROUGHNESS) < 1e-3 && mat.metalness === 0) {
    mat.roughness = 0.6; // anything we didn't name: at least stop it looking like chalk
  }
}

/**
 * The livery atlas is mapped on UV0. Its V coordinates run 1..2 (an FBX quirk), so
 * the texture must repeat. Unlike the textures embedded in the glTF, this atlas is
 * stored the other way up, so keep flipY on (checked against the "E-TECK" door text).
 */
export function prepareLivery(tex: Texture, anisotropy: number) {
  tex.flipY = true;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Clear-coated race paint carrying the livery. Replaces EXT_Carpaint_Inst. */
export function createPaintMaterial(livery: Texture, source: Material) {
  const c = CONFIG.car;
  return new MeshPhysicalMaterial({
    name: 'GT3R_Paint',
    map: livery,
    color: '#ffffff',
    metalness: c.paintMetalness,
    roughness: c.paintRoughness,
    clearcoat: c.clearcoat,
    clearcoatRoughness: c.clearcoatRoughness,
    side: source.side,
  });
}

/**
 * Window glass. The model's window texture is almost fully transparent (faint
 * smudges only), so it's replaced by real glass: transmission with a slight tint.
 * `transmission = false` gives a cheap tinted transparent version (mobile, and the
 * inner glass layers, which would otherwise cost a second transmission render).
 */
export function createGlassMaterial(source: Material, transmission: boolean) {
  const c = CONFIG.car;
  return new MeshPhysicalMaterial({
    name: transmission ? 'GT3R_Glass' : 'GT3R_GlassCheap',
    color: c.glassTint,
    metalness: 0,
    roughness: c.glassRoughness,
    transmission: transmission ? 1 : 0,
    thickness: 0.02,
    ior: 1.5,
    specularIntensity: 1,
    transparent: !transmission,
    opacity: transmission ? 1 : 0.32,
    depthWrite: transmission,
    side: source.side,
  });
}

/** Tyres: dark rubber, low specular. Keeps the sidewall lettering texture. */
export function createTyreMaterial(source: MeshStandardMaterial) {
  const c = CONFIG.car;
  return new MeshPhysicalMaterial({
    name: 'GT3R_Tyre',
    map: source.map,
    color: c.tyreColor,
    metalness: 0,
    roughness: c.tyreRoughness,
    specularIntensity: c.tyreSpecular,
    side: source.side,
  });
}
