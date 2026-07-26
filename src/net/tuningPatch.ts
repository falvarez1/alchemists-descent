import {
  GLOBAL_PARAMS,
  GLOBAL_PARAM_DEFAULTS,
  MATERIAL_PARAMS,
  MATERIAL_PARAM_DEFAULTS,
  PLAYER_PARAMS,
  PLAYER_TUNING_DEFAULTS,
  SPELL_PARAMS,
  SPELL_PARAM_DEFAULTS,
} from '@/config/params';
import { GEN_TUNE, GEN_TUNE_DEFAULTS } from '@/config/gen';
import { PROGRESSION_PACING, PROGRESSION_PACING_DEFAULTS } from '@/config/pacing';
import type { TuningChange, TuningScalar } from '@/net/authorLinkProtocol';

/**
 * Tuning paths <-> the live mutable config singletons.
 *
 * The allowlist is DERIVED from the shipped defaults rather than hand-written:
 * a path is valid iff the defaults object has that key with a number or
 * boolean value. `config/params.ts` is the single source of truth for what a
 * dial is, so a hand-maintained schema would go stale the first time someone
 * adds one — and a stale allowlist silently drops changes rather than failing
 * loudly. It also gives type checking for free: the default's type is the
 * accepted type, so a boolean can never land on a number dial.
 *
 * This is the same diff/apply discipline `config/tuningStore.ts` uses for
 * localStorage, expressed as dotted paths instead of nested bags. Both read
 * the same defaults, so persistence and the wire cannot disagree about what
 * is tunable.
 */

type Bag = Record<string, unknown>;

// The tuning objects are concretely typed (no index signature); funnel the
// dynamic access through one cast instead of at every call site.
const bag = (o: object): Bag => o as Bag;

interface Family {
  live: object;
  defaults: object;
}

/** Flat families: `<family>.<key>`. */
const FLAT_FAMILIES: Record<string, Family> = {
  global: { live: GLOBAL_PARAMS, defaults: GLOBAL_PARAM_DEFAULTS },
  player: { live: PLAYER_PARAMS, defaults: PLAYER_TUNING_DEFAULTS },
  pacing: { live: PROGRESSION_PACING, defaults: PROGRESSION_PACING_DEFAULTS },
  gen: { live: GEN_TUNE, defaults: GEN_TUNE_DEFAULTS },
};

/** Keyed families: `<family>.<id>.<key>`. */
const KEYED_FAMILIES: Record<string, { live: Bag; defaults: Bag }> = {
  materials: { live: MATERIAL_PARAMS as unknown as Bag, defaults: MATERIAL_PARAM_DEFAULTS as unknown as Bag },
  spells: { live: SPELL_PARAMS as unknown as Bag, defaults: SPELL_PARAM_DEFAULTS as unknown as Bag },
};

/** `name` is a display label on material/spell records, not a dial. */
const NON_TUNABLE_KEYS = new Set(['name']);

interface Resolved {
  live: Bag;
  defaults: Bag;
  key: string;
}

function resolvePath(path: string): Resolved | null {
  const parts = path.split('.');
  if (parts.length === 2) {
    const family = FLAT_FAMILIES[parts[0]];
    if (!family) return null;
    return { live: bag(family.live), defaults: bag(family.defaults), key: parts[1] };
  }
  if (parts.length === 3) {
    const family = KEYED_FAMILIES[parts[0]];
    if (!family) return null;
    const live = family.live[parts[1]];
    const defaults = family.defaults[parts[1]];
    if (typeof live !== 'object' || live === null) return null;
    if (typeof defaults !== 'object' || defaults === null) return null;
    return { live: bag(live), defaults: bag(defaults), key: parts[2] };
  }
  return null;
}

/** True when `path` names a real dial whose shipped default is a scalar. */
export function isTunablePath(path: string): boolean {
  const target = resolvePath(path);
  if (!target || NON_TUNABLE_KEYS.has(target.key)) return false;
  if (!Object.prototype.hasOwnProperty.call(target.defaults, target.key)) return false;
  const dv = target.defaults[target.key];
  return typeof dv === 'number' || typeof dv === 'boolean';
}

/** SHIPPED default for a dial, or undefined when the path is not tunable. */
export function readTuningDefault(path: string): TuningScalar | undefined {
  if (!isTunablePath(path)) return undefined;
  const target = resolvePath(path);
  if (!target) return undefined;
  const value = target.defaults[target.key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/** Current live value of a dial, or undefined when the path is not tunable. */
export function readTuningPath(path: string): TuningScalar | undefined {
  if (!isTunablePath(path)) return undefined;
  const target = resolvePath(path);
  if (!target) return undefined;
  const value = target.live[target.key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Write one dial. Refuses unknown paths and type mismatches (a boolean sent to
 * a number dial is a bug on the wire, not a value to coerce).
 * Returns true when the live value actually changed.
 */
export function writeTuningPath(path: string, value: TuningScalar): boolean {
  if (!isTunablePath(path)) return false;
  const target = resolvePath(path);
  if (!target) return false;
  const dv = target.defaults[target.key];
  if (typeof dv === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  } else if (typeof dv === 'boolean') {
    if (typeof value !== 'boolean') return false;
  } else {
    return false;
  }
  if (target.live[target.key] === value) return false;
  target.live[target.key] = value;
  return true;
}

/** Every tunable path in the build, sorted — used by tests and the relay schema dump. */
export function listTuningPaths(): string[] {
  const out: string[] = [];
  for (const [family, { defaults }] of Object.entries(FLAT_FAMILIES)) {
    for (const key of Object.keys(bag(defaults))) {
      if (NON_TUNABLE_KEYS.has(key)) continue;
      const dv = bag(defaults)[key];
      if (typeof dv === 'number' || typeof dv === 'boolean') out.push(`${family}.${key}`);
    }
  }
  for (const [family, { defaults }] of Object.entries(KEYED_FAMILIES)) {
    for (const id of Object.keys(defaults)) {
      const record = defaults[id];
      if (typeof record !== 'object' || record === null) continue;
      for (const key of Object.keys(bag(record))) {
        if (NON_TUNABLE_KEYS.has(key)) continue;
        const dv = bag(record)[key];
        if (typeof dv === 'number' || typeof dv === 'boolean') out.push(`${family}.${id}.${key}`);
      }
    }
  }
  return out.sort();
}

/**
 * Snapshot every dial that currently differs from its shipped default.
 *
 * Sparse-vs-defaults (rather than "everything") is deliberate and matches
 * `tuningStore`: an untouched dial keeps tracking future changes to its
 * shipped value instead of being pinned by a stale broadcast.
 */
export function captureTuningChanges(): TuningChange[] {
  const out: TuningChange[] = [];
  for (const path of listTuningPaths()) {
    const target = resolvePath(path);
    if (!target) continue;
    const dv = target.defaults[target.key];
    const lv = target.live[target.key];
    if (typeof dv === 'number' && typeof lv === 'number' && Number.isFinite(lv) && lv !== dv) {
      out.push({ path, value: lv });
    } else if (typeof dv === 'boolean' && typeof lv === 'boolean' && lv !== dv) {
      out.push({ path, value: lv });
    }
  }
  return out;
}

/** Paths where `next` disagrees with `previous`, including reverts to default. */
export function diffTuningChanges(previous: TuningChange[], next: TuningChange[]): TuningChange[] {
  const before = new Map(previous.map((c) => [c.path, c.value]));
  const after = new Map(next.map((c) => [c.path, c.value]));
  const out: TuningChange[] = [];
  for (const [path, value] of after) {
    if (before.get(path) !== value) out.push({ path, value });
  }
  // A dial dragged back to its shipped default drops out of the sparse
  // snapshot entirely; without this it would stay stuck on the other window.
  for (const [path] of before) {
    if (after.has(path)) continue;
    const target = resolvePath(path);
    if (!target) continue;
    const dv = target.defaults[target.key];
    if (typeof dv === 'number' || typeof dv === 'boolean') out.push({ path, value: dv });
  }
  return out;
}

export interface ApplyTuningResult {
  applied: number;
  rejected: string[];
}

/** Apply a remote patch to the live singletons; unknown paths are reported, not thrown. */
export function applyTuningChanges(changes: readonly TuningChange[]): ApplyTuningResult {
  let applied = 0;
  const rejected: string[] = [];
  for (const change of changes) {
    if (!isTunablePath(change.path)) {
      rejected.push(change.path);
      continue;
    }
    if (writeTuningPath(change.path, change.value)) applied++;
  }
  return { applied, rejected };
}
