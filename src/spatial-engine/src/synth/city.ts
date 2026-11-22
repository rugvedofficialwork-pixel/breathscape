import { noiseBuffer, noiseSource } from './noise';

/**
 * The sounds of "Ten Past Three", all generated, none recorded.
 * Loops return { out, start, stop, set }; one-shots schedule themselves into `dest` at time t.
 */

export interface Loop {
  out: AudioNode;
  start(when: number): void;
  stop(when: number): void;
  /** 0..1, applied smoothly. */
  set(v: number, t: number): void;
}

type Starter = AudioScheduledSourceNode | { node: AudioScheduledSourceNode; start(when: number): void };

function makeLoop(out: AudioNode, parts: Starter[], set: Loop['set'] = () => undefined): Loop {
  return {
    out,
    set,
    start: (when) => parts.forEach((p) => ('node' in p ? p.start(when) : p.start(when))),
    stop: (when) => parts.forEach((p) => {
      try { ('node' in p ? p.node : p).stop(when); } catch { /* already stopped */ }
    }),
  };
}

const osc = (c: BaseAudioContext, hz: number, type: OscillatorType = 'sine', detune = 0) => new OscillatorNode(c, { frequency: hz, type, detune });
const gain = (c: BaseAudioContext, g: number) => new GainNode(c, { gain: g });
const filt = (c: BaseAudioContext, type: BiquadFilterType, hz: number, Q = 0.7, g = 0) => new BiquadFilterNode(c, { type, frequency: hz, Q, gain: g });

// ------------------------------------------------------------------ loops

/** A city heard from far away: a low wash that moves very slowly. v = how open and close it is. */
export function cityFar(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const brown = noiseSource(c, 'brown');
  const pink = noiseSource(c, 'pink');
  const lp = filt(c, 'lowpass', 420, 0.5);
  const pinkLp = filt(c, 'bandpass', 700, 0.4);
  const pinkG = gain(c, 0.1);
  const swell = gain(c, 0.8);
  const lfo = osc(c, 0.043);
  lfo.connect(gain(c, 0.2)).connect(swell.gain);
  brown.node.connect(lp).connect(swell);
  pink.node.connect(pinkLp).connect(pinkG).connect(swell);
  swell.connect(out);
  return makeLoop(out, [brown, pink, lfo], (v, t) => {
    lp.frequency.setTargetAtTime(280 + 900 * v, t, 1.2);
    pinkG.gain.setTargetAtTime(0.06 + 0.5 * v, t, 1.2);
  });
}

/** An overhead ceiling fan: the swish of the blades, a little motor hum. */
export function ceilingFan(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const n = noiseSource(c, 'pink');
  const bp = filt(c, 'bandpass', 620, 0.8);
  const swish = gain(c, 0.55);
  const blade = osc(c, 2.1);
  blade.connect(gain(c, 0.3)).connect(swish.gain);
  n.node.connect(bp).connect(swish).connect(out);
  const hum = osc(c, 100);
  const humG = gain(c, 0.018);
  hum.connect(humG).connect(out);
  return makeLoop(out, [n, blade, hum]);
}

/** A fridge running in a dark kitchen. */
export function fridge(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const parts: Starter[] = [];
  for (const [hz, a] of [[50, 0.24], [100, 0.16], [150, 0.07], [247, 0.015]] as const) {
    const o = osc(c, hz);
    o.connect(gain(c, a)).connect(out);
    parts.push(o);
  }
  const n = noiseSource(c, 'brown');
  n.node.connect(filt(c, 'bandpass', 180, 1.5)).connect(gain(c, 0.2)).connect(out);
  parts.push(n);
  return makeLoop(out, parts);
}

/** A running tap. */
export function tap(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const n = noiseSource(c, 'white');
  const hp = filt(c, 'highpass', 900, 0.5);
  const lp = filt(c, 'lowpass', 6500, 0.4);
  const body = filt(c, 'peaking', 2200, 1.2, 7);
  const churn = gain(c, 0.5);
  const lfo = osc(c, 11);
  lfo.connect(gain(c, 0.08)).connect(churn.gain);
  n.node.connect(hp).connect(body).connect(lp).connect(churn).connect(out);
  return makeLoop(out, [n, lfo]);
}

/** A very large animal breathing slowly: air in, air out, and the chest under it. */
export function horseBreath(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const n = noiseSource(c, 'pink');
  const bp = filt(c, 'bandpass', 420, 0.9);
  const env = gain(c, 0);
  // one slow sine; its shaped absolute value gives two swells per cycle: in, then out
  const cycle = osc(c, 0.135);
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.pow(Math.abs(x), 1.6);
  }
  cycle.connect(new WaveShaperNode(c, { curve })).connect(env.gain);
  cycle.connect(gain(c, 140)).connect(bp.frequency); // the in-breath is a little higher than the out-breath
  n.node.connect(bp).connect(env).connect(out);
  // the chest
  const chest = osc(c, 46);
  const chestEnv = gain(c, 0);
  cycle.connect(new WaveShaperNode(c, { curve })).connect(chestEnv.gain);
  chest.connect(gain(c, 0.25)).connect(chestEnv).connect(out);
  return makeLoop(out, [n, cycle, chest]);
}

/** A deep, warm chord. v = how bright and full. */
export function warmPad(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const lp = filt(c, 'lowpass', 300, 0.6);
  lp.connect(out);
  const parts: Starter[] = [];
  for (const [hz, a, det] of [[55, 0.5, 0], [55, 0.3, 5], [82.41, 0.28, -4], [110, 0.22, 3], [164.81, 0.09, -6]] as const) {
    const o = osc(c, hz, 'sine', det);
    o.connect(gain(c, a)).connect(lp);
    parts.push(o);
  }
  return makeLoop(out, parts, (v, t) => lp.frequency.setTargetAtTime(220 + 900 * v, t, 1));
}

/** The morning: an open chord that widens and brightens with v. */
export function dawnPad(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const lp = filt(c, 'lowpass', 500, 0.6);
  const shimmer = gain(c, 0);
  const parts: Starter[] = [];
  for (const [hz, a, det] of [[110, 0.3, 0], [164.81, 0.24, 4], [220, 0.2, -3], [246.94, 0.12, 5], [329.63, 0.13, -5], [440, 0.08, 3]] as const) {
    const o = osc(c, hz, 'sine', det);
    o.connect(gain(c, a)).connect(lp);
    parts.push(o);
  }
  lp.connect(out);
  for (const [hz, det] of [[659.25, 3], [880, -4], [987.77, 2], [1318.5, -2]] as const) {
    const o = osc(c, hz, 'sine', det);
    o.connect(gain(c, 0.035)).connect(shimmer);
    parts.push(o);
  }
  const trem = osc(c, 0.17);
  const tremG = gain(c, 0);
  trem.connect(tremG).connect(shimmer.gain);
  parts.push(trem);
  shimmer.connect(out);
  return makeLoop(out, parts, (v, t) => {
    lp.frequency.setTargetAtTime(400 + 3000 * v, t, 0.8);
    shimmer.gain.setTargetAtTime(Math.max(0, v - 0.25) * 1.3, t, 1.2);
    tremG.gain.setTargetAtTime(v * 0.25, t, 1.2);
  });
}

/** The sea arriving and leaving on a beach some way off. */
export function seaWash(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const n = noiseSource(c, 'pink');
  const lp = filt(c, 'lowpass', 1400, 0.5);
  const wave = gain(c, 0.45);
  const lfo = osc(c, 0.085);
  lfo.connect(gain(c, 0.38)).connect(wave.gain);
  lfo.connect(gain(c, 700)).connect(lp.frequency);
  n.node.connect(lp).connect(wave).connect(out);
  return makeLoop(out, [n, lfo]);
}

/** Thousands of wings in the distance. v = how many and how close. */
export function flockFlutter(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const n = noiseSource(c, 'white');
  const bp = filt(c, 'bandpass', 2100, 0.7);
  const flut = gain(c, 0.3);
  // two inharmonic flutter rates, so it is a crowd and not one bird
  const f1 = osc(c, 13.7);
  const f2 = osc(c, 9.1);
  f1.connect(gain(c, 0.18)).connect(flut.gain);
  f2.connect(gain(c, 0.13)).connect(flut.gain);
  n.node.connect(bp).connect(flut).connect(out);
  return makeLoop(out, [n, f1, f2], (v, t) => {
    bp.frequency.setTargetAtTime(1400 + 1600 * v, t, 1);
  });
}

const birdCache = new WeakMap<BaseAudioContext, AudioBuffer>();
/** A loop of birds waking up (generated once, then played from different places and offsets). */
function birdLoop(c: BaseAudioContext): AudioBuffer {
  const hit = birdCache.get(c);
  if (hit) return hit;
  const sr = c.sampleRate, secs = 14;
  const buf = c.createBuffer(1, Math.round(sr * secs), sr);
  const d = buf.getChannelData(0);
  const song = (start: number, f0: number, f1: number, dur: number, amp: number) => {
    const i0 = Math.round(start * sr), n = Math.round(dur * sr);
    let ph = Math.random() * 6;
    for (let i = 0; i < n && i0 + i < d.length; i++) {
      const u = i / n;
      const f = f0 + (f1 - f0) * u + 60 * Math.sin(u * 40);
      ph += (2 * Math.PI * f) / sr;
      d[i0 + i] += amp * Math.sin(Math.PI * u) ** 1.5 * Math.sin(ph);
    }
  };
  for (let k = 0; k < 42; k++) {
    let t = Math.random() * (secs - 1.2);
    const base = 2200 + Math.random() * 2600;
    const notes = 2 + Math.floor(Math.random() * 4);
    const amp = 0.06 + Math.random() * 0.14;
    for (let j = 0; j < notes; j++) {
      const dur = 0.06 + Math.random() * 0.14;
      song(t, base * (0.9 + Math.random() * 0.25), base * (0.85 + Math.random() * 0.4), dur, amp);
      t += dur + 0.02 + Math.random() * 0.08;
    }
  }
  birdCache.set(c, buf);
  return buf;
}

export function birds(c: BaseAudioContext): Loop {
  const out = gain(c, 1);
  const node = new AudioBufferSourceNode(c, { buffer: birdLoop(c), loop: true, playbackRate: 0.85 + Math.random() * 0.3 });
  node.connect(out);
  return makeLoop(out, [{ node, start: (when: number) => node.start(when, Math.random() * 13) }]);
}

/** The steady tone of the breathing section: it rises with the inhale. */
export function breathTone(c: BaseAudioContext): Loop & { glide(hz: number, sec: number, t: number): void } {
  const out = gain(c, 1);
  const o1 = osc(c, 110), o2 = osc(c, 110, 'sine', 7), o3 = osc(c, 220, 'sine', -4);
  const lp = filt(c, 'lowpass', 800, 0.5);
  o1.connect(lp); o2.connect(lp);
  o3.connect(gain(c, 0.14)).connect(lp);
  lp.connect(out);
  const l = makeLoop(out, [o1, o2, o3]);
  return {
    ...l,
    glide(hz, sec, t) {
      for (const [p, m] of [[o1.frequency, 1], [o2.frequency, 1], [o3.frequency, 2]] as const) {
        p.cancelScheduledValues(t);
        p.setTargetAtTime(hz * m, t, Math.max(0.2, sec / 3));
      }
    },
  };
}

// ------------------------------------------------------------------ one-shots

function noiseBurst(c: BaseAudioContext, dest: AudioNode, t: number, o: {
  kind?: 'white' | 'pink' | 'brown'; type?: BiquadFilterType; hz: number; toHz?: number; Q?: number; amp: number; attack?: number; dur: number;
}): void {
  const buf = noiseBuffer(c, o.kind ?? 'pink');
  const src = new AudioBufferSourceNode(c, { buffer: buf, loop: true });
  const f = filt(c, o.type ?? 'bandpass', o.hz, o.Q ?? 0.8);
  const env = gain(c, 0);
  src.connect(f).connect(env).connect(dest);
  const a = Math.max(0.002, o.attack ?? 0.01);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.amp, t + a);
  env.gain.setTargetAtTime(0, t + a, Math.max(0.005, (o.dur - a) / 3));
  if (o.toHz) f.frequency.exponentialRampToValueAtTime(o.toHz, t + o.dur);
  src.start(t, Math.random() * 7);
  src.stop(t + o.dur * 1.8 + 0.1);
  src.onended = () => env.disconnect();
}

function ping(c: BaseAudioContext, dest: AudioNode, t: number, hz: number, amp: number, decay: number): void {
  const o = osc(c, hz);
  const g = gain(c, 0);
  o.connect(g).connect(dest);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.004, decay / 3);
  o.start(t);
  o.stop(t + decay * 1.8 + 0.1);
  o.onended = () => g.disconnect();
}

/** A beak on a window frame: three dry taps. */
export function beakTaps(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  for (const [dt, a] of [[0, 1], [0.34, 0.8], [0.62, 0.9]] as const) {
    noiseBurst(c, dest, t + dt, { kind: 'white', hz: 3200, Q: 2, amp: 0.8 * a * amp, attack: 0.001, dur: 0.018 });
    ping(c, dest, t + dt, 2150, 0.22 * a * amp, 0.03);
    ping(c, dest, t + dt, 870, 0.3 * a * amp, 0.04);
  }
}

/** A coin falling into a well: small cold pings, each further away than the last. It never lands. */
export function coinFall(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  let at = t, a = amp;
  for (let i = 0; i < 6; i++) {
    ping(c, dest, at, 2840, 0.5 * a, 0.5);
    ping(c, dest, at, 4210, 0.2 * a, 0.3);
    ping(c, dest, at, 1370, 0.2 * a, 0.5);
    at += 0.75 + i * 0.28;
    a *= 0.62;
  }
}

export function footstep(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  ping(c, dest, t, 78, 0.8 * amp, 0.1);
  noiseBurst(c, dest, t, { hz: 800, Q: 0.5, amp: 0.2 * amp, attack: 0.008, dur: 0.07 });
}

/** A sash window running down and meeting the frame. */
export function windowShut(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  noiseBurst(c, dest, t, { hz: 900, toHz: 450, Q: 0.6, amp: 0.2 * amp, attack: 0.1, dur: 0.42 });
  ping(c, dest, t + 0.42, 118, 1.0 * amp, 0.16);
  noiseBurst(c, dest, t + 0.42, { hz: 1500, Q: 0.7, amp: 0.45 * amp, attack: 0.002, dur: 0.06 });
}

export function windowOpen(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  ping(c, dest, t, 150, 0.45 * amp, 0.1);
  noiseBurst(c, dest, t + 0.05, { hz: 500, toHz: 1000, Q: 0.6, amp: 0.26 * amp, attack: 0.2, dur: 0.7 });
}

/** The roof door that always sticks, and tonight does not: an old hinge, then the push of outside air. */
export function doorOpens(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  const saw = osc(c, 92, 'sawtooth');
  const bp = filt(c, 'bandpass', 720, 3.5);
  const env = gain(c, 0);
  saw.frequency.setValueAtTime(92, t);
  saw.frequency.linearRampToValueAtTime(128, t + 1.5);
  // the stutter of a dry hinge
  const stutter = osc(c, 13, 'square');
  const stutterG = gain(c, 0.02);
  stutter.connect(stutterG).connect(env.gain);
  saw.connect(bp).connect(env).connect(dest);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.05 * amp, t + 0.3);
  env.gain.setValueAtTime(0.05 * amp, t + 1.2);
  env.gain.linearRampToValueAtTime(0, t + 1.7);
  stutterG.gain.setValueAtTime(0.02 * amp, t);
  stutterG.gain.setValueAtTime(0, t + 1.7);
  saw.start(t); stutter.start(t);
  saw.stop(t + 1.8); stutter.stop(t + 1.8);
  saw.onended = () => env.disconnect();
}

/** A crow settling: a quick rustle of a few wing strokes. */
export function wingFlutter(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1, strokes = 5): void {
  let at = t;
  for (let i = 0; i < strokes; i++) {
    noiseBurst(c, dest, at, { hz: 1500 + Math.random() * 700, Q: 0.7, amp: 0.55 * amp * (1 - i / (strokes + 2)), attack: 0.014, dur: 0.09 });
    at += 0.085 + Math.random() * 0.03;
  }
}

/** A hand laid on a rough hide. */
export function hideRub(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  noiseBurst(c, dest, t, { hz: 1500, toHz: 950, Q: 0.6, amp: 0.34 * amp, attack: 0.4, dur: 1.5 });
  noiseBurst(c, dest, t + 0.9, { hz: 1200, toHz: 800, Q: 0.6, amp: 0.2 * amp, attack: 0.3, dur: 1.2 });
}

/** One wing opening: a long slow rustle with a creak inside it, far bigger than the place it is in. */
export function wingUnfurl(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1, sec = 9): void {
  noiseBurst(c, dest, t, { kind: 'pink', hz: 260, toHz: 1500, Q: 0.5, amp: 0.7 * amp, attack: sec * 0.6, dur: sec });
  noiseBurst(c, dest, t, { kind: 'brown', type: 'lowpass', hz: 190, Q: 0.5, amp: 0.9 * amp, attack: sec * 0.7, dur: sec });
  for (let i = 0; i < 26; i++) {
    const at = t + 0.5 + Math.random() * (sec - 1);
    noiseBurst(c, dest, at, { kind: 'white', hz: 2400 + Math.random() * 3000, Q: 1.2, amp: 0.05 + Math.random() * 0.11 * amp, attack: 0.008, dur: 0.05 + Math.random() * 0.08 });
  }
}

/** One great wingbeat. strength 0..1. */
export function wingbeat(c: BaseAudioContext, dest: AudioNode, t: number, strength = 0.7, amp = 1): void {
  const a = (0.35 + 0.65 * strength) * amp;
  noiseBurst(c, dest, t, { kind: 'brown', type: 'lowpass', hz: 240, toHz: 70, Q: 0.6, amp: 2.2 * a, attack: 0.12, dur: 0.75 });
  noiseBurst(c, dest, t, { kind: 'pink', hz: 620, toHz: 300, Q: 0.5, amp: 0.55 * a, attack: 0.16, dur: 0.7 });
  noiseBurst(c, dest, t + 0.03, { kind: 'white', hz: 3400, toHz: 1900, Q: 0.6, amp: 0.1 * a, attack: 0.07, dur: 0.4 });
}

/** Light gathered between finger and thumb. */
export function sparkle(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1, up = true): void {
  const notes = up ? [1174.66, 1318.51, 1760, 1975.53, 2349.32] : [2349.32, 1760, 1318.51];
  notes.forEach((hz, i) => ping(c, dest, t + i * 0.09, hz, 0.24 * amp * (1 - i * 0.1), 0.9));
}

/** Warmth sinking in: a deep tone that opens and goes on a long time. */
export function chestBloom(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1, sec = 7): void {
  const lp = filt(c, 'lowpass', 300, 0.5);
  const env = gain(c, 0);
  lp.connect(env).connect(dest);
  lp.frequency.setValueAtTime(240, t);
  lp.frequency.linearRampToValueAtTime(1800, t + sec * 0.35);
  lp.frequency.linearRampToValueAtTime(260, t + sec);
  const os: OscillatorNode[] = [];
  for (const [hz, a] of [[110, 0.6], [164.81, 0.3], [220, 0.28], [329.63, 0.17], [440, 0.1], [659.25, 0.05]] as const) {
    const o = osc(c, hz);
    o.connect(gain(c, a)).connect(lp);
    o.start(t); o.stop(t + sec + 0.2);
    os.push(o);
  }
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + sec * 0.2);
  env.gain.setTargetAtTime(0, t + sec * 0.25, sec / 4);
  os[0].onended = () => env.disconnect();
}

/** A gull very far away over the water. */
export function gull(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  let at = t;
  for (let i = 0; i < 3; i++) {
    const o = osc(c, 1500, 'sawtooth');
    const bp = filt(c, 'bandpass', 1500, 4);
    const env = gain(c, 0);
    o.frequency.setValueAtTime(1650, at);
    o.frequency.exponentialRampToValueAtTime(1050, at + 0.34);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.09 * amp, at + 0.05);
    env.gain.setTargetAtTime(0, at + 0.2, 0.05);
    o.connect(bp).connect(env).connect(dest);
    o.start(at); o.stop(at + 0.5);
    o.onended = () => env.disconnect();
    at += 0.42 + Math.random() * 0.08;
  }
}

/** A peg ticking on a washing line in the air off the roof. */
export function washingLine(c: BaseAudioContext, dest: AudioNode, t: number, amp = 1): void {
  ping(c, dest, t, 2480, 0.09 * amp, 0.06);
  ping(c, dest, t + 0.17, 2610, 0.06 * amp, 0.05);
}
