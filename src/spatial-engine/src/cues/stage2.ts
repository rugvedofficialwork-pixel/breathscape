import type { Pos } from '../core/coords';
import { Path } from '../core/paths';
import type { SpatialSource } from '../core/source';
import { makeSound, type Sound } from '../synth/sounds';
import type { CueDef } from '../types';
import type { CustomCue } from './custom';
import { CueRun } from './run';

interface WidenDef extends CueDef {
  /** Where all voices start (close together, in front). */
  start: Pos;
  /** Starting spread across the front, degrees. */
  startSpreadDeg: number;
  /** Where each voice ends up around the listener (one per voice). */
  targets: Pos[];
  /** Note of each voice, Hz. */
  notes: number[];
  widenSec: number;
}

/**
 * Stage 2 Movement 5: a second, faint ambient layer that starts as a narrow
 * source in front and widens to surround the listener. Holds until stopped.
 */
export const ambientWiden: CustomCue = (eng, id, def0) => {
  const def = def0 as WidenDef;
  const t0 = eng.now + 0.03;
  const n = def.targets.length;
  const voices: { src: SpatialSource; snd: Sound }[] = [];
  def.targets.forEach((target, i) => {
    const offset = n > 1 ? (i / (n - 1) - 0.5) * def.startSpreadDeg : 0;
    const start: Pos = { ...def.start, az: def.start.az + offset };
    const src = eng.createSource({ label: `${def.label ?? id} ${i + 1}`, bus: def.bus ?? 'bed', pos: start, wet: def.wet });
    const snd = makeSound(eng.ctx, def.sound ?? 'airPad', {
      hz: def.notes[i % def.notes.length],
      airHz: 800 + 260 * i,
      breatheHz: 0.037 + 0.011 * i,
    });
    snd.out.connect(src.input);
    snd.start(t0);
    src.fadeTo(def.level ?? 0.06, def.fadeIn ?? 6, t0);
    src.followPath(new Path({ points: [{ t: 0, ...start }, { t: def.widenSec, ...target }] }), t0);
    voices.push({ src, snd });
  });

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => voices.forEach((v) => v.src.release(f)), def.fadeOut ?? 8);
  let left = voices.length;
  for (const v of voices) {
    v.src.whenEnded(() => {
      v.snd.stop(eng.now);
      if (--left === 0) run.finish();
    });
  }
  return run;
};

/**
 * Stage 2 Movement 6: everything fades toward silence except one low tone,
 * which starts under the fade and lingers into Stage 3 Part A.
 */
export const stage2FadeOut: CustomCue = (eng, id, def) => {
  const fadeSec = (def.fadeSec as number | undefined) ?? 15;
  const linger = def.linger as string | undefined;
  if (linger && !eng.getRunning(linger)) eng.cue(linger);
  for (const other of (def.fade as string[] | undefined) ?? []) eng.stopCue(other, fadeSec);
  const run = new CueRun(id, eng, eng.now, {}, () => undefined, 0);
  eng.at(eng.now + fadeSec, () => run.finish());
  return run;
};
