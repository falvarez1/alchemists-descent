import { escapeAttr, escapeHtml } from '@/ui/editor/Fields';

/**
 * Reusable editor tab strip. Renders an accessible `role=tablist` with optional
 * per-tab close affordance and ‹ › overflow scroll arrows that appear only when
 * the tabs do not fit. Used for in-panel section tabs (e.g. World Generation),
 * the Asset Browser views, and VS Code-style dock panel groups.
 */
export interface TabDef {
  id: string;
  label: string;
  title?: string;
  closable?: boolean;
  /** Optional leading glyph/icon HTML (already escaped/safe). */
  iconHtml?: string;
}

export interface TabStripRenderOptions {
  ariaLabel?: string;
  /** Extra class names on the `.editor-tabs` container. */
  extraClass?: string;
  /** Marks each tab draggable (for dock tear-off). */
  draggable?: boolean;
}

export function tabStripHtml(tabs: readonly TabDef[], activeId: string | null, options: TabStripRenderOptions = {}): string {
  const list = tabs.map((tab) => tabButtonHtml(tab, tab.id === activeId, options.draggable === true)).join('');
  const cls = ['editor-tabs', options.extraClass].filter(Boolean).join(' ');
  return (
    `<div class="${cls}">` +
    `<button type="button" class="editor-tabs-arrow editor-tabs-arrow-left" tabindex="-1" aria-hidden="true" data-tabs-scroll="-1">‹</button>` +
    `<div class="editor-tabs-list" role="tablist"${options.ariaLabel ? ` aria-label="${escapeAttr(options.ariaLabel)}"` : ''}>${list}</div>` +
    `<button type="button" class="editor-tabs-arrow editor-tabs-arrow-right" tabindex="-1" aria-hidden="true" data-tabs-scroll="1">›</button>` +
    `</div>`
  );
}

function tabButtonHtml(tab: TabDef, active: boolean, draggable: boolean): string {
  const close = tab.closable
    ? `<span class="editor-tab-close" role="button" tabindex="-1" data-tab-close="${escapeAttr(tab.id)}" aria-label="Close ${escapeAttr(
        tab.label,
      )}">×</span>`
    : '';
  const icon = tab.iconHtml ? `<span class="editor-tab-icon" aria-hidden="true">${tab.iconHtml}</span>` : '';
  return (
    `<button type="button" class="editor-tab${active ? ' active' : ''}" role="tab" data-tab-id="${escapeAttr(tab.id)}"` +
    ` aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}"${draggable ? ' draggable="false"' : ''}${
      tab.title ? ` title="${escapeAttr(tab.title)}"` : ''
    }>${icon}<span class="editor-tab-label">${escapeHtml(tab.label)}</span>${close}</button>`
  );
}

export interface TabStripHandlers {
  onSelect?(id: string): void;
  onClose?(id: string): void;
  onContextMenu?(id: string, event: MouseEvent): void;
  /** Fired on pointerdown over a tab body (not the close affordance) — used to start a drag. */
  onTabPointerDown?(id: string, event: PointerEvent): void;
}

export interface WiredTabStrip {
  /** Re-evaluate overflow arrow visibility (call after resize/content change). */
  refresh(): void;
  /** Scroll the active (or given) tab into view. */
  scrollIntoView(id?: string): void;
  dispose(): void;
}

/**
 * Wire a rendered tab strip: click-to-select, close affordance, keyboard
 * traversal, ‹ › overflow scrolling, and an optional pointerdown hook for drag.
 */
export function wireTabStrip(container: HTMLElement, handlers: TabStripHandlers = {}): WiredTabStrip {
  const list = container.querySelector<HTMLElement>('.editor-tabs-list');
  const leftArrow = container.querySelector<HTMLElement>('.editor-tabs-arrow-left');
  const rightArrow = container.querySelector<HTMLElement>('.editor-tabs-arrow-right');

  const refresh = (): void => {
    if (!list) return;
    const overflow = list.scrollWidth - list.clientWidth > 1;
    container.classList.toggle('has-overflow', overflow);
    const atStart = list.scrollLeft <= 1;
    const atEnd = list.scrollLeft >= list.scrollWidth - list.clientWidth - 1;
    leftArrow?.toggleAttribute('disabled', !overflow || atStart);
    rightArrow?.toggleAttribute('disabled', !overflow || atEnd);
  };

  const scrollIntoView = (id?: string): void => {
    if (!list) return;
    const target = id
      ? list.querySelector<HTMLElement>(`[data-tab-id="${cssEscape(id)}"]`)
      : list.querySelector<HTMLElement>('.editor-tab.active');
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    refresh();
  };

  const onClick = (event: MouseEvent): void => {
    const el = event.target as HTMLElement | null;
    if (!el) return;
    const scroll = el.closest<HTMLElement>('[data-tabs-scroll]');
    if (scroll && list) {
      const dir = Number(scroll.dataset.tabsScroll) || 0;
      list.scrollBy({ left: dir * Math.max(80, list.clientWidth * 0.8), behavior: 'smooth' });
      window.setTimeout(refresh, 220);
      return;
    }
    const close = el.closest<HTMLElement>('[data-tab-close]');
    if (close) {
      event.preventDefault();
      event.stopPropagation();
      handlers.onClose?.(close.dataset.tabClose ?? '');
      return;
    }
    const tab = el.closest<HTMLElement>('[data-tab-id]');
    if (tab) handlers.onSelect?.(tab.dataset.tabId ?? '');
  };

  const onContextMenu = (event: MouseEvent): void => {
    const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tab-id]');
    if (tab && handlers.onContextMenu) handlers.onContextMenu(tab.dataset.tabId ?? '', event);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const el = event.target as HTMLElement | null;
    if (!el || el.closest('[data-tab-close]') || el.closest('[data-tabs-scroll]')) return;
    const tab = el.closest<HTMLElement>('[data-tab-id]');
    if (tab && handlers.onTabPointerDown) handlers.onTabPointerDown(tab.dataset.tabId ?? '', event);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    const tabs = [...(list?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])];
    if (tabs.length === 0) return;
    const current = tabs.findIndex((t) => t === document.activeElement);
    let nextIndex = current;
    if (event.key === 'ArrowRight') nextIndex = current < 0 ? 0 : (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = current <= 0 ? tabs.length - 1 : current - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    const next = tabs[nextIndex];
    if (!next) return;
    event.preventDefault();
    next.focus();
    handlers.onSelect?.(next.dataset.tabId ?? '');
  };

  container.addEventListener('click', onClick);
  container.addEventListener('contextmenu', onContextMenu);
  if (handlers.onTabPointerDown) container.addEventListener('pointerdown', onPointerDown);
  if (list) list.addEventListener('keydown', onKeyDown);
  if (list) list.addEventListener('scroll', refresh, { passive: true });

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => refresh());
    observer.observe(container);
    if (list) observer.observe(list);
  }
  refresh();

  return {
    refresh,
    scrollIntoView,
    dispose() {
      container.removeEventListener('click', onClick);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('pointerdown', onPointerDown);
      list?.removeEventListener('keydown', onKeyDown);
      list?.removeEventListener('scroll', refresh);
      observer?.disconnect();
    },
  };
}

export interface TabViewPane {
  id: string;
  label: string;
  title?: string;
}

/**
 * A self-contained in-panel tab view: builds a tab strip + a content area and
 * shows exactly one pane at a time. Callers append their content into the body
 * returned by `paneBody(id)`. Used for long panels like World Generation.
 */
export class TabView {
  readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly content: HTMLElement;
  private wired: WiredTabStrip | null = null;
  private panes: TabViewPane[] = [];
  private bodies = new Map<string, HTMLElement>();
  private active: string | null = null;

  constructor(
    host: HTMLElement,
    private readonly options: { ariaLabel?: string; onChange?(id: string): void } = {},
  ) {
    this.el = document.createElement('div');
    this.el.className = 'editor-tabview';
    this.strip = document.createElement('div');
    this.content = document.createElement('div');
    this.content.className = 'editor-tabview-content';
    this.el.append(this.strip, this.content);
    host.appendChild(this.el);
  }

  /** Replace the set of panes. Returns the active pane id. Preserves the active pane when possible. */
  setPanes(panes: TabViewPane[], activeId?: string): string {
    this.panes = panes;
    const desired = activeId ?? this.active ?? panes[0]?.id ?? null;
    this.active = panes.some((p) => p.id === desired) ? desired : (panes[0]?.id ?? null);
    this.content.innerHTML = '';
    this.bodies.clear();
    for (const pane of panes) {
      const body = document.createElement('div');
      body.className = 'editor-tabview-pane';
      body.id = `tabview-pane-${pane.id}`;
      body.setAttribute('role', 'tabpanel');
      body.hidden = pane.id !== this.active;
      this.bodies.set(pane.id, body);
      this.content.appendChild(body);
    }
    this.renderStrip();
    return this.active ?? '';
  }

  /** The content host for a pane; append your rows here. */
  paneBody(id: string): HTMLElement {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`unknown tab pane: ${id}`);
    return body;
  }

  get activeId(): string | null {
    return this.active;
  }

  setActive(id: string): void {
    if (!this.bodies.has(id) || id === this.active) {
      if (id === this.active) this.wired?.scrollIntoView(id);
      return;
    }
    this.active = id;
    for (const [paneId, body] of this.bodies) body.hidden = paneId !== id;
    this.renderStrip();
    this.wired?.scrollIntoView(id);
    this.options.onChange?.(id);
  }

  refresh(): void {
    this.wired?.refresh();
  }

  private renderStrip(): void {
    this.wired?.dispose();
    this.strip.innerHTML = tabStripHtml(
      this.panes.map((pane) => ({ id: pane.id, label: pane.label, title: pane.title })),
      this.active,
      { ariaLabel: this.options.ariaLabel },
    );
    const stripEl = this.strip.querySelector<HTMLElement>('.editor-tabs');
    if (stripEl) this.wired = wireTabStrip(stripEl, { onSelect: (id) => this.setActive(id) });
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
