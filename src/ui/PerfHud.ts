import type { FrameCadence } from '@/game/FixedStepClock';

export type PerfPhase = 'sim' | 'entities' | 'render' | 'compose' | 'gl' | 'frame';
export type PerfSample = Record<PerfPhase, number> & {
  didTick: boolean;
  tickCount: number;
  interval: number;
  debt: number;
  dropped: number;
};
export interface PerfTickSample { sim: number; creatures: number; gameplay: number; total: number }

const EMA_ALPHA = 0.1;
/** Per-phase budgets in ms (DESIGN.md frame-budget ledger). The combined
 *  `render` bucket keeps emitting so old perf baselines stay comparable;
 *  `compose` (FrameComposer.compose) and `gl` (Renderer.render) are its
 *  sub-buckets, added for the GPU-compose ticket. */
const BUDGETS: Record<Exclude<PerfPhase, 'frame'>, number> = {
  sim: 6,
  entities: 2.5,
  render: 5,
  compose: 3.5,
  gl: 2.5,
};
const COLOR_OK = '#3ad55a';
const COLOR_OVER = '#ef4444';

// ===================== Perf HUD =====================
/**
 * Frame-budget overlay: smoothed (EMA) per-phase timings colored against
 * the ledger budgets, plus fps derived from requestAnimationFrame intervals. Hidden by
 * default; F3 toggles. Game.step feeds it via mark(phase, ms).
 *
 * Fully programmatic DOM so index.html stays untouched; pointer-events
 * none so it never eats game input.
 */
export class PerfHud {
  private root: HTMLDivElement;
  private fpsEl: HTMLSpanElement;
  private headerBtn: HTMLElement | null = null;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault();
      this.toggle();
    }
  };
  private readonly onHeaderClick = (e: MouseEvent): void => {
    this.toggle();
    (e.currentTarget as HTMLButtonElement).blur(); // keep Space/Enter for the game
  };
  private phaseEls: Record<Exclude<PerfPhase, 'frame'>, HTMLSpanElement>;
  private ema: Record<PerfPhase, number> = { sim: 0, entities: 0, render: 0, compose: 0, gl: 0, frame: 0 };
  private frameMarks = 0;
  private intervalEma = 0;
  private tickRate = 0;
  private rateElapsed = 0;
  private rateTicks = 0;
  private droppedMs = 0;
  private cadence = { interval: 0, debt: 0, dropped: 0 };
  private _visible = false;

  constructor() {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed',
      top: '56px',
      right: '12px',
      zIndex: '9999',
      display: 'none',
      pointerEvents: 'none',
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: '11px',
      fontWeight: '600',
      color: '#e2e8f0',
      background: 'rgba(10, 10, 16, 0.8)',
      border: '1px solid #2a2a3a',
      borderRadius: '4px',
      padding: '4px 8px',
      whiteSpace: 'nowrap',
    });

    const span = (text: string): HTMLSpanElement => {
      const s = document.createElement('span');
      s.textContent = text;
      root.appendChild(s);
      return s;
    };
    this.fpsEl = span('fps 0');
    span(' | ');
    const sim = span('sim 0.0ms');
    span(' | ');
    const entities = span('ent 0.0ms');
    span(' | ');
    const render = span('rnd 0.0ms');
    span(' (');
    const compose = span('cmp 0.0ms');
    span(' + ');
    const gl = span('gl 0.0ms');
    span(')');
    this.phaseEls = { sim, entities, render, compose, gl };

    document.body.appendChild(root);
    this.root = root;

    window.addEventListener('keydown', this.onKeyDown);

    // Header PERF button mirrors F3 (lit while the overlay is up).
    this.headerBtn = document.getElementById('perf-hud-toggle');
    this.headerBtn?.addEventListener('click', this.onHeaderClick);
  }

  get visible(): boolean {
    return this._visible;
  }

  toggle(): boolean {
    return this.setVisible(!this._visible);
  }

  setVisible(visible: boolean): boolean {
    this._visible = visible;
    this.root.style.display = this._visible ? 'block' : 'none';
    this.headerBtn?.classList.toggle('lit', this._visible);
    if (this._visible) this.refresh();
    return this._visible;
  }

  /** Per-frame scratch for the profiling hook (no cost unless recording). */
  private pending: Record<PerfPhase, number> = { sim: 0, entities: 0, render: 0, compose: 0, gl: 0, frame: 0 };
  private pendingTickCount = 0;

  beginFrame(tickCount: number, cadence?: Pick<FrameCadence, 'interval' | 'debt' | 'dropped'>): void {
    this.pendingTickCount = Math.max(0, Math.floor(tickCount));
    if (!cadence) return;
    this.cadence = cadence;
    if (cadence.interval > 0) {
      this.intervalEma = this.intervalEma === 0 ? cadence.interval : this.intervalEma + (cadence.interval - this.intervalEma) * EMA_ALPHA;
      this.rateElapsed += cadence.interval;
      this.rateTicks += this.pendingTickCount;
      this.droppedMs += cadence.dropped;
      if (this.rateElapsed >= 1000) {
        this.tickRate = this.rateTicks * 1000 / this.rateElapsed;
        this.rateElapsed = 0;
        this.rateTicks = 0;
      }
    }
  }

  mark(phase: PerfPhase, ms: number): void {
    const prev = this.ema[phase];
    this.ema[phase] = prev === 0 ? ms : prev + (ms - prev) * EMA_ALPHA;
    if (phase === 'sim' || phase === 'entities') this.pending[phase] += ms;
    else this.pending[phase] = ms;
    if (phase !== 'frame') return;
    this.frameMarks++;
    // Profiling hook: scripts set window.__perfRecord and read __perfSamples —
    // raw per-frame bucket times, no EMA smoothing, no overhead when off.
    const w = window as unknown as {
      __perfRecord?: boolean;
      __perfSamples?: PerfSample[];
    };
    if (w.__perfRecord) {
      (w.__perfSamples ??= []).push({
        ...this.pending,
        didTick: this.pendingTickCount > 0,
        tickCount: this.pendingTickCount,
        interval: this.cadence.interval,
        debt: this.cadence.debt,
        dropped: this.cadence.dropped,
      });
    }
    this.pending.sim = 0;
    this.pending.entities = 0;
    this.pendingTickCount = 0;
    if (this._visible && this.frameMarks % 10 === 0) this.refresh();
  }

  /** Fixed-tick budgets cannot be inferred from a presentation that catches up
   * several ticks. Preserve each authoritative sample separately. */
  recordTick(sim: number, creatures: number, gameplay: number, total: number): void {
    const w = window as unknown as { __perfRecord?: boolean; __perfTicks?: PerfTickSample[] };
    if (w.__perfRecord) (w.__perfTicks ??= []).push({ sim, creatures, gameplay, total });
  }

  private refresh(): void {
    const fps = this.intervalEma > 0 ? Math.round(1000 / this.intervalEma) : 0;
    this.fpsEl.textContent = `${fps} fps · ${this.tickRate.toFixed(1)} ticks/s · debt ${this.cadence.debt.toFixed(1)}ms · lost ${Math.round(this.droppedMs)}ms`;
    const labels = { sim: 'sim', entities: 'ent', render: 'rnd', compose: 'cmp', gl: 'gl' } as const;
    for (const phase of ['sim', 'entities', 'render', 'compose', 'gl'] as const) {
      const el = this.phaseEls[phase];
      el.textContent = labels[phase] + ' ' + this.ema[phase].toFixed(1) + 'ms';
      el.style.color = this.ema[phase] > BUDGETS[phase] ? COLOR_OVER : COLOR_OK;
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.headerBtn?.removeEventListener('click', this.onHeaderClick);
    this.headerBtn?.classList.remove('lit');
    this.root.remove();
  }
}
