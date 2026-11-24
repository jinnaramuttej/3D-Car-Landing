import { engineLoop, ENGINE_RPMS, pop, rainBed, starter, tyreSqueal, whoosh, wind } from './audio/synth';
import { ignite as igniteModel, powertrain } from './powertrain';

/**
 * THE SOUND
 * =========
 * Sample-based, but every sample is generated in code (src/lib/audio/synth.ts) the first
 * time the visitor turns the sound on (that click is also the browser's audio unlock).
 *
 *   engine   18 loops (9 rpm points x on-throttle / lift-off), all running, mixed by
 *            weight: neighbouring rpm points crossfade with equal-power curves in the
 *            middle of each interval, on/off throttle with an equal-power curve on the
 *            throttle. Each loop's pitch follows the rpm but stays within +-15% of the
 *            rpm it was made at. Pops on lift and on every upshift.
 *   tyres    squeal on the slip angle
 *   wind     on speed
 *   rain     a bed that ducks under the engine
 *   bridge   a whoosh past every stay cable, a bigger one past each pylon
 *   DKMS     a soft heartbeat at that stop, with everything else turned down
 *   master   compressor, then the mute
 *
 * It reads the powertrain model (src/lib/powertrain.ts: rpm, throttle, load, shifts,
 * lifts) and the scene's own state (slip, speed, rain, where the car is), never the
 * scroll position or the keys.
 */

const MASTER = 0.7;
const PITCH_RANGE = 0.15;

export type SoundInput = {
  /** 0..1 rain level of the chapter. */
  rain: number;
  /** 0..1 how much the DKMS stop is on screen (quiet, heartbeat). */
  quiet: number;
  /** 0..1 heartbeat envelope at the DKMS stop (a beat starts when it rises past 0.5). */
  heartbeat: number;
  /** Whoosh events since the last frame: 0 none, 1 a cable, 2 a pylon. */
  whoosh: 0 | 1 | 2;
};

type Layer = { rpm: number; on: GainNode; off: GainNode; srcOn: AudioBufferSourceNode; srcOff: AudioBufferSourceNode };
type Loop = { src: AudioBufferSourceNode; gain: GainNode };

class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private engineTone: BiquadFilterNode | null = null;
  private layers: Layer[] = [];
  private squeal: Loop | null = null;
  private wind: Loop | null = null;
  private windTone: BiquadFilterNode | null = null;
  private rain: Loop | null = null;
  private buffers: { pop?: AudioBuffer; whoosh?: AudioBuffer; starter?: AudioBuffer } = {};
  private muted = true;
  private building = false;
  private ready = false;
  private seen = { shifts: 0, lifts: 0 };
  private beatHigh = false;

  private context() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.18;
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(comp).connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from the click that turns sound on (autoplay rules); builds the samples once. */
  setMuted(muted: boolean) {
    this.muted = muted;
    const ctx = muted ? this.ctx : this.context();
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.08);
    if (!muted && !this.ready && !this.building) void this.build(ctx);
  }

  /** The key turns: the starter plays and the model catches. */
  ignite() {
    igniteModel();
    if (this.muted || !this.ctx || !this.buffers.starter) return;
    this.oneShot(this.buffers.starter, 0.6, 1);
  }

  private loop(ctx: AudioContext, data: Float32Array, out: AudioNode) {
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(out);
    src.start(ctx.currentTime + Math.random() * 0.05);
    return { src, gain };
  }

  private oneShot(buf: AudioBuffer, level: number, rate: number, delay = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(this.master!);
    src.start(ctx.currentTime + delay);
    src.onended = () => g.disconnect();
  }

  /** Generates every sample (yielding between buffers so a frame never stalls) and wires the mix. */
  private async build(ctx: AudioContext) {
    this.building = true;
    const sr = ctx.sampleRate;
    const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.7;
    tone.frequency.value = 2400;
    bus.connect(tone).connect(this.master!);
    this.engineBus = bus;
    this.engineTone = tone;
    for (const rpm of ENGINE_RPMS) {
      const on = this.loop(ctx, engineLoop(sr, rpm, 'on'), bus);
      const off = this.loop(ctx, engineLoop(sr, rpm, 'off'), bus);
      await yieldFrame();
      this.layers.push({ rpm, on: on.gain, off: off.gain, srcOn: on.src, srcOff: off.src });
    }
    this.squeal = this.loop(ctx, tyreSqueal(sr), this.master!);
    await yieldFrame();
    const wt = ctx.createBiquadFilter();
    wt.type = 'lowpass';
    wt.frequency.value = 400;
    wt.connect(this.master!);
    this.windTone = wt;
    this.wind = this.loop(ctx, wind(sr), wt);
    this.rain = this.loop(ctx, rainBed(sr), this.master!);
    await yieldFrame();
    const mk = (d: Float32Array) => {
      const b = ctx.createBuffer(1, d.length, sr);
      b.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
      return b;
    };
    this.buffers = { pop: mk(pop(sr)), whoosh: mk(whoosh(sr)), starter: mk(starter(sr)) };
    this.seen = { shifts: powertrain.shifts, lifts: powertrain.lifts };
    this.ready = true;
    this.building = false;
  }

  /** Once per frame (src/scene/Sound.tsx). */
  update(input: SoundInput) {
    if (!this.ready || !this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const p = powertrain;
    const set = (param: AudioParam, v: number, tau = 0.035) => param.setTargetAtTime(v, now, tau);

    // engine: weights over the rpm points (log scale), equal power, crossfading only in
    // the middle half of each interval so every loop stays inside +-15% of its pitch
    const rpm = Math.max(1, p.rpm);
    const pts = ENGINE_RPMS;
    let i = 0;
    while (i < pts.length - 2 && rpm > pts[i + 1]) i++;
    const x = Math.log(rpm / pts[i]) / Math.log(pts[i + 1] / pts[i]);
    const xf = Math.min(1, Math.max(0, (x - 0.25) / 0.5));
    const lowW = rpm <= pts[0] ? 1 : rpm >= pts[pts.length - 1] ? 0 : Math.cos((xf * Math.PI) / 2);
    const highW = rpm <= pts[0] ? 0 : rpm >= pts[pts.length - 1] ? 1 : Math.sin((xf * Math.PI) / 2);
    const thrOn = Math.sin((Math.min(1, p.throttle * 1.25) * Math.PI) / 2);
    const thrOff = Math.cos((Math.min(1, p.throttle * 1.25) * Math.PI) / 2);
    this.layers.forEach((l, k) => {
      const w = k === i ? lowW : k === i + 1 ? highW : 0;
      set(l.on.gain, w * thrOn);
      set(l.off.gain, w * thrOff);
      const rate = Math.min(1 + PITCH_RANGE, Math.max(1 - PITCH_RANGE, rpm / l.rpm));
      set(l.srcOn.playbackRate, rate, 0.02);
      set(l.srcOff.playbackRate, rate, 0.02);
    });
    const running = p.running ? 1 : 0;
    const quiet = 1 - 0.6 * input.quiet;
    const engineLevel = running * (0.32 + 0.68 * (0.35 + 0.65 * p.load)) * quiet;
    set(this.engineBus!.gain, engineLevel, 0.05);
    set(this.engineTone!.frequency, 900 + (p.rpm / 8600) * 5200 * (0.55 + 0.45 * p.throttle), 0.05);

    // pops: on a lift from high revs, and on every upshift
    if (p.lifts !== this.seen.lifts || p.shifts !== this.seen.shifts) {
      const n = p.shifts !== this.seen.shifts ? 1 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3);
      this.seen = { shifts: p.shifts, lifts: p.lifts };
      if (this.buffers.pop && p.rpm > 3000 && running) {
        for (let k = 0; k < n; k++) this.oneShot(this.buffers.pop, (0.35 + Math.random() * 0.35) * quiet, 0.8 + Math.random() * 0.5, k * (0.04 + Math.random() * 0.06));
      }
    }

    // tyres, wind, rain
    const slip = Math.max(0, (p.slip - 0.12) / 0.7);
    const squeal = Math.min(1, slip) * Math.min(1, p.speed / 6);
    set(this.squeal!.gain.gain, squeal * squeal * 0.55 * quiet, 0.06);
    set(this.squeal!.src.playbackRate, 0.92 + 0.16 * Math.min(1, slip), 0.08);
    const v = Math.min(1, p.speed / 70);
    set(this.wind!.gain.gain, v * v * 0.55, 0.15);
    set(this.windTone!.frequency, 260 + p.speed * 34, 0.15);
    // the rain bed sits under the engine (sidechain-style duck)
    set(this.rain!.gain.gain, input.rain * 0.32 * (1 - 0.55 * Math.min(1, engineLevel)), 0.2);

    // bridge whooshes
    if (input.whoosh && this.buffers.whoosh) this.oneShot(this.buffers.whoosh, input.whoosh === 2 ? 0.75 : 0.28 + Math.random() * 0.12, 0.85 + Math.random() * 0.3 + (p.speed / 120) * 0.4);

    // DKMS: a soft heartbeat (lub-dub) when the stop is on screen
    const beat = input.heartbeat > 0.5;
    if (beat && !this.beatHigh && input.quiet > 0.5) this.thump(now, 0.3 * input.quiet);
    this.beatHigh = beat;
  }

  private thump(at: number, level: number) {
    const ctx = this.ctx!;
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
  }
}

export const engine = new EngineAudio();
