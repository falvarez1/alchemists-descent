import type { Ctx, TimeControlStatus } from '@/core/types';

export type TimeControlsSurface = 'sandbox' | 'builder' | 'runtime';

export interface TimeControlsPanelOptions {
  surface: TimeControlsSurface;
}

export function mountTimeControlsPanel(
  ctx: Ctx,
  host: HTMLElement,
  options: TimeControlsPanelOptions,
): () => void {
  host.innerHTML = timeControlsHtml(options.surface);
  const sync = (status = ctx.time.status()): void => syncPanel(host, status);
  const unsubscribe = ctx.events.on('timeControlsChanged', sync);

  host.querySelector<HTMLInputElement>('[data-time-manual]')?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLInputElement;
    ctx.time.setManual(target.checked);
  });

  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-time-step]')) {
    button.addEventListener('click', () => {
      ctx.time.queueTicks(Number(button.dataset.timeStep ?? 0));
      button.blur();
    });
  }

  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-time-rewind]')) {
    button.addEventListener('click', () => {
      ctx.time.rewindTicks(Number(button.dataset.timeRewind ?? 0));
      button.blur();
    });
  }

  host.querySelector<HTMLButtonElement>('[data-time-snap]')?.addEventListener('click', (event) => {
    ctx.time.captureCheckpoint();
    (event.currentTarget as HTMLButtonElement).blur();
  });

  host.querySelector<HTMLButtonElement>('[data-time-clear]')?.addEventListener('click', (event) => {
    ctx.time.clearHistory();
    (event.currentTarget as HTMLButtonElement).blur();
  });

  sync();
  return () => unsubscribe();
}

function timeControlsHtml(surface: TimeControlsSurface): string {
  return `
    <div class="time-controls time-controls-${surface}" data-time-controls>
      <div class="tc-topline">
        <label class="tc-toggle" title="Stop automatic ticks; use the step buttons to advance.">
          <input type="checkbox" data-time-manual>
          <span>Manual</span>
        </label>
        <span class="tc-status" data-time-status>AUTO</span>
      </div>
      <div class="tc-readouts">
        <span>Frame <b data-time-frame>0</b></span>
        <span>Back <b data-time-history>0</b></span>
        <span>Queue <b data-time-queue>0</b></span>
      </div>
      <div class="tc-row" aria-label="Step ticks">
        <span>Step</span>
        <button type="button" data-time-step="1" title="Advance one fixed tick">+1</button>
        <button type="button" data-time-step="5" title="Advance five fixed ticks">+5</button>
        <button type="button" data-time-step="30" title="Advance thirty fixed ticks">+30</button>
      </div>
      <div class="tc-row" aria-label="Rewind ticks">
        <span>Back</span>
        <button type="button" data-time-rewind="1" title="Restore the previous grid snapshot">-1</button>
        <button type="button" data-time-rewind="5" title="Restore five grid snapshots">-5</button>
        <button type="button" data-time-rewind="30" title="Restore thirty grid snapshots">-30</button>
      </div>
      <div class="tc-row tc-row-secondary">
        <span>History</span>
        <button type="button" data-time-snap title="Capture the current grid as a rewind point">Snap</button>
        <button type="button" data-time-clear title="Clear queued ticks and rewind history">Clear</button>
      </div>
    </div>`;
}

function syncPanel(host: HTMLElement, status: TimeControlStatus): void {
  const root = host.querySelector<HTMLElement>('[data-time-controls]');
  root?.classList.toggle('manual', status.manual);
  const manual = host.querySelector<HTMLInputElement>('[data-time-manual]');
  if (manual && document.activeElement !== manual) manual.checked = status.manual;
  setText(host, '[data-time-status]', status.lastAction);
  setText(host, '[data-time-frame]', String(status.frameCount));
  setText(host, '[data-time-history]', `${status.rewindAvailable}/${status.historyLimit}`);
  setText(host, '[data-time-queue]', String(status.queuedTicks));
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-time-rewind]')) {
    const ticks = Number(button.dataset.timeRewind ?? 0);
    button.disabled = status.rewindAvailable < ticks;
  }
  const clear = host.querySelector<HTMLButtonElement>('[data-time-clear]');
  if (clear) clear.disabled = status.rewindAvailable === 0 && status.queuedTicks === 0;
}

function setText(host: HTMLElement, selector: string, value: string): void {
  const node = host.querySelector<HTMLElement>(selector);
  if (node) node.textContent = value;
}
