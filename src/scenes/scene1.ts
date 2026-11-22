import { CONFIG } from '../config';
import { Drone, type Phase } from '../audio/drone';
import { runTimeline, sleep, type Beat, type RunHandle } from '../engine/timeline';
import { speak } from '../speech';
import { LINE_MAP } from '../content/lines';
import { state } from '../state';
import type { PoseTracker } from '../tracking/pose';
import type { Orb } from '../visuals/orb';

const PHASES: Phase[] = ['inhale', 'hold', 'exhale', 'rest'];

/** Cue line per cycle and phase (null = silent). Cycle 5 has no rest cue; cycle 6 is mostly cue tones. */
const CUES: (string | null)[][] = [
  ['s1.c1.in', 's1.c1.hold', 's1.c1.out', 's1.c1.rest'],
  ['s1.c2.in', 's1.c2.hold', 's1.c2.out', 's1.c2.rest'],
  ['s1.c3.in', 's1.c3.hold', 's1.c3.out', 's1.c3.rest'],
  ['s1.c4.in', 's1.c4.hold', 's1.c4.out', 's1.c4.rest'],
  ['s1.c5.in', 's1.c5.hold', 's1.c5.out', null],
  ['s1.c6.one', null, null, 's1.c6.good'],
];

/** The head version of a line when breathing with the head, if there is one. */
const v = (id: string) => (state.breath === 'head' && LINE_MAP.has(id + '.head') ? id + '.head' : id);

export interface Scene1Deps { tracker: PoseTracker; orb: Orb; drone: Drone }

export function buildScene1(deps: Scene1Deps): Beat[] {
  const { tracker, orb, drone } = deps;
  const s = CONFIG.scene1;
  const beats: Beat[] = [];

  beats.push({
    label: 'open + calibrate',
    do: async () => {
      orb.show();
      drone.start();
      drone.setVolume(0.0, 0.3);
      // Calibration runs during the opening line, once "rest one hand out" has been heard.
      const canCalibrate = tracker.ready && !tracker.manual;
      const calibration = canCalibrate
        ? sleep(s.calibrationDelayMs).then(() => tracker.calibrate())
        : Promise.resolve(false);
      await speak(v('s1.open'));
      await calibration;
    },
  });
  beats.push({ wait: s.afterOpenMs });

  for (let c = 0; c < s.cycles; c++) {
    PHASES.forEach((phase, p) => {
      beats.push({
        label: `cycle ${c + 1}/${s.cycles} · ${phase}`,
        do: () => {
          const now = performance.now();
          const durMs = s.phaseMs / state.timeScale;
          state.cycle = c; state.phase = phase;
          orb.setPhase(phase, c, durMs, now);

          const vol = s.droneVolume[c];
          drone.phase(phase, durMs / 1000, vol);
          if (phase === 'rest') drone.cue(CONFIG.drone.cueToneHz.rest, 0.05 * (1 - c * 0.12));
          if (c === s.cycles - 1) drone.cue(CONFIG.drone.cueToneHz[phase], 0.045, 1.8);

          const line = CUES[c][p];
          // Cues never block: the breath clock is independent of speech.
          if (line) void speak(v(line), { volume: s.speechVolume[c], rate: s.speechRate[c] });
        },
      });
      beats.push({ wait: s.phaseMs });
    });
  }

  beats.push({
    label: 'close + dim',
    do: async () => {
      state.phase = 'closing';
      orb.dim(s.dimMs / state.timeScale, performance.now());
      drone.fadeOut(s.dimMs / 1000 / state.timeScale);
      await speak(v('s1.close'), { volume: 0.45, rate: 0.72 });
    },
  });
  beats.push({ wait: s.afterCloseMs });
  beats.push({ label: 'scene 1 done', do: () => { state.phase = 'done'; } });
  return beats;
}

export async function runScene1(deps: Scene1Deps, handle: RunHandle): Promise<void> {
  state.scene = 1;
  state.part = '1';
  deps.tracker.breathSource = state.breath;
  void deps.tracker.setSegmentation(deps.orb.style === 'particles'); // your outline, for particles to pass behind
  if (state.breath === 'head') deps.tracker.handsEnabled = false; // the hand model is not needed for this part
  try {
    await runTimeline(buildScene1(deps), handle);
  } finally {
    deps.tracker.breathSource = 'hand'; // the rest of the session is driven by the hands, as before
    void deps.tracker.setSegmentation(false);
    if (!handle.aborted) deps.tracker.handsEnabled = true; // (after a skip, the next part sets it itself)
  }
}
