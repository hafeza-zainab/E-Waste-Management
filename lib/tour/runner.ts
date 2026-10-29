/**
 * Timing and control for the guided demo. One `wait(ms)` for every pause in the tour: it scales with the speed
 * setting, checks for Stop / Skip every 50 ms, and holds while the tour is paused. Pure (no DOM), so it is unit tested.
 */
export class TourAbort extends Error {
  constructor() {
    super("tour aborted");
    this.name = "TourAbort";
  }
}
export class ChapterSkip extends Error {
  constructor() {
    super("chapter skipped");
    this.name = "ChapterSkip";
  }
}
export class TargetMissing extends Error {
  constructor(public target: string) {
    super(`tour target not found: ${target}`);
    this.name = "TargetMissing";
  }
}

export const TICK_MS = 50;
export const SPEEDS = [1, 1.5, 2] as const;

export class TourRunner {
  speed = 1;
  paused = false;
  aborted = false;
  private skipRequested = false;

  constructor(
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private tick = TICK_MS,
  ) {}

  abort() {
    this.aborted = true;
  }
  skipChapter() {
    this.skipRequested = true;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  setSpeed(s: number) {
    this.speed = s > 0 ? s : 1;
  }

  /** Throws TourAbort or ChapterSkip when asked to. Called on every tick. */
  check() {
    if (this.aborted) throw new TourAbort();
    if (this.skipRequested) {
      this.skipRequested = false;
      throw new ChapterSkip();
    }
  }

  /** Waits `ms` of tour time (shorter at higher speed). Paused time does not count. */
  async wait(ms: number) {
    let left = ms / this.speed;
    this.check();
    while (left > 0) {
      if (this.paused) {
        await this.sleep(this.tick);
        this.check();
        continue;
      }
      const d = Math.min(this.tick, left);
      await this.sleep(d);
      left -= d;
      this.check();
    }
  }

  /** Polls until `fn` returns a value (real time, not scaled by speed). Resolves null on timeout. */
  async until<T>(fn: () => T | null | undefined | false, timeoutMs: number): Promise<T | null> {
    let waited = 0;
    for (;;) {
      this.check();
      const v = fn();
      if (v) return v;
      if (waited >= timeoutMs) return null;
      await this.sleep(this.tick);
      if (!this.paused) waited += this.tick;
    }
  }
}
