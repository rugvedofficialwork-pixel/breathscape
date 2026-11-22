import { noiseSource } from './noise';

/**
 * A sound is just a signal generator: it knows nothing about space.
 * The cue connects `out` into a SpatialSource.
 */
export interface Sound {
  out: AudioNode;
  start(when: number): void;
  /** Stop generating (call after the source has faded out). */
  stop(when: number): void;
  /** For one-shots: seconds until the sound has finished on its own. */
  duration?: number;
}

export type SoundOpts = Record<string, unknown>;
export type SoundFactory = (ctx: BaseAudioContext, opts: SoundOpts) => Sound;

const num = (o: SoundOpts, k: string, d: number): number => (typeof o[k] === 'number' ? (o[k] as number) : d);

function stopAll(nodes: AudioScheduledSourceNode[], when: number): void {
  for (const n of nodes) {
    try {
      n.stop(when);
    } catch {
      /* already stopped */
    }
  }
}

/**
 * Headphone check: a few soft, broadband "shh" pulses with a quiet tone
 * under them. Broadband noise localises far better than a pure tone,
 * especially front/back.
 */
const checkPulses: SoundFactory = (ctx, o) => {
  const count = num(o, 'count', 3);
  const on = num(o, 'onSec', 0.55);
  const gap = num(o, 'gapSec', 0.3);
  const n = noiseSource(ctx, 'pink');
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 180, Q: 0.5 });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 11000, Q: 0.5 });
  const tone = new OscillatorNode(ctx, { type: 'sine', frequency: num(o, 'toneHz', 440) });
  const toneGain = new GainNode(ctx, { gain: 0.05 });
  const env = new GainNode(ctx, { gain: 0 });
  n.node.connect(hp).connect(lp).connect(env);
  tone.connect(toneGain).connect(env);
  const duration = count * (on + gap);
  return {
    out: env,
    duration,
    start(when) {
      n.start(when);
      tone.start(when);
      for (let i = 0; i < count; i++) {
        const t = when + i * (on + gap);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.9, t + 0.16);
        env.gain.linearRampToValueAtTime(0.7, t + on - 0.2);
        env.gain.linearRampToValueAtTime(0, t + on);
      }
      stopAll([n.node, tone], when + duration + 0.1);
    },
    stop(when) {
      stopAll([n.node, tone], when);
    },
  };
};

/**
 * Test probe for moving sources: soft pink noise (easy to localise) with a
 * gentle two-note tone and a slow shimmer, so it is pleasant to follow.
 */
const probe: SoundFactory = (ctx, o) => {
  const n = noiseSource(ctx, 'pink');
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(o, 'noiseLowpassHz', 6000), Q: 0.5 });
  const noiseGain = new GainNode(ctx, { gain: num(o, 'noise', 0.5) });
  const out = new GainNode(ctx, { gain: 1 });
  const root = num(o, 'toneHz', 220);
  const o1 = new OscillatorNode(ctx, { type: 'triangle', frequency: root });
  const o2 = new OscillatorNode(ctx, { type: 'sine', frequency: root * 1.5 });
  const toneGain = new GainNode(ctx, { gain: num(o, 'tone', 0.06) });
  const lfo = new OscillatorNode(ctx, { frequency: 0.4 });
  const lfoDepth = new GainNode(ctx, { gain: 0.15 });
  const shimmer = new GainNode(ctx, { gain: 0.85 });
  lfo.connect(lfoDepth).connect(shimmer.gain);
  n.node.connect(lp).connect(noiseGain).connect(shimmer);
  o1.connect(toneGain);
  o2.connect(toneGain);
  toneGain.connect(shimmer);
  shimmer.connect(out);
  const nodes = [n.node, o1, o2, lfo];
  return {
    out,
    start(when) {
      n.start(when);
      o1.start(when);
      o2.start(when);
      lfo.start(when);
    },
    stop(when) {
      stopAll(nodes, when);
    },
  };
};

/**
 * Pre-session: a single warm tone. Low-mid sine stack with a soft top and a
 * very slow swell, tuned to the breath drone's root so it can crossfade into it.
 */
const warmTone: SoundFactory = (ctx, o) => {
  const root = num(o, 'rootHz', 110);
  const out = new GainNode(ctx, { gain: 1 });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(o, 'lowpassHz', 900), Q: 0.4 });
  const swell = new GainNode(ctx, { gain: 0.9 });
  const lfo = new OscillatorNode(ctx, { frequency: 0.07 });
  const lfoDepth = new GainNode(ctx, { gain: 0.1 });
  lfo.connect(lfoDepth).connect(swell.gain);
  const partials: [number, number, OscillatorType, number][] = [
    [1, 0.5, 'sine', -3],
    [1, 0.5, 'sine', 3],
    [2, 0.22, 'triangle', 0],
    [3, 0.07, 'sine', 2],
  ];
  const nodes: AudioScheduledSourceNode[] = [lfo];
  for (const [mult, amp, type, detune] of partials) {
    const osc = new OscillatorNode(ctx, { type, frequency: root * mult, detune });
    osc.connect(new GainNode(ctx, { gain: amp })).connect(lp);
    nodes.push(osc);
  }
  lp.connect(swell).connect(out);
  return {
    out,
    start(when) {
      for (const n of nodes) n.start(when);
    },
    stop(when) {
      stopAll(nodes, when);
    },
  };
};

/** Stage 2 -> 3: one low tone that lingers (root and octave, very soft top). */
const lowTone: SoundFactory = (ctx, o) => {
  const root = num(o, 'rootHz', 55);
  const out = new GainNode(ctx, { gain: 1 });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(o, 'lowpassHz', 400), Q: 0.3 });
  const nodes: AudioScheduledSourceNode[] = [];
  for (const [mult, amp, detune] of [[1, 0.6, 0], [2, 0.35, 3], [2, 0.2, -4], [3, 0.05, 0]] as const) {
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: root * mult, detune });
    osc.connect(new GainNode(ctx, { gain: amp })).connect(lp);
    nodes.push(osc);
  }
  lp.connect(out);
  return {
    out,
    start(when) {
      for (const n of nodes) n.start(when);
    },
    stop(when) {
      stopAll(nodes, when);
    },
  };
};

/**
 * One voice of the Stage 2 ambient layer: a faint sustained note plus soft air,
 * both slowly breathing at their own rate (so several voices never pulse together).
 */
const airPad: SoundFactory = (ctx, o) => {
  const hz = num(o, 'hz', 220);
  const out = new GainNode(ctx, { gain: 1 });
  const n = noiseSource(ctx, 'pink');
  const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: num(o, 'airHz', 1200), Q: 0.7 });
  const air = new GainNode(ctx, { gain: num(o, 'air', 0.35) });
  const osc = new OscillatorNode(ctx, { type: 'sine', frequency: hz });
  const osc2 = new OscillatorNode(ctx, { type: 'sine', frequency: hz * 2, detune: 4 });
  const tone = new GainNode(ctx, { gain: num(o, 'tone', 0.25) });
  const tone2 = new GainNode(ctx, { gain: num(o, 'tone', 0.25) * 0.2 });
  const breathe = new GainNode(ctx, { gain: 0.8 });
  const lfo = new OscillatorNode(ctx, { frequency: num(o, 'breatheHz', 0.05) });
  const depth = new GainNode(ctx, { gain: 0.2 });
  lfo.connect(depth).connect(breathe.gain);
  n.node.connect(bp).connect(air).connect(breathe);
  osc.connect(tone).connect(breathe);
  osc2.connect(tone2).connect(breathe);
  breathe.connect(out);
  const nodes = [n.node, osc, osc2, lfo];
  return {
    out,
    start(when) {
      n.start(when);
      for (const x of [osc, osc2, lfo]) x.start(when);
    },
    stop(when) {
      stopAll(nodes, when);
    },
  };
};

/**
 * Part D: a clear tone that rises, then holds steady. It rises by notes
 * entering one after another, low to high, each swelling in slowly; nothing
 * slides in pitch (a sliding sine sounds like a siren). Warm, soft top.
 */
const risingTone: SoundFactory = (ctx, o) => {
  const notes = Array.isArray(o.notes) ? (o.notes as number[]) : [196, 293.66, 392];
  const stepSec = num(o, 'stepSec', 2.5);
  const swellSec = num(o, 'swellSec', 3.5);
  const out = new GainNode(ctx, { gain: 1 });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(o, 'lowpassHz', 1600), Q: 0.3 });
  lp.connect(out);
  const oscs: OscillatorNode[] = [];
  const envs: { env: GainNode; at: number; level: number }[] = [];
  notes.forEach((hz, i) => {
    const env = new GainNode(ctx, { gain: 0 });
    // higher notes a little softer, so the chord stays warm rather than bright
    const level = 0.5 / (1 + i * 0.45);
    for (const [mult, amp, detune] of [[1, 1, -3], [1, 0.6, 3], [2, 0.08, 0]] as const) {
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: hz * mult, detune });
      osc.connect(new GainNode(ctx, { gain: amp })).connect(env);
      oscs.push(osc);
    }
    env.connect(lp);
    envs.push({ env, at: i * stepSec, level });
  });
  return {
    out,
    start(when) {
      for (const osc of oscs) osc.start(when);
      for (const e of envs) {
        e.env.gain.setValueAtTime(0, when + e.at);
        e.env.gain.linearRampToValueAtTime(e.level, when + e.at + swellSec);
      }
    },
    stop(when) {
      stopAll(oscs, when);
    },
  };
};

export const SOUNDS: Record<string, SoundFactory> = {
  risingTone,
  checkPulses,
  probe,
  warmTone,
  lowTone,
  airPad,
};

export function makeSound(ctx: BaseAudioContext, name: string, opts: SoundOpts = {}): Sound {
  const f = SOUNDS[name];
  if (!f) throw new Error(`Unknown sound: ${name}`);
  return f(ctx, opts);
}
