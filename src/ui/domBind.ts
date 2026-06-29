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
  /** Remove DOM listeners owned by this binding. */
  dispose?(): void;
}

export function bindRange(opts: {
  slider: string;
  readout?: string;
  get: () => number;
  set: (value: number) => void;
  fmt?: (value: number) => string;
  /** Called after a user edit (e.g. to emit paramsChanged). */
  onInput?: () => void;
  /** Code default. When given, the readout marks itself 'overridden' when the live
   *  value differs and becomes click-to-reset — so you can always tell (and undo)
   *  when a value diverges from params.ts. */
  defaultValue?: number;
}): Binding {
  const slider = document.getElementById(opts.slider) as HTMLInputElement | null;
  const readout = opts.readout ? document.getElementById(opts.readout) : null;
  const fmt = opts.fmt ?? ((v: number) => String(v));
  const def = opts.defaultValue;
  const refresh = (v: number): void => {
    if (!readout) return;
    readout.textContent = fmt(v);
    if (def !== undefined) readout.classList.toggle('overridden', Math.abs(v - def) > 1e-6);
  };
  const resync = (): void => {
    const v = opts.get();
    if (slider && document.activeElement !== slider) slider.value = String(v);
    refresh(v);
  };
  const onSliderInput = (): void => {
    if (!slider) return;
    const v = parseFloat(slider.value);
    opts.set(v);
    refresh(v);
    opts.onInput?.();
  };
  slider?.addEventListener('input', onSliderInput);
  let onReadoutClick: (() => void) | null = null;
  if (def !== undefined && readout) {
    readout.classList.add('resettable');
    readout.title = `Click to reset to default (${fmt(def)})`;
    onReadoutClick = (): void => {
      opts.set(def);
      if (slider) slider.value = String(def);
      refresh(def);
      opts.onInput?.();
    };
    readout.addEventListener('click', onReadoutClick);
  }
  resync();
  return {
    resync,
    dispose: () => {
      slider?.removeEventListener('input', onSliderInput);
      if (onReadoutClick) readout?.removeEventListener('click', onReadoutClick);
    },
  };
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
  const onChange = (): void => {
    if (!select) return;
    opts.set(select.value);
    opts.onChange?.();
  };
  select?.addEventListener('change', onChange);
  resync();
  return {
    resync,
    dispose: () => select?.removeEventListener('change', onChange),
  };
}
