import type { DockRegion } from '@/ui/editor/Workspace';
import { escapeAttr, escapeHtml } from '@/ui/editor/Fields';

export interface PanelChromeAction {
  id: string;
  label: string;
  icon?: string;
  pressed?: boolean;
  disabled?: boolean;
}

export interface PanelChromeRenderOptions {
  title: string;
  dock?: DockRegion;
  handle?: boolean;
  actions?: readonly PanelChromeAction[];
}

export interface NormalizePanelChromeOptions {
  fallbackHandleSelectors?: readonly string[];
}

export function panelChromeHtml(options: PanelChromeRenderOptions): string {
  const handle = options.handle === false ? '' : ' data-panel-handle';
  const dock = options.dock ? ` data-panel-dock="${escapeAttr(options.dock)}"` : '';
  const actions = (options.actions ?? []).map(panelActionHtml).join('');
  return `<div class="editor-panel-chrome"${handle}${dock}><span class="editor-panel-title">${escapeHtml(
    options.title,
  )}</span>${actions ? `<span class="editor-panel-actions">${actions}</span>` : ''}</div>`;
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

function panelActionHtml(action: PanelChromeAction): string {
  const classes = ['editor-panel-action'];
  if (action.pressed) classes.push('pressed');
  const icon = action.icon ? `<span aria-hidden="true">${escapeHtml(action.icon)}</span>` : '';
  return `<button type="button" class="${classes.join(' ')}" data-panel-action="${escapeAttr(action.id)}" aria-label="${escapeAttr(
    action.label,
  )}"${action.disabled ? ' disabled aria-disabled="true"' : ''}>${icon}</button>`;
}
