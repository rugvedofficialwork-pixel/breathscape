import type { Pos } from '../core/coords';
import { clamp, lerp } from '../core/math';
import { kRate, type SpatialSource } from '../core/source';
import type { Engine } from '../engine';
import { wind } from '../synth/nature';
import { chime, heartbeat } from '../synth/pulse';
import { makeSound } from '../synth/sounds';
import type { CueDef, Word } from '../types';
import type { CustomCue } from './custom';
import { CueRun } from './run';
import type { BedVoice } from './stage3';

const BED = 'stage3.partB.ambientBed';
const EFFECT = 'stage3.partF.effect';

/** Stop a set of nodes, ignoring ones already stopped. */
const stopNodes = (nodes: AudioScheduledSourceNode[]) => {
  for (const n of nodes) {
    try {
      n.stop();
    } catch {
      /* stopped */
    }
  }
};

const lastSet = new WeakMap<AudioParam, number>();

/** Glide a param to a value, but only if it differs noticeably from what was last sent (saves the audio thread work). */
function setIfChanged(p: AudioParam, value: number, now: number, tc: number): void {
  const last = lastSet.get(p);
  if (last !== undefined && Math.abs(value - last) <= Math.max(1e-4, Math.abs(last) * 0.005)) return;
  lastSet.set(p, value);
  p.setTargetAtTime(value, now, tc);
}

/** Finish `run` once every source has faded out and been freed. */
function finishWhenGone(run: CueRun, sources: SpatialSource[], cleanup: () => void): void {
  let left = sources.length;
  if (left === 0) {
    cleanup();
    run.finish();
    return;
  }
  for (const s of sources) {
    s.whenEnded(() => {
      if (--left === 0) {
        cleanup();
        run.finish();
      }
    });
  }
}

// ======================================================================= Part E: swell
interface SwellDef extends CueDef {
  rootHz: number;
  /** Frequency ratios of the partials, low to high; each is its own source. */
  partials: number[];
  /** Where each partial ends up at armsRaised = 1 (at 0 they are all centred in front). */
  targets: Pos[];
  /** Seconds between partials entering (low first: the swell rises). */
  stepSec: number;
  riseSec: number;
  holdSec: number;
  /** Level it settles to after the swell, 0..1 of the peak. */
  sustain: number;
  settleSec: number;
  /** Cue this one replaces (the Part D rising tone), and how fast it fades. */
  replaces?: string;
  replaceFadeSec?: number;
}

/**
 * Part E: a rising harmonic swell. Partials enter low to high and swell, then
 * settle to a soft sustain. Its width follows armsRaised: narrow and centred
 * at 0, spread around the listener at 1 (and holds wherever the arms hold).
 */
export const swell: CustomCue = (eng, id, def0) => {
  const def = def0 as SwellDef;
  const c = eng.ctx;
  const t0 = eng.now + 0.03;
  if (def.replaces) eng.stopCue(def.replaces, def.replaceFadeSec ?? 6);
  const level = def.level ?? 0.1;
  const centre: Pos = { az: 0, el: 0, dist: def.targets[0]?.dist ?? 2 };
  const parts = def.partials.map((ratio, i) => {
    const src = eng.createSource({ label: `swell ${i + 1}`, bus: def.bus ?? 'fx', pos: centre, wet: def.wet });
    const amp = 0.5 / (1 + i * 0.5);
    const nodes: OscillatorNode[] = [];
    for (const detune of [-3, 3]) {
      const o = new OscillatorNode(c, { type: 'sine', frequency: def.rootHz * ratio, detune });
      o.connect(new GainNode(c, { gain: amp / 2 })).connect(src.input);
      o.start(t0);
      nodes.push(o);
    }
    const start = t0 + i * def.stepSec;
    src.fadeTo(level, def.riseSec, start);
    eng.at(start + def.riseSec + def.holdSec, () => {
      if (!src.isReleased) src.fadeTo(level * def.sustain, def.settleSec);
    });
    return { src, nodes, target: def.targets[i % def.targets.length] };
  });

  let n = 0;
  const unsub = eng.clock.onTick((_dt, now) => {
    if (n++ % 3) return; // ~10 updates a second; the glide fills in between
    const s = eng.params.get('armsRaised');
    for (const p of parts) {
      if (p.src.isReleased) continue;
      p.src.setPosition({ az: p.target.az * s, el: p.target.el * s, dist: lerp(centre.dist, p.target.dist, s) }, 0.4, now);
    }
  });

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => parts.forEach((p) => p.src.release(f)), def.fadeOut ?? 6);
  finishWhenGone(run, parts.map((p) => p.src), () => {
    unsub();
    parts.forEach((p) => stopNodes(p.nodes));
  });
  return run;
};

// ======================================================================= Part F: word effects
type Focus = 'free' | 'gather' | 'chest' | 'in';

interface WordEffect {
  sources: SpatialSource[];
  /** I = smoothed wristSpread 0..1, x = userScreenX -1..1, m = master 0..1 (Part G). */
  tick(now: number, dt: number, I: number, x: number, m: number): void;
  focus(stage: Focus, now: number): void;
  /** Called on stop: fade own sources, hand the world bed back. */
  release(fadeSec: number): void;
  cleanup(): void;
}

interface EffectDef extends CueDef {
  /** Cues to fade out when the effect starts (the Part E swell). */
  replaces?: string[];
  replaceFadeSec?: number;
  /** Positions the F2 proposals move the effect to. */
  fingertips: Pos;
  chest: Pos;
  kindness: KindnessDef;
  acceptance: AcceptanceDef;
  courage: CourageDef;
  calm: CalmDef;
  glow: { level: number; hz: number; wet: number };
}

/**
 * Part F: the word's effect layer, driven by wristSpread (and userScreenX for
 * Kindness). It follows the arms and never escalates by itself: if the arms
 * stop widening, it holds; if they come in, it recedes at the same rate.
 * Kindness is specified by the script; Acceptance, Courage and Calm are proposals.
 *
 * Controls: 'focus' 'free' | 'gather' | 'chest' | 'in' (Part F2 proposals),
 *           'master' 0..1 (Part G, fades with the hands).
 */
export const wordEffect: CustomCue = (eng, id, def0, opts) => {
  const def = def0 as EffectDef;
  const t0 = eng.now + 0.03;
  for (const r of def.replaces ?? []) eng.stopCue(r, def.replaceFadeSec ?? 6);
  const word = (opts.word as Word | undefined) ?? eng.word;
  const fx =
    word === 'acceptance' ? acceptanceEffect(eng, def, t0)
    : word === 'courage' ? courageEffect(eng, def, t0)
    : word === 'calm' ? calmEffect(eng, def, t0)
    : kindnessEffect(eng, def, t0);
  eng.emit('log', `effect: ${word}${word === 'kindness' ? '' : ' (proposal)'}`);

  let master = 1;
  let masterTarget = 1;
  let n = 0;
  let acc = 0;
  const unsub = eng.clock.onTick((dt, now) => {
    master += (masterTarget - master) * (1 - Math.exp(-dt / 0.15));
    acc += dt;
    // Kindness needs every tick (chime timing); the others move slowly: ~10 updates a second
    if (word !== 'kindness' && n++ % 3) return;
    fx.tick(now, acc, eng.params.get('wristSpread'), eng.params.get('userScreenX'), master);
    acc = 0;
  });

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => fx.release(f), def.fadeOut ?? 4);
  run.onControl = (name, value) => {
    if (name === 'focus' && typeof value === 'string') fx.focus(value as Focus, eng.now);
    if (name === 'master' && typeof value === 'number') masterTarget = clamp(value, 0, 1);
  };
  // an effect with no sources of its own (unlikely) still ends when stopped
  const sources = fx.sources;
  if (sources.length === 0) {
    const origStop = run.stop.bind(run);
    run.stop = (f?: number) => {
      origStop(f);
      eng.at(eng.now + (f ?? def.fadeOut ?? 4), () => {
        unsub();
        fx.cleanup();
        run.finish();
      });
    };
  } else {
    finishWhenGone(run, sources, () => {
      unsub();
      fx.cleanup();
    });
  }
  return run;
};

// ---------------------------------------------------------------- Kindness (from the script)
interface KindnessDef {
  poolSize: number;
  /** Chimes per second at wristSpread 0 and 1. */
  rate: [number, number];
  /** Degrees of azimuth the chimes spread over at wristSpread 0 and 1. */
  widthDeg: [number, number];
  /** userScreenX -1..1 maps to this many degrees left/right: where the bloom starts. */
  screenAzDeg: number;
  elDeg: [number, number];
  dist: [number, number];
  notes: number[];
  level: number;
  decaySec: number;
  wet: number;
}

/**
 * Soft chimes blooming outward from the user's on-screen position. wristSpread
 * sets how many and how far around they scatter: a few near the start point,
 * up to chimes all around the listener.
 */
function kindnessEffect(eng: Engine, def: EffectDef, t0: number): WordEffect {
  const k = def.kindness;
  const c = eng.ctx;
  const pool = Array.from({ length: k.poolSize }, (_, i) => {
    const src = eng.createSource({ label: `chime ${i + 1}`, bus: 'fx', pos: { az: 0, el: 0, dist: 1.5 }, wet: k.wet });
    src.fadeTo(1, 0.2, t0);
    return { src, lastUsed: -1 };
  });
  let focus: Focus = 'free';
  const place = (I: number, x: number): Pos => {
    if (focus === 'gather') return { az: (Math.random() - 0.5) * 30, el: def.fingertips.el, dist: def.fingertips.dist };
    if (focus === 'chest') return { az: (Math.random() - 0.5) * 10, el: def.chest.el, dist: def.chest.dist };
    const start = x * k.screenAzDeg;
    const width = lerp(k.widthDeg[0], k.widthDeg[1], Math.pow(I, 1.2));
    return {
      az: start + (Math.random() - 0.5) * width,
      el: lerp(k.elDeg[0], lerp(k.elDeg[0], k.elDeg[1], I), Math.random()),
      dist: lerp(k.dist[0], lerp(k.dist[0], k.dist[1], I), Math.random()),
    };
  };
  let nextAt = t0 + 0.3;
  return {
    sources: pool.map((p) => p.src),
    tick(now, _dt, I, x, m) {
      const rate = focus === 'free' ? lerp(k.rate[0], k.rate[1], I) : focus === 'in' ? 0 : focus === 'gather' ? 0.9 : 0.5;
      if (rate <= 0 || m < 0.02) {
        nextAt = now + 0.5;
        return;
      }
      if (now < nextAt) return;
      // irregular spacing (never a metronome)
      nextAt = now + (0.5 + Math.random()) / rate;
      const voice = pool.reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b));
      voice.lastUsed = now;
      voice.src.setPosition(place(I, x), 0.05, now);
      // wider arms bring in the higher notes; gathered, the notes drop an octave (smaller, closer)
      const top = focus === 'free' ? Math.max(2, Math.round(lerp(3, k.notes.length, I))) : 3;
      const hz = k.notes[Math.floor(Math.random() * top)] * (focus === 'chest' ? 0.5 : 1);
      chime(c, voice.src.input, now + 0.07, hz, k.level * m * (0.6 + 0.4 * Math.random()), k.decaySec);
    },
    focus(stage) {
      focus = stage;
    },
    release(f) {
      pool.forEach((p) => p.src.release(f));
    },
    cleanup() {},
  };
}

// ---------------------------------------------------------------- Acceptance (replaces Strength)
interface AcceptanceDef {
  /** Wind that keeps moving past the listener and is never quieted (that is Courage and Calm). */
  pass: { count: number; dist: [number, number]; el: number; speedDegPerSec: number; level: number; wet: number; lowpassHz: [number, number] };
  /** The room: an open, warm chord that widens to the sides and gains space as the arms open. */
  room: { rootHz: number; core: Pos; level: number; sideAzDeg: [number, number]; wet: number };
}

/**
 * Acceptance as making room (acceptance and commitment therapy's "expansion"): the wind keeps blowing at the same
 * level. wristSpread does not push it away; it softens its edge and brings its path closer, so it passes through
 * the listener's space rather than against it. Meanwhile an open fifth (no major or minor colour) widens to both
 * sides: there is more room. The same chord carries the F2 gather / chest / let-it-in stages.
 */
function acceptanceEffect(eng: Engine, def: EffectDef, t0: number): WordEffect {
  const a = def.acceptance;
  const c = eng.ctx;
  const nodes: OscillatorNode[] = [];
  const bedDef = eng.cues.cues[BED] as unknown as { wind: Parameters<typeof wind>[1] };
  const pass = Array.from({ length: a.pass.count }, (_, i) => {
    const src = eng.createSource({ label: `passing wind ${i + 1}`, bus: 'bed', pos: { az: -90, el: a.pass.el, dist: a.pass.dist[0] }, wet: a.pass.wet });
    const snd = wind(c, { ...bedDef.wind, bandHz: 650 + 280 * i, gustHz: [0.08 + 0.03 * i, 0.14 + 0.02 * i], file: eng.assets.peek('wind_loop.wav') ?? null, gustFile: null });
    const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: a.pass.lowpassHz[0], Q: 0.5 });
    kRate(lp.frequency);
    const g = new GainNode(c, { gain: 1 });
    snd.out.connect(lp).connect(g).connect(src.input);
    snd.start(t0);
    snd.setIntensity(0.6, t0);
    src.fadeTo(a.pass.level, 3, t0);
    return { src, snd, lp, g, offset: i * 180 };
  });

  const osc = (hz: number, amp: number, dest: AudioNode, detune = 0) => {
    const o = new OscillatorNode(c, { type: 'sine', frequency: hz, detune });
    o.connect(new GainNode(c, { gain: amp })).connect(dest);
    o.start(t0);
    nodes.push(o);
  };
  const sides = [-1, 1].map((side) => {
    const src = eng.createSource({ label: `room ${side < 0 ? 'left' : 'right'}`, bus: 'fx', pos: a.room.core, wet: a.room.wet });
    const g = new GainNode(c, { gain: 0 });
    const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 900, Q: 0.5 });
    g.connect(lp).connect(src.input);
    osc(a.room.rootHz, 0.35, g, side * 4);
    osc(a.room.rootHz * 1.5, 0.25, g, -side * 3);
    osc(a.room.rootHz * 2, 0.12, g);
    src.fadeTo(a.room.level, 4, t0);
    return { src, g, lp, side };
  });

  let focus: Focus = 'free';
  return {
    sources: [...pass.map((p) => p.src), ...sides.map((x) => x.src)],
    tick(now, _dt, I, _x, m) {
      const tc = 0.3;
      // drawn in (F2): the wind has passed; it fades back, and the room is what is gathered
      const windAmt = focus === 'free' ? 1 : focus === 'gather' ? 0.5 : 0.2;
      for (const p of pass) {
        const az = ((((now * a.pass.speedDegPerSec + p.offset) % 360) + 540) % 360) - 180; // always moving past, left to right
        p.src.setPosition({ az, el: a.pass.el, dist: lerp(a.pass.dist[0], a.pass.dist[1], I) }, 0.3, now);
        setIfChanged(p.g.gain, windAmt * m, now, tc); // the same level whatever the arms do
        setIfChanged(p.lp.frequency, lerp(a.pass.lowpassHz[0], a.pass.lowpassHz[1], Math.pow(I, 0.8)), now, tc);
      }
      for (const x of sides) {
        let pos: Pos;
        let amt: number;
        if (focus === 'free') {
          pos = { az: x.side * lerp(a.room.sideAzDeg[0], a.room.sideAzDeg[1], I), el: a.room.core.el, dist: lerp(a.room.core.dist, a.room.core.dist * 2.2, I) };
          amt = 0.06 + 0.94 * I; // opening the arms is heard at once: the room swells from almost nothing
        } else if (focus === 'gather') {
          pos = { ...def.fingertips, az: def.fingertips.az + x.side * 8 };
          amt = 0.45;
        } else {
          pos = def.chest;
          amt = focus === 'in' ? 0.12 : 0.35;
        }
        x.src.setPosition(pos, focus === 'free' ? 0.4 : 1.5, now);
        setIfChanged(x.g.gain, amt * m, now, tc);
        // and it brightens as it opens (a closed room is dull, an open one airy)
        setIfChanged(x.lp.frequency, focus === 'free' ? 500 + 2600 * I : 900, now, tc);
      }
    },
    focus(stage) {
      focus = stage;
    },
    release(f) {
      pass.forEach((p) => {
        p.src.whenEnded(() => p.snd.stop(eng.now));
        p.src.release(f);
      });
      sides.forEach((x) => x.src.release(f));
    },
    cleanup() {
      stopNodes(nodes);
    },
  };
}

// ---------------------------------------------------------------- shared by Courage and Calm
/** The world bed's sources, if it is running (Courage and Calm shape it rather than adding instruments). */
function bedVoices(eng: Engine): BedVoice[] {
  return (eng.getRunning(BED)?.shared.voices as BedVoice[] | undefined) ?? [];
}

/** Ease every bed source's quiet/still back to 0 over `sec` (when the effect ends). */
function handBedBack(eng: Engine, sec: number): void {
  const voices = bedVoices(eng);
  const from = voices.map((v) => ({ v, q: v.quiet, s: v.still }));
  const start = eng.now;
  const unsub = eng.clock.onTick((_dt, now) => {
    const u = clamp((now - start) / Math.max(0.1, sec), 0, 1);
    for (const f of from) {
      f.v.quiet = f.q * (1 - u);
      f.v.still = f.s * (1 - u);
    }
    if (u >= 1) unsub();
  });
}

/**
 * F2 proposal for Courage and Calm (effects without a sound object of their own):
 * a faint "held" tone that forms at the fingertips, moves to the chest, and sinks in.
 */
function makeGlow(eng: Engine, def: EffectDef) {
  let src: SpatialSource | null = null;
  let sound: ReturnType<typeof makeSound> | null = null;
  return {
    get source() {
      return src;
    },
    focus(stage: Focus, now: number) {
      if (stage === 'free') return;
      if (!src) {
        src = eng.createSource({ label: 'held glow', bus: 'fx', pos: def.fingertips, wet: def.glow.wet });
        sound = makeSound(eng.ctx, 'airPad', { hz: def.glow.hz, air: 0.25, tone: 0.3, breatheHz: 0.05 });
        sound.out.connect(src.input);
        sound.start(now);
        src.fadeTo(def.glow.level, 4, now);
      }
      if (stage === 'chest') src.setPosition(def.chest, 2.5, now);
      if (stage === 'in') src.fadeTo(def.glow.level * 0.2, 4, now);
    },
    release(f: number) {
      if (src) {
        const s = sound;
        src.whenEnded(() => s?.stop(eng.now));
        src.release(f);
      }
    },
  };
}

// ---------------------------------------------------------------- Courage (proposal)
interface CourageDef {
  /** Wind moving past close to the listener (the part that goes quiet first). */
  near: { count: number; dist: number; el: number; speedDegPerSec: number; level: number; wet: number };
  /** How much the world bed's own wind is quieted at full spread (distant wind keeps moving). */
  bedQuiet: number;
}

/**
 * No new instrument: the space gets calmer. Wind keeps moving past the
 * listener; wristSpread quiets and darkens the nearby wind first (a pocket of
 * calm), then partly the wider bed, while distant wind continues.
 */
function courageEffect(eng: Engine, def: EffectDef, t0: number): WordEffect {
  const cd = def.courage;
  const c = eng.ctx;
  const bedDef = eng.cues.cues[BED] as unknown as { wind: Parameters<typeof wind>[1] };
  const near = Array.from({ length: cd.near.count }, (_, i) => {
    const src = eng.createSource({ label: `near wind ${i + 1}`, bus: 'bed', pos: { az: -90, el: cd.near.el, dist: cd.near.dist }, wet: cd.near.wet });
    const snd = wind(c, { ...bedDef.wind, bandHz: 700 + 300 * i, gustHz: [0.09 + 0.03 * i, 0.15 + 0.02 * i], file: eng.assets.peek('wind_loop.wav') ?? null, gustFile: null });
    const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    kRate(lp.frequency);
    const g = new GainNode(c, { gain: 1 });
    snd.out.connect(lp).connect(g).connect(src.input);
    snd.start(t0);
    snd.setIntensity(0.7, t0);
    src.fadeTo(cd.near.level, 3, t0);
    return { src, snd, lp, g, dir: i % 2 ? -1 : 1, offset: i * 170 };
  });
  const glow = makeGlow(eng, def);
  let focus: Focus = 'free';
  return {
    sources: near.map((n) => n.src),
    tick(now, _dt, I, _x, m) {
      // gathered: the pocket holds where it was (the stillness has been drawn in)
      const pocket = focus === 'free' ? I : Math.max(I, 0.8);
      const nearQuiet = clamp(pocket / 0.5, 0, 1);
      for (const n of near) {
        // wind sweeping past, around the listener
        const az = ((((now * cd.near.speedDegPerSec * n.dir + n.offset) % 360) + 540) % 360) - 180;
        n.src.setPosition({ az, el: cd.near.el, dist: cd.near.dist }, 0.3, now);
        setIfChanged(n.g.gain, (1 - 0.92 * nearQuiet) * m, now, 0.3);
        setIfChanged(n.lp.frequency, 20000 * Math.pow(0.04, nearQuiet), now, 0.3);
      }
      const bedQuiet = cd.bedQuiet * clamp((pocket - 0.35) / 0.6, 0, 1);
      for (const v of bedVoices(eng)) if (v.kind === 'wind') v.quiet = bedQuiet;
    },
    focus(stage, now) {
      focus = stage;
      glow.focus(stage, now);
    },
    release(f) {
      near.forEach((n) => {
        n.src.whenEnded(() => n.snd.stop(eng.now));
        n.src.release(f);
      });
      glow.release(f);
      handBedBack(eng, f);
    },
    cleanup() {},
  };
}

// ---------------------------------------------------------------- Calm (proposal)
interface CalmDef {
  heart: { pos: Pos; bpm: [number, number]; level: [number, number]; hz: number; wet: number };
  /** wristSpread ranges over which each layer goes still: wind first, then water, then the heartbeat. */
  windRange: [number, number];
  waterRange: [number, number];
  heartRange: [number, number];
}

/**
 * In order: the wind slows, then the water, then a soft heartbeat slows.
 * wristSpread sets how far the stillness has spread; within the wind the
 * nearest sources go still first, the furthest last.
 */
function calmEffect(eng: Engine, def: EffectDef, t0: number): WordEffect {
  const cd = def.calm;
  const c = eng.ctx;
  const heart = eng.createSource({ label: 'heartbeat', bus: 'fx', pos: cd.heart.pos, wet: cd.heart.wet });
  heart.fadeTo(1, 3, t0);
  const glow = makeGlow(eng, def);
  const stage = (I: number, r: [number, number]) => clamp((I - r[0]) / (r[1] - r[0]), 0, 1);
  let next = t0 + 0.5;
  let focus: Focus = 'free';
  let stopped = false;
  return {
    sources: [heart],
    tick(now, _dt, I, _x, m) {
      const spread = focus === 'free' ? I : Math.max(I, 0.9);
      const windStill = stage(spread, cd.windRange);
      const waterStill = stage(spread, cd.waterRange);
      const heartStill = stage(spread, cd.heartRange);
      const winds = bedVoices(eng).filter((v) => v.kind === 'wind').sort((a, b) => a.base.dist - b.base.dist);
      winds.forEach((v, i) => {
        const rank = winds.length > 1 ? i / (winds.length - 1) : 0; // 0 = nearest
        v.still = clamp((windStill - 0.4 * rank) / 0.6, 0, 1);
      });
      for (const v of bedVoices(eng)) if (v.kind === 'water') v.still = waterStill;
      if (stopped) return;
      const bpm = lerp(cd.heart.bpm[0], cd.heart.bpm[1], heartStill);
      const amp = lerp(cd.heart.level[0], cd.heart.level[1], heartStill) * m * (focus === 'in' ? 0.3 : 1);
      while (next < now + 0.3) {
        heartbeat(c, heart.input, next, amp, cd.heart.hz, bpm);
        next += 60 / bpm;
      }
    },
    focus(s, now) {
      focus = s;
      glow.focus(s, now);
    },
    release(f) {
      stopped = true;
      heart.release(f);
      glow.release(f);
      handBedBack(eng, f);
    },
    cleanup() {},
  };
}

// ======================================================================= Part F2 (proposals, off by default)
/** Pinch: the effect draws in toward the fingertips. Chest: it converges at the chest. */
export const f2Focus: CustomCue = (eng, id, def) => {
  eng.cueControl(EFFECT, 'focus', def.focus as Focus);
  const run = new CueRun(id, eng, eng.now, {}, () => undefined, 0);
  eng.at(eng.now + 2, () => run.finish());
  return run;
};

/** "Let it in": the converged sound sinks in (darker, quieter) and a warm low tone blooms and settles. */
export const f2LetItIn: CustomCue = (eng, id, def) => {
  eng.cueControl(EFFECT, 'focus', 'in');
  const bloom = def.bloom as string | undefined;
  if (bloom) eng.at(eng.now + ((def.bloomDelay as number | undefined) ?? 0.8), () => eng.cue(bloom));
  const run = new CueRun(id, eng, eng.now, {}, () => undefined, 0);
  eng.at(eng.now + 4, () => run.finish());
  return run;
};

// ======================================================================= Part G: return
interface ReturnDef extends CueDef {
  /** Cues that fade with the hands (the effect and the world bed). */
  follow: string[];
  /** Cues to fade out right away (anything left from Parts D-E). */
  fadeNow?: string[];
  /** Below this fraction of the starting hand level (held for `downHoldSec`) the fade completes. */
  downAt: number;
  downHoldSec: number;
  /** Fallback when tracking is lost for trackingLostSec: a timed fade of this length. */
  timedSec: number;
  trackingLostSec: number;
}

/**
 * Part G: the effect and the ambient bed fade together, at the rate the hands
 * come down (armsRaised / wristSpread going down) - an active choice, not a
 * timeout. If the hands go back up, the sound comes back with them. Once the
 * hands are down it completes (marker 'released'). With opts { mode: 'timed' },
 * or when tracking is lost, it fades over timedSec instead.
 * The reversed portal whoosh is its own cue (stage3.partG.whoosh) so the main
 * project can place it between lines, as the script does.
 */
export const partGReturn: CustomCue = (eng, id, def0, opts) => {
  const def = def0 as ReturnDef;
  const t0 = eng.now;
  for (const c of def.fadeNow ?? []) eng.stopCue(c, 4);
  const hands = () => Math.max(eng.params.get('armsRaised'), eng.params.get('wristSpread'));
  const ref = Math.max(0.25, hands());
  let timed: { start: number; from: number } | null = opts.mode === 'timed' ? { start: t0, from: 1 } : null;
  let m = 1;
  let downFor = 0;
  let lostFor = 0;
  let done = false;

  const run = new CueRun(id, eng, t0, {}, () => undefined, 0);
  const complete = () => {
    if (done) return;
    done = true;
    for (const c of def.follow) eng.stopCue(c, 1.5);
    eng.emit('marker', { cue: id, name: 'released' });
    unsub();
    eng.at(eng.now + 1.5, () => run.finish());
  };
  const unsub = eng.clock.onTick((dt, now) => {
    if (done) return;
    lostFor = eng.params.isTracking ? 0 : lostFor + dt;
    if (!timed && lostFor > def.trackingLostSec) {
      timed = { start: now, from: m };
      eng.emit('log', 'Part G: tracking lost, finishing with a timed fade');
    }
    const target = timed ? timed.from * (1 - clamp((now - timed.start) / def.timedSec, 0, 1)) : clamp(hands() / ref, 0, 1);
    m += (target - m) * (1 - Math.exp(-dt / 0.2));
    for (const c of def.follow) eng.cueControl(c, 'master', m);
    downFor = m < def.downAt ? downFor + dt : 0;
    if (downFor >= def.downHoldSec) complete();
  });
  run.onControl = (name) => {
    if (name === 'timed' && !timed) timed = { start: eng.now, from: m };
    if (name === 'complete') complete();
  };
  return run;
};
