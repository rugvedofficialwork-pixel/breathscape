import type { Engine } from '../engine';
import type { CueDef } from '../types';
import type { CueRun } from './run';
import { breathDrone, stage1Close } from './stage1';
import { ambientWiden, stage2FadeOut } from './stage2';
import { ambientBed, portal, resolve, trial } from './stage3';
import { f2Focus, f2LetItIn, partGReturn, swell, wordEffect } from './stage3ef';

export type CustomCue = (eng: Engine, id: string, def: CueDef, opts: Record<string, unknown>) => CueRun;

/**
 * Cues with behaviour beyond "one sound at a place / along a path"
 * (breath drone, beds, gesture-linked layers). Their numbers still live in
 * cues.json; the code here only says how to use them.
 */
export const CUSTOM_CUES: Record<string, CustomCue> = {
  'stage1.breathDrone': breathDrone,
  'stage1.close': stage1Close,
  'stage2.ambientWiden': ambientWiden,
  'stage2.fadeOut': stage2FadeOut,
  'stage3.partA.portal': portal,
  'stage3.partB.ambientBed': ambientBed,
  'stage3.partC.trial': trial,
  'stage3.partD.resolve': resolve,
  'stage3.partE.swell': swell,
  'stage3.partF.effect': wordEffect,
  'stage3.partF2.gather': f2Focus,
  'stage3.partF2.chest': f2Focus,
  'stage3.partF2.letItIn': f2LetItIn,
  'stage3.partG.return': partGReturn,
  'stage3.partG.whoosh': portal,
};
