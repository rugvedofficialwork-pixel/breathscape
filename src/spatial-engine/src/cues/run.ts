import type { CueHandle } from '../types';

/** What a running cue needs from the engine. */
export interface CueHost {
  readonly now: number;
  at(t: number, cb: () => void): void;
  emit(type: 'marker', detail: { cue: string; name: string }): void;
}

/**
 * Handle for one running cue. Cue implementations create one, pass a stop
 * function that fades their sources out, and call finish() once everything
 * has gone silent.
 */
export class CueRun implements CueHandle {
  readonly done: Promise<void>;
  private resolveDone!: () => void;
  private stopped = false;
  private finished = false;

  constructor(
    readonly id: string,
    private readonly host: CueHost,
    readonly startAt: number,
    private readonly markers: Record<string, number>,
    private readonly onStop: (fadeSec: number) => void,
    private readonly defaultFade: number,
  ) {
    this.done = new Promise((r) => (this.resolveDone = r));
    for (const [name, off] of Object.entries(markers)) {
      host.at(startAt + off, () => {
        if (!this.stopped) host.emit('marker', { cue: id, name });
      });
    }
  }

  marker(name: string): Promise<void> {
    const off = this.markers[name];
    if (off === undefined || this.stopped) return Promise.resolve();
    const t = this.startAt + off;
    if (t <= this.host.now) return Promise.resolve();
    return new Promise((r) => this.host.at(t, r));
  }

  /** Internals a cue shares with other cues (e.g. the world bed's sources, for the word effects). */
  readonly shared: Record<string, unknown> = {};

  /** Set by cues that accept live settings (see Engine.cueControl). */
  onControl: ((name: string, value: unknown) => void) | null = null;

  control(name: string, value?: unknown): void {
    this.onControl?.(name, value);
  }

  stop(fadeSec?: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.onStop(fadeSec ?? this.defaultFade);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopped = true;
    this.resolveDone();
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  get isFinished(): boolean {
    return this.finished;
  }
}
