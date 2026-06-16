import type { BodyMaterial, Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

/**
 * The "PHYSICS TEST ARENA" level (worldgraph id 'physics-test'): a large,
 * hand-authored enclosure built to exercise the Rapier rigid-body layer —
 * rolling ramps, a crate platform with steps, a tumble drop, and a water pool —
 * populated with boulders and crates on entry. Stamped over a normal generated
 * level by Levels.enterLevel AFTER the level-change clear, so the bodies survive.
 */

const AX0 = 560;
const AX1 = 1140;
const ATOP = 360;
const GROUND = 600;
const BOT = 616;
const WALL = 6;

export function buildPhysicsArena(ctx: Ctx): void {
  const w = ctx.world;
  const stone = (x: number, y: number): void => {
    if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), Cell.Stone, COLOR_FN[Cell.Stone]());
  };
  const clear = (x: number, y: number): void => {
    if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
  };
  const water = (x: number, y: number): void => {
    if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), Cell.Water, COLOR_FN[Cell.Water]());
  };

  // Hollow the arena, lay the floor, raise the outer walls.
  for (let x = AX0; x <= AX1; x++) for (let y = ATOP; y <= BOT; y++) clear(x, y);
  for (let x = AX0; x <= AX1; x++) for (let y = GROUND; y <= BOT; y++) stone(x, y);
  for (let y = ATOP; y <= BOT; y++) for (let d = 0; d < WALL; d++) {
    stone(AX0 + d, y);
    stone(AX1 - d, y);
  }

  // LEFT: a long ramp descending to the right — boulders roll down it.
  for (let x = AX0 + WALL; x <= 760; x++) {
    const top = Math.round(450 + (x - (AX0 + WALL)) * 0.78);
    for (let y = Math.min(top, GROUND); y <= GROUND; y++) stone(x, y);
  }

  // MIDDLE: a raised crate platform with a staircase up its right side.
  for (let x = 786; x <= 862; x++) for (let y = 520; y <= 524; y++) stone(x, y);
  for (let s = 0; s < 5; s++) {
    const sx = 864 + s * 7;
    for (let x = sx; x < sx + 7; x++) for (let y = 524 + s * 15; y <= GROUND; y++) stone(x, y);
  }

  // RIGHT: a stone-lined water pool to drop bodies into (splash-ready).
  const PX0 = 952;
  const PX1 = 1108;
  for (let x = PX0; x <= PX1; x++) for (let y = 540; y <= GROUND; y++) clear(x, y); // carve the basin
  for (let y = 540; y <= BOT; y++) for (let d = 0; d < 3; d++) {
    stone(PX0 - 1 - d, y);
    stone(PX1 + 1 + d, y);
  }
  for (let x = PX0; x <= PX1; x++) for (let y = GROUND - 2; y <= BOT; y++) stone(x, y); // basin floor
  for (let x = PX0 + 1; x <= PX1 - 1; x++) for (let y = 560; y <= GROUND - 3; y++) water(x, y);

  // Drop the player onto clear flat floor just past the ramp, and CARVE a
  // guaranteed standing pocket so an authored spawn can never wedge in terrain
  // (the generated-level spawn-chamber safeguard doesn't cover authored arenas).
  const SPAWN_X = 775;
  for (let x = SPAWN_X - 6; x <= SPAWN_X + 6; x++) for (let y = GROUND - 28; y <= GROUND - 1; y++) clear(x, y);
  const p = ctx.player;
  p.x = SPAWN_X;
  p.y = GROUND - 1;
  p.vx = p.vy = p.fx = p.fy = 0;
  p.dead = false;
  p.crawling = false;
  p.climbing = false;
  p.diveT = 0;
  p.hp = p.maxHp;
  ctx.camera.snapTo(850, 470);
  ctx.enemies.length = 0; // a calm test arena

  // Populate with a MIX of materials — wood floats, stone/metal sink (P5), and
  // heavier materials resist kicks/blasts (B1/P1/P2).
  const rb = ctx.rigidBodies;
  rb.clear();
  const boulder = (x: number, y: number): void => {
    rb.spawn({ kind: 'circle', radius: 5 }, x, y, { material: 'stone', friction: 0.9, restitution: 0.15 });
  };
  const crate = (x: number, y: number, material: BodyMaterial): void => {
    rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, y, { material, friction: 0.6, restitution: 0.15 });
  };
  // Boulders for the ramp + the pool (sink).
  boulder(580, 430);
  boulder(600, 430);
  boulder(1010, 470); // into the pool → sinks
  // A neat stack of crates on the platform (wood + a couple of heavy metal ones).
  for (let i = 0; i < 4; i++) crate(800 + (i % 2) * 9, 510 - i * 8, i >= 2 ? 'metal' : 'wood');
  for (let i = 0; i < 3; i++) crate(835, 510 - i * 8, 'wood');
  // Tumbling crates dropped from above the ramp + the middle.
  crate(700, 380, 'wood');
  crate(720, 380, 'metal');
  crate(980, 470, 'wood'); // into the pool → floats (P5)
  crate(1040, 470, 'metal'); // into the pool → sinks

  // Ceiling beams with hanging ropes + thick vines into the player's walking path,
  // so you can brush/swing through them (persistent Verlet strands, player-reactive).
  const beam = (bx0: number, bx1: number): void => {
    for (let x = bx0; x <= bx1; x++) for (let y = 456; y <= 460; y++) stone(x, y);
  };
  beam(704, 772);
  beam(884, 924);
  const vines = ctx.vineStrands;
  vines.addHanging(716, 461, 135, { thickness: 1 }); // thin vine
  vines.addHanging(740, 461, 135, { thickness: 1 }); // thin vine
  vines.addHanging(764, 461, 135, { thickness: 3 }); // thick vine
  vines.addHanging(904, 461, 135, { thickness: 2, color: packRGB(122, 88, 52) }); // a rope
}
