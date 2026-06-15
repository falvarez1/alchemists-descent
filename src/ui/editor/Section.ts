import { escapeAttr, escapeHtml } from '@/ui/editor/Fields';

export interface EditorSectionOptions {
  id: string;
  title: string;
  body: string;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
  collapsed?: boolean;
  count?: number | string;
  attrs?: string;
}

export function editorSectionHtml(options: EditorSectionOptions): string {
  const bodyId = `editor-section-body-${stableDomId(options.id)}`;
  const sectionClasses = ['editor-section', options.className, options.collapsed ? 'collapsed' : '']
    .filter(Boolean)
    .join(' ');
  const titleClasses = ['editor-section-head', options.titleClassName].filter(Boolean).join(' ');
  const bodyClasses = ['editor-section-body', options.bodyClassName].filter(Boolean).join(' ');
  const count =
    options.count === undefined
      ? ''
      : `<span class="editor-section-count">${escapeHtml(String(options.count))}</span>`;
  const attrs = options.attrs ? ` ${options.attrs.trim()}` : '';
  return `<section class="${escapeAttr(sectionClasses)}" data-section="${escapeAttr(options.id)}"${attrs}>
    <button type="button" class="${escapeAttr(titleClasses)}" data-section-toggle="${escapeAttr(options.id)}" aria-expanded="${
      options.collapsed ? 'false' : 'true'
    }" aria-controls="${escapeAttr(bodyId)}">
      <span class="bp-chevron" aria-hidden="true"></span>
      <span class="editor-section-label">${escapeHtml(options.title)}</span>${count}
    </button>
    <div id="${escapeAttr(bodyId)}" class="${escapeAttr(bodyClasses)}">${options.body}</div>
  </section>`;
}

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
}
