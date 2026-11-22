import { clamp } from '../core/math';
import { kRate } from '../core/source';
import { noiseSource } from './noise';

/**
 * Natural sounds that respond to parameters in real time. Each uses a real
 * recording from assets/ when one is supplied, and a procedural fallback
 * (filtered noise) otherwise, so everything always runs.
 */

export interface LiveSound {
  out: AudioNode;
  start(when: number): void;
  stop(when: number): void;
  /** 0..1, applied smoothly from audio time t. */
  setIntensity(i: number, t: number): void;
}

const stopNodes = (nodes: AudioScheduledSourceNode[], when: number) => {
  for (const n of nodes) {
    try {
      n.stop(when);
    } catch {
      /* already stopped */
    }
  }
};

const seamlessCache = new WeakMap<AudioBuffer, AudioBuffer>();

/** Loop recordings are matched to this RMS (about -20 dBFS), so any file sits at the level cues.json expects. */
const LOOP_RMS = 0.1;

/**
 * Prepare a recording for looping:
 * - A recording's end rarely matches its start, so a plain loop jumps once per
 *   pass. The last `sec` seconds are blended (equal-power) into the first `sec`
 *   seconds and that tail is dropped: the loop point is inaudible.
 * - Its loudness is matched to LOOP_RMS (quiet and loud source files end up the same).
 */
function seamless(ctx: BaseAudioContext, buf: AudioBuffer, sec = 2): AudioBuffer {
  const hit = seamlessCache.get(buf);
  if (hit) return hit;
  const x = Math.min(Math.round(sec * buf.sampleRate), Math.floor(buf.length / 4));
  const len = buf.length - x;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < x; i++) {
      const a = (i / x) * (Math.PI / 2);
      dst[i] = src[i] * Math.sin(a) + src[len + i] * Math.cos(a);
    }
  }
  let sum = 0;
  for (let ch = 0; ch < out.numberOfChannels; ch++) for (const v of out.getChannelData(ch)) sum += v * v;
  const rms = Math.sqrt(sum / (out.length * out.numberOfChannels));
  if (rms > 1e-6) {
    const k = LOOP_RMS / rms;
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const d = out.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  seamlessCache.set(buf, out);
  return out;
}

/** Loop a recording (made seamless) from a random point, so several sources from one file stay decorrelated. */
function loopSource(ctx: BaseAudioContext, file: AudioBuffer, rate: number): { node: AudioBufferSourceNode; start(when: number): void } {
  const buf = seamless(ctx, file);
  const node = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, playbackRate: rate });
  const offset = Math.random() * Math.max(0, buf.duration - 0.1);
  return { node, start: (when) => node.start(when, offset) };
}

export interface WindOpts {
  /** Centre of the band-pass (procedural wind), Hz. */
  bandHz: number;
  /** Slow gust LFO rates, Hz (two, so gusts never repeat regularly). */
  gustHz: [number, number];
  /** How the wind changes with intensity 0..1. */
  intensity: { levelMin: number; levelMax: number; brightHzMin: number; brightHzMax: number; gustMin: number; gustMax: number; rateMin: number; rateMax: number };
  file?: AudioBuffer | null;
  gustFile?: AudioBuffer | null;
}

/**
 * One wind source: noise (or the wind recording) with slow, irregular gusts.
 * Intensity raises the level, the brightness, the gust depth and the gust speed.
 */
export function wind(ctx: BaseAudioContext, o: WindOpts): LiveSound {
  const out = new GainNode(ctx, { gain: o.intensity.levelMin });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2000, Q: 0.4 });
  // gust LFOs swing this by up to +-1.6 x depth, so keep depth <= 0.5 to stay positive
  const gust = new GainNode(ctx, { gain: 0.85 });
  const bandParams: AudioParam[] = [];
  const nodes: AudioScheduledSourceNode[] = [];
  const starts: ((when: number) => void)[] = [];

  let gustLayer: GainNode | null = null;
  if (o.file) {
    const s = loopSource(ctx, o.file, 0.97 + Math.random() * 0.06);
    s.node.connect(tone);
    nodes.push(s.node);
    starts.push(s.start);
    if (o.gustFile) {
      const g = loopSource(ctx, o.gustFile, 0.97 + Math.random() * 0.06);
      gustLayer = new GainNode(ctx, { gain: 0 });
      g.node.connect(gustLayer).connect(tone);
      nodes.push(g.node);
      starts.push(g.start);
    }
  } else {
    const n = noiseSource(ctx, 'pink');
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: o.bandHz, Q: 0.6 });
    bandParams.push(bp.frequency);
    // the gusts also move the band a little, like air changing speed
    const sweep = new GainNode(ctx, { gain: o.bandHz * 0.25 });
    n.node.connect(bp).connect(tone);
    nodes.push(n.node);
    starts.push(n.start);
    const lfoS = new OscillatorNode(ctx, { frequency: o.gustHz[0] * 0.8 });
    lfoS.connect(sweep).connect(bp.frequency);
    nodes.push(lfoS);
    starts.push((w) => lfoS.start(w));
  }

  const lfo1 = new OscillatorNode(ctx, { frequency: o.gustHz[0] });
  const lfo2 = new OscillatorNode(ctx, { frequency: o.gustHz[1] });
  const depth = new GainNode(ctx, { gain: o.intensity.gustMin });
  lfo1.connect(depth);
  lfo2.connect(new GainNode(ctx, { gain: 0.6 })).connect(depth);
  depth.connect(gust.gain);
  nodes.push(lfo1, lfo2);
  starts.push((w) => {
    lfo1.start(w);
    lfo2.start(w);
  });
  tone.connect(gust).connect(out);
  // slow-moving filters: once per block, not per sample (see kRate in core/source.ts)
  kRate(tone.frequency, ...bandParams);

  const it = o.intensity;
  let lastI = -1;
  return {
    out,
    start: (when) => starts.forEach((s) => s(when)),
    stop: (when) => stopNodes(nodes, when),
    setIntensity(i, t) {
      const I = clamp(i, 0, 1);
      if (Math.abs(I - lastI) < 0.004) return; // nothing audible would change
      lastI = I;
      const tc = 0.4;
      out.gain.setTargetAtTime(it.levelMin + (it.levelMax - it.levelMin) * I, t, tc);
      tone.frequency.setTargetAtTime(it.brightHzMin + (it.brightHzMax - it.brightHzMin) * I, t, tc);
      depth.gain.setTargetAtTime(Math.min(0.5, it.gustMin + (it.gustMax - it.gustMin) * I), t, tc);
      const rate = it.rateMin + (it.rateMax - it.rateMin) * I;
      lfo1.frequency.setTargetAtTime(o.gustHz[0] * rate, t, 1);
      lfo2.frequency.setTargetAtTime(o.gustHz[1] * rate, t, 1);
      gustLayer?.gain.setTargetAtTime(I * I, t, tc);
    },
  };
}

export interface WaterOpts {
  lowpassHz: number;
  file?: AudioBuffer | null;
  /** When a recording is used: its own top cut and gain (recordings need less softening). */
  fileLowpassHz?: number;
  fileGain?: number;
}

/**
 * Moving water (a stream). Procedural: a churning wash of shaped noise, a
 * quiet layer of dense tiny bubbles for texture, and a little low rush.
 * Intensity here means "activity": 1 = normal flow, towards 0 = stiller,
 * softer, darker.
 */
export function water(ctx: BaseAudioContext, o: WaterOpts): LiveSound {
  const out = new GainNode(ctx, { gain: 1 });
  const topHz = o.file ? (o.fileLowpassHz ?? o.lowpassHz) : o.lowpassHz;
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: topHz, Q: 0.4 });
  const trim = new GainNode(ctx, { gain: o.file ? (o.fileGain ?? 1) : 1 });
  lp.connect(trim).connect(out);
  kRate(lp.frequency);
  let lastI = -1;
  const nodes: AudioScheduledSourceNode[] = [];
  const starts: ((when: number) => void)[] = [];
  let bubbles: GainNode | null = null;
  let rush: GainNode | null = null;
  let wash: GainNode | null = null;

  if (o.file) {
    const s = loopSource(ctx, o.file, 1);
    s.node.connect(lp);
    nodes.push(s.node);
    starts.push(s.start);
  } else {
    // 1. the wash: broadband noise, shaped like water (most energy 400 Hz - 4 kHz),
    //    its level moving irregularly a few times a second, like the surface churning
    const n = noiseSource(ctx, 'pink');
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300, Q: 0.5 });
    const body = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1500, Q: 0.6, gain: 5 });
    wash = new GainNode(ctx, { gain: 0.5 });
    const churnSrc = noiseSource(ctx, 'white');
    const churnLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3, Q: 0.5 });
    // Low-passed white noise is very quiet (RMS ~ 0.52 * sqrt(2*fc/sr) for our buffer):
    // scale it so the wash level wobbles by about +-30% of its 0.5 base.
    const churnRms = 0.52 * Math.sqrt((2 * 3) / ctx.sampleRate);
    const churn = new GainNode(ctx, { gain: (0.3 * 0.5) / churnRms });
    churnSrc.node.connect(churnLp).connect(churn).connect(wash.gain);
    n.node.connect(hp).connect(body).connect(wash).connect(lp);
    // 2. the babble: thousands of tiny bubbles, quietly, for texture
    const b = loopSource(ctx, bubbleLoop(ctx), 1);
    bubbles = new GainNode(ctx, { gain: 0.35 });
    b.node.connect(bubbles).connect(lp);
    // 3. a little low rush for weight
    const r = noiseSource(ctx, 'brown');
    const rushLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 500, Q: 0.5 });
    rush = new GainNode(ctx, { gain: 0.25 });
    r.node.connect(rushLp).connect(rush).connect(lp);
    nodes.push(n.node, churnSrc.node, b.node, r.node);
    starts.push(n.start, churnSrc.start, b.start, r.start);
  }
  return {
    out,
    start: (when) => starts.forEach((s) => s(when)),
    stop: (when) => stopNodes(nodes, when),
    setIntensity(i, t) {
      const I = clamp(i, 0, 1);
      if (Math.abs(I - lastI) < 0.004) return;
      lastI = I;
      out.gain.setTargetAtTime(0.3 + 0.7 * I, t, 0.6);
      bubbles?.gain.setTargetAtTime(0.05 + 0.3 * I * I, t, 0.6);
      wash?.gain.setTargetAtTime(0.2 + 0.3 * I, t, 0.6);
      rush?.gain.setTargetAtTime(0.15 + 0.1 * I, t, 0.6);
      lp.frequency.setTargetAtTime(topHz * (0.45 + 0.55 * I), t, 0.6);
    },
  };
}

const bubbleCache = new WeakMap<BaseAudioContext, AudioBuffer[]>();

/** Generate the procedural water texture ahead of time (~0.5 s of work), so Part B starts without a hitch. */
export function prepareWater(ctx: BaseAudioContext): void {
  bubbleLoop(ctx);
  bubbleLoop(ctx);
}

/**
 * A loopable stretch of stream "babble": hundreds of tiny bubbles, each a sine
 * that rises slightly in pitch and dies away within tens of milliseconds
 * (the sound of air pockets in running water). Bigger bubbles are lower,
 * louder and rarer. A few variants are made so nearby sources differ.
 */
function bubbleLoop(ctx: BaseAudioContext): AudioBuffer {
  let list = bubbleCache.get(ctx);
  if (!list) bubbleCache.set(ctx, (list = []));
  if (list.length >= 2) return list[Math.floor(Math.random() * list.length)];

  const sr = ctx.sampleRate;
  const seconds = 12;
  const fade = Math.round(0.4 * sr);
  const len = Math.round(seconds * sr) + fade;
  const d = new Float32Array(len);
  // Dense and small: individual bubbles should blur into texture, not be heard as "bloops".
  const rate = 1200; // bubbles per second
  const count = Math.round(rate * seconds * 1.05);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(Math.random() * (len - fade));
    // mostly small, high bubbles (1-5 kHz); only an occasional lower one
    const u = Math.random();
    const f0 = 900 + 4200 * Math.pow(u, 0.7);
    const amp = 0.02 * Math.pow(1500 / f0, 0.6) * Math.pow(Math.random(), 2);
    const decay = 1.6 * (0.043 * f0 + 0.0014 * Math.pow(f0, 1.5)); // faster than a lone bubble: short ticks
    const rise = 0.01 + 0.04 * Math.random(); // barely any chirp
    const n = Math.min(len - start, Math.round((4 / decay) * sr));
    let phase = Math.random() * 2 * Math.PI;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f0 * (1 + rise * decay * t);
      phase += (2 * Math.PI * f) / sr;
      const attack = Math.min(1, i / 48); // 1 ms: no click
      d[start + i] += amp * attack * Math.exp(-decay * t) * Math.sin(phase);
    }
  }
  // fold the tail into the head so the loop is seamless
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[len - fade + i] * (1 - a);
  }
  const buf = ctx.createBuffer(1, len - fade, sr);
  const ch = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < len - fade; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len - fade; i++) ch[i] = (d[i] / peak) * 0.8;
  list.push(buf);
  return buf;
}
