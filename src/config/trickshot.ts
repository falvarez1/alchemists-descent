import type { TrickshotSettings } from '@/core/types';

export const TRICKSHOT_DEFAULTS: Readonly<TrickshotSettings> = {
  enabled: false, timeScale: .35, durationMs: 700, chainWindowMs: 2600, assistDegrees: 4,
  finisher: true, impactPauseMs: 50, cameraMotion: true,
};

export function sanitizeTrickshot(value: Partial<TrickshotSettings> | null | undefined): TrickshotSettings {
  const number = (key: keyof TrickshotSettings, low: number, high: number): number => {
    const n = value?.[key];
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : TRICKSHOT_DEFAULTS[key] as number;
  };
  // Sub-experiments default ON under the master switch: a saved preference
  // from before they existed keeps working, and the master switch stays the
  // one place that turns the whole experiment off.
  const flag = (key: 'finisher' | 'cameraMotion'): boolean => (typeof value?.[key] === 'boolean' ? value[key] === true : TRICKSHOT_DEFAULTS[key]);
  return { enabled: value?.enabled === true, timeScale: number('timeScale', .2, .8),
    durationMs: number('durationMs', 300, 1200), chainWindowMs: number('chainWindowMs', 1200, 4500),
    assistDegrees: number('assistDegrees', 0, 8), finisher: flag('finisher'),
    impactPauseMs: number('impactPauseMs', 0, 70), cameraMotion: flag('cameraMotion') };
}
