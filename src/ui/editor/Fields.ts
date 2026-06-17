import { escapeHtml, escapeAttr } from '@/core/strings';

export { escapeHtml, escapeAttr };

export type FieldKind = 'number' | 'slider' | 'checkbox' | 'select' | 'color' | 'text' | 'swatch' | 'vec2';

export interface FieldOption {
  value: string;
  label: string;
}

export interface BaseField {
  id: string;
  label: string;
  controlId?: string;
  dataset?: Record<string, string | number | boolean>;
  disabled?: boolean;
  disabledReason?: string;
  hint?: string;
  mixed?: boolean;
  placeholder?: string;
}

export interface NumberField extends BaseField {
  kind: 'number' | 'slider';
  value: number | '';
  min?: number;
  max?: number;
  step?: number;
}

export interface CheckboxField extends BaseField {
  kind: 'checkbox';
  checked: boolean;
}

export interface SelectField extends BaseField {
  kind: 'select';
  value: string;
  options: Array<string | FieldOption>;
}

export interface TextField extends BaseField {
  kind: 'text' | 'color' | 'swatch';
  value: string;
}

export interface Vec2Field extends BaseField {
  kind: 'vec2';
  x: number;
  y: number;
  xDataset?: Record<string, string | number | boolean>;
  yDataset?: Record<string, string | number | boolean>;
  min?: number;
  max?: number;
  step?: number;
}

export type EditorField = NumberField | CheckboxField | SelectField | TextField | Vec2Field;

export function fieldRow(field: EditorField): string {
  const title = field.disabledReason ?? field.hint ?? '';
  const labelId = `editor-field-label-${escapeAttr(field.id)}`;
  return `<div class="bi-row editor-field editor-field-${field.kind}" data-field-id="${escapeAttr(field.id)}"${
    field.mixed ? ' data-mixed="true"' : ''
  }${
    title ? ` title="${escapeAttr(title)}"` : ''
  }><span id="${labelId}">${escapeHtml(field.label)}</span>${fieldControl(field, labelId)}</div>`;
}

export function numberField(field: Omit<NumberField, 'kind'>): string {
  return fieldRow({ ...field, kind: 'number' });
}

export function checkboxField(field: Omit<CheckboxField, 'kind'>): string {
  return fieldRow({ ...field, kind: 'checkbox' });
}

export function selectField(field: Omit<SelectField, 'kind'>): string {
  return fieldRow({ ...field, kind: 'select' });
}

export function vec2Field(field: Omit<Vec2Field, 'kind'>): string {
  return fieldRow({ ...field, kind: 'vec2' });
}

function fieldControl(field: EditorField, labelId: string): string {
  if (field.kind === 'checkbox') {
    return `<input type="checkbox"${controlAttrs(field, labelId)}${dataAttrs(field.dataset)}${
      field.checked ? ' checked' : ''
    }${field.mixed ? ' data-mixed="true" aria-checked="mixed"' : ''}${disabledAttrs(field)}>`;
  }
  if (field.kind === 'select') {
    const selected = field.mixed ? '\u0000' : field.value;
    const mixed = field.mixed ? '<option value="" selected disabled>mixed</option>' : '';
    return `<select${controlAttrs(field, labelId)}${dataAttrs(field.dataset)}${disabledAttrs(field)}>${mixed}${field.options
      .map((option) => optionTag(option, selected))
      .join('')}</select>`;
  }
  if (field.kind === 'color') {
    return `<input type="color" value="${escapeAttr(field.mixed ? '#000000' : field.value)}"${controlAttrs(
      field,
      labelId,
    )}${dataAttrs(field.dataset)}${mixedAttrs(field)}${disabledAttrs(field)}>`;
  }
  if (field.kind === 'swatch') {
    return `<span class="editor-field-swatch" style="background:${escapeAttr(field.value)}"></span><input type="text" value="${escapeAttr(
      field.mixed ? '' : field.value,
    )}"${controlAttrs(field, labelId)}${dataAttrs(field.dataset)}${mixedAttrs(field)}${disabledAttrs(field)}>`;
  }
  if (field.kind === 'text') {
    return `<input type="text" value="${escapeAttr(field.mixed ? '' : field.value)}"${controlAttrs(field, labelId)}${dataAttrs(
      field.dataset,
    )}${mixedAttrs(field)}${disabledAttrs(field)}>`;
  }
  if (field.kind === 'vec2') {
    const range = numberAttrs(field);
    const mixed = mixedAttrs(field);
    return `<span class="editor-field-vec2"><input type="number" value="${field.mixed ? '' : field.x}"${dataAttrs(
      field.xDataset ?? field.dataset,
    )}${range} aria-label="${escapeAttr(field.label)} X"${mixed}${disabledAttrs(field)}><input type="number" value="${
      field.mixed ? '' : field.y
    }"${dataAttrs(field.yDataset ?? field.dataset)}${range} aria-label="${escapeAttr(field.label)} Y"${mixed}${disabledAttrs(
      field,
    )}></span>`;
  }
  const numeric = field as NumberField;
  const type = field.kind === 'slider' ? 'range' : 'number';
  return `<input type="${type}" value="${numeric.mixed ? '' : numeric.value}"${controlAttrs(numeric, labelId)}${numberAttrs(
    numeric,
  )}${dataAttrs(numeric.dataset)}${mixedAttrs(numeric)}${disabledAttrs(numeric)}>`;
}

function optionTag(option: string | FieldOption, selected: string): string {
  const value = typeof option === 'string' ? option : option.value;
  const label = typeof option === 'string' ? option : option.label;
  return `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${
    label === '' ? '&mdash;' : escapeHtml(label)
  }</option>`;
}

function numberAttrs(field: { min?: number; max?: number; step?: number }): string {
  return [
    field.min === undefined ? '' : ` min="${field.min}"`,
    field.max === undefined ? '' : ` max="${field.max}"`,
    field.step === undefined ? '' : ` step="${field.step}"`,
  ].join('');
}

function controlAttrs(field: BaseField, labelId: string): string {
  return [
    field.controlId ? ` id="${escapeAttr(field.controlId)}"` : '',
    ` aria-labelledby="${labelId}"`,
    field.placeholder ? ` placeholder="${escapeAttr(field.placeholder)}"` : '',
  ].join('');
}

function mixedAttrs(field: BaseField): string {
  return field.mixed ? ' data-mixed="true"' : '';
}

function disabledAttrs(field: BaseField): string {
  return field.disabled ? ' disabled aria-disabled="true"' : '';
}

function dataAttrs(dataset: BaseField['dataset']): string {
  if (!dataset) return '';
  return Object.entries(dataset)
    .map(([key, value]) => ` data-${toKebab(key)}="${escapeAttr(String(value))}"`)
    .join('');
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

