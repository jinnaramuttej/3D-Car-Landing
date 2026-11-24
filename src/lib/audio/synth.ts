/**
 * GENERATED SAMPLES
 * =================
 * Every sound in the site is made here, in code, when the visitor first turns the sound
 * on: no recordings, so nothing to license (they are part of this repository's code).
 * README "Sound" lists each one.
 *
 *   engine loops   flat-six exhaust, 9 rpm points x on-throttle / lift-off. Each loop is
 *                  a train of firing pulses (3 per crank turn) through the same exhaust
 *                  resonances, so the timbre stays put while the pitch follows the rpm;
 *                  on-throttle is harder and brighter with intake roar, lift-off softer
 *                  with overrun crackle. Loop lengths are whole firing cycles (seamless).
 *   tyre squeal    resonant noise with a slow wobble
 *   wind           low-passed noise with a rumble under it
 *   rain bed       pink-ish noise with drop ticks
 *   starter        the starter motor whining against compression
 *   pop            one overrun / shift crackle (played 1-3 times with random pitch)
 *   whoosh         a stay cable or pylon going past
 */

export const ENGINE_RPMS = [1000, 1300, 1700, 2200, 2850, 3700, 4800, 6250, 8100];

type Rng = () => number;
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exhaust resonances [Hz, decay s, gain] for each variant. */
const RES = {
  on: [
    [128, 0.018, 1.0],
    [305, 0.011, 0.72],
    [760, 0.0065, 0.46],
    [1820, 0.0035, 0.3],
    [3500, 0.0018, 0.15],
  ],
  off: [
    [112, 0.022, 0.85],
    [268, 0.013, 0.52],
    [640, 0.0065, 0.22],
    [1380, 0.003, 0.08],
  ],
} as const;

const templates = new Map<string, Float32Array[]>();

/** A few phase-shifted copies of one firing pulse through the resonances (cached). */
function pulseTemplates(sr: number, variant: 'on' | 'off', count = 4) {
  const key = `${sr}:${variant}`;
  const hit = templates.get(key);
  if (hit) return hit;
  const res = RES[variant];
  const len = Math.ceil(sr * 6 * res[0][1]);
  const r = rng(variant === 'on' ? 7 : 11);
  const out = Array.from({ length: count }, () => {
    const t = new Float32Array(len);
    for (const [f, decay, g] of res) {
      const ph = r() * Math.PI * 2;
      for (let i = 0; i < len; i++) {
        const s = i / sr;
        t[i] += g * Math.exp(-s / decay) * Math.sin(2 * Math.PI * f * s + ph);
      }
    }
    // a short attack, so a pulse doesn't click
    for (let i = 0; i < Math.min(len, 24); i++) t[i] *= i / 24;
    return t;
  });
  templates.set(key, out);
  return out;
}

function normalise(d: Float32Array, peak = 0.9, drive = 1.3) {
  let m = 1e-6;
  for (const v of d) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh((d[i] / m) * drive) * peak;
  return d;
}

/** One engine loop at `rpm`, seamless. */
export function engineLoop(sr: number, rpm: number, variant: 'on' | 'off') {
  const fire = (rpm / 60) * 3;
  const cycles = Math.max(12, Math.round(fire * 0.55));
  const n = Math.round((cycles / fire) * sr);
  const f = (cycles * sr) / n; // exact firing rate for a seamless loop
  const out = new Float32Array(n);
  const tpl = pulseTemplates(sr, variant);
  const r = rng(Math.round(rpm) * (variant === 'on' ? 3 : 5));
  const amps = Array.from({ length: cycles }, () => (variant === 'on' ? 1 + (r() - 0.5) * 0.24 : 0.55 + (r() - 0.5) * 0.5));
  const jit = Array.from({ length: cycles }, () => (r() - 0.5) * 0.04);
  for (let k = 0; k < cycles; k++) {
    const t0 = Math.round(((k + jit[k]) / f) * sr);
    const p = tpl[k % tpl.length];
    const a = amps[k];
    for (let i = 0; i < p.length; i++) out[(t0 + i + n) % n] += p[i] * a;
  }
  // order-1.5 boxer warble and a sub thump at the firing rate
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    out[i] += 0.18 * Math.sin(2 * Math.PI * f * s) + 0.1 * Math.sin(Math.PI * f * s + 0.7);
  }
  if (variant === 'on') {
    // intake roar: band-limited noise that breathes with the pulses
    let lp = 0;
    let hp = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      lp += (w - lp) * 0.35;
      hp = lp - hp * 0.94;
      out[i] += hp * 0.12 * (0.6 + 0.4 * Math.sin(2 * Math.PI * f * (i / sr)));
    }
  } else if (rpm > 2500) {
    // overrun crackle: a few sharp pops per second
    const pops = Math.round((n / sr) * (2 + rpm / 2000));
    for (let k = 0; k < pops; k++) {
      const t0 = Math.floor(r() * n);
      const a = 0.4 + r() * 0.5;
      for (let i = 0; i < 90; i++) out[(t0 + i) % n] += (r() * 2 - 1) * a * Math.exp(-i / 18);
    }
  }
  return normalise(out, 0.85, variant === 'on' ? 1.6 : 1.2);
}

/** Crossfades the end of a noise buffer into its start, so it loops without a seam. */
function seamless(d: Float32Array, sr: number, fade = 0.15) {
  const m = Math.floor(sr * fade);
  const out = d.slice(0, d.length - m);
  for (let i = 0; i < m; i++) {
    const w = i / m;
    out[i] = out[i] * w + d[d.length - m + i] * (1 - w);
  }
  return out;
}

/** Two-pole resonant band-pass, in place. */
function bandpass(d: Float32Array, sr: number, f: number | ((i: number) => number), q: number) {
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const fc = typeof f === 'number' ? f : f(i);
    const w = (2 * Math.PI * fc) / sr;
    const r = Math.exp(-w / (2 * q));
    const y = d[i] * (1 - r) + 2 * r * Math.cos(w) * y1 - r * r * y2;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
  return d;
}

export function tyreSqueal(sr: number) {
  const n = Math.round(sr * 2.15);
  const r = rng(31);
  const a = new Float32Array(n).map(() => r() * 2 - 1);
  const b = a.slice();
  const wob = (i: number) => 1 + 0.03 * Math.sin((2 * Math.PI * 5.5 * i) / sr) + 0.015 * Math.sin((2 * Math.PI * 1.3 * i) / sr);
  bandpass(a, sr, (i) => 1150 * wob(i), 28);
  bandpass(b, sr, (i) => 2320 * wob(i), 22);
  for (let i = 0; i < n; i++) a[i] = a[i] + b[i] * 0.45;
  return normalise(seamless(a, sr), 0.8, 1.4);
}

export function wind(sr: number) {
  const n = Math.round(sr * 3.2);
  const r = rng(41);
  const out = new Float32Array(n);
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.06;
    lp2 += (w - lp2) * 0.012;
    out[i] = lp * 0.8 + lp2 * 1.6;
  }
  return normalise(seamless(out, sr, 0.3), 0.8, 1);
}

export function rainBed(sr: number) {
  const n = Math.round(sr * 4.3);
  const r = rng(53);
  const out = new Float32Array(n);
  // pink-ish noise (three one-poles), brightened
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    a = 0.99765 * a + w * 0.099;
    b = 0.963 * b + w * 0.2965;
    c = 0.57 * c + w * 1.0526;
    out[i] = (a + b + c + w * 0.1848) * 0.11;
  }
  // drops: little resonant ticks
  const ticks = new Float32Array(n);
  for (let k = 0; k < n / sr * 90; k++) {
    const t0 = Math.floor(r() * n);
    const amp = 0.2 + r() * 0.8;
    for (let i = 0; i < 160; i++) ticks[(t0 + i) % n] += (r() * 2 - 1) * amp * Math.exp(-i / 28);
  }
  bandpass(ticks, sr, 4200, 3);
  for (let i = 0; i < n; i++) out[i] += ticks[i] * 0.6;
  return normalise(seamless(out, sr, 0.3), 0.7, 1);
}

export function starter(sr: number) {
  const n = Math.round(sr * 0.62);
  const out = new Float32Array(n);
  const r = rng(61);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    // the motor whine, and the engine thudding against compression ~8 times a second
    const whine = Math.sin(2 * Math.PI * (640 + 60 * Math.sin(s * 9)) * s) * 0.25;
    const comp = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 7.8 * s)), 6);
    out[i] = whine * (0.6 + 0.4 * comp) + comp * Math.sin(2 * Math.PI * 70 * s) * 0.9 + (r() - 0.5) * 0.06;
  }
  return normalise(out, 0.8, 1.2);
}

export function pop(sr: number) {
  const n = Math.round(sr * 0.09);
  const r = rng(71);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    out[i] = (r() * 2 - 1) * Math.exp(-s / 0.012) + Math.sin(2 * Math.PI * 95 * s) * Math.exp(-s / 0.03) * 1.2;
  }
  bandpass(out, sr, 900, 1.2);
  return normalise(out, 0.95, 1.8);
}

export function whoosh(sr: number) {
  const n = Math.round(sr * 0.7);
  const r = rng(83);
  const out = new Float32Array(n).map(() => r() * 2 - 1);
  bandpass(out, sr, (i) => 380 + 1400 * Math.sin((Math.PI * i) / n), 1.6);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    out[i] *= Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 2);
  }
  return normalise(out, 0.8, 1);
}
