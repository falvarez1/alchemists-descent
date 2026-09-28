import type { Plate } from '@/content/story';
import { PLATE_TITLES } from '@/content/story';
import type { StoryHost } from './host';

/**
 * The story's cinematics, game side (wave 3 WS-S): a timeline of painted
 * plates (ui/story/StoryCinema paints them from `storyCinema` events), each
 * holding for its time or its voice, whichever is longer — capped, for the
 * opening, so the first fire is never far away. Wall-clock timers: the game
 * is paused underneath. Any key or click skips (the UI calls skip()).
 */
export class StoryCinema {
  private kind: 'opening' | 'ending' | null = null;
  private timer: number | null = null;
  private finish: (() => void) | null = null;
  private wasPaused = false;
  private pauses = false;

  constructor(private readonly host: StoryHost) {}

  get active(): 'opening' | 'ending' | null { return this.kind; }

  play(kind: 'opening' | 'ending', plates: readonly Plate[], opts: { pause: boolean; maxSeconds?: number; breathSeconds?: number; leadSeconds?: number }): Promise<void> {
    this.stop(false);
    const ctx = this.host.ctx;
    this.kind = kind;
    this.pauses = opts.pause;
    if (opts.pause) { this.wasPaused = ctx.state.paused; ctx.state.paused = true; }
    ctx.events.emit('storyCinema', { phase: 'begin', kind, count: plates.length });
    // Each plate's hold: its own time, or its voice and a breath, scaled to fit the cap.
    const breath = opts.breathSeconds ?? 0.5;
    const holds = plates.map(p => Math.max(p.seconds, p.line ? this.host.lineSeconds(p.line) + breath : 0));
    const total = holds.reduce((a, b) => a + b, 0);
    const scale = opts.maxSeconds && total > opts.maxSeconds ? opts.maxSeconds / total : 1;
    return new Promise<void>(resolve => {
      this.finish = resolve;
      const show = (i: number): void => {
        if (this.kind !== kind) return;
        if (i >= plates.length) { this.stop(true); return; }
        const plate = plates[i];
        ctx.events.emit('storyCinema', { phase: 'plate', kind, art: plate.art, title: PLATE_TITLES[plate.art], line: plate.line, index: i, count: plates.length });
        if (plate.line) this.host.say([plate.line], { priority: 'high', source: 'cinema', ttlMs: 2500, captioned: false, repeatable: true });
        this.timer = window.setTimeout(() => show(i + 1), holds[i] * scale * 1000);
      };
      // A beat of black before the first plate.
      this.timer = window.setTimeout(() => show(0), (opts.leadSeconds ?? 0.45) * 1000);
    });
  }

  skip(): void {
    if (this.kind) this.stop(true);
  }

  private stop(publish: boolean): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const kind = this.kind;
    if (!kind) return;
    this.kind = null;
    this.host.ctx.narrator?.cutSource?.('cinema');
    if (this.pauses) this.host.ctx.state.paused = this.wasPaused;
    this.pauses = false;
    if (publish) this.host.ctx.events.emit('storyCinema', { phase: 'end', kind });
    const done = this.finish;
    this.finish = null;
    done?.();
  }
}
