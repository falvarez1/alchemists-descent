/**
 * Two-way bindings for the static HTML control panels (Sandbox).
 *
 * The bug these prevent: a hard-coded HTML control wired write-only — an `input`
 * listener that pushes to state but never reads state back — displays whatever
 * value was baked into the markup and snaps the live value to it on first drag.
 * `bindRange`/`bindSelect` SEED the control from state, write on change, and
 * return a `resync()` so the control re-reads state when it's changed elsewhere
 * (console `param`, Builder, a reset). Subscribe `resync` to `paramsChanged`.
 */

import { escapeAttr, escapeHtml } from '@/core/strings';

export interface Binding {
  /** Re-read the live value into the control. Skips a control being dragged. */
  resync(): void;
}

export function bindRange(opts: {
  slider: string;
  readout?: string;
  get: () => number;
  set: (value: number) => void;
  fmt?: (value: number) => string;
  /** Called after a user edit (e.g. to emit paramsChanged). */
  onInput?: () => void;
}): Binding {
  const slider = document.getElementById(opts.slider) as HTMLInputElement | null;
  const readout = opts.readout ? document.getElementById(opts.readout) : null;
  const fmt = opts.fmt ?? ((v: number) => String(v));
  const resync = (): void => {
    const v = opts.get();
    if (slider && document.activeElement !== slider) slider.value = String(v);
    if (readout) readout.textContent = fmt(v);
  };
  slider?.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    opts.set(v);
    if (readout) readout.textContent = fmt(v);
    opts.onInput?.();
  });
  resync();
  return { resync };
}

export function bindSelect(opts: {
  select: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  get: () => string;
  set: (value: string) => void;
  /** Called after a user pick (e.g. to regenerate / emit). */
  onChange?: () => void;
}): Binding {
  const select = document.getElementById(opts.select) as HTMLSelectElement | null;
  if (select) {
    // Build options from data so the list is never a stale hard-coded subset.
    // Escape value/label so this shared primitive stays injection-safe for any caller.
    select.innerHTML = opts.options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  }
  const resync = (): void => {
    if (select && document.activeElement !== select) select.value = opts.get();
  };
  select?.addEventListener('change', () => {
    opts.set(select.value);
    opts.onChange?.();
  });
  resync();
  return { resync };
}
