import type { Ctx } from '@/core/types';
import type { ExperimentEntry, MixFeel, MixVerdict } from '@/core/alchemy';

export const GRIMOIRE_KEY = 'noita-grimoire';
export const LEGACY_LORE_KEY = 'noita-grimoire-lore';

/** The newest schema this build writes. A record carrying a LARGER version is read, never rewritten. */
export const GRIMOIRE_VERSION = 3;
/** The experiment log keeps this many distinct mixes (the oldest inert ones go first). */
export const MAX_EXPERIMENTS = 48;

export interface GrimoireRecord {
  version: 3;
  recipes: Record<string, boolean>;
  materials: Record<string, boolean>;
  interactions: Record<string, boolean>;
  /** v3: every failed mix tried at a cauldron, oldest first (the Grimoire's experiment log). */
  experiments: ExperimentEntry[];
  /** v3: marginal notes unlocked by play (a clue's id), the part of a recipe the book has been told. */
  clues: Record<string, boolean>;
}

let cache: GrimoireRecord | null = null;
/** True while the cached record came from a NEWER schema: we read what we can and write nothing. */
let readOnly = false;

function emptyRecord(): GrimoireRecord {
  return { version: 3, recipes: {}, materials: {}, interactions: {}, experiments: [], clues: {} };
}

function boolMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [key, discovered] of Object.entries(value as Record<string, unknown>)) {
    if (discovered === true) out[key] = true;
  }
  return out;
}

const VERDICTS: readonly MixVerdict[] = ['inert', 'close', 'muddy'];
const FEELS: readonly MixFeel[] = ['hot', 'warm', 'cold'];

/** A cell id as a record key: digits only, and a real cell (ids stay under 128). */
function cellKey(k: string): boolean {
  return /^\d{1,3}$/.test(k) && Number(k) < 128;
}

function countMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(value as Record<string, unknown>)) {
    if (!cellKey(k) || typeof n !== 'number' || !Number.isFinite(n)) continue;
    const c = Math.floor(n);
    if (c >= 1 && c <= 99) out[k] = c;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function signatureOf(counts: Record<string, number>): string {
  return Object.keys(counts)
    .map(Number)
    .sort((a, b) => a - b)
    .map((c) => `${c}:${counts[String(c)]}`)
    .join(',');
}

/** Read the experiment log back defensively: anything malformed is dropped, never thrown. */
function experimentList(value: unknown): ExperimentEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ExperimentEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const counts = countMap(e.counts);
    if (!counts) continue;
    const verdict = VERDICTS.find((v) => v === e.verdict);
    if (!verdict) continue;
    const sig = signatureOf(counts);
    if (out.some((o) => o.sig === sig)) continue;
    const entry: ExperimentEntry = {
      sig,
      counts,
      verdict,
      tries: typeof e.tries === 'number' && Number.isFinite(e.tries) ? Math.max(1, Math.min(999, Math.floor(e.tries))) : 1,
    };
    if (typeof e.closeTo === 'string' && e.closeTo.length > 0 && e.closeTo.length <= 40) entry.closeTo = e.closeTo;
    if (e.feel && typeof e.feel === 'object') {
      const feel: Record<string, MixFeel> = {};
      for (const [k, f] of Object.entries(e.feel as Record<string, unknown>)) {
        const known = FEELS.find((x) => x === f);
        if (cellKey(k) && known) feel[k] = known;
      }
      if (Object.keys(feel).length > 0) entry.feel = feel;
    }
    out.push(entry);
  }
  return out.slice(-MAX_EXPERIMENTS);
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
  // A record from a newer build is never overwritten with our projection of it.
  if (readOnly) return false;
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
    version: 3,
    recipes: { ...record.recipes },
    materials: { ...record.materials },
    interactions: { ...record.interactions },
    experiments: record.experiments.map((e) => ({
      ...e,
      counts: { ...e.counts },
      ...(e.feel ? { feel: { ...e.feel } } : {}),
    })),
    clues: { ...record.clues },
  };
}

/** True if `raw` carries the nested map shape (v2, v3 or a future schema) —
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
  // Any record carrying the nested {recipes,materials,interactions} shape — v2,
  // v3 OR a FUTURE version whose known fields we can still read — is preserved
  // field-by-field. Flattening a versioned record would drop materials and
  // interactions, and the eager re-write below would then overwrite the real
  // save with an empty one (permanent loss). Only a truly legacy FLAT map (no
  // nested objects) is read as the old recipes-only format. A v2 record simply
  // has no experiments or clues yet.
  if (hasNestedMaps(raw)) {
    const source = raw as Record<string, unknown>;
    return {
      version: 3,
      recipes: boolMap(source.recipes),
      materials: boolMap(source.materials),
      interactions: boolMap(source.interactions),
      experiments: experimentList(source.experiments),
      clues: boolMap(source.clues),
    };
  }
  return { ...emptyRecord(), recipes: boolMap(raw) };
}

export function loadGrimoireRecord(): GrimoireRecord {
  if (cache) return cloneRecord(cache);

  const primaryRaw = readStorage(GRIMOIRE_KEY);
  const record = normalizePrimary(primaryRaw);
  // A record from a newer schema (version > 3) is read for what we can, but never
  // re-persisted — writing our v3 projection back would downgrade and corrupt
  // it for the newer code that owns it.
  const primaryVersion =
    primaryRaw && typeof primaryRaw === 'object' ? (primaryRaw as { version?: unknown }).version : undefined;
  const isFutureFormat = typeof primaryVersion === 'number' && primaryVersion > GRIMOIRE_VERSION;
  // Persist only when we actually transformed something: a flat legacy map we just
  // upgraded, or legacy lore we merged in. A fresh / empty record is left untouched
  // (no eager write on first run), and a v2 record is upgraded in memory and
  // written on the next change (its first experiment or clue).
  const legacyUpgrade = primaryRaw !== null && !hasNestedMaps(primaryRaw);
  let mergedLegacyLore = false;
  const legacyLore = boolMap(readStorage(LEGACY_LORE_KEY));
  for (const [id, known] of Object.entries(legacyLore)) {
    if (!known || record.materials[id]) continue;
    record.materials[id] = true;
    mergedLegacyLore = true;
  }
  cache = record;
  readOnly = isFutureFormat;
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

/** The experiment log, oldest first. */
export function loadExperiments(): ExperimentEntry[] {
  return loadGrimoireRecord().experiments;
}

/** The marginal notes this reader has unlocked (clue id -> true). */
export function loadClues(): Record<string, boolean> {
  return { ...loadGrimoireRecord().clues };
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

/**
 * Write a failed mix into the experiment log. The same mix again counts a try and
 * moves to the end (most recent last); a new mix is a new line. The log is capped:
 * when it overflows, the oldest INERT line goes first (a mix that came to nothing
 * teaches least), else the oldest.
 */
export function recordExperiment(entry: Omit<ExperimentEntry, 'tries'>): { first: boolean; tries: number } {
  let first = true;
  let tries = 1;
  update((record) => {
    const at = record.experiments.findIndex((e) => e.sig === entry.sig);
    if (at >= 0) {
      first = false;
      tries = record.experiments[at].tries + 1;
      record.experiments.splice(at, 1);
    }
    record.experiments.push({ ...entry, tries });
    while (record.experiments.length > MAX_EXPERIMENTS) {
      const inert = record.experiments.findIndex((e) => e.verdict === 'inert');
      record.experiments.splice(inert >= 0 ? inert : 0, 1);
    }
    return true;
  });
  return { first, tries };
}

/** Inscribe a marginal note. True the first time it is written. */
export function recordClue(id: string): boolean {
  return update((record) => {
    if (record.clues[id]) return false;
    record.clues[id] = true;
    return true;
  });
}

export function resetGrimoireCacheForTests(): void {
  cache = null;
  readOnly = false;
}

// Cross-tab safety: if another document rewrites or clears our keys, drop the
// in-memory cache so the next read re-syncs from localStorage instead of
// overwriting their change with our stale snapshot. (Same-document writes go
// through update()/this module, so they keep the cache coherent themselves.)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === GRIMOIRE_KEY || event.key === LEGACY_LORE_KEY || event.key === null) {
      cache = null;
      readOnly = false;
    }
  };
  window.addEventListener('storage', onStorage);
  import.meta.hot?.dispose(() => window.removeEventListener('storage', onStorage));
}
