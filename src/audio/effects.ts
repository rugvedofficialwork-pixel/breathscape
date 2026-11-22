import { getCtx, getMaster, ramp } from './drone';
import type { Word } from '../state';

let noiseBuf: AudioBuffer | null = null;
function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  return s;
}

const clampPan = (p: number) => Math.max(-0.9, Math.min(0.9, p));
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0];

interface Bed {
  word: Word;
  panner: StereoPannerNode;
  gains: Record<string, GainNode>;
  /** Acceptance: the wind's tone, softened (not silenced) as the arms open. */
  soften?: BiquadFilterNode;
  stop: () => void;
}

/** Synthesised sound for Scene 2. Effect sounds are panned by the user's on-screen X. */
/** The original stereo sound for Parts D-G (used with ?spatial=0). */
export class EffectAudio {
  private tone: { gain: GainNode; stop: () => void } | null = null;
  private bed: Bed | null = null;

  /** Lead-in: a clear rising tone that settles on a steady note, centred. */
  riseTone(): void {
    const c = getCtx(), t = c.currentTime;
    const gain = c.createGain(); gain.gain.value = 0;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(196, t);
    o.frequency.exponentialRampToValueAtTime(392, t + 6);
    const o2 = c.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(392, t);
    o2.frequency.exponentialRampToValueAtTime(784, t + 6);
    const g2 = c.createGain(); g2.gain.value = 0.2;
    o.connect(gain); o2.connect(g2).connect(gain); gain.connect(getMaster());
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 2.5);
    o.start(t); o2.start(t);
    this.tone = { gain, stop: () => { try { o.stop(); o2.stop(); } catch { /* stopped */ } } };
  }

  endTone(sec: number): void {
    if (!this.tone) return;
    const { gain, stop } = this.tone;
    this.tone = null;
    ramp(gain.gain, 0, sec / 3);
    setTimeout(stop, (sec + 0.5) * 1000);
  }

  /** Rising harmonic swell that widens across the stereo field as the gesture is detected. */
  swell(): void {
    const c = getCtx(), t = c.currentTime;
    [1, 2, 3, 4, 6].forEach((k, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 220 * k;
      const g = c.createGain(); g.gain.value = 0;
      const p = c.createStereoPanner(); p.pan.value = 0;
      o.connect(g).connect(p).connect(getMaster());
      const start = t + i * 0.3, peak = 0.05 / (1 + i * 0.6);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + 1.8);
      g.gain.linearRampToValueAtTime(peak * 0.35, start + 3.2);
      g.gain.linearRampToValueAtTime(0, start + 6);
      const side = (i % 2 ? 1 : -1) * Math.min(0.8, 0.15 * i);
      p.pan.setValueAtTime(0, start);
      p.pan.linearRampToValueAtTime(side, start + 3);
      o.start(start); o.stop(start + 6.2);
    });
  }

  /** Persistent bed for the chosen word (Kindness uses chimes only). */
  startEffect(word: Word): void {
    this.stopEffect(0.3);
    const c = getCtx();
    const panner = c.createStereoPanner();
    panner.connect(getMaster());
    const nodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
    const gains: Record<string, GainNode> = {};
    const mkGain = (name: string) => { const g = c.createGain(); g.gain.value = 0; gains[name] = g; return g; };

    let soften: BiquadFilterNode | undefined;
    if (word === 'acceptance') {
      // The wind is not hushed (that is Courage and Calm): it keeps blowing at the same level, but opening the
      // arms makes it softer and rounder, as if it now passes through you, and an open, warm chord (the room) grows.
      const g = mkGain('flow');
      const n = noiseSource(c); n.start(); nodes.push(n);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.7;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
      const lg = c.createGain(); lg.gain.value = 220;
      lfo.connect(lg).connect(bp.frequency); lfo.start(); nodes.push(lfo);
      soften = c.createBiquadFilter(); soften.type = 'lowpass'; soften.frequency.value = 3200; soften.Q.value = 0.5;
      n.connect(bp).connect(soften).connect(g).connect(panner);
      const room = mkGain('room');
      for (const f of [146.83, 220.0, 293.66]) { // an open fifth and octave: no major or minor colour, just space
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = c.createGain(); og.gain.value = 0.3;
        o.connect(og).connect(room); o.start(); nodes.push(o);
      }
      room.connect(panner);
    } else if (word === 'courage') {
      // wind: band-passed noise with a slow sweep
      const g = mkGain('wind');
      const n = noiseSource(c); n.start(); nodes.push(n);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 560; bp.Q.value = 0.9;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.17;
      const lg = c.createGain(); lg.gain.value = 240;
      lfo.connect(lg).connect(bp.frequency); lfo.start(); nodes.push(lfo);
      n.connect(bp).connect(g).connect(panner);
      // a soft, still tone that grows as the calm pocket grows
      const pad = mkGain('pad');
      for (const f of [174.61, 261.63, 349.23]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = c.createGain(); og.gain.value = 0.3;
        o.connect(og).connect(pad); o.start(); nodes.push(o);
      }
      pad.connect(panner);
    } else if (word === 'calm') {
      // A busy wash of wind and water that is LOUD when your hands are close and falls to near-silence as
      // your arms open. Only a barely-there tone remains at full spread.
      const bg = mkGain('bg');
      const wind = noiseSource(c); wind.start(); nodes.push(wind);
      const windF = c.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 480; windF.Q.value = 0.7;
      const sweep = c.createOscillator(); sweep.frequency.value = 0.19;
      const sweepG = c.createGain(); sweepG.gain.value = 200;
      sweep.connect(sweepG).connect(windF.frequency); sweep.start(); nodes.push(sweep);
      wind.connect(windF).connect(bg);
      const water = noiseSource(c); water.start(); nodes.push(water);
      const waterF = c.createBiquadFilter(); waterF.type = 'bandpass'; waterF.frequency.value = 1700; waterF.Q.value = 0.9;
      const waterG = c.createGain(); waterG.gain.value = 0.45;
      const ripple = c.createOscillator(); ripple.frequency.value = 0.55;
      const rippleG = c.createGain(); rippleG.gain.value = 0.25;
      ripple.connect(rippleG).connect(waterG.gain); ripple.start(); nodes.push(ripple);
      water.connect(waterF).connect(waterG).connect(bg);
      bg.connect(panner);
      const pad = mkGain('pad');
      for (const f of [130.81, 196.0]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = c.createGain(); og.gain.value = 0.3;
        o.connect(og).connect(pad); o.start(); nodes.push(o);
      }
      pad.connect(panner);
    }

    this.bed = {
      word, panner, gains, soften,
      stop: () => { for (const n of nodes) { try { n.stop(); } catch { /* stopped */ } } panner.disconnect(); },
    };
  }

  /** intensity 0-1 (from arm spread), pan -1..1 (user's on-screen X), vis 0-1 overall fade. */
  update(intensity: number, pan: number, vis: number): void {
    const b = this.bed;
    if (!b) return;
    const g = b.gains, I = intensity;
    // Acceptance: the wind stays (same level), only its edge softens; the room grows with the arms
    if (g.flow) ramp(g.flow.gain, 0.12 * vis, 0.25);
    if (b.soften) ramp(b.soften.frequency, 3200 * Math.pow(0.22, I), 0.2);
    if (g.room) ramp(g.room.gain, (0.008 + 0.06 * I) * vis, 0.3);
    // Live, not a loop: wind loudness is set every frame from your arm spread (loud when narrow, hushed when wide)
    if (g.wind) ramp(g.wind.gain, (0.015 + 0.2 * Math.pow(1 - I, 1.3)) * vis, 0.15);
    if (g.pad) ramp(g.pad.gain, (b.word === 'calm' ? 0.005 * I : 0.01 + 0.07 * I) * vis, 0.3);
    // Calm: live wash, loud with hands together, silent with arms wide (recalculated every frame)
    if (g.bg) ramp(g.bg.gain, (0.004 + 0.24 * Math.pow(1 - I, 1.5)) * vis, 0.15);
    b.panner.pan.setTargetAtTime(clampPan(pan), getCtx().currentTime, 0.15);
  }

  /** Soft bell for a flower blooming at on-screen X (pan -1..1). */
  chime(pan: number, volume: number): void {
    const c = getCtx(), t = c.currentTime;
    const f = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
    const p = c.createStereoPanner(); p.pan.value = clampPan(pan);
    const g = c.createGain(); g.gain.value = 0;
    p.connect(getMaster()); g.connect(p);
    for (const [mult, amp, dec] of [[1, 1, 2.6], [2.76, 0.25, 1.4], [5.4, 0.08, 0.7]] as const) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
      const og = c.createGain(); og.gain.value = amp;
      o.connect(og).connect(g); o.start(t); o.stop(t + dec + 0.2);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    setTimeout(() => p.disconnect(), 3200);
  }

  stopEffect(sec: number): void {
    const b = this.bed;
    if (!b) return;
    this.bed = null;
    for (const g of Object.values(b.gains)) ramp(g.gain, 0, Math.max(0.05, sec / 3));
    setTimeout(b.stop, (sec + 0.4) * 1000);
  }

  /** Very soft tick when a pinch is recognised. */
  pinchTick(pan = 0): void {
    this.chime(pan, 0.018);
  }

  /**
   * Chest contact (Part F2): a soft low tone plus a gentle swell of chimes as the transformation begins.
   */
  contactTone(): void {
    const c = getCtx(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 98;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 147;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.4;
    o.connect(g); o2.connect(g2).connect(g); g.connect(getMaster());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 1.6);
    g.gain.linearRampToValueAtTime(0.06, t + 3.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
    o.start(t); o2.start(t); o.stop(t + 7.2); o2.stop(t + 7.2);
    // gentle chime swell, rising in loudness then easing off
    [0, 0.5, 1.0, 1.55, 2.1, 2.7, 3.4].forEach((delay, i) => {
      setTimeout(() => this.chime((Math.random() - 0.5) * 0.7, 0.014 + 0.012 * Math.sin((i / 6) * Math.PI)), delay * 1000);
    });
  }

  /** The portal once more, softer and reversed: it swells inward, then closes. */
  whooshReverse(): void {
    const c = getCtx(), t = c.currentTime;
    const n = noiseSource(c);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 2.4);
    const g = c.createGain(); g.gain.value = 0;
    n.connect(bp).connect(g).connect(getMaster());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 1.6);
    g.gain.linearRampToValueAtTime(0, t + 2.6);
    n.start(t); n.stop(t + 2.7);
  }

  stopAll(): void {
    this.endTone(0.3);
    this.stopEffect(0.3);
  }
}
