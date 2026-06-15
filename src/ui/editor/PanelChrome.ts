import { escapeAttr, escapeHtml } from '@/ui/editor/Fields';

export interface BuilderPanelHeaderOptions {
  /** Visible title. Pass the registry title (see `builderPanelTitle`); rendered upper-cased. */
  title: string;
  /** Stable id for the close button, kept for existing wiring + headless probes (e.g. `bo-close`). */
  closeId?: string;
  /** Accessible label for the icon-only close button. Defaults to `Close <title>`. */
  closeLabel?: string;
  /** Optional command id stamped on the close button. */
  closeCommandId?: string;
  /** Render the drag-handle affordance (default true). */
  handle?: boolean;
  /** Extra header-trailing markup (e.g. action buttons) rendered before the close button. */
  actions?: string;
  /** Optional extra class for panel-specific chrome hooks. */
  className?: string;
}

export interface NormalizePanelChromeOptions {
  fallbackHandleSelectors?: readonly string[];
}

/**
 * The single shared Builder panel title bar. Emits the real convention used
 * across every docked panel (`.bi-head` + `data-panel-handle`) so the registry
 * handle-selectors and headless probes keep working, plus a consistent
 * ARIA-labelled `.b-close` button. Title text is upper-cased from one source
 * (callers pass the registry title) to stop OUTLINER/VALIDATION drift.
 */
export function builderPanelHeader(options: BuilderPanelHeaderOptions): string {
  const handle = options.handle === false ? '' : ' data-panel-handle';
  const className = ['bi-head', options.className].filter(Boolean).join(' ');
  const close = options.closeId
    ? `<button id="${escapeAttr(options.closeId)}" type="button" class="b-close" aria-label="${escapeAttr(
        options.closeLabel ?? `Close ${options.title}`,
      )}"${options.closeCommandId ? ` data-command-id="${escapeAttr(options.closeCommandId)}"` : ''}>&times;</button>`
    : '';
  const trailing = `${options.actions ?? ''}${close}`;
  return `<div class="${escapeAttr(className)}"${handle}>${escapeHtml(options.title.toUpperCase())}${trailing ? ` ${trailing}` : ''}</div>`;
}

export function normalizePanelChromeHandles(panel: HTMLElement, options: NormalizePanelChromeOptions = {}): HTMLElement[] {
  const selectors = options.fallbackHandleSelectors ?? [':scope > .bi-head', ':scope > .builder-panel-title'];
  for (const selector of selectors) {
    panel.querySelector<HTMLElement>(selector)?.setAttribute('data-panel-handle', 'true');
  }
  const handles = [...panel.querySelectorAll<HTMLElement>('[data-panel-handle]')];
  for (const handle of handles) {
    handle.classList.add('builder-panel-handle');
    handle.draggable = false;
  }
  return handles;
}
