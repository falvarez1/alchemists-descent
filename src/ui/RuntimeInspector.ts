import { renderRuntimePanel } from '@/builder/runtimePanel';
import type { Ctx } from '@/core/types';
import { buildRuntimeEntitySnapshot } from '@/game/runtimeSnapshot';
import type { RuntimeEntityGroup, RuntimeEntityRow, RuntimeEntitySnapshot } from '@/game/runtimeSnapshot';
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
  private followSelectedEntity = false;
  private rafId: number | null = null;
  private readonly onButtonClick = (): void => this.toggle();

  constructor(private readonly ctx: Ctx) {
    const holder = document.getElementById('viewport-container') ?? document.body;
    this.root = document.createElement('div');
    this.root.id = 'runtime-inspector';
    this.root.className = 'runtime-inspector';
    this.root.setAttribute('aria-hidden', 'true');
    holder.appendChild(this.root);

    this.button = document.getElementById('runtime-inspector-toggle') as HTMLButtonElement | null;
    this.button?.addEventListener('click', this.onButtonClick);
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
    this.root.addEventListener('keydown', (event) => this.handleKeyDown(event));
    this.root.addEventListener('input', (event) => this.handleInput(event));
    this.root.addEventListener('change', (event) => this.handleInput(event));

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

  dispose(): void {
    this.close();
    this.button?.removeEventListener('click', this.onButtonClick);
    this.root.remove();
    this.button?.classList.remove('lit');
    this.button?.removeAttribute('disabled');
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
      this.updateSelectedRuntimeTarget({ updateCamera: this.followSelectedEntity, snapCamera: false });
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
    const scrollTop = this.root.scrollTop;
    this.root.innerHTML = renderRuntimePanel({
      snapshot,
      query: this.query,
      filters: this.filters,
      showOverlayControls: false,
      showFocusActions: false,
      showCameraControls: true,
      cameraFollowEnabled: this.followSelectedEntity,
    });
    this.root.scrollTop = scrollTop;
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
        preserveRowOrder: true,
      });
      this.snapshotFrame = frame;
      if (this.snapshot.selectedMissing) {
        this.clearInspectionSelection();
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
    this.ctx.state.runtimeInspectionLight = null;
    this.invalidateSnapshot();
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === 'brt-search') {
      this.query = target.value;
      this.render(false);
      this.root.querySelector<HTMLInputElement>('#brt-search')?.focus({ preventScroll: true });
      return;
    }
    if (target.id === 'brt-follow-selected') {
      this.followSelectedEntity = target.checked;
      if (this.followSelectedEntity) {
        this.updateSelectedRuntimeTarget({ updateCamera: true, snapCamera: false });
      }
    }
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

  private handleKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (this.focusRouter.isTextEntryTarget(target)) return;
    const row = target.closest<HTMLElement>('[data-runtime-id]');
    if (!row || !this.root.contains(row)) return;

    if (event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      const id = row.dataset.runtimeId ?? '';
      if (id) this.focusRuntimeRow(id, { restoreRowFocus: true });
      return;
    }

    const rows = this.runtimeRows();
    const index = rows.indexOf(row);
    if (rows.length === 0 || index < 0) return;
    let nextIndex = index;
    if (event.code === 'ArrowDown' || event.code === 'ArrowRight') nextIndex = Math.min(rows.length - 1, index + 1);
    else if (event.code === 'ArrowUp' || event.code === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
    else if (event.code === 'Home') nextIndex = 0;
    else if (event.code === 'End') nextIndex = rows.length - 1;
    else return;

    event.preventDefault();
    event.stopPropagation();
    rows[nextIndex]?.focus({ preventScroll: true });
  }

  private runtimeRows(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('[data-runtime-id]'));
  }

  private focusRenderedRow(id: string): void {
    const row = this.runtimeRows().find((candidate) => candidate.dataset.runtimeId === id);
    row?.focus({ preventScroll: true });
  }

  private focusRuntimeRow(id: string, options: { restoreRowFocus?: boolean } = {}): void {
    this.selectedId = id;
    const snapshot = this.sampleSnapshot(true);
    const row = snapshot.selectedRow ?? snapshot.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      this.render(false);
      return;
    }
    const focus = runtimeRowFocus(row);
    this.ctx.state.runtimeInspectionLight = focus;
    this.ctx.camera.setInspectionFocus(focus.x, focus.y, { snap: !this.followSelectedEntity });
    this.render(false);
    if (options.restoreRowFocus) this.focusRenderedRow(id);
  }

  private updateSelectedRuntimeTarget(options: { updateCamera: boolean; snapCamera: boolean }): void {
    if (this.selectedId === null || this.ctx.state.mode !== 'play') return;
    const snapshot = buildRuntimeEntitySnapshot(this.ctx, {
      selectedId: this.selectedId,
      preserveRowOrder: true,
    });
    const row = snapshot.selectedRow;
    if (row === null || snapshot.selectedMissing) {
      this.clearInspectionSelection();
      if (this.openState && !this.pointerInside) this.render(true);
      return;
    }
    const focus = runtimeRowFocus(row);
    this.ctx.state.runtimeInspectionLight = focus;
    if (options.updateCamera) {
      this.ctx.camera.setInspectionFocus(focus.x, focus.y, { snap: options.snapCamera });
    }
  }
}

function runtimeRowFocus(row: RuntimeEntityRow): { x: number; y: number } {
  return row.bounds
    ? { x: (row.bounds.x0 + row.bounds.x1) / 2, y: (row.bounds.y0 + row.bounds.y1) / 2 }
    : { x: row.x, y: row.y };
}
