import type { AuthoredLight, Ctx } from '@/core/types';
import { buildMechanismTriggerIndex } from '@/core/mechanisms';
import type { EditorDocument } from '@/builder/document';
import { AUTHORED_LIGHT_RUNTIME_CAP, applyWorldLayer } from '@/builder/document';
import { sanitizeBackdropSettings } from '@/config/backdrop';
import { playtestBlockingIssues, validateDocument } from '@/builder/validate';
import type { DocIssue } from '@/builder/validate';
import {
  instantiateObjects,
  makeInstantiationSink,
  spawnPrefabEnemy,
} from '@/game/instantiate';
import { getStoredSprite } from '@/builder/assets/spritelib';
import { cancelChargingBlackHole, resetCombatTransients, resetHeldSpellInputs } from '@/game/transients';
import type { CellSetter } from '@/builder/stamps';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { createDefaultStatus } from '@/entities/status';

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
  if (playtestBlockingIssues(issues, opts?.spawnAt ? 'cursor-spawn' : 'authored-spawn').length > 0) return false;

  // 1) Terrain: the document layer becomes the live world (decoded by value —
  //    the layer itself is untouched by whatever the playtest does to cells).
  ctx.state.currentBiome = doc.biome;
  if (doc.world) applyWorldLayer(ctx, doc.world);
  // mood: the document may own the ambient light level for its playtest
  // (the Builder snapshots and restores the global on return)
  if (doc.mood && doc.mood.ambient !== null && Number.isFinite(doc.mood.ambient)) {
    ctx.params.global.ambient = doc.mood.ambient;
  }

  // 2) Fresh combat state, then wrap the world as the custom runtime.
  ctx.enemies.length = 0;
  resetCombatTransients(ctx);
  ctx.levels.playCurrentWorld(ctx);
  const runtime = ctx.levels.current;
  if (!runtime) return false;
  runtime.backdrop = sanitizeBackdropSettings(doc.backdrop ?? ctx.params.backdrop);
  runtime.backdropLevelId = doc.backdropProfileId ?? null;

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
  const spawn = doc.objects.find((o) => o.kind === 'spawn' && !o.hidden);
  const at = opts?.spawnAt ?? (spawn ? { x: spawn.x, y: spawn.y } : null);
  if (at) {
    runtime.spawn = { x: Math.floor(at.x), y: Math.floor(at.y) };
    ctx.player.x = runtime.spawn.x;
    ctx.player.y = runtime.spawn.y;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.fx = 0;
    ctx.player.fy = 0;
    ctx.camera.snapTo(runtime.spawn.x, runtime.spawn.y);
  }
  resetPlayerForPlaytest(ctx);

  // 4-6) Objects, doors-then-triggers, rune links, lights — the shared
  //      instantiation pass, pushing straight into the runtime's arrays.
  const sink = makeInstantiationSink();
  sink.pickups = runtime.pickups;
  sink.mechanisms = runtime.mechanisms;
  sink.runeVaults = runtime.runeVaults;
  sink.waystones = runtime.waystones;
  instantiateObjects(ctx, sink, doc.objects, doc.links, doc.lights, 0, 0, set, {
    spawnEnemy: (rec) => spawnPrefabEnemy(ctx, rec),
    // sprite decor resolves from the local library first, then the document's
    // embedded fallback (decoded once; instances share frame buffers)
    docSprites: doc.assets?.sprites,
    spriteLookup: getStoredSprite,
  });
  runtime.mechanismTriggers = buildMechanismTriggerIndex(runtime.mechanisms);
  if (sink.portal !== undefined) runtime.portal = sink.portal;
  if (sink.keyTaken === true) runtime.keyTaken = true;
  if (sink.exit !== undefined) runtime.exit = sink.exit;
  if (sink.cauldron !== undefined) runtime.cauldron = sink.cauldron;
  if (sink.boss !== undefined) runtime.boss = sink.boss;
  if (sink.emitters.length > 0) (runtime.emitters ??= []).push(...sink.emitters);
  // Animated decor — visual-only; the runtime list only feeds the renderer.
  if (sink.decors.length > 0) runtime.decors = sink.decors;

  // 7) Authored lights onto the runtime for Lighting.build.
  if (sink.authoredLights.length > 0) {
    runtime.authoredLights = capRuntimeAuthoredLights(sink.authoredLights);
  }

  // refresh the live snapshot the runtime keeps
  runtime.enemies.length = 0;
  runtime.enemies.push(...ctx.enemies);
  return true;
}

export function capRuntimeAuthoredLights(lights: readonly AuthoredLight[]): AuthoredLight[] {
  return lights.slice(0, AUTHORED_LIGHT_RUNTIME_CAP);
}

function resetPlayerForPlaytest(ctx: Ctx): void {
  const p = ctx.player;
  p.hp = p.maxHp;
  p.mana = p.maxMana;
  p.levit = p.maxLevit;
  p.dead = false;
  p.invuln = 90;
  p.cooldown = 0;
  p.firing = false;
  p.tpCool = 0;
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  p.aimAngle = 0;
  p.inLiquid = false;
  p.grounded = false;
  p.prevGrounded = false;
  p.recharge = 0;
  p.pullT = 0;
  p.pullDir = 1;
  p.stridePhase = 0;
  p.landTimer = 0;
  p.blinkTimer = 0;
  p.fallPeak = p.y;
  p.hat = { ox: 0, oy: 0, vx: 0, vy: 0, pvx: 0, pvy: 0 };
  p._px = p.x;
  p._py = p.y;
  p._svx = 0;
  p._svy = 0;
  p.crouchT = 0;
  p.diveT = 0;
  p.crawling = false;
  p.crawlT = 0;
  p.crawlSlope = 0;
  p.wallGrabT = 0;
  p.wallGrabDir = 1;
  p.climbing = false;
  p.climbDir = 1;
  p.climbT = 0;
  p.climbPhase = 0;
  p.climbMoveT = 0;
  p.climbIntentY = 0;
  p.stretchT = 0;
  p.skidT = 0;
  p.skidDir = 1;
  p.swapT = 0;
  p.recoilT = 0;
  p.staggerT = 0;
  p.staggerDir = 1;
  p.fidgetT = 0;
  p.robe = { ox: 0, vx: 0 };
  p.status = createDefaultStatus();
  resetHeldSpellInputs(ctx);
  cancelChargingBlackHole(ctx);
  ctx.events.emit('playerDeathCleared');
}
