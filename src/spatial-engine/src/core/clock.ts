/**
 * Control-rate clock (~30 Hz) on the audio timeline.
 *
 * Realtime: driven by setInterval, reading ctx.currentTime (keeps running when
 * the tab is hidden, unlike requestAnimationFrame).
 * Offline: driven by OfflineAudioContext.suspend() steps, so gesture smoothing,
 * ducking and timed callbacks behave exactly the same in WAV renders.
 */
export class ControlClock {
  private listeners: ((dt: number, now: number) => void)[] = [];
  private timers: { t: number; cb: () => void }[] = [];
  private last = 0;
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: BaseAudioContext, private readonly hz: number) {
    this.last = ctx.currentTime;
  }

  /** Returns a function that removes the listener. */
  onTick(cb: (dt: number, now: number) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** Call cb once the audio clock reaches t. */
  at(t: number, cb: () => void): void {
    this.timers.push({ t, cb });
    this.timers.sort((a, b) => a.t - b.t);
  }

  startRealtime(): void {
    if (this.handle) return;
    this.last = this.ctx.currentTime;
    this.handle = setInterval(() => this.tick(), 1000 / this.hz);
  }

  /** Step an OfflineAudioContext at control rate. Call before startRendering(). */
  startOffline(ctx: OfflineAudioContext): void {
    const step = 1 / this.hz;
    const lengthSec = ctx.length / ctx.sampleRate;
    // Resume on the next macrotask, so promise chains started by this tick (e.g. a
    // sequence awaiting a marker, then scheduling the next clip) settle at this exact
    // audio time. MessageChannel avoids setTimeout's 4 ms clamping on long renders.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => void ctx.resume();
    const schedule = (t: number) => {
      if (t >= lengthSec) return;
      void ctx.suspend(t).then(() => {
        this.tick();
        schedule(t + step);
        channel.port2.postMessage(0);
      });
    };
    schedule(step);
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = null;
  }

  private tick(): void {
    const now = this.ctx.currentTime;
    const dt = Math.max(0, Math.min(0.25, now - this.last));
    this.last = now;
    for (const l of this.listeners) l(dt, now);
    while (this.timers.length && this.timers[0].t <= now) {
      const { cb } = this.timers.shift()!;
      try {
        cb();
      } catch (e) {
        console.error('[spatial-audio] timer callback failed', e);
      }
    }
  }
}
