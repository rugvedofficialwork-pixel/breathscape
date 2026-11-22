import { state } from '../state';

export type Beat = { label?: string } & (
  | { do: () => void | Promise<void> }
  | { wait: number }
  | { waitFor: () => boolean; timeout: number; onTimeout?: () => void }
);

export interface RunHandle { aborted: boolean }

/** Sleep that respects the debug time scale and can be aborted. */
export function sleep(ms: number, handle?: RunHandle): Promise<void> {
  return new Promise((resolve) => {
    const total = ms / state.timeScale;
    const start = performance.now();
    const tick = () => {
      if (handle?.aborted || performance.now() - start >= total) return resolve();
      setTimeout(tick, Math.min(50, total));
    };
    setTimeout(tick, Math.min(50, total));
  });
}

/** Runs a list of beats in order. Not nested timeouts: one small loop. */
export async function runTimeline(beats: Beat[], handle: RunHandle): Promise<void> {
  for (const beat of beats) {
    if (handle.aborted) return;
    if (beat.label) state.beat = beat.label;
    if ('do' in beat) {
      await beat.do();
    } else if ('wait' in beat) {
      await sleep(beat.wait, handle);
    } else {
      const start = performance.now();
      while (!handle.aborted && !beat.waitFor()) {
        if (performance.now() - start >= beat.timeout / state.timeScale) { beat.onTimeout?.(); break; }
        await sleep(50, handle);
      }
    }
  }
}
