import { LookupTexture } from 'postprocessing';

/**
 * A teal/orange film grade baked into a 3D LUT (32^3), applied after tone mapping on
 * display (sRGB) values:
 *   - cool, slightly teal shadows and warm highlights (split toning)
 *   - blues and cyans pulled toward teal, reds and yellows toward orange
 *   - greens muted, a gentle S-curve, and a tiny lift of the blacks
 */
export function createTealOrangeLut(size = 32) {
  const lut = LookupTexture.createNeutral(size);
  const data = lut.image.data as Float32Array;
  const hsv = [0, 0, 0];
  const rgb = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // hue moves
    rgbToHsv(r, g, b, hsv);
    let [h, s, v] = hsv;
    const deg = h * 360;
    const wTeal = bell(deg, 205, 45);
    const wOrange = bell(deg, 32, 32) + bell(deg, 392, 32);
    const wGreen = bell(deg, 110, 40);
    const tealTarget = 188;
    const orangeTarget = deg > 200 ? 390 : 30;
    let nd = deg + (tealTarget - deg) * wTeal * 0.45 + (orangeTarget - deg) * wOrange * 0.35;
    nd = ((nd % 360) + 360) % 360;
    h = nd / 360;
    s = Math.min(1, s * (1 + 0.12 * wOrange + 0.08 * wTeal - 0.35 * wGreen));
    hsvToRgb(h, s, v, rgb);
    [r, g, b] = rgb;

    // split toning by luma
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = (1 - l) * (1 - l);
    const hi = l * l;
    r += -0.035 * sh + 0.045 * hi;
    g += 0.012 * sh + 0.012 * hi;
    b += 0.035 * sh - 0.045 * hi;

    // gentle S-curve and lifted blacks
    r = curve(r);
    g = curve(g);
    b = curve(b);
    data[i] = clamp01(0.012 + r * 0.988);
    data[i + 1] = clamp01(0.014 + g * 0.986);
    data[i + 2] = clamp01(0.018 + b * 0.982);
  }
  lut.needsUpdate = true;
  lut.name = 'teal-orange';
  return lut;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const bell = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) * (x - mu)) / (2 * sigma * sigma));
function curve(x: number) {
  const c = clamp01(x);
  const s = c * c * (3 - 2 * c);
  return c + (s - c) * 0.22;
}

function rgbToHsv(r: number, g: number, b: number, out: number[]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  out[0] = h;
  out[1] = max > 1e-6 ? d / max : 0;
  out[2] = max;
}

function hsvToRgb(h: number, s: number, v: number, out: number[]) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const k = ((i % 6) + 6) % 6;
  const table = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][k];
  out[0] = table[0];
  out[1] = table[1];
  out[2] = table[2];
}
