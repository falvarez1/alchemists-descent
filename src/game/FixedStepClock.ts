/** Wall-clock accounting, independent of the DOM and of simulation frame order. */
export interface FrameCadence {
  interval: number;
  ticks: number;
  debt: number;
  dropped: number;
  alpha: number;
}

export class FixedStepClock {
  private previous: number | null = null;
  private debt = 0;

  reset(): void {
    this.previous = null;
    this.debt = 0;
  }

  advance(now: number, stepMs = 1000 / 60, manual = false): FrameCadence {
    const interval = this.previous === null ? 0 : Math.max(0, now - this.previous);
    this.previous = now;
    if (manual) {
      this.debt = 0;
      return { interval, ticks: 0, debt: 0, dropped: 0, alpha: 0 };
    }
    // Preserve ordinary catch-up debt. Only a suspended tab / exceptional hitch
    // can discard time, and every discarded millisecond is reported.
    const acceptedInterval = Math.min(250, interval);
    const available = this.debt + acceptedInterval;
    // A run of ordinary short stalls is still owed time. Keep that separate
    // from a suspended tab's long interval; cap sustained overload at one
    // second so a machine that cannot keep up has a bounded recovery queue.
    const dropped = Math.max(0, interval - acceptedInterval) + Math.max(0, available - 1000);
    this.debt = Math.min(1000, available);
    const ticks = Math.min(4, Math.floor((this.debt + 0.00001) / stepMs));
    this.debt = Math.max(0, this.debt - ticks * stepMs);
    return { interval, ticks, debt: this.debt, dropped, alpha: Math.min(1, this.debt / stepMs) };
  }
}
