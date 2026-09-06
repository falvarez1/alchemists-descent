import type { TrickshotSettings } from '@/core/types';

export const TRICKSHOT_DEFAULTS: Readonly<TrickshotSettings> = {
  enabled: false, timeScale: .35, durationMs: 700, chainWindowMs: 2600, assistDegrees: 4,
};

export function sanitizeTrickshot(value: Partial<TrickshotSettings> | null | undefined): TrickshotSettings {
  const number = (key: keyof TrickshotSettings, low: number, high: number): number => {
    const n = value?.[key];
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : TRICKSHOT_DEFAULTS[key] as number;
  };
  return { enabled: value?.enabled === true, timeScale: number('timeScale', .2, .8),
    durationMs: number('durationMs', 300, 1200), chainWindowMs: number('chainWindowMs', 1200, 4500),
    assistDegrees: number('assistDegrees', 0, 8) };
}
