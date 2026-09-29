export type TouchControlsPreference = 'auto' | 'on' | 'off';
const STORAGE_KEY = 'ad-touch-controls-v1';

/** Input capabilities also cover tablets that identify themselves as desktop browsers. */
export function prefersTouchControls(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

export function readTouchControlsPreference(): TouchControlsPreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'on' || value === 'off' ? value : 'auto';
  } catch { return 'auto'; }
}

export function touchControlsEnabled(preference = readTouchControlsPreference()): boolean {
  return preference === 'on' || (preference === 'auto' && prefersTouchControls());
}

export function setTouchControlsPreference(value: TouchControlsPreference): void {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* The current session still works. */ }
  window.dispatchEvent(new CustomEvent('touch-controls-change', { detail: value }));
}

/** Radial dead zone, with a bounded vector even when the thumb leaves the pad. */
export function touchStickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (radius <= 0 || distance < radius * 0.18) return { x: 0, y: 0 };
  const scale = Math.min(distance / radius, 1) / distance;
  return { x: dx * scale, y: dy * scale };
}
