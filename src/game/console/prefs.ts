export const CONSOLE_WATCHES_KEY = 'noita-console-watches';
export const CONSOLE_BINDS_KEY = 'noita-console-binds';
export const CONSOLE_WATCH_LIMIT = 12;

type ConsoleStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storageOrNull(storage?: ConsoleStorage): ConsoleStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function readJson<T>(key: string, fallback: T, storage?: ConsoleStorage): T {
  const store = storageOrNull(storage);
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown, storage?: ConsoleStorage): boolean {
  const store = storageOrNull(storage);
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeWatchPath(raw: string): string | null {
  const path = raw.trim();
  if (!/^(global|materials|spells|postFx)\.[A-Za-z0-9._-]+$/.test(path)) return null;
  return path;
}

export function loadConsoleWatches(storage?: ConsoleStorage): string[] {
  const raw = readJson<unknown>(CONSOLE_WATCHES_KEY, [], storage);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((value): value is string => typeof value === 'string').map(normalizeWatchPath).filter((value): value is string => value !== null))]
    .sort()
    .slice(0, CONSOLE_WATCH_LIMIT);
}

export function saveConsoleWatches(paths: string[], storage?: ConsoleStorage): boolean {
  return writeJson(CONSOLE_WATCHES_KEY, [...new Set(paths.map(normalizeWatchPath).filter((value): value is string => value !== null))].sort().slice(0, CONSOLE_WATCH_LIMIT), storage);
}

export function normalizeBindKey(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  if (/^F([4-9]|10|12)$/.test(key)) return key;
  return null;
}

export function loadConsoleBinds(storage?: ConsoleStorage): Record<string, string> {
  const raw = readJson<unknown>(CONSOLE_BINDS_KEY, {}, storage);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, command] of Object.entries(raw)) {
    const normalized = normalizeBindKey(key);
    if (normalized && typeof command === 'string' && command.trim().length > 0) out[normalized] = command.trim();
  }
  return out;
}

export function saveConsoleBinds(binds: Record<string, string>, storage?: ConsoleStorage): boolean {
  const out: Record<string, string> = {};
  for (const [key, command] of Object.entries(binds)) {
    const normalized = normalizeBindKey(key);
    if (normalized && typeof command === 'string' && command.trim().length > 0) out[normalized] = command.trim();
  }
  return writeJson(CONSOLE_BINDS_KEY, out, storage);
}
