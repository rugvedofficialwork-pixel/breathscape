import { clamp, glide, lerp } from '../core/math';
import type { Pos } from '../core/coords';
import { noiseSource } from '../synth/noise';
import type { CueDef } from '../types';
import type { CustomCue } from './custom';
import { CueRun } from './run';

type Phase = 'inhale' | 'hold' | 'exhale' | 'rest';
const PHASES: Phase[] = ['inhale', 'hold', 'exhale', 'rest'];
export type DroneMode = 'timeline' | 'hand' | 'blend';

interface DroneDef extends CueDef {
  pos: Pos;
  rootHz: number;
  /** Pitch rise at the top of the breath. */
  semitones: number;
  phaseSec: number;
  cycles: number;
  mode: DroneMode;
  /** In 'blend' mode: 0 = all timeline, 1 = all hand. */
  handBlend: number;
  pitchGlideSec: number;
  /** Seconds from the cue until cycle 1's inhale (the drone rests at its root until then). */
  firstInhaleIn: number;
  /** Per cycle (1..6): level, low-pass cutoff, upper-harmonic amount. Cycle 6 is almost bare. */
  cycleLevel: number[];
  cycleCutoffHz: number[];
  cycleHarmonics: number[];
  timbreGlideSec: number;
  /** Level multiplier during "rest". */
  restDip: number;
  /** Soft breath-noise that follows the movement of the breath (0 = off). */
  air: number;
  crossfadeFrom?: string;
  crossfadeSec?: number;
  cueTones: {
    /** 'all' = every phase change in every cycle; 'cycle6' = only in the silent last cycle. */
    cycles: 'all' | 'cycle6';
    level: number;
    cycle6Level: number;
    hz: Record<Phase, number>;
    decaySec: number;
    pos: Pos;
    wet: number;
  };
  close: { thinSec: number; level: number; cutoffHz: number; fadeSec: number };
}

const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1));

/**
 * Stage 1 breath drone.
 *
 * Pitch rises on inhale, sustains on hold, falls on exhale, rests; each cycle
 * is quieter, darker and has fewer harmonics. The breath position comes from
 * the cycle timeline, the hand, or a blend (control 'mode').
 *
 * Controls (audio.cueControl('stage1.breathDrone', name, value)):
 *   'mode'  'timeline' | 'hand' | 'blend'
 *   'blend' 0..1
 *   'sync'  { cycle: 1..6, phase: 'inhale'|'hold'|'exhale'|'rest' }  re-anchor to the main project's breath clock
 *   'close' (no value) thin down to almost nothing (the "close your eyes" line)
 */
export const breathDrone: CustomCue = (eng, id, def0, opts) => {
  const def = def0 as DroneDef;
  const c = eng.ctx;
  const t0 = eng.now + 0.03;

  // crossfade out of the pre-session warm tone, if it is playing
  let fadeIn = def.fadeIn ?? 3;
  const from = def.crossfadeFrom ? eng.getRunning(def.crossfadeFrom) : undefined;
  if (from) {
    fadeIn = def.crossfadeSec ?? 5;
    from.stop(fadeIn);
  }

  const src = eng.createSource({ label: def.label ?? id, bus: def.bus ?? 'bed', pos: def.pos, wet: def.wet });
  const pitch = new ConstantSourceNode(c, { offset: 0 }); // cents, drives every oscillator's detune
  const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: def.cycleCutoffHz[0], Q: 0.5 });
  const harm = new GainNode(c, { gain: def.cycleHarmonics[0] });
  const level = new GainNode(c, { gain: def.cycleLevel[0] });
  const nodes: AudioScheduledSourceNode[] = [pitch];

  const partial = (mult: number, amp: number, type: OscillatorType, detune: number, dest: AudioNode) => {
    const o = new OscillatorNode(c, { type, frequency: def.rootHz * mult, detune });
    pitch.connect(o.detune);
    o.connect(new GainNode(c, { gain: amp })).connect(dest);
    nodes.push(o);
  };
  partial(1, 0.5, 'sine', -4, lp);
  partial(1, 0.5, 'sine', 4, lp);
  partial(2, 0.3, 'triangle', 0, harm);
  partial(3, 0.12, 'sine', 3, harm);
  partial(4, 0.05, 'sine', -3, harm);
  harm.connect(lp);

  const n = noiseSource(c, 'pink');
  const airBp = new BiquadFilterNode(c, { type: 'bandpass', frequency: 650, Q: 0.9 });
  const airGain = new GainNode(c, { gain: 0 });
  n.node.connect(airBp).connect(airGain).connect(lp);
  nodes.push(n.node);

  lp.connect(level).connect(src.input);
  n.start(t0);
  for (const x of nodes) if (x !== n.node) x.start(t0);
  src.fadeTo(1, fadeIn, t0);

  // soft tones that mark each phase change
  const ct = def.cueTones;
  const tones = eng.createSource({ label: 'breath cues', bus: 'fx', pos: ct.pos, wet: ct.wet });
  tones.fadeTo(1, 0.15, t0);
  const tone = (hz: number, vol: number) => {
    if (vol <= 0) return;
    const t = eng.now + 0.01;
    const env = new GainNode(c, { gain: 0 });
    const o1 = new OscillatorNode(c, { type: 'sine', frequency: hz });
    const o2 = new OscillatorNode(c, { type: 'sine', frequency: hz * 2 });
    o1.connect(env);
    o2.connect(new GainNode(c, { gain: 0.12 })).connect(env);
    env.connect(tones.input);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.15);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ct.decaySec);
    o1.start(t);
    o2.start(t);
    o1.stop(t + ct.decaySec + 0.1);
    o2.stop(t + ct.decaySec + 0.1);
    eng.at(t + ct.decaySec + 0.2, () => env.disconnect());
  };

  // ---------------------------------------------------------------- state
  let anchor = t0 + ((opts.firstInhaleIn as number | undefined) ?? def.firstInhaleIn ?? 0);
  let mode: DroneMode = (opts.mode as DroneMode | undefined) ?? def.mode;
  let blend = def.handBlend;
  let closing = false;
  let lastIdx = -1;
  let lastCycle = 0;
  let prevV = 0;
  let airEnv = 0;
  const totalPhases = def.cycles * 4;

  const where = (now: number) => {
    const el = now - anchor;
    if (el < 0) return { idx: -1, cycle: 0, phase: 'rest' as Phase, b: 0 };
    const idx = Math.floor(el / def.phaseSec);
    if (idx >= totalPhases) return { idx: totalPhases, cycle: def.cycles - 1, phase: 'rest' as Phase, b: 0 };
    const u = (el - idx * def.phaseSec) / def.phaseSec;
    const phase = PHASES[idx % 4];
    const b = phase === 'inhale' ? ease(u) : phase === 'hold' ? 1 : phase === 'exhale' ? 1 - ease(u) : 0;
    return { idx, cycle: Math.floor(idx / 4), phase, b };
  };

  const tick = (dt: number, now: number) => {
    const s = where(now);
    if (!closing && s.idx >= 0 && s.idx < totalPhases && s.idx !== lastIdx) {
      lastIdx = s.idx;
      const last = s.cycle === def.cycles - 1;
      if (ct.cycles === 'all' || last) tone(ct.hz[s.phase], last ? ct.cycle6Level : ct.level);
      eng.emit('marker', { cue: id, name: `cycle ${s.cycle + 1} ${s.phase}` });
    }
    if (!closing && s.cycle !== lastCycle) {
      lastCycle = s.cycle;
      glide(lp.frequency, def.cycleCutoffHz[s.cycle], now, def.timbreGlideSec / 3);
      glide(harm.gain, def.cycleHarmonics[s.cycle], now, def.timbreGlideSec / 3);
    }
    const hand = eng.params.get('handHeight');
    const v = mode === 'timeline' ? s.b : mode === 'hand' ? hand : lerp(s.b, hand, blend);
    pitch.offset.setTargetAtTime(v * def.semitones * 100, now, Math.max(0.02, def.pitchGlideSec / 3));

    // breath air follows how fast the breath is moving (about 1 during inhale/exhale)
    const speed = dt > 0 ? (Math.abs(v - prevV) / dt) * def.phaseSec : 0;
    prevV = v;
    airEnv += (clamp(speed, 0, 1.5) - airEnv) * (1 - Math.exp(-dt / 0.3));
    airGain.gain.setTargetAtTime(def.air * airEnv * (closing ? 0 : 1), now, 0.1);

    if (!closing) {
      const target = def.cycleLevel[s.cycle] * (s.phase === 'rest' && s.idx >= 0 ? def.restDip : 1);
      level.gain.setTargetAtTime(target, now, 0.5);
    }
  };
  const unsub = eng.clock.onTick(tick);

  const run = new CueRun(id, eng, t0, {}, (f) => {
    src.release(f);
    tones.release(f);
  }, def.fadeOut ?? 4);

  run.onControl = (name, value) => {
    const now = eng.now;
    if (name === 'mode' && (value === 'timeline' || value === 'hand' || value === 'blend')) mode = value;
    else if (name === 'blend' && typeof value === 'number') blend = clamp(value, 0, 1);
    else if (name === 'sync' && value && typeof value === 'object') {
      const v = value as { cycle: number; phase: Phase };
      const k = (clamp(Math.round(v.cycle), 1, def.cycles) - 1) * 4 + Math.max(0, PHASES.indexOf(v.phase));
      anchor = now - k * def.phaseSec;
    } else if (name === 'close' && !closing) {
      closing = true;
      const cl = def.close;
      glide(level.gain, cl.level, now, cl.thinSec / 3);
      glide(lp.frequency, cl.cutoffHz, now, cl.thinSec / 3);
      glide(harm.gain, 0, now, cl.thinSec / 3);
      if (cl.fadeSec > 0) eng.at(now + cl.thinSec, () => run.stop(cl.fadeSec));
    }
  };

  src.whenEnded(() => {
    unsub();
    for (const x of nodes) {
      try {
        x.stop();
      } catch {
        /* stopped */
      }
    }
    run.finish();
  });
  return run;
};

/** "...you can close your eyes": the drone (and any warm tone) thins down to almost nothing. */
export const stage1Close: CustomCue = (eng, id, def) => {
  eng.cueControl('stage1.breathDrone', 'close');
  const thin = (def.thinSec as number | undefined) ?? 8;
  eng.getRunning('pre.warmTone')?.stop(thin);
  const run = new CueRun(id, eng, eng.now, {}, () => undefined, 0);
  eng.at(eng.now + thin, () => run.finish());
  return run;
};
