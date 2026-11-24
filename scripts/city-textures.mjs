/**
 * Generated textures that replace images in the city model (see optimize-city.mjs).
 * Everything here is drawn from code as SVG and rasterised with sharp, so the output
 * carries no third-party imagery.
 *
 *   ledPalm   the palm atlas: bark on the top quarter (wrapped round the trunk) with a
 *             spiral LED strip, two fronds below drawn as dark leaflets lined with LEDs
 *   ledTree   the tree card: dark branches hung with fairy lights, and on the right
 *             eighth a dark panel strip with small lit slots (the model uses it as a facade)
 *   ledSign   shop-sign panels (stand-ins for the ad posters with faces and logos)
 */
import sharp from 'sharp';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svgToPng = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const f = (v) => v.toFixed(1);

/** LED dots along a line from (x0,y0) to (x1,y1). */
function dotLine(x0, y0, x1, y1, step, r, colors, rand) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.floor(len / step));
  let out = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = colors[Math.floor(rand() * colors.length)];
    out += `<circle cx="${f(x0 + (x1 - x0) * t)}" cy="${f(y0 + (y1 - y0) * t)}" r="${f(r * (0.8 + rand() * 0.4))}" fill="${c}"/>`;
  }
  return out;
}

/** A leaflet: a thin dark blade with LEDs down its centre. */
function leaflet(x0, y0, angle, length, width, rand, colors) {
  const x1 = x0 + Math.cos(angle) * length;
  const y1 = y0 + Math.sin(angle) * length;
  const nx = -Math.sin(angle) * width;
  const ny = Math.cos(angle) * width;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const blade = `<path d="M${f(x0)},${f(y0)} Q${f(mx + nx)},${f(my + ny)} ${f(x1)},${f(y1)} Q${f(mx - nx)},${f(my - ny)} ${f(x0)},${f(y0)} Z" fill="#0d1a12"/>`;
  return blade + dotLine(x0, y0, x1, y1, 9, 2.6, colors, rand);
}

/** 1024 x 1024, same layout as the image it replaces. */
export async function ledPalm() {
  const S = 1024;
  const rand = rng(11);
  const warm = ['#fff2c8', '#ffe39a', '#fff8e8'];
  const cool = ['#b8fff0', '#d8fff8', '#9cf7e0'];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">`;
  // bark (opaque, wraps round the trunk): dark rings and a spiral LED strip
  s += `<rect x="0" y="0" width="${S}" height="256" fill="#1c1611"/>`;
  for (let y = 8; y < 256; y += 22) s += `<rect x="0" y="${y}" width="${S}" height="9" fill="#2a2018" opacity="0.8"/>`;
  for (let k = -3; k < 8; k++) {
    const x0 = k * 160;
    s += dotLine(x0, 256, x0 + 256, 0, 12, 4, warm, rand);
  }
  // fan frond: leaflets radiating from (550, 640), stem from the left
  s += `<rect x="16" y="634" width="540" height="10" rx="5" fill="#0d1a12"/>`;
  s += dotLine(24, 639, 548, 639, 14, 3, cool, rand);
  // (kept inside the frond's own box, y 500-780, so the cards never show a neighbour)
  for (let i = 0; i < 22; i++) {
    const a = -0.3 + (0.6 * i) / 21 + (rand() - 0.5) * 0.04;
    const len = 330 + rand() * 90;
    s += leaflet(550, 640, a, len, 10, rand, cool);
  }
  for (let i = 0; i < 8; i++) {
    const a = Math.PI + (i < 4 ? -1 : 1) * (0.35 + (i % 4) * 0.1);
    s += leaflet(550, 640, a, 120 + rand() * 40, 8, rand, cool);
  }
  // feather frond: midrib along y = 893, leaflets angled back on both sides
  s += `<rect x="30" y="888" width="945" height="10" rx="5" fill="#0d1a12"/>`;
  s += dotLine(36, 893, 968, 893, 14, 3, warm, rand);
  for (let x = 150; x < 960; x += 30) {
    const taper = 1 - Math.abs((x - 560) / 520) ** 1.6;
    const len = 30 + 95 * Math.max(0.15, taper);
    s += leaflet(x, 893, -Math.PI + 0.9 + (rand() - 0.5) * 0.1, len, 7, rand, cool);
    s += leaflet(x, 893, Math.PI - 0.9 + (rand() - 0.5) * 0.1, len, 7, rand, cool);
  }
  s += '</svg>';
  return svgToPng(s);
}

/** 1024 x 1024: fairy-light branches on the left 7/8, a facade strip on the right. */
export async function ledTree() {
  const S = 1024;
  const rand = rng(23);
  const lights = ['#ffd27a', '#ffe7b0', '#fff4dc', '#ffc25a'];
  let branches = '';
  let dots = '';
  const grow = (x, y, angle, len, width, depth) => {
    const x1 = x + Math.cos(angle) * len;
    const y1 = y + Math.sin(angle) * len;
    branches += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x1)}" y2="${f(y1)}" stroke="#14100c" stroke-width="${f(width)}" stroke-linecap="round"/>`;
    if (depth < 5) dots += dotLine(x, y, x1, y1, 16 + depth * 2, 3.2, lights, rand);
    if (depth >= 6 || len < 18) {
      dots += `<circle cx="${f(x1)}" cy="${f(y1)}" r="4" fill="${lights[depth % lights.length]}"/>`;
      return;
    }
    const n = depth < 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * (0.55 + rand() * 0.25);
      grow(x1, y1, angle + spread + (rand() - 0.5) * 0.3, len * (0.68 + rand() * 0.12), width * 0.68, depth + 1);
    }
  };
  // trunk from the bottom centre; a few main limbs spread outwards
  grow(448, 1000, -Math.PI / 2, 210, 30, 0);
  for (const a of [-2.4, -0.75]) grow(448, 840, a, 170, 16, 1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">`;
  s += branches + dots;
  // right strip (x >= 896): dark panelling with small lit slots, opaque
  s += `<rect x="896" y="0" width="128" height="${S}" fill="#15171b"/>`;
  for (let y = 12; y < S; y += 46) {
    s += `<rect x="900" y="${y}" width="120" height="3" fill="#24272d"/>`;
    for (let x = 908; x < 1016; x += 26) if (rand() < 0.35) s += `<rect x="${x}" y="${y + 14}" width="14" height="18" fill="${rand() < 0.7 ? '#ffcf8a' : '#cfe6ff'}"/>`;
  }
  s += '</svg>';
  return svgToPng(s);
}

const SIGN_WORDS = ['OPEN', 'NOODLES', '24 HRS', 'TEA', 'RAMEN', 'HOTEL', 'BAR', 'MARKET', 'ARCADE', 'PHARMACY', 'DUMPLINGS', 'KARAOKE'];
const SIGN_COLORS = [
  ['#ff2a55', '#ffe0e8'],
  ['#25c6ff', '#e0f8ff'],
  ['#ffb020', '#fff3d6'],
  ['#7cff6b', '#eaffe4'],
  ['#c35bff', '#f4e6ff'],
  ['#ff6a2a', '#ffe9dc'],
];

/**
 * Shop-sign panels: framed boxes with one word each, in the colours of a lit sign.
 * `vertical` stacks the letters (narrow hanging signs).
 */
export async function ledSign(width, height, seed, { vertical = false, cols = 2, rows = 3 } = {}) {
  const rand = rng(seed);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#07080b"/>`;
  const cw = width / cols;
  const ch = height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [glow, core] = SIGN_COLORS[Math.floor(rand() * SIGN_COLORS.length)];
      const word = SIGN_WORDS[Math.floor(rand() * SIGN_WORDS.length)];
      const x = c * cw + 4;
      const y = r * ch + 4;
      const w = cw - 8;
      const h = ch - 8;
      s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="4" fill="#0c0d12" stroke="${glow}" stroke-width="3"/>`;
      if (vertical) {
        const letters = word.replace(/\s/g, '').slice(0, 6).split('');
        const fs = Math.min(w * 0.7, (h * 0.86) / letters.length);
        letters.forEach((l, i) => {
          s += `<text x="${f(x + w / 2)}" y="${f(y + h * 0.08 + fs * (i + 0.85))}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${f(fs)}" fill="${core}" stroke="${glow}" stroke-width="1.2" text-anchor="middle">${l}</text>`;
        });
      } else {
        const fs = Math.min(h * 0.45, (w * 1.12) / Math.max(3, word.length));
        s += `<text x="${f(x + w / 2)}" y="${f(y + h / 2 + fs * 0.36)}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${f(fs)}" fill="${core}" stroke="${glow}" stroke-width="1.4" text-anchor="middle">${word}</text>`;
      }
    }
  }
  s += '</svg>';
  return svgToPng(s);
}
