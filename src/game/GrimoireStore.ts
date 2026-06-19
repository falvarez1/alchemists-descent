import type { Ctx } from '@/core/types';

export const GRIMOIRE_KEY = 'noita-grimoire';
export const LEGACY_LORE_KEY = 'noita-grimoire-lore';

interface GrimoireRecord {
  version: 2;
  recipes: Record<string, boolean>;
  materials: Record<string, boolean>;
  interactions: Record<string, boolean>;
}

let cache: GrimoireRecord | null = null;

function emptyRecord(): GrimoireRecord {
  return { version: 2, recipes: {}, materials: {}, interactions: {} };
}

function boolMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [key, discovered] of Object.entries(value as Record<string, unknown>)) {
    if (discovered === true) out[key] = true;
  }
  return out;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStorage(key: string): unknown {
  try {
    return typeof localStorage !== 'undefined' ? parseJson(localStorage.getItem(key)) : null;
  } catch {
    return null;
  }
}

function writeStorage(record: GrimoireRecord): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(GRIMOIRE_KEY, JSON.stringify(record));
  } catch {
    // Private mode or quota errors: the in-memory cache still records the session.
  }
}

function normalizePrimary(raw: unknown): GrimoireRecord {
  if (raw && typeof raw === 'object' && (raw as { version?: unknown }).version === 2) {
    const source = raw as Partial<GrimoireRecord>;
    return {
      version: 2,
      recipes: boolMap(source.recipes),
      materials: boolMap(source.materials),
      interactions: boolMap(source.interactions),
    };
  }
  const legacyRecipes = boolMap(raw);
  return { ...emptyRecord(), recipes: legacyRecipes };
}

export function loadGrimoireRecord(): GrimoireRecord {
  if (cache) return {
    version: 2,
    recipes: { ...cache.recipes },
    materials: { ...cache.materials },
    interactions: { ...cache.interactions },
  };

  const primaryRaw = readStorage(GRIMOIRE_KEY);
  const record = normalizePrimary(primaryRaw);
  const legacyLore = boolMap(readStorage(LEGACY_LORE_KEY));
  let changed = primaryRaw === null || !(primaryRaw && typeof primaryRaw === 'object' && (primaryRaw as { version?: unknown }).version === 2);
  for (const [id, known] of Object.entries(legacyLore)) {
    if (!known || record.materials[id]) continue;
    record.materials[id] = true;
    changed = true;
  }
  cache = record;
  if (changed) writeStorage(record);
  return loadGrimoireRecord();
}

function update(mutator: (record: GrimoireRecord) => boolean): boolean {
  const record = loadGrimoireRecord();
  const changed = mutator(record);
  if (!changed) return false;
  cache = record;
  writeStorage(record);
  return true;
}

export function loadDiscoveredRecipes(): Record<string, boolean> {
  return { ...loadGrimoireRecord().recipes };
}

export function loadDiscoveredMaterials(): Record<string, boolean> {
  return { ...loadGrimoireRecord().materials };
}

export function loadDiscoveredInteractions(): Record<string, boolean> {
  return { ...loadGrimoireRecord().interactions };
}

export function recordRecipeDiscovery(ctx: Ctx, id: string, title: string): boolean {
  const changed = update((record) => {
    if (record.recipes[id]) return false;
    record.recipes[id] = true;
    return true;
  });
  if (changed) ctx.events.emit('grimoireEntryDiscovered', { kind: 'recipe', id, title });
  return changed;
}

export function recordMaterialDiscovery(ctx: Ctx, id: string, title: string): boolean {
  const changed = update((record) => {
    if (record.materials[id]) return false;
    record.materials[id] = true;
    return true;
  });
  if (changed) ctx.events.emit('grimoireEntryDiscovered', { kind: 'material', id, title });
  return changed;
}

export function recordInteractionDiscovery(ctx: Ctx, id: string, title: string): boolean {
  const changed = update((record) => {
    if (record.interactions[id]) return false;
    record.interactions[id] = true;
    return true;
  });
  if (changed) ctx.events.emit('grimoireEntryDiscovered', { kind: 'interaction', id, title });
  return changed;
}

export function resetGrimoireCacheForTests(): void {
  cache = null;
}
