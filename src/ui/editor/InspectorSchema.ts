import type { EditorField, Vec2Field } from '@/ui/editor/Fields';
import { escapeAttr, escapeHtml, fieldRow } from '@/ui/editor/Fields';

export type InspectorTargetScope =
  | 'sandbox'
  | 'expedition'
  | 'builder-document'
  | 'builder-live-preview'
  | 'builder-playtest'
  | 'asset-library'
  | 'view-session'
  | 'live-runtime-param';

export type InspectorOwnership =
  | 'document-command'
  | 'document-metadata-command'
  | 'asset-library'
  | 'view-session'
  | 'live-runtime-param';

export interface InspectorCommandRef {
  /** Transitional metadata, shaped so it can later adapt into editor commands. */
  id: string;
  target: InspectorTargetScope;
  ownership: InspectorOwnership;
  undoable: boolean;
  payload?: Record<string, string | number | boolean>;
}

export type InspectorTone = 'normal' | 'warn' | 'muted';

export interface InspectorSectionItem {
  kind: 'section';
  label: string;
  id?: string;
}

export interface InspectorIdentityItem {
  kind: 'identity';
  value: string;
}

export interface InspectorReadoutItem {
  kind: 'readout';
  id: string;
  label: string;
  value: string | number | boolean;
  tone?: InspectorTone;
  command?: InspectorCommandRef;
}

export interface InspectorFieldItem {
  kind: 'field';
  field: EditorField;
  command: InspectorCommandRef;
}

export interface InspectorActionItem {
  kind: 'action';
  id: string;
  label: string;
  elementId?: string;
  title?: string;
  className?: string;
  disabled?: boolean;
  dataset?: Record<string, string | number | boolean>;
  command?: InspectorCommandRef;
}

export interface InspectorActionGroupItem {
  kind: 'actionGroup';
  id?: string;
  className?: string;
  actions: InspectorActionItem[];
}

export interface InspectorRowActionItem {
  kind: 'rowAction';
  id: string;
  label: string;
  actionLabel: string;
  title?: string;
  dataset?: Record<string, string | number | boolean>;
  command?: InspectorCommandRef;
}

export interface InspectorHelpItem {
  kind: 'help';
  lines: string[];
}

export interface InspectorCustomItem {
  kind: 'custom';
  id: string;
  html: string;
  command?: InspectorCommandRef;
}

export type InspectorSchemaItem =
  | InspectorSectionItem
  | InspectorIdentityItem
  | InspectorReadoutItem
  | InspectorFieldItem
  | InspectorActionItem
  | InspectorActionGroupItem
  | InspectorRowActionItem
  | InspectorHelpItem
  | InspectorCustomItem;

export const MIXED_VALUE: unique symbol = Symbol('inspector.mixed');
export type MixedValue<T> = T | typeof MIXED_VALUE;

export function sharedValue<T>(values: T[], equal: (a: T, b: T) => boolean = Object.is): MixedValue<T> | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((value) => equal(first, value)) ? first : MIXED_VALUE;
}

export function isMixedValue<T>(value: MixedValue<T> | undefined): value is typeof MIXED_VALUE {
  return value === MIXED_VALUE;
}

export function renderInspectorItems(items: InspectorSchemaItem[]): string {
  return items.map(renderInspectorItem).join('');
}

export function commandDataset(command: InspectorCommandRef): Record<string, string | number | boolean> {
  return {
    commandId: command.id,
    commandTarget: command.target,
    commandOwner: command.ownership,
    commandUndoable: command.undoable,
    ...(command.payload ?? {}),
  };
}

function renderInspectorItem(item: InspectorSchemaItem): string {
  switch (item.kind) {
    case 'section':
      return `<div class="bi-head"${item.id ? ` data-section-id="${escapeAttr(item.id)}"` : ''}>${escapeHtml(
        item.label,
      )}</div>`;
    case 'identity':
      return `<div class="bi-id">${escapeHtml(item.value)}</div>`;
    case 'readout':
      return renderReadout(item);
    case 'field':
      return fieldRow(withCommandDataset(item.field, item.command));
    case 'action':
      return renderAction(item);
    case 'actionGroup':
      return `<div${item.id ? ` data-action-group-id="${escapeAttr(item.id)}"` : ''} class="${escapeAttr(
        item.className ?? 'bp-grid bp-grid2',
      )}">${item.actions.map(renderAction).join('')}</div>`;
    case 'rowAction':
      return renderRowAction(item);
    case 'help':
      return `<div class="bi-empty">${item.lines.map(escapeHtml).join('<br>')}</div>`;
    case 'custom':
      return `<div data-custom-id="${escapeAttr(item.id)}"${item.command ? attrs(commandDataset(item.command)) : ''}>${
        item.html
      }</div>`;
  }
}

function renderReadout(item: InspectorReadoutItem): string {
  const cls = item.tone === 'warn' ? ' class="bi-warn"' : item.tone === 'muted' ? ' class="muted"' : '';
  return `<div class="bi-row" data-readout-id="${escapeAttr(item.id)}"${item.command ? attrs(commandDataset(item.command)) : ''}><span>${escapeHtml(
    item.label,
  )}</span><b${cls}>${escapeHtml(String(item.value))}</b></div>`;
}

function renderAction(item: InspectorActionItem): string {
  const command = item.command ? commandDataset(item.command) : {};
  return `<button${item.elementId ? ` id="${escapeAttr(item.elementId)}"` : ''} data-inspector-action="${escapeAttr(
    item.id,
  )}"${item.className ? ` class="${escapeAttr(item.className)}"` : ''}${item.title ? ` title="${escapeAttr(item.title)}"` : ''}${
    item.disabled ? ' disabled aria-disabled="true"' : ''
  }${attrs({ ...(item.dataset ?? {}), ...command })}>${escapeHtml(item.label)}</button>`;
}

function renderRowAction(item: InspectorRowActionItem): string {
  const command = item.command ? commandDataset(item.command) : {};
  return `<div class="bi-row" data-row-action-id="${escapeAttr(item.id)}"><span>${escapeHtml(
    item.label,
  )}</span><button${item.title ? ` title="${escapeAttr(item.title)}"` : ''}${attrs({
    ...(item.dataset ?? {}),
    ...command,
  })}>${escapeHtml(item.actionLabel)}</button></div>`;
}

function withCommandDataset(field: EditorField, command: InspectorCommandRef): EditorField {
  const commandData = commandDataset(command);
  if (field.kind === 'vec2') {
    const vec = field as Vec2Field;
    return {
      ...vec,
      xDataset: { ...(vec.xDataset ?? vec.dataset ?? {}), ...commandData },
      yDataset: { ...(vec.yDataset ?? vec.dataset ?? {}), ...commandData },
    };
  }
  return { ...field, dataset: { ...(field.dataset ?? {}), ...commandData } } as EditorField;
}

function attrs(dataset: Record<string, string | number | boolean>): string {
  return Object.entries(dataset)
    .map(([key, value]) => ` data-${toKebab(key)}="${escapeAttr(String(value))}"`)
    .join('');
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}
