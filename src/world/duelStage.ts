import { versusMatchUnderway } from '@/core/versus';
import { BACKDROP_LAYER_SPECS, createDefaultBackdropSettings } from '@/config/backdrop';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import { stampStockStage } from '@/world/stockStage';

/**
 * THE DUEL STAGE (worldgraph id 'fighter-duel', docs/arena/ARENA-RULES.md 1): one symmetric room for two fighters. 560 cells wide (the
 * 640-wide view holds the whole stage, so there is no camera to leash), 230 tall, walled and roofed, dry, lit. Left and right are
 * mirror images: a floor, two side platforms a jump apart from the floor, a stone pedestal in the middle and a high perch over it.
 * Nothing on it is a hazard: it measures the fighters, not the stage. Test-mode content (never saved, never part of a run).
 *
 *        ___________________________________________   roof 410
 *       |                                           |
 *       |                  ======                   |   perch  (y floor-120)
 *       |   ======          [  ]            ======  |   side platforms (y floor-72)
 *       |  S                [  ]                 S  |   spawns on the floor, facing each other
 *       |___________________[__]___________________|   floor 640
 */

export const DUEL = {
  floor: 640,
  roof: 410,
  x0: 520,
  x1: 1080,
  cx: 800,
  /** Where each fighter starts: on the floor, either side, facing in. */
  spawns: [{ x: 580, y: 639 }, { x: 1020, y: 639 }] as ReadonlyArray<{ x: number; y: number }>,
  platforms: [{ x0: 580, x1: 650, y: 640 - 72 }, { x0: 950, x1: 1020, y: 640 - 72 }] as ReadonlyArray<{ x0: number; x1: number; y: number }>,
  pedestal: { x0: 780, x1: 820, top: 640 - 5 },
  perch: { x0: 760, x1: 840, y: 640 - 120 },
} as const;

const AMBIENT = 0.92;
let savedAmbient: number | null = null;

function stampStage(ctx: Ctx): void {
  const w = ctx.world;
  const cell = (x: number, y: number, t: number): void => {
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    if (t === Cell.Empty) w.clearCellAt(i);
    else w.replaceCellAt(i, t, COLOR_FN[t] ? COLOR_FN[t]() : packRGB(120, 120, 120));
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(WIDTH - 1, x1); x++) cell(x, y, t);
  };
  const { floor, roof, x0, x1 } = DUEL;
  // the shell: indestructible walls and roof, a stone floor over a wall base (a blast can crater the floor, never open the stage)
  fill(x0 - 20, roof - 12, x0 - 1, floor + 60, Cell.Wall);
  fill(x1 + 1, roof - 12, x1 + 20, floor + 60, Cell.Wall);
  fill(x0 - 20, roof - 12, x1 + 20, roof - 1, Cell.Wall);
  fill(x0, floor, x1, floor + 40, Cell.Stone);
  fill(x0 - 20, floor + 41, x1 + 20, floor + 60, Cell.Wall);
  // Wall cells crumble in explosions. Back the shell with actual blast-proof metal
  // so bombs can crater the interior without dropping a duelist outside the stage.
  fill(x0 - 20, roof - 12, x0 - 18, floor + 60, Cell.Metal);
  fill(x1 + 18, roof - 12, x1 + 20, floor + 60, Cell.Metal);
  fill(x0 - 20, roof - 12, x1 + 20, roof - 10, Cell.Metal);
  fill(x0 - 20, floor + 41, x1 + 20, floor + 60, Cell.Metal);
  // platforms: a metal slab on a short stone bracket at the wall end (never down to the floor: that is where a fighter spawns)
  for (const p of DUEL.platforms) {
    fill(p.x0, p.y, p.x1, p.y + 2, Cell.Metal);
    const wall = p.x0 < DUEL.cx ? p.x0 : p.x1 - 1;
    fill(wall, p.y + 3, wall + 1, p.y + 10, Cell.Stone);
  }
  // the pedestal and the perch (a floating slab: nothing hangs between them, so the middle of the stage is open air)
  fill(DUEL.pedestal.x0, DUEL.pedestal.top, DUEL.pedestal.x1, floor - 1, Cell.Stone);
  fill(DUEL.perch.x0, DUEL.perch.y, DUEL.perch.x1, DUEL.perch.y + 2, Cell.Metal);
  // lamps: stone posts topped with glowshrooms at the walls, and a row under the roof
  for (const lx of [x0 + 14, x1 - 15]) {
    fill(lx, floor - 12, lx + 1, floor - 1, Cell.Stone);
    fill(lx - 1, floor - 14, lx + 2, floor - 13, Cell.Glowshroom);
  }
  for (const gx of [x0 + 60, DUEL.cx, x1 - 60]) fill(gx - 2, roof, gx + 2, roof + 1, Cell.Glowshroom);
}

function wipeTransients(ctx: Ctx): void {
  ctx.rigidBodies.clear();
  ctx.vineStrands.clear();
  ctx.critters.clear();
  // (a rival's stand-in is in ctx.enemies: the arena owns it, so leave it)
  for (let i = ctx.enemies.length - 1; i >= 0; i--) if (ctx.enemies[i].fighter === undefined) ctx.enemies.splice(i, 1);
  ctx.projectiles.length = 0;
}

/** Clear the stage and stamp it fresh (the panel's "Reset stage"). */
export function resetDuelStage(ctx: Ctx): void {
  ctx.world.clear();
  wipeTransients(ctx);
  const runtime = ctx.levels.current;
  if (runtime) {
    runtime.inspectionMarkers = [];
    runtime.mechanisms.length = 0;
    runtime.emitters = [];
    runtime.pickups.length = 0;
    if (ctx.arena?.stockMatch) {
      runtime.decors = [];
      runtime.authoredLights = [];
      runtime.placedPrefabs = [];
      runtime.story = undefined;
      runtime.cauldron = null;
      runtime.exit = null;
      runtime.portal = null;
      runtime.runeVaults.length = 0;
    }
  }
  if (ctx.arena?.stockMatch) stampStockStage(ctx);
  else stampStage(ctx);
}

/** Entering the stage: wipe the generated level, light it, stamp the room, stand the fighter at its spawn. */
export function buildDuelStage(ctx: Ctx): void {
  ctx.world.clear();
  if (savedAmbient === null) savedAmbient = ctx.params.global.ambient;
  ctx.params.global.ambient = AMBIENT;
  const runtime = ctx.levels.current;
  if (runtime) {
    const black = createDefaultBackdropSettings();
    for (const spec of BACKDROP_LAYER_SPECS) {
      black.layers[spec.id].visible = false;
      black.layers[spec.id].opacity = 0;
    }
    runtime.backdrop = black;
    runtime.backdropLevelId = null;
    runtime.waystones.length = 0;
    runtime.mechanismTriggers = undefined;
  }
  const restore = ctx.events.on('levelChanged', () => {
    if (savedAmbient !== null) ctx.params.global.ambient = savedAmbient;
    savedAmbient = null;
    restore();
  });
  resetDuelStage(ctx);
  // the verbs: a fighter needs something to cast and a flask to throw
  for (const card of ['lightning', 'bomb', 'flame'] as const) {
    const known = ctx.wands.collection.includes(card) || ctx.wands.wands.some((wand) => wand.cards.includes(card));
    if (!known) ctx.wands.grantCard(ctx, card);
  }
  ctx.flask.setSlot(0, Cell.Water, 300);
  ctx.flask.setSlot(1, Cell.Oil, 300);
  standAtSpawn(ctx, 0);
  ctx.arena?.setSpawns(DUEL.spawns);
  // The Proving Yard's hint; a lobby-started Duel already has both fighters and says nothing of panels.
  if (!versusMatchUnderway(ctx.versus)) ctx.events.emit('toast', { text: 'THE DUEL STAGE: add a rival from the panel; a brain for each fighter makes it a fight.' });
}

/** Stand slot 0's body (the one on the Ctx) at a spawn, still, facing in. */
export function standAtSpawn(ctx: Ctx, which: number): void {
  const s = DUEL.spawns[which] ?? DUEL.spawns[0];
  const p = ctx.player;
  p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  p.dead = false;
  p.facing = s.x < DUEL.cx ? 1 : -1;
  const runtime = ctx.levels.current;
  if (runtime) runtime.spawn = { x: s.x, y: s.y };
  ctx.camera.snapTo(DUEL.cx, DUEL.floor - 110);
}
