import defaultCues from '../cues.json';
import { Engine } from './engine';
import type { CueFile, Word } from './types';

export interface CreateOptions {
  /** The word picked before the session (steers Stage 3 Part F/G). Default 'kindness'. */
  word?: Word;
  /** Where asset files (wind_loop.wav, voice clips, ...) are served from. Default 'assets/'. */
  assetsBaseUrl?: string;
  /**
   * Share the main project's AudioContext (recommended: one audio graph).
   * Also accepts an OfflineAudioContext for WAV renders.
   */
  context?: BaseAudioContext;
  /** Output node (default: context.destination). */
  destination?: AudioNode;
  /** Cue data (default: the bundled cues.json). */
  cues?: CueFile;
}

/**
 * Create the engine. Call `unlock()` from the first user click (browser autoplay rule).
 *
 *   const audio = await createSpatialAudio({ word: 'kindness', assetsBaseUrl: '/spatial/' });
 *   await audio.unlock();
 *   audio.cue('pre.warmTone');
 *   audio.setParam('handHeight', 0.4);
 */
export async function createSpatialAudio(opts: CreateOptions = {}): Promise<SpatialAudio> {
  const cues = opts.cues ?? (defaultCues as unknown as CueFile);
  // A large audio buffer (default 100 ms) absorbs moments when the computer is busy
  // (camera tracking, other tabs) instead of crackling. The extra ~0.1 s of delay is
  // not noticeable in a meditation. ('playback' alone only gave 20 ms on Windows.)
  const context = opts.context ?? new AudioContext({ latencyHint: cues.global.latencySec ?? 0.1 });
  const engine = new Engine({
    context,
    cues,
    word: opts.word ?? 'kindness',
    assetsBaseUrl: opts.assetsBaseUrl ?? 'assets/',
    destination: opts.destination,
  });
  engine.voice; // create the voice channel up front so it is ready for the main project's player
  await engine.preloadAssets();
  return engine;
}

/** The public surface. (The Engine class has a few more methods used by the harness and renderer.) */
export type SpatialAudio = Engine;

export { toXYZ, fromXYZ } from './core/coords';
export type { Pos, XYZ } from './core/coords';
export type { CueHandle, CueDef, CueFile, ParamName, SourceInfo, Word, BusName, PathDef, PathPoint } from './types';
export type { PlayVoiceOpts } from './voice';
