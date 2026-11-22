import { CONFIG } from '../config';

export type Phase = 'inhale' | 'hold' | 'exhale' | 'rest';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export const getCtx = (): AudioContext => ctx!;
export const getMaster = (): GainNode => master!;

/** Must be called from a user gesture (the Begin click). */
export function initAudio(): AudioContext {
  if (!ctx) {
    // A larger buffer (0.1 s) absorbs busy moments (camera tracking, the 3D engine) instead of crackling.
    ctx = new AudioContext({ latencyHint: 0.1 });
    master = ctx.createGain();
    master.gain.value = 0.5; // was 0.9: about 5 dB quieter overall, comfortable at a normal system volume (24)
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Smooth gain change, never a click (time constant >= 50ms). */
export function ramp(param: AudioParam, value: number, tc = 0.2): void {
  const c = ctx!;
  param.cancelScheduledValues(c.currentTime);
  param.setTargetAtTime(value, c.currentTime, Math.max(0.05, tc));
}

export class Drone {
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private lfo!: OscillatorNode;
  private lfoGain!: GainNode;
  private level!: GainNode;
  private shimmer!: GainNode;
  private started = false;

  start(): void {
    if (this.started) return;
    const c = initAudio();
    const d = CONFIG.drone;
    this.o1 = c.createOscillator(); this.o1.type = 'sine'; this.o1.frequency.value = d.rootHz;
    this.o2 = c.createOscillator(); this.o2.type = 'sine'; this.o2.frequency.value = d.rootHz; this.o2.detune.value = d.detuneCents;
    this.level = c.createGain(); this.level.gain.value = 0;
    this.shimmer = c.createGain(); this.shimmer.gain.value = 1;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = d.lowpassHz;
    this.lfo = c.createOscillator(); this.lfo.frequency.value = d.shimmerHz;
    this.lfoGain = c.createGain(); this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain).connect(this.shimmer.gain);
    this.o1.connect(this.level); this.o2.connect(this.level);
    this.level.connect(this.shimmer).connect(lp).connect(master!);
    this.o1.start(); this.o2.start(); this.lfo.start();
    this.started = true;
  }

  /** Volume for this cycle (already stepped down per cycle). */
  setVolume(v: number, tc = 0.6): void {
    if (this.started) ramp(this.level.gain, v, tc);
  }

  /** Pitch rises across inhale, sustains with a faint shimmer on hold, falls on exhale, near-silence on rest. */
  phase(name: Phase, durSec: number, volume: number): void {
    if (!this.started) return;
    const c = ctx!, d = CONFIG.drone;
    const f =this.o1.frequency, f2 = this.o2.frequency;
    const glide = (to: number) => {
      for (const p of [f, f2]) {
        p.cancelScheduledValues(c.currentTime);
        p.setValueAtTime(Math.max(1, p.value), c.currentTime);
        p.exponentialRampToValueAtTime(to, c.currentTime + Math.max(0.1, durSec));
      }
    };
    ramp(this.lfoGain.gain, name === 'hold' ? d.shimmerDepth : 0, 0.5);
    if (name === 'inhale') { ramp(this.level.gain, volume, 0.4); glide(d.peakHz); }
    else if (name === 'hold') { ramp(this.level.gain, volume, 0.4); }
    else if (name === 'exhale') { ramp(this.level.gain, volume * 0.85, 0.4); glide(d.rootHz); }
    else { ramp(this.level.gain, volume * 0.06, 0.5); }
  }

  /** A single soft tone with a slow decay (rest chime and cycle-6 cues). */
  cue(hz: number, volume: number, decaySec = 2.6): void {
    if (!ctx || volume <= 0) return;
    const c = ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz;
    const o3 = c.createOscillator(); o3.type = 'sine'; o3.frequency.value = hz * 2;
    const g = c.createGain(); g.gain.value = 0;
    const g3 = c.createGain(); g3.gain.value = 0.18;
    o.connect(g); o3.connect(g3).connect(g); g.connect(master!);
    const t = c.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decaySec);
    o.start(t); o3.start(t); o.stop(t + decaySec + 0.1); o3.stop(t + decaySec + 0.1);
  }

  fadeOut(sec: number): void {
    if (!this.started) return;
    ramp(this.level.gain, 0, sec / 3);
    const c = ctx!;
    setTimeout(() => {
      try { this.o1.stop(); this.o2.stop(); this.lfo.stop(); } catch { /* already stopped */ }
      this.started = false;
    }, (sec + 0.5) * 1000);
    void c;
  }
}
