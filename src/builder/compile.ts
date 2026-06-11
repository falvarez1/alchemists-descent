import type { Ctx, EnemyKind, PickupKind } from '@/core/types';
import type { EditorDocument } from '@/builder/document';
import { applyWorldLayer, decodeTypes } from '@/builder/document';
import { makePickup } from '@/game/Pickups';
import { blocksEntity } from '@/sim/CellType';
import { WIDTH, HEIGHT } from '@/config/constants';

/**
 * Playtest compiler (docs/BUILDER.md Phase 9 core): EditorDocument ->
 * custom LevelRuntime. The document is the source of truth; the compiled
 * world is a disposable copy — playtest scars never touch the document.
 */

export interface DocIssue {
  severity: 'error' | 'warning' | 'info';
  what: string;
  objId?: string;
}

/** Static document validation (pre-compile; cheap, specific). */
export function validateDocument(doc: EditorDocument): DocIssue[] {
  const issues: DocIssue[] = [];
  const types = doc.world ? decodeTypes(doc.world) : null;
  const blockedAt = (x: number, y: number): boolean =>
    types !== null && blocksEntity(types[Math.floor(x) + Math.floor(y) * WIDTH]);

  const spawns = doc.objects.filter((o) => o.kind === 'spawn');
  if (spawns.length === 0) issues.push({ severity: 'error', what: 'No player spawn placed' });
  if (spawns.length > 1) issues.push({ severity: 'error', what: 'Multiple spawns placed' });
  if (spawns[0] && types) {
    // the wizard is 9x17 — check head and feet clearance
    let blocked = false;
    for (let dy = 0; dy < 17 && !blocked; dy += 4) {
      for (let dx = -4; dx <= 4 && !blocked; dx += 4) {
        if (blockedAt(spawns[0].x + dx, spawns[0].y - dy)) blocked = true;
      }
    }
    if (blocked)
      issues.push({ severity: 'error', what: 'Spawn is embedded in blocking cells', objId: spawns[0].id });
  }

  if (!doc.world)
    issues.push({
      severity: 'warning',
      what: 'No terrain captured — playtest will use the live sandbox world',
    });

  const portal = doc.objects.find((o) => o.kind === 'exitPortal');
  const key = doc.objects.find((o) => o.kind === 'pickup' && o.params.kind === 'key');
  if (portal && !key && portal.params.alwaysOpen !== true) {
    issues.push({
      severity: 'warning',
      what: 'Portal has no golden key and is not marked always-open — it can never open',
      objId: portal.id,
    });
  }
  if (!portal) issues.push({ severity: 'info', what: 'No exit portal: custom level has no win exit' });

  for (const o of doc.objects) {
    if (o.x < 4 || o.x >= WIDTH - 4 || o.y < 4 || o.y >= HEIGHT - 4) {
      issues.push({ severity: 'error', what: o.kind + ' outside world bounds', objId: o.id });
    }
    if ((o.kind === 'enemy' || o.kind === 'pickup') && types && blockedAt(o.x, o.y - 2)) {
      issues.push({ severity: 'warning', what: o.kind + ' embedded in blocking cells', objId: o.id });
    }
  }
  return issues;
}

/**
 * Compile the document into the live ctx and enter playtest:
 * decode terrain -> wrap as custom runtime -> attach authored objects.
 * Returns false if hard errors block the compile.
 */
export function compileAndPlaytest(ctx: Ctx, doc: EditorDocument): boolean {
  const issues = validateDocument(doc);
  if (issues.some((i) => i.severity === 'error')) return false;

  // 1) Terrain: the document layer becomes the live world (a copy by value —
  //    the layer itself is untouched by whatever the playtest does to cells).
  if (doc.world) applyWorldLayer(ctx, doc.world);
  ctx.state.currentBiome = doc.biome;

  // 2) Fresh combat state, then wrap the world as the custom runtime.
  ctx.enemies.length = 0;
  ctx.projectiles.length = 0;
  ctx.particles.clear();
  ctx.levels.playCurrentWorld(ctx);
  const runtime = ctx.levels.current;
  if (!runtime) return false;

  // 3) Authored objects onto the runtime.
  const spawn = doc.objects.find((o) => o.kind === 'spawn');
  if (spawn) {
    runtime.spawn = { x: Math.floor(spawn.x), y: Math.floor(spawn.y) };
    ctx.player.x = runtime.spawn.x;
    ctx.player.y = runtime.spawn.y;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.camera.snapTo(runtime.spawn.x, runtime.spawn.y);
  }
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if (o.kind === 'enemy') {
      const kind = (o.params.kind as EnemyKind) ?? 'slime';
      ctx.enemyCtl.spawn(kind, Math.floor(o.x), Math.floor(o.y));
      const e = ctx.enemies[ctx.enemies.length - 1];
      if (e && o.params.sleeping === true && kind === 'bat') {
        e.sleeping = true;
        e.x = Math.floor(o.x);
        e.y = Math.floor(o.y);
      }
    } else if (o.kind === 'pickup') {
      const kind = (o.params.kind as PickupKind) ?? 'goldpile';
      runtime.pickups.push(
        makePickup(kind, o.x, o.y, {
          amount: typeof o.params.amount === 'number' ? o.params.amount : undefined,
          card: o.params.card as never,
          potion: o.params.potion as never,
        }),
      );
    } else if (o.kind === 'exitPortal') {
      runtime.portal = { x: Math.floor(o.x), y: Math.floor(o.y), open: false };
      if (o.params.alwaysOpen === true) runtime.keyTaken = true;
    } else if (o.kind === 'waystone') {
      runtime.waystones.push({
        x: Math.floor(o.x),
        y: Math.floor(o.y),
        lit: o.params.lit === true,
      });
    }
  }
  // refresh the live snapshot the runtime keeps
  runtime.enemies.length = 0;
  runtime.enemies.push(...ctx.enemies);
  return true;
}
