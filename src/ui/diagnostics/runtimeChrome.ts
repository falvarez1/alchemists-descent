import { escapeAttr, escapeHtml } from '@/core/strings';

export { escapeAttr, escapeHtml };

export interface RuntimeSectionOptions {
  id: string;
  title: string;
  body: string;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
  collapsed?: boolean;
  attrs?: string;
}

export function runtimePanelHeader(options: {
  title: string;
  closeId: string;
  closeLabel: string;
}): string {
  return `<div class="bi-head" data-panel-handle><span class="builder-panel-title-label">${escapeHtml(
    options.title.toUpperCase(),
  )}</span><span class="builder-panel-header-actions"><button id="${escapeAttr(
    options.closeId,
  )}" type="button" class="b-close" aria-label="${escapeAttr(options.closeLabel)}">&times;</button></span></div>`;
}

export function runtimeSectionHtml(options: RuntimeSectionOptions): string {
  const bodyId = `editor-section-body-${stableDomId(options.id)}`;
  const sectionClasses = ['editor-section', options.className, options.collapsed ? 'collapsed' : '']
    .filter(Boolean)
    .join(' ');
  const titleClasses = ['editor-section-head', options.titleClassName].filter(Boolean).join(' ');
  const bodyClasses = ['editor-section-body', options.bodyClassName].filter(Boolean).join(' ');
  const attrs = options.attrs ? ` ${options.attrs.trim()}` : '';
  return `<section class="${escapeAttr(sectionClasses)}" data-section="${escapeAttr(options.id)}"${attrs}>
    <button type="button" class="${escapeAttr(titleClasses)}" data-section-toggle="${escapeAttr(options.id)}" aria-expanded="${
      options.collapsed ? 'false' : 'true'
    }" aria-controls="${escapeAttr(bodyId)}">
      <span class="bp-chevron" aria-hidden="true"></span>
      <span class="editor-section-label">${escapeHtml(options.title)}</span>
    </button>
    <div id="${escapeAttr(bodyId)}" class="${escapeAttr(bodyClasses)}">${options.body}</div>
  </section>`;
}

export function isRuntimeTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.closest?.('[contenteditable="true"]')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  const type =
    typeof input.getAttribute === 'function' ? (input.getAttribute('type') ?? 'text').toLowerCase() : 'text';
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
}
