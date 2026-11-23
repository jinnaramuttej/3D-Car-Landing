import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/** Deterministic PRNG so the textures look the same on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/**
 * Billowy smoke puff: fBm noise thresholded into lumps, under a radial falloff.
 * White RGB with a little self-shadowing in the dense parts; the shape lives in alpha.
 */
export function createSmokeTexture(size = 256) {
  const [c, g] = canvas(size);
  const n = fbm(size, 3, 5, 21);
  const img = g.createImageData(size, size);
  const half = size / 2;
  const sstep = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half; // 0 centre .. 1 edge
      // Noise thresholded against the radius: dense core, cauliflower edge.
      const density = n[i] + (1 - r) * 0.95 - 0.72;
      const a = sstep(0, 0.38, density) * sstep(1, 0.82, r);
      const shade = 0.72 + 0.28 * sstep(0.1, 0.6, density); // thin wisps darker, cores brighter
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255 * shade;
      img.data[i * 4 + 3] = 255 * a;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Elliptical contact shadow for under the car (long axis along V). */
export function createBlobShadowTexture() {
  const [c, g] = canvas(128, 256);
  g.translate(64, 128);
  g.scale(0.5, 1);
  const grd = g.createRadialGradient(0, 0, 10, 0, 0, 128);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(-128, -128, 256, 256);
  return new CanvasTexture(c);
}

/** Warm radial pool of light, used additively under the lamp posts. */
export function createGlowTexture() {
  const [c, g] = canvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Red/white kerb stripes along V. */
export function createKerbTexture() {
  const [c, g] = canvas(4, 64);
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, 4, 32);
  g.fillStyle = '#e8e8e8';
  g.fillRect(0, 32, 4, 32);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = NearestFilter;
  return tex;
}

/** Lane dash along V: 1/3 painted, 2/3 gap (use with alphaTest). */
export function createDashTexture() {
  const [c, g] = canvas(4, 48);
  g.clearRect(0, 0, 4, 48);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 4, 16);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** Tileable wave normal map for the sea. */
export function createWaveNormalTexture() {
  const size = 256;
  const h = fbm(size, 8, 4, 17);
  const data = new Uint8Array(size * size * 4);
  const strength = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength;
      const ny = (u - d) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = (nx / len) * 127.5 + 127.5;
      data[i + 1] = (ny / len) * 127.5 + 127.5;
      data[i + 2] = (1 / len) * 127.5 + 127.5;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size);
}

/** Tileable value noise, fBm, values 0..1. */
function fbm(size: number, baseCells: number, octaves: number, seed: number) {
  const out = new Float32Array(size * size);
  const rnd = mulberry32(seed);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells).map(() => rnd());
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const iy = Math.floor(gy);
      const fy = gy - iy;
      const sy = fy * fy * (3 - 2 * fy);
      const y0 = iy % cells;
      const y1 = (iy + 1) % cells;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const ix = Math.floor(gx);
        const fx = gx - ix;
        const sx = fx * fx * (3 - 2 * fx);
        const x0 = ix % cells;
        const x1 = (ix + 1) % cells;
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0];
        const d = grid[y1 * cells + x1];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function dataTexture(data: Uint8Array, size: number) {
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Asphalt maps.
 * - normal: fine grain, meant to repeat every few metres.
 * - roughness: big blotches (puddles are smooth = sharp reflections), repeats rarely.
 */
export function createAsphaltTextures() {
  const size = 256;

  // Fine grain -> normal map (central differences on a noisy height field)
  const h = fbm(size, 64, 2, 3);
  const rnd = mulberry32(5);
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.6 + rnd() * 0.4;
  const normal = new Uint8Array(size * size * 4);
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i + 2] = (nz * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }

  // Puddles -> roughness (green channel is what three samples). It's raining: lots of
  // standing water (mirror-smooth) with damp, slightly rough asphalt in between.
  const w = fbm(size, 4, 5, 9);
  const rough = new Uint8Array(size * size * 4);
  for (let i = 0; i < w.length; i++) {
    const wet = Math.min(1, Math.max(0, (w[i] - 0.36) / 0.18)); // 0 damp .. 1 puddle
    const v = (0.78 - wet * 0.7) * 255;
    rough[i * 4] = v;
    rough[i * 4 + 1] = v;
    rough[i * 4 + 2] = v;
    rough[i * 4 + 3] = 255;
  }

  return { normal: dataTexture(normal, size), roughness: dataTexture(rough, size) };
}
