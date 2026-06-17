import { clamp } from '@/core/math';

export type PopoverSide = 'right' | 'left' | 'bottom' | 'top';

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverViewport {
  width: number;
  height: number;
}

export interface PopoverPlacementOptions {
  preferredSide?: PopoverSide;
  gap?: number;
  margin?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface PopoverPosition {
  left: number;
  top: number;
  side: PopoverSide;
}

export interface PopoverShowOptions extends PopoverPlacementOptions {
  id: string;
  className?: string;
  anchor?: Element | null;
  anchorRect?: RectLike;
  cursor?: { x: number; y: number };
  interactive?: boolean;
  render: (el: HTMLDivElement) => void;
}

export interface PopoverHoverOptions extends Omit<PopoverShowOptions, 'anchor' | 'render'> {
  render: (el: HTMLDivElement, anchor: HTMLElement) => void;
  delayMs?: number;
  shouldShow?: (anchor: HTMLElement) => boolean;
}

const DEFAULT_GAP = 10;
const DEFAULT_MARGIN = 8;

export class PopoverHost {
  private readonly nodes = new Map<string, HTMLDivElement>();
  private hoverTimer: number | null = null;

  constructor(private readonly doc: Document = document) {
    this.doc.addEventListener('keydown', this.onKeyDown, true);
    this.doc.addEventListener('scroll', this.onScroll, true);
    this.doc.defaultView?.addEventListener('resize', this.onResize, { passive: true });
  }

  show(options: PopoverShowOptions): HTMLDivElement {
    const el = this.node(options.id, options.className);
    this.ensurePortal(el);
    el.innerHTML = '';
    el.className = options.className ?? el.className;
    el.classList.add('editor-popover');
    el.classList.toggle('interactive', options.interactive === true);
    el.dataset.editorPopover = 'true';
    el.style.position = 'fixed';
    el.style.pointerEvents = options.interactive ? 'auto' : 'none';
    el.style.visibility = 'hidden';
    el.style.display = '';
    options.render(el);
    const rect = options.anchorRect ?? options.anchor?.getBoundingClientRect() ?? cursorRect(options.cursor ?? { x: 0, y: 0 });
    const width = el.offsetWidth || 190;
    const height = el.offsetHeight || 120;
    const viewport = {
      width: this.doc.defaultView?.innerWidth ?? 1024,
      height: this.doc.defaultView?.innerHeight ?? 768,
    };
    const pos = placePopover(rect, { width, height }, viewport, options);
    el.dataset.popoverSide = pos.side;
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.style.visibility = '';
    return el;
  }

  hide(id?: string): void {
    if (this.hoverTimer !== null) {
      this.doc.defaultView?.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (id) {
      const el = this.nodes.get(id);
      if (el) {
        el.style.display = 'none';
        el.classList.remove('interactive');
      }
      return;
    }
    for (const el of this.nodes.values()) {
      el.style.display = 'none';
      el.classList.remove('interactive');
    }
  }

  /**
   * Tear down the document/window listeners and drop the popover nodes.
   * Mirrors MenuHost.dispose()/Tabs teardown so PopoverHost is symmetric and
   * safe to use per-view (current owners are app-lifetime singletons).
   */
  dispose(): void {
    if (this.hoverTimer !== null) {
      this.doc.defaultView?.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.doc.removeEventListener('scroll', this.onScroll, true);
    this.doc.defaultView?.removeEventListener('resize', this.onResize);
    for (const el of this.nodes.values()) el.remove();
    this.nodes.clear();
  }

  attachHover(anchor: HTMLElement, options: PopoverHoverOptions): () => void {
    const show = () => {
      if (options.shouldShow?.(anchor) === false) return;
      if (this.hoverTimer !== null) this.doc.defaultView?.clearTimeout(this.hoverTimer);
      const run = () =>
        this.show({
          ...options,
          anchor,
          render: (el) => options.render(el, anchor),
        });
      if (options.delayMs && options.delayMs > 0) {
        this.hoverTimer = this.doc.defaultView?.setTimeout(run, options.delayMs) ?? null;
      } else {
        run();
      }
    };
    const hide = () => this.hide(options.id);
    anchor.addEventListener('mouseenter', show);
    anchor.addEventListener('mouseleave', hide);
    return () => {
      anchor.removeEventListener('mouseenter', show);
      anchor.removeEventListener('mouseleave', hide);
    };
  }

  private node(id: string, className?: string): HTMLDivElement {
    const cached = this.nodes.get(id);
    if (cached) {
      this.ensurePortal(cached);
      return cached;
    }
    const existing = this.doc.getElementById(id);
    const el = existing instanceof HTMLDivElement ? existing : this.doc.createElement('div');
    el.id = id;
    if (className) el.className = className;
    el.style.display = 'none';
    const root = this.portalRoot();
    if (el.parentElement !== root) root.appendChild(el);
    this.nodes.set(id, el);
    return el;
  }

  private ensurePortal(el: HTMLDivElement): void {
    const root = this.portalRoot();
    if (el.parentElement !== root) root.appendChild(el);
  }

  private portalRoot(): HTMLElement {
    return this.doc.fullscreenElement instanceof HTMLElement ? this.doc.fullscreenElement : this.doc.body;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    // Only dismiss INTERACTIVE (editable) popovers on Escape, and consume the
    // event so it doesn't also fire a host-level Escape handler. Non-interactive
    // hover popovers are transient (mouseleave/scroll already dismiss them) and
    // are left alone so an unrelated tooltip isn't blown away mid-edit.
    let dismissed = false;
    for (const [id, el] of this.nodes) {
      if (el.style.display !== 'none' && el.classList.contains('interactive')) {
        this.hide(id);
        dismissed = true;
      }
    }
    if (dismissed) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private readonly onScroll = (): void => this.hide();
  private readonly onResize = (): void => this.hide();
}

export function placePopover(
  anchor: RectLike,
  size: PopoverSize,
  viewport: PopoverViewport,
  options: PopoverPlacementOptions = {},
): PopoverPosition {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const gap = options.gap ?? DEFAULT_GAP;
  const preferred = options.preferredSide ?? (anchor.left + anchor.width / 2 < viewport.width / 2 ? 'right' : 'left');
  const side = chooseSide(preferred, anchor, size, viewport, margin, gap);
  const raw = rawPosition(side, anchor, size, gap, options.offsetX ?? 0, options.offsetY ?? 0);
  return {
    left: Math.round(clamp(raw.left, margin, Math.max(margin, viewport.width - size.width - margin))),
    top: Math.round(clamp(raw.top, margin, Math.max(margin, viewport.height - size.height - margin))),
    side,
  };
}

function chooseSide(
  preferred: PopoverSide,
  anchor: RectLike,
  size: PopoverSize,
  viewport: PopoverViewport,
  margin: number,
  gap: number,
): PopoverSide {
  if (fits(preferred, anchor, size, viewport, margin, gap)) return preferred;
  const fallback: Record<PopoverSide, PopoverSide[]> = {
    right: ['left', 'bottom', 'top'],
    left: ['right', 'bottom', 'top'],
    bottom: ['top', 'right', 'left'],
    top: ['bottom', 'right', 'left'],
  };
  return fallback[preferred].find((side) => fits(side, anchor, size, viewport, margin, gap)) ?? preferred;
}

function fits(side: PopoverSide, anchor: RectLike, size: PopoverSize, viewport: PopoverViewport, margin: number, gap: number): boolean {
  const pos = rawPosition(side, anchor, size, gap, 0, 0);
  return pos.left >= margin && pos.top >= margin && pos.left + size.width <= viewport.width - margin && pos.top + size.height <= viewport.height - margin;
}

function rawPosition(side: PopoverSide, anchor: RectLike, size: PopoverSize, gap: number, offsetX: number, offsetY: number): { left: number; top: number } {
  if (side === 'left') return { left: anchor.left - size.width - gap + offsetX, top: anchor.top + offsetY };
  if (side === 'bottom') return { left: anchor.left + offsetX, top: anchor.bottom + gap + offsetY };
  if (side === 'top') return { left: anchor.left + offsetX, top: anchor.top - size.height - gap + offsetY };
  return { left: anchor.right + gap + offsetX, top: anchor.top + offsetY };
}

function cursorRect(cursor: { x: number; y: number }): RectLike {
  return { left: cursor.x, top: cursor.y, right: cursor.x, bottom: cursor.y, width: 0, height: 0 };
}
