import { renderRuntimePanel } from '@/builder/runtimePanel';
import type { Ctx } from '@/core/types';
import { buildRuntimeEntitySnapshot } from '@/game/runtimeSnapshot';
import type { RuntimeEntityGroup, RuntimeEntitySnapshot } from '@/game/runtimeSnapshot';
import { FocusRouter } from '@/ui/editor/FocusRouter';

const RUNTIME_INSPECTOR_REFRESH_FRAMES = 30;

export class RuntimeInspector {
  private readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement | null;
  private readonly focusRouter = new FocusRouter();
  private query = '';
  private filters = new Set<RuntimeEntityGroup>();
  private selectedId: string | null = null;
  private snapshot: RuntimeEntitySnapshot | null = null;
  private snapshotFrame = -1;
  private openState = false;
  private pointerInside = false;
  private rafId: number | null = null;

  constructor(private readonly ctx: Ctx) {
    const holder = document.getElementById('viewport-container') ?? document.body;
    this.root = document.createElement('div');
    this.root.id = 'runtime-inspector';
    this.root.className = 'runtime-inspector';
    this.root.setAttribute('aria-hidden', 'true');
    holder.appendChild(this.root);

    this.button = document.getElementById('runtime-inspector-toggle') as HTMLButtonElement | null;
    this.button?.addEventListener('click', () => this.toggle());
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.addEventListener('pointerup', (event) => event.stopPropagation());
    this.root.addEventListener('pointerenter', () => {
      this.pointerInside = true;
    });
    this.root.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.invalidateSnapshot();
    });
    this.root.addEventListener('mousedown', (event) => event.stopPropagation());
    this.root.addEventListener('mouseup', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => this.handleClick(event));
    this.root.addEventListener('input', (event) => this.handleInput(event));

    ctx.events.on('modeChanged', ({ mode }) => {
      this.syncButton();
      this.invalidateSnapshot();
      if (mode !== 'play') this.close();
    });
    ctx.events.on('levelChanged', () => {
      this.clearInspectionSelection();
      if (this.openState) this.render(true);
    });
    this.syncButton();
  }

  private toggle(): void {
    if (this.openState) {
      this.close();
      return;
    }
    if (this.ctx.state.mode !== 'play') {
      this.ctx.events.emit('toast', { text: 'RUNTIME INSPECTOR IS AVAILABLE IN PLAY' });
      this.syncButton();
      return;
    }
    this.open();
  }

  private open(): void {
    if (this.openState) return;
    this.pointerInside = false;
    this.openState = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.button?.classList.add('lit');
    document.body.classList.add('runtime-inspector-open');
    this.render(true);
    this.scheduleRefresh();
  }

  private close(): void {
    if (!this.openState) return;
    this.pointerInside = false;
    this.openState = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    this.button?.classList.remove('lit');
    document.body.classList.remove('runtime-inspector-open');
    this.clearInspectionSelection();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private syncButton(): void {
    if (!this.button) return;
    const enabled = this.ctx.state.mode === 'play';
    this.button.disabled = !enabled;
    this.button.classList.toggle('lit', this.openState && enabled);
    this.button.title = enabled
      ? 'Inspect the active Play runtime'
      : 'Runtime inspector is available in Play and Builder Playtest';
  }

  private scheduleRefresh(): void {
    if (!this.openState || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.openState) return;
      if (this.ctx.state.mode !== 'play') {
        this.close();
        return;
      }
      const frame = this.ctx.state.frameCount;
      const active = document.activeElement;
      const focusInside = active instanceof HTMLElement && this.root.contains(active);
      const editingText = focusInside && this.focusRouter.isTextEntryTarget(active);
      if (
        !this.pointerInside &&
        !focusInside &&
        !editingText &&
        (this.snapshotFrame < 0 || Math.abs(frame - this.snapshotFrame) >= RUNTIME_INSPECTOR_REFRESH_FRAMES)
      ) {
        this.render(true);
      }
      this.scheduleRefresh();
    });
  }

  private render(forceSnapshot: boolean): void {
    const snapshot = this.sampleSnapshot(forceSnapshot);
    this.root.innerHTML = renderRuntimePanel({
      snapshot,
      query: this.query,
      filters: this.filters,
      showOverlayControls: false,
      showFocusActions: false,
    });
  }

  private sampleSnapshot(force: boolean): RuntimeEntitySnapshot {
    const frame = this.ctx.state.frameCount;
    if (
      force ||
      this.snapshot === null ||
      this.snapshotFrame < 0 ||
      Math.abs(frame - this.snapshotFrame) >= RUNTIME_INSPECTOR_REFRESH_FRAMES
    ) {
      this.snapshot = buildRuntimeEntitySnapshot(this.ctx, {
        selectedId: this.selectedId,
      });
      this.snapshotFrame = frame;
      if (this.snapshot.selectedMissing) {
        this.selectedId = null;
        this.ctx.camera.clearInspectionFocus();
      }
    }
    return this.snapshot;
  }

  private invalidateSnapshot(): void {
    this.snapshotFrame = -1;
  }

  private clearInspectionSelection(): void {
    this.selectedId = null;
    this.ctx.camera.clearInspectionFocus();
    this.invalidateSnapshot();
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'brt-search') return;
    this.query = target.value;
    this.render(false);
    this.root.querySelector<HTMLInputElement>('#brt-search')?.focus({ preventScroll: true });
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#brt-close')) {
      this.close();
      return;
    }
    const chip = target.closest<HTMLButtonElement>('button[data-runtime-filter]');
    if (chip && this.root.contains(chip)) {
      const filter = chip.dataset.runtimeFilter as RuntimeEntityGroup;
      if (this.filters.has(filter)) this.filters.delete(filter);
      else this.filters.add(filter);
      this.render(false);
      return;
    }
    const row = target.closest<HTMLElement>('[data-runtime-id]');
    if (row && this.root.contains(row)) {
      const id = row.dataset.runtimeId ?? '';
      if (id) this.focusRuntimeRow(id);
    }
  }

  private focusRuntimeRow(id: string): void {
    this.selectedId = id;
    const snapshot = this.sampleSnapshot(true);
    const row = snapshot.selectedRow ?? snapshot.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      this.render(false);
      return;
    }
    const focusX = row.bounds ? (row.bounds.x0 + row.bounds.x1) / 2 : row.x;
    const focusY = row.bounds ? (row.bounds.y0 + row.bounds.y1) / 2 : row.y;
    this.ctx.camera.setInspectionFocus(focusX, focusY);
    this.render(false);
  }
}
