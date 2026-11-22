import { Path } from '../core/paths';
import { makeSound, type SoundOpts } from '../synth/sounds';
import type { Engine } from '../engine';
import type { CueDef } from '../types';
import { CueRun } from './run';

/**
 * Data-only cues (kind "point" or "path"): one sound, one source, all numbers
 * from cues.json. No code needed to add one.
 */
export function runBasic(eng: Engine, id: string, def: CueDef): CueRun {
  const t0 = eng.now + 0.03 + (typeof def.delay === 'number' ? def.delay : 0);
  const path = def.kind === 'path' && def.path ? new Path(def.path, def.pos) : null;
  const pos = path ? path.start : (def.pos ?? { az: 0, el: 0, dist: 1.5 });
  const fadeIn = def.fadeIn ?? 0.5;
  const fadeOut = def.fadeOut ?? 1;

  const src = eng.createSource({ label: def.label ?? id, bus: def.bus ?? 'fx', pos, wet: def.wet });
  const snd = makeSound(eng.ctx, def.sound ?? 'probe', def as SoundOpts);
  snd.out.connect(src.input);
  snd.start(t0);
  src.fadeTo(def.level ?? 0.5, fadeIn, t0);

  const run = new CueRun(id, eng, t0, def.markers ?? {}, (f) => src.release(f), fadeOut);
  src.whenEnded(() => {
    snd.stop(eng.now);
    run.finish();
  });

  if (path) {
    const end = src.followPath(path, t0);
    if (def.hold === undefined) eng.at(Math.max(t0, end - fadeOut), () => run.stop(fadeOut));
  }
  if (def.hold !== undefined) {
    eng.at(t0 + Math.max(0, def.hold - fadeOut), () => run.stop(fadeOut));
  } else if (!path && snd.duration !== undefined) {
    // one-shot with its own envelope: free the source once it has played out
    eng.at(t0 + snd.duration, () => run.stop(eng.global.minFadeSec));
  }
  return run;
}
