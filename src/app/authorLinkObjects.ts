import type { Ctx, LevelRuntime, PrefabEnemy } from '@/core/types';
import type { EditorLight, EditorLink, EditorObject } from '@/authoring/document';
import type { CellSetter } from '@/authoring/stamps';
import type { CellPatch } from '@/authoring/cellPatch';
import { applyCellPatch, createCellPatch } from '@/authoring/cellPatch';
import { buildMechanismTriggerIndex } from '@/core/mechanisms';
import { instantiateObjects, makeInstantiationSink, spawnPrefabEnemy } from '@/game/instantiate';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { Cell } from '@/sim/CellType';

/**
 * AuthorLink Phase 2: authored objects, links, and lights across windows.
 *
 * WHOLE-SET, NOT PER-RECORD. A remote edit replaces the entire authored set
 * rather than diffing one object. That is deliberate:
 *
 * - Links wire doors to triggers across records, and `instantiateObjects`
 *   resolves that wiring in one ordered pass (objects, then doors, then
 *   triggers, then rune links). Feeding it one record at a time would need a
 *   second, subtly different wiring path — exactly the "playtest drift" the
 *   Builder decoupling plan warns about.
 * - An authored set is tens of records and a few KB. There is nothing to save.
 * - It is idempotent: no per-record delete/upsert bookkeeping to get wrong.
 *
 * WHAT IT MAY TOUCH. Only entities this module previously created. Whatever
 * the receiving window generated for itself — worldgen mechanisms, campaign
 * pickups, wandering enemies — is never removed, because it was never
 * recorded here. An editor with an empty document cannot wipe a live level.
 *
 * CELLS COME BACK TOO. Doors stamp metal, exit wells carve shafts. Teardown
 * replays a `CellPatch` snapshotted during instantiation, so moving a door
 * does not leave its old frame welded into the terrain.
 */

interface AppliedObjects {
  /** Exact entity references pushed into the runtime, for splice-out. */
  pickups: unknown[];
  mechanisms: unknown[];
  runeVaults: unknown[];
  waystones: unknown[];
  emitters: unknown[];
  decors: unknown[];
  enemySourceIds: string[];
  /** Cell values as they were before instantiation stamped over them. */
  cellsBefore: CellPatch;
  /** True when this window had authored lights replaced. */
  hadLights: boolean;
}

export interface AuthoredSet {
  objects: EditorObject[];
  links: EditorLink[];
  lights: EditorLight[];
}

export interface ApplyAuthoredResult {
  ok: boolean;
  reason?: string;
  objects: number;
  mechanisms: number;
  removed: number;
}

/**
 * Records the pre-write value of every cell instantiation touches, once per
 * index, so teardown can put the terrain back exactly.
 *
 * The write itself mirrors `compile.ts`'s setter deliberately — one semantics
 * path for "authored object becomes real cells".
 */
function recordingSetter(ctx: Ctx, before: CellPatch, seen: Set<number>): CellSetter {
  const world = ctx.world;
  return (x, y, t) => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    if (!seen.has(i)) {
      seen.add(i);
      before.idxs.push(i);
      before.types.push(world.types[i]);
      before.colors.push(world.colors[i]);
      before.life.push(world.life[i]);
      before.charge.push(world.charge[i]);
    }
    world.types[i] = t;
    const fn = COLOR_FN[t];
    world.colors[i] = fn ? fn() : EMPTY_COLOR;
    world.life[i] = 0;
    world.setChargeAt(i, 0);
  };
}

/**
 * Erase a door's metal immediately.
 *
 * Only cells that are STILL the door's metal are cleared — anything the player
 * or the sim has since put in the doorway is theirs to keep.
 */
function clearDoorFootprint(ctx: Ctx, door: { x: number; y: number; w: number; h: number }): void {
  const world = ctx.world;
  for (let dx = 0; dx < door.w; dx++) {
    for (let dy = 0; dy < door.h; dy++) {
      const x = door.x + dx;
      const y = door.y + dy;
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Metal) continue;
      world.clearCellAt(i);
    }
  }
}

function spliceAll(list: unknown[] | undefined, refs: readonly unknown[]): number {
  if (!list || refs.length === 0) return 0;
  let removed = 0;
  for (const ref of refs) {
    const at = list.indexOf(ref);
    // Missing is normal: gameplay may already have consumed the pickup or
    // killed the enemy. Only the ones still present need removing.
    if (at < 0) continue;
    list.splice(at, 1);
    removed++;
  }
  return removed;
}

export class AuthoredObjectSync {
  private applied: AppliedObjects | null = null;
  /** The runtime the applied entities live in; a level change invalidates them. */
  private appliedRuntime: LevelRuntime | null = null;

  constructor(private readonly ctx: Ctx) {}

  /** Remove everything this sync previously created. Safe to call repeatedly. */
  teardown(): number {
    const applied = this.applied;
    const runtime = this.appliedRuntime;
    this.applied = null;
    this.appliedRuntime = null;
    if (!applied) return 0;
    // A level transition swapped the runtime out from under us; its arrays and
    // its world are gone, so there is nothing to unpick and nothing to restore.
    if (!runtime || this.ctx.levels.current !== runtime) return 0;

    // Doors must be un-stamped BEFORE they leave the list. A closed door's
    // metal is written by the runtime (`setDoorCells` during
    // `Mechanisms.update`), not by the instantiation setter, so the cell patch
    // below never captured it — and `setDoorCells(open)` only queues a
    // dissolve that `Mechanisms.update` drains, which will never run for a
    // mechanism we are about to remove. Leaving it would weld a permanent
    // metal slab across the level every time someone deletes a door, which is
    // exactly the kind of physics-chaos softlock the design rules forbid.
    for (const ref of applied.mechanisms) {
      const door = ref as { kind?: string; x: number; y: number; w: number; h: number };
      if (door.kind !== 'door') continue;
      clearDoorFootprint(this.ctx, door);
    }

    let removed = 0;
    removed += spliceAll(runtime.pickups, applied.pickups);
    removed += spliceAll(runtime.mechanisms, applied.mechanisms);
    removed += spliceAll(runtime.runeVaults, applied.runeVaults);
    removed += spliceAll(runtime.waystones, applied.waystones);
    removed += spliceAll(runtime.emitters, applied.emitters);
    removed += spliceAll(runtime.decors, applied.decors);

    if (applied.enemySourceIds.length > 0) {
      const ids = new Set(applied.enemySourceIds);
      const enemies = this.ctx.enemies;
      for (let i = enemies.length - 1; i >= 0; i--) {
        const source = (enemies[i] as { sourceId?: string }).sourceId;
        if (source !== undefined && ids.has(source)) {
          enemies.splice(i, 1);
          removed++;
        }
      }
      // The runtime keeps its own snapshot of the roster.
      if (runtime.enemies) {
        for (let i = runtime.enemies.length - 1; i >= 0; i--) {
          const source = (runtime.enemies[i] as { sourceId?: string }).sourceId;
          if (source !== undefined && ids.has(source)) runtime.enemies.splice(i, 1);
        }
      }
    }

    if (applied.cellsBefore.idxs.length > 0) applyCellPatch(this.ctx.world, applied.cellsBefore);
    if (applied.hadLights) runtime.authoredLights = [];
    runtime.mechanismTriggers = buildMechanismTriggerIndex(runtime.mechanisms);
    return removed;
  }

  /** Replace the authored set with `set`. Returns what happened, for the UI. */
  apply(set: AuthoredSet): ApplyAuthoredResult {
    const ctx = this.ctx;
    const runtime = ctx.levels.current;
    if (!runtime) {
      // Authored objects have nowhere to live without a level runtime. Say so
      // rather than dropping them silently — this is a real, reachable state
      // (a Sandbox window that never started a run).
      return { ok: false, reason: 'no level runtime — start a run or a playtest', objects: 0, mechanisms: 0, removed: 0 };
    }

    const removed = this.teardown();

    const sink = makeInstantiationSink();
    const before = createCellPatch();
    const seen = new Set<number>();
    const set2 = recordingSetter(ctx, before, seen);
    const enemySourceIds: string[] = [];

    instantiateObjects(ctx, sink, set.objects, set.links, set.lights, 0, 0, set2, {
      spawnEnemy: (rec: PrefabEnemy) => {
        if (rec.sourceId !== undefined) enemySourceIds.push(rec.sourceId);
        spawnPrefabEnemy(ctx, rec);
      },
    });

    // Push into the live runtime, remembering exactly what we added.
    const applied: AppliedObjects = {
      pickups: [...sink.pickups],
      mechanisms: [...sink.mechanisms],
      runeVaults: [...sink.runeVaults],
      waystones: [...sink.waystones],
      emitters: [...sink.emitters],
      decors: [...sink.decors],
      enemySourceIds,
      cellsBefore: before,
      hadLights: sink.authoredLights.length > 0,
    };
    runtime.pickups.push(...sink.pickups);
    runtime.mechanisms.push(...sink.mechanisms);
    runtime.runeVaults.push(...sink.runeVaults);
    runtime.waystones.push(...sink.waystones);
    if (sink.emitters.length > 0) (runtime.emitters ??= []).push(...sink.emitters);
    if (sink.decors.length > 0) (runtime.decors ??= []).push(...sink.decors);
    if (sink.authoredLights.length > 0) runtime.authoredLights = [...sink.authoredLights];

    // Load-bearing: a door added or removed without this leaves the trigger
    // index pointing at mechanisms that are no longer in the list.
    runtime.mechanismTriggers = buildMechanismTriggerIndex(runtime.mechanisms);

    this.applied = applied;
    this.appliedRuntime = runtime;
    return { ok: true, objects: set.objects.length, mechanisms: sink.mechanisms.length, removed };
  }
}

/** Structural validation for an authored set that crossed a process boundary. */
export function isAuthoredSet(value: unknown): value is AuthoredSet {
  if (typeof value !== 'object' || value === null) return false;
  const set = value as Partial<AuthoredSet>;
  if (!Array.isArray(set.objects) || !Array.isArray(set.links) || !Array.isArray(set.lights)) return false;
  return set.objects.every(
    (o) =>
      typeof o === 'object' &&
      o !== null &&
      typeof (o as EditorObject).id === 'string' &&
      typeof (o as EditorObject).kind === 'string' &&
      Number.isFinite((o as EditorObject).x) &&
      Number.isFinite((o as EditorObject).y),
  );
}
