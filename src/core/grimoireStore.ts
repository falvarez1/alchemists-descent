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

function writeStorage(record: GrimoireRecord): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(GRIMOIRE_KEY, JSON.stringify(record));
    return true;
  } catch {
    // Private mode or quota errors: the in-memory cache still records the session.
    return false;
  }
}

function removeStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
      localStorage.removeItem(key);
    }
  } catch {
    // Best-effort cleanup; a failure just leaves the legacy key in place.
  }
}

function cloneRecord(record: GrimoireRecord): GrimoireRecord {
  return {
    version: 2,
    recipes: { ...record.recipes },
    materials: { ...record.materials },
    interactions: { ...record.interactions },
  };
}

/** True if `raw` carries the nested map shape (current v2 or a future schema) —
 *  as opposed to a truly legacy FLAT recipes-only map. */
function hasNestedMaps(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    (!!r.recipes && typeof r.recipes === 'object') ||
    (!!r.materials && typeof r.materials === 'object') ||
    (!!r.interactions && typeof r.interactions === 'object')
  );
}

function normalizePrimary(raw: unknown): GrimoireRecord {
  // Any record carrying the nested {recipes,materials,interactions} shape — the
  // current v2 OR a FUTURE version whose known fields we can still read — is
  // preserved field-by-field. Flattening a versioned record would drop materials
  // and interactions, and the eager re-write below would then overwrite the real
  // save with an empty one (permanent loss). Only a truly legacy FLAT map (no
  // nested objects) is read as the old recipes-only format.
  if (hasNestedMaps(raw)) {
    const source = raw as Partial<GrimoireRecord>;
    return {
      version: 2,
      recipes: boolMap(source.recipes),
      materials: boolMap(source.materials),
      interactions: boolMap(source.interactions),
    };
  }
  return { ...emptyRecord(), recipes: boolMap(raw) };
}

export function loadGrimoireRecord(): GrimoireRecord {
  if (cache) return cloneRecord(cache);

  const primaryRaw = readStorage(GRIMOIRE_KEY);
  const record = normalizePrimary(primaryRaw);
  // A record from a newer schema (version > 2) is read for what we can, but never
  // re-persisted here — writing our v2 projection back would downgrade and corrupt
  // it for the newer code that owns it.
  const primaryVersion =
    primaryRaw && typeof primaryRaw === 'object' ? (primaryRaw as { version?: unknown }).version : undefined;
  const isFutureFormat = typeof primaryVersion === 'number' && primaryVersion > 2;
  // Persist only when we actually transformed something: a flat legacy map we just
  // upgraded to v2, or legacy lore we merged in. A fresh / empty / already-v2
  // record is left untouched (no eager write on first run).
  const legacyUpgrade = primaryRaw !== null && !hasNestedMaps(primaryRaw);
  let mergedLegacyLore = false;
  const legacyLore = boolMap(readStorage(LEGACY_LORE_KEY));
  for (const [id, known] of Object.entries(legacyLore)) {
    if (!known || record.materials[id]) continue;
    record.materials[id] = true;
    mergedLegacyLore = true;
  }
  cache = record;
  if (!isFutureFormat && (legacyUpgrade || mergedLegacyLore)) {
    const persisted = writeStorage(record);
    // True one-time migration: once legacy lore is folded into the unified record
    // AND persisted, drop the legacy key so it can't be re-merged on every load.
    if (persisted && mergedLegacyLore) removeStorage(LEGACY_LORE_KEY);
  }
  return cloneRecord(record);
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

// Cross-tab safety: if another document rewrites or clears our keys, drop the
// in-memory cache so the next read re-syncs from localStorage instead of
// overwriting their change with our stale snapshot. (Same-document writes go
// through update()/this module, so they keep the cache coherent themselves.)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === GRIMOIRE_KEY || event.key === LEGACY_LORE_KEY || event.key === null) {
      cache = null;
    }
  };
  window.addEventListener('storage', onStorage);
  import.meta.hot?.dispose(() => window.removeEventListener('storage', onStorage));
}
