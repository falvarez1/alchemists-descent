import type {
  BackdropGradeSettings,
  BackdropLayerId,
  BackdropLayerSettings,
  BackdropLevelProfile,
  BackdropProfile,
  BackdropSettings,
  LevelRuntime,
} from '@/core/types';

export interface BackdropLayerSpec {
  id: BackdropLayerId;
  label: string;
  file: string;
  src: string;
  defaultSpeed: number;
  defaultOpacity: number;
}

export const BACKDROP_SETTINGS_KEY = 'noita-backdrop-settings';

export const DEFAULT_BACKDROP_GRADE: BackdropGradeSettings = {
  exposure: -0.35,
  brightness: -0.015,
  contrast: 1,
  gamma: 1,
  saturation: 0.95,
};

export const BACKDROP_LAYER_SPECS: readonly BackdropLayerSpec[] = [
  {
    id: 'back',
    label: 'Back layer',
    file: 'back-layer.png',
    src: new URL('../../backdrop/back-layer.png', import.meta.url).href,
    defaultSpeed: 0.1,
    defaultOpacity: 1,
  },
  {
    id: 'second',
    label: 'Second layer',
    file: 'second-layer.png',
    src: new URL('../../backdrop/second-layer.png', import.meta.url).href,
    defaultSpeed: 0.18,
    defaultOpacity: 1,
  },
  {
    id: 'third',
    label: 'Third layer',
    file: 'third-layer.png',
    src: new URL('../../backdrop/third-layer.png', import.meta.url).href,
    defaultSpeed: 0.3,
    defaultOpacity: 1,
  },
  {
    id: 'fourth',
    label: 'Fourth layer',
    file: 'fourth-layer.png',
    src: new URL('../../backdrop/fourth-layer.png', import.meta.url).href,
    defaultSpeed: 0.48,
    defaultOpacity: 1,
  },
  {
    id: 'front',
    label: 'Front layer',
    file: 'front-layer.png',
    src: new URL('../../backdrop/front-layer.png', import.meta.url).href,
    defaultSpeed: 0.72,
    defaultOpacity: 1,
  },
] as const;

function storageOrNull(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function createDefaultLayer(spec: BackdropLayerSpec): BackdropLayerSettings {
  return {
    speed: spec.defaultSpeed,
    opacity: spec.defaultOpacity,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    visible: true,
  };
}

export function createDefaultBackdropProfile(): BackdropProfile {
  const layers = {} as BackdropProfile['layers'];
  for (const spec of BACKDROP_LAYER_SPECS) layers[spec.id] = createDefaultLayer(spec);
  return { layers, grade: { ...DEFAULT_BACKDROP_GRADE } };
}

export function cloneBackdropProfile(profile: BackdropProfile): BackdropProfile {
  const layers = {} as BackdropProfile['layers'];
  for (const spec of BACKDROP_LAYER_SPECS) {
    const layer = profile.layers[spec.id] ?? createDefaultLayer(spec);
    layers[spec.id] = {
      speed: clampBackdropSpeed(layer.speed),
      opacity: clampBackdropOpacity(layer.opacity),
      offsetX: clampBackdropOffset(layer.offsetX),
      offsetY: clampBackdropOffset(layer.offsetY),
      scale: clampBackdropScale(layer.scale),
      visible: layer.visible !== false,
    };
  }
  return { layers, grade: sanitizeBackdropGrade(profile.grade) };
}

export function createDefaultBackdropSettings(): BackdropSettings {
  return {
    ...createDefaultBackdropProfile(),
    levels: {},
  };
}

export function cloneBackdropSettings(settings: BackdropSettings): BackdropSettings {
  return sanitizeBackdropSettings(settings);
}

export function copyBackdropSettingsInto(target: BackdropSettings, source: unknown): BackdropSettings {
  const clean = sanitizeBackdropSettings(source);
  target.layers = clean.layers;
  target.grade = clean.grade;
  target.levels = clean.levels;
  return target;
}

export function resolveBackdropProfile(
  settings: BackdropSettings,
  levelId?: string | null,
): BackdropProfile {
  const level = levelId ? settings.levels[levelId] : undefined;
  return level?.enabled ? level : settings;
}

export function resolveBackdropLayers(
  settings: BackdropSettings,
  levelId?: string | null,
): Record<BackdropLayerId, BackdropLayerSettings> {
  return resolveBackdropProfile(settings, levelId).layers;
}

export function resolveBackdropProfileForRuntime(
  settings: BackdropSettings,
  runtime?: LevelRuntime | null,
): BackdropProfile {
  const source = runtime?.backdrop ?? settings;
  return resolveBackdropProfile(source, runtime?.backdropLevelId ?? runtime?.def.id);
}

export function resolveBackdropLayersForRuntime(
  settings: BackdropSettings,
  runtime?: LevelRuntime | null,
): Record<BackdropLayerId, BackdropLayerSettings> {
  return resolveBackdropProfileForRuntime(settings, runtime).layers;
}

export function setBackdropLevelOverride(settings: BackdropSettings, levelId: string, enabled: boolean): void {
  if (enabled) {
    const existing = settings.levels[levelId];
    settings.levels[levelId] = {
      ...cloneBackdropProfile(existing?.enabled ? existing : { layers: settings.layers, grade: settings.grade }),
      enabled: true,
    };
  } else {
    delete settings.levels[levelId];
  }
}

export function sanitizeBackdropSettings(raw: unknown): BackdropSettings {
  const defaults = createDefaultBackdropSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  const source = raw as Partial<BackdropSettings>;
  const globalProfile = cloneBackdropProfile({
    layers: (source.layers ?? defaults.layers) as BackdropProfile['layers'],
    grade: source.grade ?? defaults.grade,
  });
  const levels: BackdropSettings['levels'] = {};
  if (source.levels && typeof source.levels === 'object' && !Array.isArray(source.levels)) {
    for (const [levelId, value] of Object.entries(source.levels)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const profile = value as Partial<BackdropLevelProfile>;
      if (profile.enabled !== true) continue;
      levels[levelId] = {
        ...cloneBackdropProfile({
          layers: (profile.layers ?? globalProfile.layers) as BackdropProfile['layers'],
          grade: profile.grade ?? globalProfile.grade,
        }),
        enabled: true,
      };
    }
  }
  return { ...globalProfile, levels };
}

export function loadBackdropSettings(): BackdropSettings {
  const store = storageOrNull();
  if (!store) return createDefaultBackdropSettings();
  try {
    const raw = store.getItem(BACKDROP_SETTINGS_KEY);
    return raw ? sanitizeBackdropSettings(JSON.parse(raw)) : createDefaultBackdropSettings();
  } catch {
    return createDefaultBackdropSettings();
  }
}

export function saveBackdropSettings(settings: BackdropSettings): boolean {
  const store = storageOrNull();
  if (!store) return false;
  try {
    store.setItem(BACKDROP_SETTINGS_KEY, JSON.stringify(sanitizeBackdropSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function sanitizeBackdropGrade(raw: unknown): BackdropGradeSettings {
  const source = raw as Partial<BackdropGradeSettings> | null;
  return {
    exposure: clampBackdropExposure(source?.exposure ?? DEFAULT_BACKDROP_GRADE.exposure),
    brightness: clampBackdropBrightness(source?.brightness ?? DEFAULT_BACKDROP_GRADE.brightness),
    contrast: clampBackdropContrast(source?.contrast ?? DEFAULT_BACKDROP_GRADE.contrast),
    gamma: clampBackdropGamma(source?.gamma ?? DEFAULT_BACKDROP_GRADE.gamma),
    saturation: clampBackdropSaturation(source?.saturation ?? DEFAULT_BACKDROP_GRADE.saturation),
  };
}

export function clampBackdropSpeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1.5, value));
}

export function clampBackdropOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

export function clampBackdropOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-8192, Math.min(8192, value));
}

export function clampBackdropScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.25, Math.min(4, value));
}

export function clampBackdropExposure(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKDROP_GRADE.exposure;
  return Math.max(-3, Math.min(2, value));
}

export function clampBackdropBrightness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKDROP_GRADE.brightness;
  return Math.max(-0.5, Math.min(0.5, value));
}

export function clampBackdropContrast(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKDROP_GRADE.contrast;
  return Math.max(0.25, Math.min(2.5, value));
}

export function clampBackdropGamma(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKDROP_GRADE.gamma;
  return Math.max(0.35, Math.min(3, value));
}

export function clampBackdropSaturation(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKDROP_GRADE.saturation;
  return Math.max(0, Math.min(2.5, value));
}
