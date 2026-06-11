import type { AuthoredLight, Ctx, EnemyKind, Mechanism, PickupKind } from '@/core/types';
import type { EditorDocument, EditorLight, EditorObject } from '@/builder/document';
import { applyWorldLayer, paramNum } from '@/builder/document';
import { validateDocument } from '@/builder/validate';
import type { DocIssue } from '@/builder/validate';
import { makePickup } from '@/game/Pickups';
import {
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeDoor,
  makeLever,
  makePlate,
  makeScale,
  setDoorCells,
} from '@/game/Mechanisms';
import {
  stampBuoyBasin,
  stampCauldron,
  stampExitWell,
  stampRuneDoor,
  stampRunePedestal,
} from '@/builder/stamps';
import type { CellSetter } from '@/builder/stamps';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { HEIGHT } from '@/config/constants';

/**
 * Playtest compiler (docs/BUILDER.md Phase 9): EditorDocument -> custom
 * LevelRuntime. The document is the source of truth; the compiled world is
 * a disposable copy — playtest scars never touch the document.
 *
 * Compile order matters: the player is moved to the authored spawn BEFORE
 * doors stamp their metal (setDoorCells refuses to crush living bodies, so
 * a stale player position would punch silent holes in authored gates).
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

  // 4) Simple objects + structural landmarks.
  for (const o of doc.objects) {
    if (o.hidden) continue;
    const ox = Math.floor(o.x),
      oy = Math.floor(o.y);
    if (o.kind === 'enemy') {
      const kind = (o.params.kind as EnemyKind) ?? 'slime';
      ctx.enemyCtl.spawn(kind, ox, oy);
      const e = ctx.enemies[ctx.enemies.length - 1];
      if (e && o.params.sleeping === true && kind === 'bat') {
        e.sleeping = true;
        e.x = ox;
        e.y = oy;
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
      runtime.portal = { x: ox, y: oy, open: false };
      if (o.params.alwaysOpen === true) runtime.keyTaken = true;
    } else if (o.kind === 'waystone') {
      runtime.waystones.push({ x: ox, y: oy, lit: o.params.lit === true });
    } else if (o.kind === 'exitWell') {
      const halfW = paramNum(o, 'halfW', 14);
      stampExitWell(set, ox, oy, halfW, HEIGHT);
      runtime.exit = { x: ox, sealY: oy, halfW };
    } else if (o.kind === 'cauldron') {
      stampCauldron(set, ox, oy);
      runtime.cauldron = { x: ox, y: oy - 1 };
    } else if (o.kind === 'bossMarker') {
      runtime.boss = { x: ox, y: oy };
      ctx.enemyCtl.spawn('colossus', ox, oy);
    }
  }

  // 5) Mechanisms: doors first, then triggers wired through the link records.
  //    Several triggers on one door compile to the runtime's AND gate.
  const doorByObj = new Map<string, Mechanism>();
  for (const o of doc.objects) {
    if (o.hidden || o.kind !== 'door') continue;
    const door = makeDoor(
      ctx,
      runtime.mechanisms,
      Math.floor(o.x),
      Math.floor(o.y),
      paramNum(o, 'w', 3),
      paramNum(o, 'h', 13),
    );
    if (o.params.initialOpen === true) setDoorCells(ctx, door, true);
    if (o.params.logic === 'or' || o.params.logic === 'sequence') door.logic = o.params.logic;
    doorByObj.set(o.id, door);
  }
  const objById = new Map(doc.objects.map((o) => [o.id, o] as const));
  for (const link of doc.links) {
    if (link.kind !== 'triggerDoor') continue;
    const trig = objById.get(link.fromId);
    const door = doorByObj.get(link.toId);
    if (!trig || trig.hidden || !door) continue;
    compileTrigger(ctx, runtime.mechanisms, trig, door, set);
  }

  // 6) Rune vaults: glyph pedestal + dissolving stone door per rune link.
  for (const link of doc.links) {
    if (link.kind !== 'runeDoor') continue;
    const glyph = objById.get(link.fromId);
    const slab = objById.get(link.toId);
    if (!glyph || !slab || glyph.hidden || slab.hidden) continue;
    const gx = Math.floor(glyph.x),
      gy = Math.floor(glyph.y);
    stampRunePedestal(set, gx, gy);
    const cells = stampRuneDoor(
      set,
      Math.floor(slab.x),
      Math.floor(slab.y),
      paramNum(slab, 'w', 2),
      paramNum(slab, 'h', 11),
    );
    runtime.runeVaults.push({ rx: gx, ry: gy - 2, door: cells, active: false });
  }

  // 7) Authored lights onto the runtime for Lighting.build.
  const lights = doc.lights.filter((l) => !l.hidden);
  if (lights.length > 0) {
    runtime.authoredLights = lights.map((l, n) => toAuthoredLight(l, n));
  }

  // refresh the live snapshot the runtime keeps
  runtime.enemies.length = 0;
  runtime.enemies.push(...ctx.enemies);
  return true;
}

function compileTrigger(
  ctx: Ctx,
  list: Mechanism[],
  o: EditorObject,
  door: Mechanism,
  set: CellSetter,
): void {
  const x = Math.floor(o.x),
    y = Math.floor(o.y);
  if (o.kind === 'plate') {
    const w = paramNum(o, 'w', 5);
    makePlate(ctx.world, list, x - Math.floor(w / 2), y, w, door);
  } else if (o.kind === 'lever') {
    makeLever(list, x, y, door);
  } else if (o.kind === 'brazier') {
    makeBrazier(ctx.world, list, x, y, door);
  } else if (o.kind === 'scale') {
    const w = paramNum(o, 'w', 7);
    makeScale(ctx.world, list, x - Math.floor(w / 2), y, w, paramNum(o, 'threshold', 24), door);
  } else if (o.kind === 'buoy') {
    const { body, zone } = stampBuoyBasin(
      set,
      x,
      y,
      paramNum(o, 'w', 13),
      paramNum(o, 'depth', 4),
    );
    makeBuoy(list, x, y - 1, zone, paramNum(o, 'threshold', 26), door, body);
  } else if (o.kind === 'chargeLatch') {
    makeChargeLatch(ctx.world, list, x, y, door);
  }
}

/** EditorLight (authoring record) -> AuthoredLight (runtime seeding data). */
export function toAuthoredLight(l: EditorLight, n: number): AuthoredLight {
  const hex = /^#?([0-9a-f]{6})$/i.exec(l.color.trim());
  const rgb = hex ? parseInt(hex[1], 16) : 0xffffff;
  return {
    x: Math.floor(l.x),
    y: Math.floor(l.y),
    r: ((rgb >> 16) & 0xff) / 255,
    g: ((rgb >> 8) & 0xff) / 255,
    b: (rgb & 0xff) / 255,
    intensity: l.intensity,
    radius: l.radius,
    bloom: l.bloom,
    flicker: l.flicker,
    flickerPhase: (n * 2.39996) % (Math.PI * 2),
    falloff: l.falloff,
    occluded: l.occluded,
  };
}
