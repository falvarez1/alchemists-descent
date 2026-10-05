/** One host tick of game time. The host simulates at a fixed 60 Hz and stamps every snapshot with its tick. */
export const TICK_MS = 1000 / 60;

/**
 * Where the host's ticks land on this machine's clock. Each arrival gives `arrival - tick * TICK_MS`; the smallest of
 * the recent ones is the best transit seen (the offset), and how far the others fall behind it is the jitter a replica
 * has to buffer. A window, not a lifetime minimum, so a host that drifts (dropped ticks, a slower machine) is followed.
 * A frame far later than the offset means the stream stopped (a pause, a stall): the estimate starts over from it.
 */
export class HostClock {
  private readonly samples: number[] = [];
  private offset = Number.NaN;
  constructor(
    private readonly window = 120,
    private readonly restartMs = 250,
  ) {}
  get ready(): boolean {
    return this.samples.length > 0;
  }
  observe(tick: number, at: number): void {
    const sample = at - tick * TICK_MS;
    if (Number.isNaN(this.offset) || sample - this.offset > this.restartMs) this.samples.length = 0;
    this.samples.push(sample);
    if (this.samples.length > this.window) this.samples.shift();
    let min = Infinity;
    for (const s of this.samples) if (s < min) min = s;
    this.offset = min;
  }
  /** The host tick that would be arriving now if the network added nothing beyond the best transit seen. */
  hostTick(now: number): number {
    return Number.isNaN(this.offset) ? Number.NaN : (now - this.offset) / TICK_MS;
  }
  /** How late frames arrive beyond the best transit, in ticks, at quantile `q` (0..1) of the window. */
  lateness(q: number): number {
    const n = this.samples.length;
    if (n < 2) return 0;
    const sorted = this.samples.map((s) => s - this.offset).sort((a, b) => a - b);
    return sorted[Math.min(n - 1, Math.floor(q * n))] / TICK_MS;
  }
  reset(): void {
    this.samples.length = 0;
    this.offset = Number.NaN;
  }
}

/** Far enough behind its target that the playhead jumps rather than speeds up (forward only). */
const SNAP_TICKS = 8;
/** Speed change per tick of error, and its bound: a 20% warp is invisible, a jump is not. */
const GAIN = 0.1;
const MAX_WARP = 0.2;

/**
 * A playhead over the host's ticks that runs at real time and steers toward a target by speeding up or slowing down
 * (never backward, never past the newest frame received). Steering instead of jumping keeps motion even when the
 * target moves as jitter estimates change; a target far ahead (a burst after a stall) is jumped to.
 */
export class PlaybackCursor {
  tick = Number.NaN;
  private last = Number.NaN;
  advance(now: number, target: number, newest: number): number {
    if (Number.isNaN(this.tick)) this.tick = Math.min(target, newest);
    else if (target - this.tick > SNAP_TICKS) this.tick = target;
    else {
      const dt = Math.max(0, now - this.last) / TICK_MS;
      const rate = 1 + Math.max(-MAX_WARP, Math.min(MAX_WARP, (target - this.tick) * GAIN));
      this.tick += dt * rate;
    }
    this.last = now;
    if (this.tick > newest) this.tick = newest;
    return this.tick;
  }
  reset(): void {
    this.tick = this.last = Number.NaN;
  }
}
