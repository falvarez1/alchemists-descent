import { sanitizePrefab } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';

/**
 * Built-in prefab registry for descent worldgen. Descent generation uses
 * BUILT-INS ONLY: restoreLevel regenerates the pristine world from the seed,
 * so placement inputs must be identical on every machine — user-library
 * prefabs (localStorage) would desync saves across installs.
 *
 * Files are eager-imported with lexicographically sorted keys and pushed
 * through sanitizePrefab, so the candidate order is stable and every prefab
 * obeys the same validation as an imported one.
 */

const modules = import.meta.glob('./builtin/*.json', { eager: true }) as Record<
  string,
  { default?: unknown }
>;

const BUILTINS: PrefabDef[] = [];
for (const key of Object.keys(modules).sort()) {
  const mod = modules[key];
  const raw = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
  const got = sanitizePrefab(raw);
  if (!got) {
    throw new Error(`[prefabs] builtin ${key} failed sanitization`);
  }
  if (got.warnings.length > 0) {
    throw new Error(`[prefabs] builtin ${key}: ${got.warnings.join('; ')}`);
  }
  BUILTINS.push(got.prefab);
}

/** All sanitized built-ins in stable (filename-sorted) order. */
export function builtinPrefabs(): ReadonlyArray<PrefabDef> {
  return BUILTINS;
}

/**
 * Stable-ordered placement candidates: built-ins matching ANY of the given
 * tags. Worldgen placement requires at least one anchor (a prefab without a
 * connection point can never join the cave network), so anchorless prefabs
 * are excluded unless opts.includeAnchorless is set.
 */
export function queryPrefabs(
  tags: string[],
  opts?: { includeAnchorless?: boolean },
): PrefabDef[] {
  return BUILTINS.filter(
    (p) =>
      (opts?.includeAnchorless === true || (p.anchors?.length ?? 0) > 0) &&
      p.tags.some((t) => tags.includes(t)),
  );
}
