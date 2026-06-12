import type { Ctx } from '@/core/types';
import type { EditorDocument } from '@/builder/document';
import { applyWorldLayer } from '@/builder/document';
import { validateDocument } from '@/builder/validate';
import type { DocIssue } from '@/builder/validate';
import {
  instantiateObjects,
  makeInstantiationSink,
  spawnPrefabEnemy,
} from '@/game/instantiate';
import type { CellSetter } from '@/builder/stamps';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';

// Re-exported for existing consumers (Builder UI, inspector choices); the
// shared implementations live in game/instantiate.ts now.
export { EMITTER_CELLS, toAuthoredLight } from '@/game/instantiate';

/**
 * Playtest compiler (docs/BUILDER.md Phase 9): EditorDocument -> custom
 * LevelRuntime. The document is the source of truth; the compiled world is
 * a disposable copy — playtest scars never touch the document.
 *
 * Compile order matters: the player is moved to the authored spawn BEFORE
 * doors stamp their metal (setDoorCells refuses to crush living bodies, so
 * a stale player position would punch silent holes in authored gates).
 * The object/link/light instantiation itself is the SHARED implementation
 * in game/instantiate.ts (worldgen prefab placement uses the same one);
 * enemies spawn at their original in-loop moment via the spawnEnemy hook.
 */

export { validateDocument };
export type { DocIssue };

export function compileAndPlaytest(
  ctx: Ctx,
  doc: EditorDocument,
  opts?: { spawnAt?: { x: number; y: number } },
): boolean {
  const issues = validateDocument(doc);
  if (issues.some((i) => i.severity === 'error')) return false;

  // 1) Terrain: the document layer becomes the live world (decoded by value —
  //    the layer itself is untouched by whatever the playtest does to cells).
  if (doc.world) applyWorldLayer(ctx, doc.world);
  ctx.state.currentBiome = doc.biome;
  // mood: the document may own the ambient light level for its playtest
  // (the Builder snapshots and restores the global on return)
  if (doc.mood && doc.mood.ambient !== null && Number.isFinite(doc.mood.ambient)) {
    ctx.params.global.ambient = doc.mood.ambient;
  }

  // 2) Fresh combat state, then wrap the world as the custom runtime.
  ctx.enemies.length = 0;
  ctx.projectiles.length = 0;
  ctx.particles.clear();
  ctx.levels.playCurrentWorld(ctx);
  const runtime = ctx.levels.current;
  if (!runtime) return false;

  const world = ctx.world;
  // Structural stamps write real cells with their factory colors.
  const set: CellSetter = (x, y, t) => {
    if (!world.inBounds(x, y)) return;
    const i = world.idx(x, y);
    world.types[i] = t;
    const fn = COLOR_FN[t];
    world.colors[i] = fn ? fn() : EMPTY_COLOR;
    world.life[i] = 0;
    world.charge[i] = 0;
  };

  // 3) Player to the spawn FIRST (see header note). "Playtest from here"
  //    overrides the authored spawn so iteration loops start at the cursor
  //    (and death respawns there too).
  const spawn = doc.objects.find((o) => o.kind === 'spawn');
  const at = opts?.spawnAt ?? (spawn ? { x: spawn.x, y: spawn.y } : null);
  if (at) {
    runtime.spawn = { x: Math.floor(at.x), y: Math.floor(at.y) };
    ctx.player.x = runtime.spawn.x;
    ctx.player.y = runtime.spawn.y;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.camera.snapTo(runtime.spawn.x, runtime.spawn.y);
  }

  // 4-6) Objects, doors-then-triggers, rune links, lights — the shared
  //      instantiation pass, pushing straight into the runtime's arrays.
  const sink = makeInstantiationSink();
  sink.pickups = runtime.pickups;
  sink.mechanisms = runtime.mechanisms;
  sink.runeVaults = runtime.runeVaults;
  sink.waystones = runtime.waystones;
  instantiateObjects(ctx, sink, doc.objects, doc.links, doc.lights, 0, 0, set, {
    spawnEnemy: (rec) => spawnPrefabEnemy(ctx, rec),
  });
  if (sink.portal !== undefined) runtime.portal = sink.portal;
  if (sink.keyTaken === true) runtime.keyTaken = true;
  if (sink.exit !== undefined) runtime.exit = sink.exit;
  if (sink.cauldron !== undefined) runtime.cauldron = sink.cauldron;
  if (sink.boss !== undefined) runtime.boss = sink.boss;
  if (sink.emitters.length > 0) (runtime.emitters ??= []).push(...sink.emitters);

  // 7) Authored lights onto the runtime for Lighting.build.
  if (sink.authoredLights.length > 0) {
    runtime.authoredLights = sink.authoredLights;
  }

  // refresh the live snapshot the runtime keeps
  runtime.enemies.length = 0;
  runtime.enemies.push(...ctx.enemies);
  return true;
}
