import { clamp, dbToGain, glide } from './math';
import type { BusName, GlobalDef } from '../types';

/**
 * Master chain and groups:
 *
 *   bed   -> duck --\
 *   fx    -> duck ---+-> sum -> peak compressor -> trim -> soft ceiling -> master volume -> destination
 *   voice ----------/
 *   reverb send -> convolver -> return --/
 *   early-reflection send -> short convolver -/
 *
 * Beds and fx dip gently while the voice is speaking (envelope follower on the voice group).
 */
export class Mixer {
  private readonly groups: Record<BusName, GainNode>;
  private readonly ducks: Record<'bed' | 'fx', GainNode>;
  readonly reverbInput: GainNode;
  private readonly reverbReturn: GainNode;
  private readonly convolver: ConvolverNode;
  /** The current acoustic space: its own reverb, crossfaded by setSpace(). */
  private spaceSlot: { conv: ConvolverNode; gain: GainNode } | null = null;
  private readonly reverbSum: GainNode;
  private readonly volume: GainNode;
  private readonly meter: AnalyserNode;
  private readonly meterBuf: Float32Array<ArrayBuffer>;
  private voiceEnv = 0;
  private lastDuck = 1;

  constructor(private readonly ctx: BaseAudioContext, private g: GlobalDef, destination: AudioNode) {
    const c = ctx;
    const sum = c.createGain();

    const lim = g.limiter;
    const comp = new DynamicsCompressorNode(c, {
      threshold: lim.thresholdDb,
      knee: lim.kneeDb,
      ratio: lim.ratio,
      attack: lim.attack,
      release: lim.release,
    });
    // Chromium's compressor adds automatic make-up gain; trim it back so the level stays gentle.
    const trim = c.createGain();
    trim.gain.value = dbToGain(lim.makeupTrimDb);
    const ceiling = new WaveShaperNode(c, { curve: softCeiling(lim.ceiling), oversample: '2x' });

    this.volume = c.createGain();
    this.volume.gain.value = g.masterLevel;
    sum.connect(comp).connect(trim).connect(ceiling).connect(this.volume).connect(destination);

    const mk = () => c.createGain();
    this.groups = { bed: mk(), fx: mk(), voice: mk() };
    this.ducks = { bed: mk(), fx: mk() };
    this.groups.bed.connect(this.ducks.bed).connect(sum);
    this.groups.fx.connect(this.ducks.fx).connect(sum);
    this.groups.voice.connect(sum);

    this.meter = c.createAnalyser();
    this.meter.fftSize = 1024;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.groups.voice.connect(this.meter);

    this.reverbInput = c.createGain();
    this.convolver = new ConvolverNode(c, { buffer: makeImpulse(c, g.reverb.seconds, g.reverb.preDelayMs, g.reverb.damping) });
    this.reverbReturn = c.createGain();
    this.reverbReturn.gain.value = g.reverb.returnLevel;
    this.reverbSum = c.createGain();
    this.reverbInput.connect(this.convolver).connect(this.reverbSum).connect(this.reverbReturn).connect(sum);

    // Early reflections: a few short, quiet echoes (like nearby walls). They help sounds,
    // especially frontal ones, feel outside the head rather than in the middle of it.
    this.erInput = c.createGain();
    const er = new ConvolverNode(c, { buffer: makeEarlyReflections(c), disableNormalization: true });
    this.erReturn = c.createGain();
    this.erReturn.gain.value = g.externalize.earlyReflections ? g.externalize.erLevel : 0;
    this.erInput.connect(er).connect(this.erReturn).connect(sum);
  }

  readonly erInput: GainNode;
  private readonly erReturn: GainNode;

  setEarlyReflections(on: boolean, sec = 0.5): void {
    glide(this.erReturn.gain, on ? this.g.externalize.erLevel : 0, this.ctx.currentTime, sec / 3);
  }

  input(bus: BusName): AudioNode {
    return this.groups[bus];
  }

  setMasterVolume(v: number, sec = 0.3): void {
    glide(this.volume.gain, clamp(v, 0, 1) * this.g.masterLevel, this.ctx.currentTime, sec / 3);
  }

  setBusLevel(bus: BusName, v: number, sec = 1): void {
    glide(this.groups[bus].gain, clamp(v, 0, 2), this.ctx.currentTime, sec / 3);
  }

  /** Use a real impulse response (e.g. from assets) instead of the generated one. */
  setImpulse(buf: AudioBuffer): void {
    this.convolver.buffer = buf;
  }

  /**
   * Move the listener into another acoustic space: a new reverb fades in while the old one fades out.
   * def.level is that space's reverb return (a roof has very little, a stairwell a lot).
   */
  setSpace(def: SpaceDef, sec = 2): void {
    const c = this.ctx;
    const t = c.currentTime;
    const conv = new ConvolverNode(c, { buffer: makeImpulse(c, def.seconds, def.preDelayMs, def.damping) });
    const gain = new GainNode(c, { gain: 0 });
    this.reverbInput.connect(conv).connect(gain).connect(this.reverbSum);
    gain.gain.setTargetAtTime(1, t, Math.max(0.02, sec / 3));
    glide(this.reverbReturn.gain, def.level, t, sec / 3);
    const old = this.spaceSlot;
    if (old) {
      old.gain.gain.setTargetAtTime(0, t, Math.max(0.02, sec / 3));
      // Free the old reverb once it has rung out (a silent timer on the audio clock, so a pause also pauses this).
      const timer = new ConstantSourceNode(c, { offset: 0 });
      timer.connect(c.destination);
      timer.onended = () => {
        timer.disconnect();
        try { this.reverbInput.disconnect(old.conv); old.conv.disconnect(); old.gain.disconnect(); } catch { /* already gone */ }
      };
      timer.start(t);
      timer.stop(t + sec * 2 + def.seconds + 3);
    } else {
      // the first space replaces the default room
      this.reverbInput.disconnect(this.convolver);
    }
    this.spaceSlot = { conv, gain };
  }

  updateGlobal(g: GlobalDef): void {
    this.g = g;
    glide(this.reverbReturn.gain, g.reverb.returnLevel, this.ctx.currentTime, 0.3);
  }

  /** Called at control rate: follow the voice's loudness and dip the beds under it. */
  tick(dt: number): void {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (const v of this.meterBuf) sum += v * v;
    const rmsDb = 10 * Math.log10(sum / this.meterBuf.length + 1e-12);
    const d = this.g.duck;
    const target = clamp((rmsDb - d.floorDb) / d.rangeDb, 0, 1);
    const tc = target > this.voiceEnv ? d.attackSec : d.releaseSec;
    this.voiceEnv += (target - this.voiceEnv) * (1 - Math.exp(-dt / Math.max(0.01, tc)));
    const gain = dbToGain(-d.depthDb * this.voiceEnv);
    if (Math.abs(gain - this.lastDuck) < 0.002) return; // unchanged: don't re-send
    this.lastDuck = gain;
    const t = this.ctx.currentTime;
    for (const k of ['bed', 'fx'] as const) {
      this.ducks[k].gain.setTargetAtTime(gain, t, 0.05);
    }
  }

  get duckAmount(): number {
    return this.voiceEnv;
  }
}

export interface SpaceDef { seconds: number; preDelayMs: number; damping: number; level: number }

/** Transparent below `ceiling`, then a smooth knee towards 1.0: a last safety net, never meant to be hit. */
function softCeiling(ceiling: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const k = 1 - ceiling;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= ceiling ? a : ceiling + k * Math.tanh((a - ceiling) / k);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * Early reflections: discrete taps between ~6 and 40 ms, different in each ear
 * (so they read as reflections from around the room), each slightly darkened.
 */
function makeEarlyReflections(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const taps: [number, number][][] = [
    // [ms, gain] left ear
    [[6.3, 0.42], [11.1, 0.33], [17.9, 0.27], [23.2, 0.2], [29.4, 0.15], [37.1, 0.1]],
    // right ear
    [[7.4, 0.4], [12.9, 0.31], [16.1, 0.26], [25.3, 0.19], [31.6, 0.14], [40.2, 0.09]],
  ];
  const len = Math.round(0.05 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (const [ms, gain] of taps[ch]) {
      const at = Math.round((ms / 1000) * sr);
      // a tiny smeared, low-passed tap instead of a single-sample click
      const spread = Math.max(4, Math.round(sr * 0.0004));
      for (let i = 0; i < spread && at + i < len; i++) {
        d[at + i] += (gain * Math.exp(-i / (spread / 3))) / (spread / 3);
      }
    }
  }
  return buf;
}

/**
 * A short, soft room: decorrelated stereo noise with an exponential decay that
 * gets darker as it decays (so it sounds like air, not a metal plate).
 */
function makeImpulse(ctx: BaseAudioContext, seconds: number, preDelayMs: number, damping: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.round((preDelayMs / 1000) * sr);
  const len = pre + Math.round(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len - pre; i++) {
      const t = i / sr;
      const env = Math.exp((-6.91 * t) / seconds); // -60 dB at `seconds`
      const coef = clamp(0.15 + damping * 0.8 * (t / seconds), 0, 0.97); // darker over time
      lp += (1 - coef) * (Math.random() * 2 - 1 - lp);
      const fadeIn = Math.min(1, t / 0.008);
      data[pre + i] = lp * env * fadeIn;
    }
  }
  return buf;
}
