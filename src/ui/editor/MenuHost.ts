import type { CommandRegistry } from '@/ui/editor/CommandRegistry';
import type { CommandRunResult } from '@/ui/editor/CommandRegistry';
import type { PopoverPosition, RectLike } from '@/ui/editor/PopoverHost';
import { placePopover } from '@/ui/editor/PopoverHost';

export interface CommandMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface CommandMenuOptions {
  id?: string;
  registry: CommandRegistry;
  commandIds: readonly string[];
  anchorRect?: RectLike;
  cursor?: { x: number; y: number };
  commandState?: (id: string) => { enabled: boolean; reason?: string };
  runCommand?: (id: string) => CommandRunResult;
  onStatus?: (message: string, error?: boolean) => void;
}

export class MenuHost {
  private readonly root: HTMLDivElement;
  private readonly modalObserver: MutationObserver | null = null;

  constructor(private readonly doc: Document = document) {
    this.root = doc.createElement('div');
    this.root.id = 'editor-menu-host';
    this.root.className = 'editor-command-menu';
    this.root.setAttribute('role', 'menu');
    this.root.style.display = 'none';
    this.portalRoot().appendChild(this.root);
    doc.addEventListener('keydown', (event) => {
      if (!this.isOpen()) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.hide();
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.focusNext(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.focusNext(event.code === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.code === 'Enter' || event.code === 'Space') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    doc.addEventListener('pointerdown', (event) => {
      if (this.root.style.display === 'none') return;
      if (event.target instanceof Node && this.root.contains(event.target)) return;
      this.hide();
    }, true);
    if (typeof MutationObserver !== 'undefined') {
      this.modalObserver = new MutationObserver(() => {
        if (this.isOpen() && this.modalSurfaceOpen()) this.hide();
      });
      this.modalObserver.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
  }

  showCommandMenu(options: CommandMenuOptions): HTMLDivElement {
    const items = commandMenuItems(options.registry, options.commandIds, options.commandState);
    const root = this.portalRoot();
    if (this.root.parentElement !== root) root.appendChild(this.root);
    this.root.innerHTML = '';
    this.root.dataset.menuId = options.id ?? '';
    this.root.classList.add('open');
    for (const item of items) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.className = 'editor-command-menu-item' + (item.enabled ? '' : ' disabled');
      button.textContent = item.label;
      if (!item.enabled) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = item.reason ?? 'Command unavailable';
      }
      button.addEventListener('click', () => {
        const result = (options.runCommand ?? ((id: string) => options.registry.run(id)))(item.id);
        if (!result.ok) options.onStatus?.(result.reason ?? 'Command unavailable', true);
        this.hide();
      });
      this.root.appendChild(button);
    }
    if (items.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'editor-command-menu-empty';
      empty.textContent = 'No commands';
      this.root.appendChild(empty);
    }
    this.root.style.visibility = 'hidden';
    this.root.style.display = '';
    const rect = options.anchorRect ?? cursorRect(options.cursor ?? { x: 0, y: 0 });
    const pos: PopoverPosition = placePopover(
      rect,
      { width: this.root.offsetWidth || 180, height: this.root.offsetHeight || 40 },
      { width: this.doc.defaultView?.innerWidth ?? 1024, height: this.doc.defaultView?.innerHeight ?? 768 },
      { preferredSide: 'bottom', gap: 6, margin: 8 },
    );
    this.root.style.left = `${pos.left}px`;
    this.root.style.top = `${pos.top}px`;
    this.root.style.visibility = '';
    this.root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return this.root;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.classList.remove('open');
  }

  dispose(): void {
    this.modalObserver?.disconnect();
    this.root.remove();
  }

  isOpen(): boolean {
    return this.root.classList.contains('open') && this.root.style.display !== 'none';
  }

  private focusNext(delta: number): void {
    const items = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (items.length === 0) return;
    const current = this.doc.activeElement instanceof HTMLButtonElement ? items.indexOf(this.doc.activeElement) : -1;
    const next = items[(current + delta + items.length) % items.length];
    next.focus({ preventScroll: true });
  }

  private modalSurfaceOpen(): boolean {
    return (
      this.doc.querySelector('.app-dialog-root') !== null ||
      this.doc.getElementById('builder-help')?.classList.contains('open') === true
    );
  }

  private portalRoot(): HTMLElement {
    return this.doc.fullscreenElement instanceof HTMLElement ? this.doc.fullscreenElement : this.doc.body;
  }
}

export function commandMenuItems(
  registry: CommandRegistry,
  commandIds: readonly string[],
  commandState?: (id: string) => { enabled: boolean; reason?: string },
): CommandMenuItem[] {
  return commandIds
    .map((id): CommandMenuItem | null => {
      const command = registry.get(id);
      if (!command || command.visible?.() === false) return null;
      const state = commandState?.(id);
      const enabled = state?.enabled ?? registry.isEnabled(id);
      const item: CommandMenuItem = { id, label: command.label, enabled };
      if (!enabled) item.reason = state?.reason ?? registry.disabledReason(id);
      return item;
    })
    .filter((item): item is CommandMenuItem => item !== null);
}

function cursorRect(cursor: { x: number; y: number }): RectLike {
  return { left: cursor.x, top: cursor.y, right: cursor.x, bottom: cursor.y, width: 0, height: 0 };
}
