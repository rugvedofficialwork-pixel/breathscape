import type { Pos } from '../core/coords';
import { clamp, lerp } from '../core/math';
import { Path } from '../core/paths';
import { kRate, type SpatialSource } from '../core/source';
import { water, wind, type LiveSound, type WindOpts } from '../synth/nature';
import { noiseSource } from '../synth/noise';
import { heartbeat } from '../synth/pulse';
import type { CueDef } from '../types';
import type { CustomCue } from './custom';
import { CueRun } from './run';

// ======================================================================= Part A: portal
interface PortalDef extends CueDef {
  /** The small point in front where the portal opens. */
  start: Pos;
  startSpreadDeg: number;
  /** Where each part of the whoosh ends up (all around, some above, closer in). */
  targets: Pos[];
  moveSec: number;
  /** Band-pass sweep of the noise, Hz: low -> high while opening, then back down. */
  bandHz: [number, number];
  attackSec: number;
  peakAt: number;
  releaseSec: number;
  /** Per-source level. */
  levelEach: number;
  /** Low sine under the whoosh (tuned to the lingering low tone so one resolves into the other). */
  sub: { hz: number; level: number };
  /** Cue that fades out as the portal opens (the Stage 2 low tone). */
  resolves?: string;
  /** Part G: play it softer and backwards (from all around, contracting to a point in front). */
  reverse?: boolean;
  /** Overall level multiplier (Part G's whoosh is softer). */
  levelScale?: number;
}

/**
 * "Step through.": a low whoosh that starts as a small source in front and
 * sweeps out to surround the listener (several decorrelated sources fanning out,
 * some slightly above, closing in). With reverse: true it plays backwards.
 */
export const portal: CustomCue = (eng, id, def0) => {
  const def = def0 as PortalDef;
  const c = eng.ctx;
  const t0 = eng.now + 0.03;
  const n = def.targets.length;
  const total = def.peakAt + def.releaseSec;
  const [lo, hi] = def.bandHz;
  if (def.resolves) eng.stopCue(def.resolves, def.attackSec + 1);

  const sources: SpatialSource[] = [];
  const nodes: AudioScheduledSourceNode[] = [];
  def.targets.forEach((target, i) => {
    const offset = n > 1 ? (i / (n - 1) - 0.5) * def.startSpreadDeg : 0;
    const point: Pos = { ...def.start, az: def.start.az + offset };
    const [from, to] = def.reverse ? [target, point] : [point, target];
    const src = eng.createSource({ label: `${def.label ?? id} ${i + 1}`, bus: def.bus ?? 'fx', pos: from, wet: def.wet });
    src.followPath(new Path({ points: [{ t: 0, ...from }, { t: def.moveSec, ...to }] }), t0);
    src.fadeTo(def.levelEach * (def.levelScale ?? 1), 0.15, t0);

    const env = new GainNode(c, { gain: 0 });
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + def.attackSec);
    env.gain.setValueAtTime(1, t0 + def.peakAt);
    env.gain.setTargetAtTime(0, t0 + def.peakAt, def.releaseSec / 4);

    const noise = noiseSource(c, 'pink');
    const k = 1 + 0.18 * i; // each part a slightly different colour
    const bp = new BiquadFilterNode(c, { type: 'bandpass', Q: 0.8 });
    const [a, b] = def.reverse ? [hi * k, lo * k] : [lo * k, hi * k];
    bp.frequency.setValueAtTime(a, t0);
    bp.frequency.exponentialRampToValueAtTime(b, t0 + def.peakAt);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, lo * 0.7 * k), t0 + total);
    noise.node.connect(bp).connect(env).connect(src.input);
    noise.start(t0);
    nodes.push(noise.node);

    if (i === 0 && def.sub.level > 0) {
      const sub = new OscillatorNode(c, { type: 'sine', frequency: def.sub.hz });
      sub.connect(new GainNode(c, { gain: def.sub.level })).connect(env);
      sub.start(t0);
      nodes.push(sub);
    }
    sources.push(src);
  });

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => sources.forEach((s) => s.release(f)), 0.5);
  eng.at(t0 + total, () => run.stop(0.3));
  let left = sources.length;
  for (const s of sources) {
    s.whenEnded(() => {
      if (--left === 0) {
        for (const x of nodes) {
          try {
            x.stop();
          } catch {
            /* stopped */
          }
        }
        run.finish();
      }
    });
  }
  return run;
};

// ======================================================================= Part B: world bed
interface BedDef extends CueDef {
  wind: Omit<WindOpts, 'file' | 'gustFile' | 'bandHz'> & {
    sources: Pos[];
    level: number;
    wet: number;
    bandHz: number[];
    /** Slow azimuth drift of each wind source, degrees (more when windier). */
    wanderDeg: number;
    wanderPeriodSec: number;
    /** How many wind sources drift (moving sources are expensive; the rest stay still). */
    wanderCount?: number;
    file?: string;
    gustFile?: string;
  };
  water: { sources: Pos[]; level: number; wet: number; lowpassHz: number; file?: string; fileLowpassHz?: number; fileGain?: number };
}

/**
 * One source of the world bed. The word effects in Part F shape these per source:
 * `quiet` 0..1 (level down + darker: Courage's pocket of calm) and
 * `still` 0..1 (slower, gentler movement: Calm's stillness spreading).
 */
export interface BedVoice {
  src: SpatialSource;
  sound: LiveSound;
  local: GainNode;
  lp: BiquadFilterNode;
  kind: 'wind' | 'water';
  base: Pos;
  level: number;
  quiet: number;
  still: number;
  /** Last quiet/still sent to the audio graph (to skip repeats). */
  shape?: string;
}

/**
 * New world bed: wind from several directions (some elevated, all gently
 * moving) and distant moving water at a fixed spot. Wind follows the
 * windIntensity param (the timeline raises it in Part C).
 * Recordings from assets/ are used when present.
 */
export const ambientBed: CustomCue = (eng, id, def0) => {
  const def = def0 as BedDef;
  const c = eng.ctx;
  const t0 = eng.now + 0.03;
  const w = def.wind;
  const windFile = w.file ? eng.assets.peek(w.file) : null;
  const gustFile = w.gustFile ? eng.assets.peek(w.gustFile) : null;
  const waterFile = def.water.file ? eng.assets.peek(def.water.file) : null;
  eng.emit('log', `bed: wind ${windFile ? 'recording' : 'generated'}, water ${waterFile ? 'recording' : 'generated'}`);

  const voices: BedVoice[] = [];
  const add = (kind: 'wind' | 'water', base: Pos, sound: LiveSound, level: number, wet: number, i: number) => {
    const src = eng.createSource({ label: `${kind} ${i + 1}`, bus: def.bus ?? 'bed', pos: base, wet });
    const local = new GainNode(c, { gain: 1 });
    const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    kRate(lp.frequency);
    sound.out.connect(lp).connect(local).connect(src.input);
    sound.start(t0);
    src.fadeTo(level, def.fadeIn ?? 6, t0);
    voices.push({ src, sound, local, lp, kind, base, level, quiet: 0, still: 0 });
  };
  w.sources.forEach((p, i) =>
    add('wind', p, wind(c, { ...w, bandHz: w.bandHz[i % w.bandHz.length], gustHz: [w.gustHz[0] * (1 + 0.23 * i), w.gustHz[1] * (1 + 0.17 * i)], file: windFile, gustFile }), w.level, w.wet, i),
  );
  def.water.sources.forEach((p, i) => add('water', p, water(c, { lowpassHz: def.water.lowpassHz, file: waterFile, fileLowpassHz: def.water.fileLowpassHz, fileGain: def.water.fileGain }), def.water.level, def.water.wet, i));

  let waterActivity = 1;
  let n = 0;
  const unsub = eng.clock.onTick((_dt, now) => {
    if (n++ % 3) return; // 10 Hz is plenty for slow changes
    const I = eng.params.get('windIntensity');
    const moveNow = n % 9 === 1; // positions ~3 times a second: the drift is very slow
    voices.forEach((v, i) => {
      // per-source shaping from the word effects (0 = untouched); only sent when it changes
      const shape = `${v.quiet.toFixed(3)}|${v.still.toFixed(3)}`;
      if (shape !== v.shape) {
        v.shape = shape;
        v.local.gain.setTargetAtTime((1 - 0.9 * v.quiet) * (1 - 0.5 * v.still), now, 0.3);
        v.lp.frequency.setTargetAtTime(20000 * Math.pow(0.035, v.quiet), now, 0.3);
      }
      if (v.kind === 'water') {
        v.sound.setIntensity(waterActivity * (1 - 0.85 * v.still), now);
        return;
      }
      v.sound.setIntensity(I * (1 - 0.9 * v.still), now);
      // A moving HRTF source costs ~7x a still one, so only the first few wind sources drift;
      // the rest stay put (their gusts still give a sense of moving air).
      if (!moveNow || i >= (w.wanderCount ?? 2)) return;
      const phase = (2 * Math.PI * now) / (w.wanderPeriodSec * (1 + 0.31 * i)) + i * 1.7;
      const az = v.base.az + w.wanderDeg * (0.6 + 0.8 * I) * (1 - 0.8 * v.still) * Math.sin(phase);
      v.src.setPosition({ ...v.base, az }, 1.2, now);
    });
  });

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => voices.forEach((v) => v.src.release(f)), def.fadeOut ?? 6);
  run.onControl = (name, value) => {
    if (name === 'waterActivity' && typeof value === 'number') waterActivity = clamp(value, 0, 1);
    // 'master' 0..1: overall bed level (Part G: fades with the hands coming down)
    if (name === 'master' && typeof value === 'number') {
      const m = clamp(value, 0, 1);
      for (const v of voices) if (!v.src.isReleased) v.src.fadeTo(v.level * m, 0.25);
    }
  };
  run.shared.voices = voices;
  let left = voices.length;
  for (const v of voices) {
    v.src.whenEnded(() => {
      v.sound.stop(eng.now);
      if (--left === 0) {
        unsub();
        run.finish();
      }
    });
  }
  return run;
};

// ======================================================================= Part C: tension pulse
interface TrialDef extends CueDef {
  from: Pos;
  to: Pos;
  /** How long the approach takes (roughly the length of Part C). */
  durationSec: number;
  bpm: [number, number];
  /** Beat level at the start and end of the approach (distance adds its own rise). */
  beatLevel: [number, number];
  thumpHz: number;
  resolve: { bpm: number; slowSec: number; fadeSec: number };
}

/**
 * Low, heartbeat-like pulse in front that approaches over Part C: from far and
 * quiet to close, gradually louder and slightly faster.
 * Control 'resolve': slows and fades (Part D, "The path opens.").
 */
export const trial: CustomCue = (eng, id, def0, opts) => {
  const def = def0 as TrialDef;
  const c = eng.ctx;
  const t0 = eng.now + 0.03;
  const dur = (opts.durationSec as number | undefined) ?? def.durationSec;
  const src = eng.createSource({ label: def.label ?? id, bus: def.bus ?? 'fx', pos: def.from, wet: def.wet });
  src.followPath(new Path({ points: [{ t: 0, ...def.from }, { t: dur, ...def.to }] }), t0);
  src.fadeTo(def.level ?? 1, def.fadeIn ?? 3, t0);

  let next = t0 + 0.5;
  let resolving: { at: number; fromBpm: number } | null = null;
  let bpm = def.bpm[0];
  const unsub = eng.clock.onTick((_dt, now) => {
    const p = clamp((now - t0) / dur, 0, 1);
    if (resolving) {
      const u = clamp((now - resolving.at) / def.resolve.slowSec, 0, 1);
      bpm = lerp(resolving.fromBpm, def.resolve.bpm, u);
    } else {
      bpm = lerp(def.bpm[0], def.bpm[1], p);
    }
    const amp = lerp(def.beatLevel[0], def.beatLevel[1], p);
    while (next < now + 0.3) {
      heartbeat(c, src.input, next, amp, def.thumpHz, bpm);
      next += 60 / bpm;
    }
  });

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => src.release(f), def.fadeOut ?? 4);
  run.onControl = (name) => {
    if (name === 'resolve' && !resolving) {
      resolving = { at: eng.now, fromBpm: bpm };
      eng.at(eng.now + def.resolve.slowSec * 0.4, () => run.stop(def.resolve.fadeSec));
    }
  };
  src.whenEnded(() => {
    unsub();
    run.finish();
  });
  return run;
};

// ======================================================================= Part D: resolve
/**
 * "The path opens.": the pulse slows and fades, the wind settles, and a clear
 * rising tone (centred, steady) takes its place.
 */
export const resolve: CustomCue = (eng, id, def) => {
  const settle = (def.windSettleSec as number | undefined) ?? 8;
  eng.cueControl((def.pulse as string | undefined) ?? 'stage3.partC.trial', 'resolve');
  eng.rampParam('windIntensity', (def.windTo as number | undefined) ?? 0.3, settle);
  const tone = (def.tone as string | undefined) ?? 'stage3.partD.risingTone';
  eng.at(eng.now + ((def.toneDelay as number | undefined) ?? 2.5), () => eng.cue(tone));
  const run = new CueRun(id, eng, eng.now, {}, () => undefined, 0);
  eng.at(eng.now + settle, () => run.finish());
  return run;
};
