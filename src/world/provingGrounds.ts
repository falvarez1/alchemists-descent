import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

/**
 * PHYSICS PROVING GROUNDS (console: `level alchemy-test` / `level gas-test`
 * / `level frost-test`): authored playgrounds for the Noita-physics wave —
 * the alchemy table + the run's secret reaction, marsh-gas pockets +
 * gunpowder seams, and flask-grenade / freeze-terraforming practice.
 * Test-mode content, not campaign progression (same contract as the
 * weaver/physics arenas: they wipe and stamp the world on entry).
 */

const FLOOR = 640;
const BOT = 664;
const GROUNDS_AMBIENT = 0.85; // a proving ground must be READABLE (weaver-arena pattern)

function stamp(ctx: Ctx): {
  cell: (x: number, y: number, t: number) => void;
  fill: (x0: number, y0: number, x1: number, y1: number, t: number) => void;
  basin: (x0: number, x1: number, depth: number, t: number) => void;
} {
  const w = ctx.world;
  const cell = (x: number, y: number, t: number): void => {
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    if (t === Cell.Empty) w.clearCellAt(i);
    else w.replaceCellAt(i, t, COLOR_FN[t] ? COLOR_FN[t]() : packRGB(120, 120, 120));
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(WIDTH - 1, x1); x++) cell(x, y, t);
    }
  };
  // a METAL tub sunk into the floor (metal is the one thing acid cannot
  // eat — a stone basin of acid dissolves itself within seconds)
  const basin = (x0: number, x1: number, depth: number, t: number): void => {
    fill(x0 - 2, FLOOR - depth - 2, x0 - 1, BOT, Cell.Metal);
    fill(x1 + 1, FLOOR - depth - 2, x1 + 2, BOT, Cell.Metal);
    fill(x0 - 2, FLOOR, x1 + 2, BOT, Cell.Metal);
    fill(x0, FLOOR - depth, x1, FLOOR - 1, t);
  };
  w.clear();
  ctx.params.global.ambient = GROUNDS_AMBIENT;
  const runtime = ctx.levels.current;
  if (runtime) runtime.inspectionMarkers = [];
  ctx.rigidBodies.clear();
  ctx.vineStrands.clear();
  ctx.critters.clear();
  ctx.enemies.length = 0;
  // shell: sealed box with a flat main floor and a LOW ceiling — everything
  // in a proving ground lives at eye level (the first draft hung galleries
  // 150+ cells overhead in the dark; the wizard saw an empty floor)
  const CEIL = FLOOR - 96;
  fill(40, CEIL - 16, WIDTH - 40, CEIL, Cell.Wall); // ceiling
  fill(40, FLOOR, WIDTH - 40, BOT, Cell.Stone); // floor
  fill(40, CEIL - 16, 56, BOT, Cell.Wall); // left wall
  fill(WIDTH - 56, CEIL - 16, WIDTH - 40, BOT, Cell.Wall); // right wall
  // glowshroom lighting rows: real light sources every 40 cells, so the
  // grounds are readable regardless of the level's ambient plumbing
  for (let x = 80; x < WIDTH - 60; x += 40) cell(x, CEIL + 1, Cell.Glowshroom);
  return { cell, fill, basin };
}

function mark(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, label: string, detail: string): void {
  ctx.levels.current?.inspectionMarkers?.push({ kind: 'prefab', label, x0, y0, x1, y1, detail });
}

function arrive(ctx: Ctx, x: number, objective: string, hint: string, y = FLOOR - 2): void {
  const p = ctx.player;
  p.x = x;
  p.y = y;
  const rt = ctx.levels.current;
  if (rt) rt.spawn = { x, y }; // respawn INTO the arena, not the old void spawn
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  ctx.camera.snapTo(x, y - 88);
  ctx.events.emit('objectiveChanged', { text: objective });
  ctx.events.emit('toast', { text: hint });
}

/** ALCHEMY PROVING GROUNDS: one supply tub per reagent, spaced so every
 *  combination is the player's own doing (siphon, pour, throw, dig). The
 *  run's SECRET pair is staged side by side at the far end. */
export function buildAlchemyArena(ctx: Ctx): void {
  const { fill, basin } = stamp(ctx);
  // base-table reagents, left to right
  basin(120, 180, 10, Cell.Water);
  basin(230, 290, 10, Cell.Acid);
  basin(340, 400, 8, Cell.Lava);
  basin(450, 510, 10, Cell.Slime);
  basin(560, 620, 10, Cell.Blood);
  basin(670, 730, 10, Cell.Toxic);
  fill(790, FLOOR - 8, 830, FLOOR - 1, Cell.Catalyst); // dust heap on the floor
  fill(860, FLOOR - 8, 900, FLOOR - 1, Cell.Ash); // ash heap (secret fodder)
  fill(930, FLOOR - 8, 970, FLOOR - 1, Cell.Snow); // snow bank
  fill(1000, FLOOR - 8, 1040, FLOOR - 1, Cell.Coal); // coal bed
  const tubs: Array<[number, number, string, string]> = [
    [120, 180, 'Water tub', 'Dilutes toxic; quenches lava; freezes under frost'],
    [230, 290, 'Acid tub', 'Pour onto LAVA to vitrify it into glass'],
    [340, 400, 'Lava tub', 'Acid vitrifies it; water quenches it'],
    [450, 510, 'Slime tub', 'Acid digests slime into toxic sludge'],
    [560, 620, 'Blood tub', 'Runs it into the catalyst heap for healing mist'],
    [670, 730, 'Toxic tub', 'Flood it with water to cleanse it'],
    [790, 830, 'Catalyst heap', 'Transmutes blood into healium; consumed grain by grain'],
    [860, 900, 'Ash heap', 'Secret-reaction fodder'],
    [930, 970, 'Snow bank', 'Secret-reaction fodder'],
    [1000, 1040, 'Coal bed', 'Secret-reaction fodder'],
  ];
  for (const [x0, x1, label, detail] of tubs) mark(ctx, x0 - 3, FLOOR - 16, x1 + 3, BOT, label, detail);
  // THE RUN'S SECRET, pre-staged: its two reagents in adjacent tubs with a
  // 6-cell stone dam between them — breach the dam and watch
  const secret = ctx.state.secretReaction;
  if (secret) {
    basin(1120, 1170, 10, secret.a as Cell);
    basin(1182, 1232, 10, secret.b as Cell);
    // the DAM between them is SAND — metal basin walls are indestructible,
    // and an unbreachable "breach the dam" is a lie. Dig or kick it open.
    fill(1172, FLOOR - 14, 1180, FLOOR - 1, Cell.Sand);
    ctx.events.emit('toast', { text: 'THE FAR TUBS HOLD THIS RUN’S SECRET PAIR — BREACH THE DAM' });
    mark(ctx, 1115, FLOOR - 16, 1237, BOT, 'THE RUN’S SECRET PAIR', 'Breach the dam between these two tubs and watch');
  }
  arrive(
    ctx,
    100,
    'COMBINE THE TUBS — EVERY REACTION IS REAL CELLS',
    'ALCHEMY GROUNDS: siphon, pour, and throw the flask between tubs',
  );
}

/** THE GASWORKS: pooled marsh-gas galleries, a torch plug, and a
 *  gunpowder-laced ore wall to mine — carefully, or not. */
export function buildGasArena(ctx: Ctx): void {
  const { cell, fill } = stamp(ctx);
  const CEIL = FLOOR - 96;
  // BAY 1 — the plugged torch: gas pools under the shell ceiling; a glowing
  // lava well sits at floor level with a sand plug capping its chimney. Dig
  // the plug and the heat climbs into the pocket.
  fill(120, CEIL + 1, 470, CEIL + 22, Cell.MarshGas);
  fill(280, FLOOR - 26, 300, FLOOR - 1, Cell.Metal); // the well
  fill(284, FLOOR - 22, 296, FLOOR - 4, Cell.Lava);
  fill(284, FLOOR - 30, 296, FLOOR - 27, Cell.Sand); // the plug on top
  fill(478, CEIL, 494, FLOOR - 1, Cell.Wall); // bay divider
  mark(ctx, 120, CEIL, 470, FLOOR, 'Plugged torch bay', 'Gas overhead; dig the sand cap off the lava well');
  // BAY 2 — the laced seam: an ore wall AT eye level, gas pooled above it
  fill(520, CEIL + 1, 940, CEIL + 16, Cell.MarshGas);
  fill(620, FLOOR - 70, 850, FLOOR - 1, Cell.RawOre);
  for (let x = 632; x < 850; x += 9) {
    for (let y = FLOOR - 64; y < FLOOR - 4; y += 8) {
      cell(x + ((y * 7) % 5), y, Cell.Gunpowder);
    }
  }
  fill(948, CEIL, 964, FLOOR - 1, Cell.Wall); // bay divider
  mark(ctx, 620, FLOOR - 70, 850, FLOOR, 'Laced ore seam', 'Gunpowder threads the ore — excavate carefully, or don’t');
  // BAY 3 — the clean pocket + the wandering fuse
  fill(1000, CEIL + 1, 1420, CEIL + 26, Cell.MarshGas);
  mark(ctx, 1000, CEIL, 1420, CEIL + 30, 'The clean pocket', 'Detonate it from range — or let the bomber do it');
  ctx.enemyCtl.spawn('bomber', 1250, FLOOR - 2); // the wandering fuse
  arrive(
    ctx,
    90,
    'THE GASWORKS — EVERY POCKET IS A FUSE',
    'GASWORKS: dig the sand plug by the torch, mine the laced ore, mind the bomber',
  );
}

/** FLASK & FROST RANGE: freeze a crossing over deep water, melt it back,
 *  and practice flask grenades on live targets. */
export function buildFrostArena(ctx: Ctx): void {
  const { fill } = stamp(ctx);
  // RAISED SHORES with the lake sunk between them — the first draft piled a
  // 60-cell wall of water ABOVE the walking floor (an aquarium, not a lake;
  // the blueprint shot made that obvious). Shores are stone platforms; the
  // water surface sits just below their lips, so the crossing reads true.
  const SHORE = FLOOR - 40; // walkway level on both shores
  fill(57, SHORE, 358, FLOOR - 1, Cell.Stone); // near shore platform
  fill(1042, SHORE, WIDTH - 57, FLOOR - 1, Cell.Stone); // far shore platform
  fill(360, SHORE + 2, 1040, FLOOR - 1, Cell.Water); // the lake, below the lips
  // fire pit on the near shore: re-melt your bridge behind you
  fill(248, SHORE - 8, 292, SHORE - 1, Cell.Metal); // brazier
  fill(252, SHORE - 6, 288, SHORE - 2, Cell.Lava);
  // flask reagent tubs on the shores (basins are floor-relative, so build
  // them by hand at shore level)
  fill(118, SHORE - 14, 172, SHORE - 1, Cell.Metal);
  fill(121, SHORE - 12, 169, SHORE - 2, Cell.Water);
  fill(1148, SHORE - 12, 1202, SHORE - 1, Cell.Metal);
  fill(1151, SHORE - 10, 1199, SHORE - 2, Cell.Lava);
  fill(1258, SHORE - 14, 1312, SHORE - 1, Cell.Metal);
  fill(1261, SHORE - 12, 1309, SHORE - 2, Cell.Acid);
  // live targets on the far shore
  ctx.enemyCtl.spawn('slime', 1120, SHORE - 2);
  ctx.enemyCtl.spawn('slime', 1230, SHORE - 2);
  ctx.enemyCtl.spawn('bat', 1180, SHORE - 80);
  mark(ctx, 360, SHORE, 1040, FLOOR, 'The lake', 'Icelance the surface into a bridge; the brazier melts it back');
  mark(ctx, 246, SHORE - 10, 294, SHORE, 'Lava brazier', 'Re-melt your bridge behind you');
  arrive(
    ctx,
    200,
    'FREEZE A CROSSING — THROW WHAT BURNS',
    'FROST RANGE: icelance the lake to bridge it; fill the flask and throw it',
    SHORE - 2,
  );
}
