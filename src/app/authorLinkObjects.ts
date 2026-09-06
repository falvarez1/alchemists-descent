import type { Ctx, LevelRuntime, PrefabEnemy } from '@/core/types';
import type { EditorLight, EditorLink, EditorObject } from '@/authoring/document';
import type { SpriteAsset } from '@/authoring/sprites';
import type { CellSetter } from '@/authoring/stamps';
import type { CellPatch } from '@/authoring/cellPatch';
import { applyCellPatch, createCellPatch } from '@/authoring/cellPatch';
import { buildMechanismTriggerIndex } from '@/core/mechanisms';
import { instantiateObjects, makeInstantiationSink, spawnPrefabEnemy } from '@/game/instantiate';
import type { World } from '@/sim/World';
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
 * TRACKED PER LEVEL. Levels persist as live runtimes for the whole expedition
 * (a parked D1 keeps its world and its arrays while you are on D2), so what
 * this sync put into a level has to be remembered against THAT level, not
 * against "whatever is current". Forgetting on a level change is how a set
 * pushed into D1 came back as a second copy the next time D1 was synced.
 *
 * CELLS COME BACK TOO. Doors stamp metal, exit wells carve shafts. Teardown
 * replays a `CellPatch` snapshotted during instantiation into the level's own
 * world, so moving a door does not leave its old frame welded into the terrain
 * — even when that level is no longer the one on screen.
 */

type LandmarkKey = 'exit' | 'portal' | 'cauldron' | 'boss' | 'keyTaken';

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
  /**
   * Level landmarks the set overrode (an authored exit well becomes THE exit,
   * the way it does when the compiler builds a playtest), with the runtime's
   * previous value so teardown can hand them back.
   */
  landmarks: Array<{ key: LandmarkKey; previous: unknown }>;
}

export interface AuthoredSet {
  objects: EditorObject[];
  links: EditorLink[];
  lights: EditorLight[];
  /** Document-embedded sprites referenced by the set's decor, when any. */
  sprites?: SpriteAsset[];
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
function recordingSetter(world: World, before: CellPatch, seen: Set<number>): CellSetter {
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
function clearDoorFootprint(world: World, door: { x: number; y: number; w: number; h: number }): void {
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

function spliceEnemies(list: { sourceId?: string }[] | undefined, ids: ReadonlySet<string>): number {
  if (!list) return 0;
  let removed = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const source = list[i].sourceId;
    if (source !== undefined && ids.has(source)) {
      list.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

function restoreLandmark(runtime: LevelRuntime, key: LandmarkKey, previous: unknown): void {
  switch (key) {
    case 'exit':
      runtime.exit = previous as LevelRuntime['exit'];
      break;
    case 'portal':
      runtime.portal = previous as LevelRuntime['portal'];
      break;
    case 'cauldron':
      runtime.cauldron = previous as LevelRuntime['cauldron'];
      break;
    case 'boss':
      runtime.boss = previous as LevelRuntime['boss'];
      break;
    case 'keyTaken':
      runtime.keyTaken = previous === true;
      break;
  }
}

/** Remove everything `applied` put into `runtime`, whether or not that level is on screen. */
function unpick(ctx: Ctx, runtime: LevelRuntime, applied: AppliedObjects): number {
  const world = runtime.world;

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
    clearDoorFootprint(world, door);
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
    // The live roster is `ctx.enemies` only while this level is current; a
    // parked level keeps its own snapshot, which is what comes back on return.
    if (ctx.levels.current === runtime) removed += spliceEnemies(ctx.enemies, ids);
    spliceEnemies(runtime.enemies, ids);
  }

  if (applied.cellsBefore.idxs.length > 0) applyCellPatch(world, applied.cellsBefore);
  if (applied.hadLights) runtime.authoredLights = [];
  // Restore in reverse so a set that overrode a landmark twice unwinds cleanly.
  for (let i = applied.landmarks.length - 1; i >= 0; i--) {
    restoreLandmark(runtime, applied.landmarks[i].key, applied.landmarks[i].previous);
  }
  runtime.mechanismTriggers = buildMechanismTriggerIndex(runtime.mechanisms);
  return removed;
}

export class AuthoredObjectSync {
  /** What this sync created, per level runtime it was created in. */
  private readonly applied = new Map<LevelRuntime, AppliedObjects>();

  constructor(private readonly ctx: Ctx) {}

  /** Remove what this sync previously created in `runtime` (default: the current level). Safe to call repeatedly. */
  teardown(runtime: LevelRuntime | null = this.ctx.levels.current): number {
    if (!runtime) return 0;
    const applied = this.applied.get(runtime);
    if (!applied) return 0;
    this.applied.delete(runtime);
    return unpick(this.ctx, runtime, applied);
  }

  /** Remove everything this sync created in EVERY level it touched (dispose). */
  teardownAll(): number {
    let removed = 0;
    for (const [runtime, applied] of [...this.applied]) {
      this.applied.delete(runtime);
      removed += unpick(this.ctx, runtime, applied);
    }
    return removed;
  }

  /** Replace the authored set in the current level with `set`. Returns what happened, for the UI. */
  apply(set: AuthoredSet): ApplyAuthoredResult {
    const ctx = this.ctx;
    const runtime = ctx.levels.current;
    if (!runtime) {
      // Authored objects have nowhere to live without a level runtime. Say so
      // rather than dropping them silently — this is a real, reachable state
      // (a Sandbox window that never started a run).
      return { ok: false, reason: 'no level runtime — start a run or a playtest', objects: 0, mechanisms: 0, removed: 0 };
    }
    if (runtime.world !== ctx.world) {
      // The Builder parks an expedition on a scratch world while it edits.
      // Instantiating here would push mechanisms into the parked level while
      // stamping their cells into the scratch grid — two worlds, one set.
      return { ok: false, reason: 'this window has parked its level behind the Builder', objects: 0, mechanisms: 0, removed: 0 };
    }

    const removed = this.teardown(runtime);

    const sink = makeInstantiationSink();
    const before = createCellPatch();
    const seen = new Set<number>();
    const setter = recordingSetter(runtime.world, before, seen);
    const enemySourceIds: string[] = [];

    instantiateObjects(ctx, sink, set.objects, set.links, set.lights, 0, 0, setter, {
      spawnEnemy: (rec: PrefabEnemy) => {
        if (rec.sourceId !== undefined) enemySourceIds.push(rec.sourceId);
        spawnPrefabEnemy(ctx, rec);
      },
      docSprites: set.sprites,
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
      landmarks: [],
    };
    runtime.pickups.push(...sink.pickups);
    runtime.mechanisms.push(...sink.mechanisms);
    runtime.runeVaults.push(...sink.runeVaults);
    runtime.waystones.push(...sink.waystones);
    if (sink.emitters.length > 0) (runtime.emitters ??= []).push(...sink.emitters);
    if (sink.decors.length > 0) (runtime.decors ??= []).push(...sink.decors);
    if (sink.authoredLights.length > 0) runtime.authoredLights = [...sink.authoredLights];

    // Landmarks: the same records the compiler turns into a playtest's exit,
    // portal, cauldron and boss marker. Without this an exit well placed in
    // the editor carved its shaft in the peer's grid but the level never knew
    // it had a second exit.
    if (sink.exit !== undefined) {
      applied.landmarks.push({ key: 'exit', previous: runtime.exit });
      runtime.exit = sink.exit;
    }
    if (sink.portal !== undefined) {
      applied.landmarks.push({ key: 'portal', previous: runtime.portal });
      runtime.portal = sink.portal;
    }
    if (sink.cauldron !== undefined) {
      applied.landmarks.push({ key: 'cauldron', previous: runtime.cauldron });
      runtime.cauldron = sink.cauldron;
    }
    if (sink.boss !== undefined) {
      applied.landmarks.push({ key: 'boss', previous: runtime.boss });
      runtime.boss = sink.boss;
    }
    if (sink.keyTaken !== undefined) {
      applied.landmarks.push({ key: 'keyTaken', previous: runtime.keyTaken });
      runtime.keyTaken = sink.keyTaken;
    }

    // Load-bearing: a door added or removed without this leaves the trigger
    // index pointing at mechanisms that are no longer in the list.
    runtime.mechanismTriggers = buildMechanismTriggerIndex(runtime.mechanisms);

    this.applied.set(runtime, applied);
    return { ok: true, objects: set.objects.length, mechanisms: sink.mechanisms.length, removed };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Structural validation for an authored set that crossed a process boundary. */
export function isAuthoredSet(value: unknown): value is AuthoredSet {
  if (!isRecord(value)) return false;
  const set = value as Partial<AuthoredSet>;
  if (!Array.isArray(set.objects) || !Array.isArray(set.links) || !Array.isArray(set.lights)) return false;
  if (set.sprites !== undefined && !Array.isArray(set.sprites)) return false;
  const objectsOk = set.objects.every(
    (o) =>
      isRecord(o) &&
      typeof (o as EditorObject).id === 'string' &&
      typeof (o as EditorObject).kind === 'string' &&
      Number.isFinite((o as EditorObject).x) &&
      Number.isFinite((o as EditorObject).y),
  );
  if (!objectsOk) return false;
  // A link with a non-string endpoint would reach the wiring pass as a lookup
  // of `undefined`; a light without a position has no cell to shine from.
  const linksOk = set.links.every(
    (l) =>
      isRecord(l) &&
      typeof (l as EditorLink).id === 'string' &&
      typeof (l as EditorLink).kind === 'string' &&
      typeof (l as EditorLink).fromId === 'string' &&
      typeof (l as EditorLink).toId === 'string',
  );
  if (!linksOk) return false;
  const lightsOk = set.lights.every(
    (l) =>
      isRecord(l) &&
      typeof (l as EditorLight).id === 'string' &&
      Number.isFinite((l as EditorLight).x) &&
      Number.isFinite((l as EditorLight).y),
  );
  if (!lightsOk) return false;
  if (set.sprites) {
    const spritesOk = set.sprites.every(
      (s) =>
        isRecord(s) &&
        typeof (s as SpriteAsset).id === 'string' &&
        Number.isFinite((s as SpriteAsset).w) &&
        Number.isFinite((s as SpriteAsset).h) &&
        Array.isArray((s as SpriteAsset).frames),
    );
    if (!spritesOk) return false;
  }
  return true;
}
