import type { TelemetryApi } from '@/core/types';

const STORAGE_KEY = 'noita-telemetry';
const WRITE_INTERVAL_MS = 5000;

/**
 * Local gameplay counters (deaths by cause, material usage, secret find
 * rate, ...). Purely local — nothing leaves the browser.
 *
 * Persistence is debounced without timers: count() compares a last-write
 * timestamp and flushes to localStorage at most every 5s; a visibilitychange
 * listener flushes on tab-hide so short sessions aren't lost.
 */
export class Telemetry implements TelemetryApi {
  private counters: Record<string, number> = {};
  private dirty = false;
  private lastWrite = performance.now();

  constructor() {
    this.load();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  count(key: string, n = 1): void {
    this.counters[key] = (this.counters[key] ?? 0) + n;
    this.dirty = true;
    if (performance.now() - this.lastWrite >= WRITE_INTERVAL_MS) this.flush();
  }

  all(): Record<string, number> {
    return { ...this.counters };
  }

  /** Merge previously persisted counters into the live record. */
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored: unknown = JSON.parse(raw);
      if (typeof stored !== 'object' || stored === null) return;
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.counters[key] = (this.counters[key] ?? 0) + value;
        }
      }
    } catch {
      // Private mode / corrupt payload — run in-memory only.
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastWrite = performance.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.counters));
    } catch {
      // Private mode / quota — counters stay in-memory only.
    }
  }
}
