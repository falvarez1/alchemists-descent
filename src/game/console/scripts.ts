export const CONSOLE_SCRIPTS_KEY = 'noita-console-scripts';

export type ConsoleScriptMap = Record<string, string>;

export interface ConsoleScriptLine {
  lineNumber: number;
  line: string;
}

type ConsoleStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storageOrNull(storage?: ConsoleStorage): ConsoleStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function normalizeScriptName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function loadConsoleScripts(storage?: ConsoleStorage): ConsoleScriptMap {
  const store = storageOrNull(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(CONSOLE_SCRIPTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ConsoleScriptMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const name = normalizeScriptName(key);
      if (!name) continue;
      if (typeof value === 'string') out[name] = value;
      else if (Array.isArray(value) && value.every((line) => typeof line === 'string')) out[name] = value.join('\n');
    }
    return out;
  } catch {
    return {};
  }
}

export function saveConsoleScripts(scripts: ConsoleScriptMap, storage?: ConsoleStorage): boolean {
  const store = storageOrNull(storage);
  if (!store) return false;
  try {
    store.setItem(CONSOLE_SCRIPTS_KEY, JSON.stringify(scripts));
    return true;
  } catch {
    return false;
  }
}

export function upsertConsoleScript(name: string, body: string, storage?: ConsoleStorage): { ok: boolean; name: string } {
  const normalized = normalizeScriptName(name);
  if (!normalized) return { ok: false, name: normalized };
  const scripts = loadConsoleScripts(storage);
  scripts[normalized] = body;
  return { ok: saveConsoleScripts(scripts, storage), name: normalized };
}

export function scriptNames(storage?: ConsoleStorage): string[] {
  return Object.keys(loadConsoleScripts(storage)).sort();
}

export function parseScriptLines(body: string): ConsoleScriptLine[] {
  return body
    .split(/\r?\n/)
    .map((line, index) => ({ lineNumber: index + 1, line: line.trim() }))
    .filter(({ line }) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));
}
