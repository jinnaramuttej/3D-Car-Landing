/**
 * Synthesised flat-six (no audio files): sawtooth/square oscillators at the firing
 * frequency, band-passed noise for intake roar, soft-clipped and low-passed. RPM,
 * throttle and level follow a piecewise-linear script.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is created
 * the first time the visitor turns sound on (the navbar toggle). Muted by default.
 */

/** [seconds, rpm, throttle 0..1, level 0..1] */
type Point = readonly [number, number, number, number];

const MASTER = 0.55;

/** Two throttle blips on the line. */
const REV: Point[] = [
  [0, 950, 0.15, 1],
  [0.25, 950, 0.15, 1],
  [0.42, 7400, 1, 1],
  [0.55, 6800, 0.2, 1],
  [1.2, 1500, 0.1, 1],
  [1.45, 1300, 0.1, 1],
  [1.62, 7900, 1, 1],
  [1.75, 7300, 0.2, 1],
  [2.5, 1200, 0.1, 1],
  [3.2, 1000, 0.1, 0.8],
  [3.6, 950, 0.1, 0],
];

/** Launch through two shifts while the car pulls away (level drops with distance). */
const LAUNCH: Point[] = [
  [0, 3500, 0.6, 1],
  [0.15, 6200, 1, 1],
  [1.2, 8300, 1, 0.9],
  [1.28, 5900, 0.5, 0.85],
  [1.36, 6000, 1, 0.85],
  [2.6, 8400, 1, 0.55],
  [2.68, 6300, 0.5, 0.5],
  [2.76, 6400, 1, 0.48],
  [4.2, 8200, 1, 0.18],
  [5.2, 8000, 0.8, 0],
];

/** Starter, the engine catching, settling to idle (chapter II). */
const IGNITE: Point[] = [
  [0, 220, 0.25, 0.55],
  [0.45, 260, 0.25, 0.6],
  [0.55, 1900, 0.9, 1],
  [0.75, 1500, 0.4, 0.95],
  [1.4, 1000, 0.15, 0.85],
  [1.9, 950, 0.12, 0],
];

/** Flat-six four-stroke: three power pulses per crank revolution. */
const fireHz = (rpm: number) => (rpm / 60) * 3;

function softClip(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = true;
  private stopCurrent: (() => void) | null = null;
  /** The held-throttle voice (hold to rev): built on demand, pitch follows `rev`. */
  private live: {
    out: GainNode;
    lowpass: BiquadFilterNode;
    band: BiquadFilterNode;
    voices: { osc: OscillatorNode; mult: number }[];
    noise: AudioBufferSourceNode;
  } | null = null;

  private ensure() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER;
      master.connect(comp).connect(ctx.destination);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noise = noise;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a click handler the first time (autoplay rules). */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (!muted) this.ensure();
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, 0.05);
      if (muted) this.stopCurrent?.();
    }
    if (muted) this.setLive(false, 0);
  }

  rev() {
    this.play(REV);
  }

  ignite() {
    this.play(IGNITE);
  }

  /** One soft heartbeat (lub-dub): two low sine thumps, no engine involved. */
  heartbeat() {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.01;
    const thump = (at: number, level: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(g).connect(this.master!);
      osc.start(at);
      osc.stop(at + 0.25);
    };
    thump(t0, 0.32);
    thump(t0 + 0.28, 0.2);
  }

  /**
   * Hold-to-rev: `on` while the engine runs, `rev` 0..1 from the visitor. Idles quietly,
   * climbs to ~7800 rpm at full rev.
   */
  setLive(on: boolean, rev: number) {
    if (this.muted || !on) {
      if (this.live && this.ctx) {
        const live = this.live;
        this.live = null;
        const now = this.ctx.currentTime;
        live.out.gain.setTargetAtTime(0, now, 0.08);
        for (const v of live.voices) v.osc.stop(now + 0.5);
        live.noise.stop(now + 0.5);
        window.setTimeout(() => live.out.disconnect(), 700);
      }
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    if (!this.live) {
      const out = ctx.createGain();
      out.gain.value = 0;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.Q.value = 0.9;
      const shaper = ctx.createWaveShaper();
      shaper.curve = softClip(18);
      const pre = ctx.createGain();
      pre.gain.value = 0.6;
      pre.connect(shaper).connect(lowpass).connect(out).connect(this.master);
      const voices: { osc: OscillatorNode; mult: number }[] = [];
      for (const [type, mult, gain] of [
        ['sawtooth', 1, 0.5],
        ['square', 0.5, 0.35],
        ['sawtooth', 2, 0.18],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = fireHz(950) * mult;
        const g = ctx.createGain();
        g.gain.value = gain;
        osc.connect(g).connect(pre);
        osc.start();
        voices.push({ osc, mult });
      }
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise;
      noise.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      noise.connect(band).connect(ng).connect(pre);
      noise.start();
      this.live = { out, lowpass, band, voices, noise };
    }
    const now = ctx.currentTime;
    const rpm = 950 + rev * 6900;
    const live = this.live;
    for (const v of live.voices) v.osc.frequency.setTargetAtTime(fireHz(rpm) * v.mult, now, 0.06);
    live.lowpass.frequency.setTargetAtTime(300 + rpm * 0.55 * (0.6 + 0.4 * rev), now, 0.06);
    live.band.frequency.setTargetAtTime(180 + rpm * 0.12, now, 0.06);
    // quiet idle; a scripted clip (finale rev, launch) ducks it
    const level = (this.stopCurrent ? 0.25 : 1) * (0.1 + 0.9 * rev);
    live.out.gain.setTargetAtTime(level, now, 0.05);
  }

  launch() {
    this.play(LAUNCH);
  }

  private play(points: Point[]) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    this.stopCurrent?.();

    const t0 = ctx.currentTime + 0.02;
    const end = t0 + points[points.length - 1][0];

    const out = ctx.createGain();
    out.gain.value = 0;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0.9;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(18);
    shaper.oversample = '2x';
    const pre = ctx.createGain();
    pre.gain.value = 0.6;
    pre.connect(shaper).connect(lowpass).connect(out).connect(this.master);

    // Firing-frequency harmonics
    const voices: { osc: OscillatorNode; mult: number }[] = [];
    const voice = (type: OscillatorType, mult: number, gain: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(pre);
      voices.push({ osc, mult });
    };
    voice('sawtooth', 1, 0.5);
    voice('square', 0.5, 0.35);
    voice('sawtooth', 2, 0.18);
    voice('triangle', 3, 0.08);

    // Intake / exhaust roar
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.25;
    noise.connect(band).connect(noiseGain).connect(pre);

    const [, rpm0, thr0, lvl0] = points[0];
    for (const v of voices) v.osc.frequency.setValueAtTime(fireHz(rpm0) * v.mult, t0);
    lowpass.frequency.setValueAtTime((300 + rpm0 * 0.55) * (0.5 + 0.5 * lvl0), t0);
    band.frequency.setValueAtTime(180 + rpm0 * 0.12, t0);
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime((0.12 + 0.88 * thr0) * lvl0, t0 + 0.05);
    for (const [time, rpm, throttle, level] of points.slice(1)) {
      const at = t0 + time;
      for (const v of voices) v.osc.frequency.linearRampToValueAtTime(fireHz(rpm) * v.mult, at);
      lowpass.frequency.linearRampToValueAtTime((300 + rpm * 0.55 * (0.6 + 0.4 * throttle)) * (0.5 + 0.5 * level), at);
      band.frequency.linearRampToValueAtTime(180 + rpm * 0.12, at);
      out.gain.linearRampToValueAtTime((0.12 + 0.88 * throttle) * level, at);
    }

    const sources: AudioScheduledSourceNode[] = [...voices.map((v) => v.osc), noise];
    for (const s of sources) {
      s.start(t0);
      s.stop(end + 0.05);
    }
    const stop = () => {
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.04);
      for (const s of sources) {
        try {
          s.stop(now + 0.2);
        } catch {
          /* already stopped */
        }
      }
    };
    this.stopCurrent = stop;
    sources[0].onended = () => {
      out.disconnect();
      if (this.stopCurrent === stop) this.stopCurrent = null;
    };
  }
}

export const engine = new EngineAudio();
