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
  // shell: sealed box with a flat main floor
  fill(40, 300, WIDTH - 40, 316, Cell.Wall); // ceiling
  fill(40, FLOOR, WIDTH - 40, BOT, Cell.Stone); // floor
  fill(40, 300, 56, BOT, Cell.Wall); // left wall
  fill(WIDTH - 56, 300, WIDTH - 40, BOT, Cell.Wall); // right wall
  return { cell, fill, basin };
}

function mark(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, label: string, detail: string): void {
  ctx.levels.current?.inspectionMarkers?.push({ kind: 'prefab', label, x0, y0, x1, y1, detail });
}

function arrive(ctx: Ctx, x: number, objective: string, hint: string): void {
  const p = ctx.player;
  p.x = x;
  p.y = FLOOR - 2;
  p.vx = 0;
  p.vy = 0;
  p.fx = 0;
  p.fy = 0;
  ctx.camera.snapTo(x, FLOOR - 90);
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
  // gallery 1: a low ceiling shelf holding a big gas pocket, with a plugged
  // torch niche — dig the 2-cell sand plug to introduce the flame
  fill(120, 420, 480, 436, Cell.Wall); // shelf ceiling
  fill(120, 437, 480, 442, Cell.MarshGas);
  fill(150, 470, 156, 480, Cell.Wall); // torch niche
  for (let y = 452; y <= 468; y++) cell(152, y, Cell.Fire);
  fill(150, 444, 156, 450, Cell.Sand); // the plug between torch and pocket
  // gallery 2: gas over a gunpowder-laced ore wall — the two-stage disaster
  fill(620, 380, 980, 396, Cell.Wall);
  fill(620, 397, 980, 404, Cell.MarshGas);
  fill(660, 560, 900, FLOOR - 1, Cell.RawOre);
  for (let x = 675; x < 900; x += 9) {
    for (let y = 566; y < FLOOR - 4; y += 8) {
      cell(x + ((y * 7) % 5), y, Cell.Gunpowder);
    }
  }
  mark(ctx, 120, 420, 480, 452, 'Gas pocket + plugged torch', 'Dig the sand plug below-left; the flame finds the pocket');
  mark(ctx, 660, 380, 900, FLOOR, 'Laced ore seam', 'Gunpowder threads the ore — excavate carefully, or don’t');
  mark(ctx, 1100, 360, 1400, 392, 'The clean pocket', 'Detonate it from range — or keep it as a trap for the bomber');
  // gallery 3: a clean pocket to husband — or detonate from range
  fill(1100, 360, 1400, 376, Cell.Wall);
  fill(1100, 377, 1400, 390, Cell.MarshGas);
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
  const { fill, basin } = stamp(ctx);
  // the lake: a wide deep-water span with a far shore
  fill(360, FLOOR - 60, 1040, FLOOR - 1, Cell.Water);
  fill(340, FLOOR - 62, 358, BOT, Cell.Stone); // near quay
  fill(1042, FLOOR - 62, 1060, BOT, Cell.Stone); // far quay
  // fire pit on the near shore: re-melt your bridge behind you
  fill(250, FLOOR - 4, 290, FLOOR - 1, Cell.Coal);
  for (let x = 255; x <= 285; x += 6) fill(x, FLOOR - 6, x + 1, FLOOR - 5, Cell.Fire);
  // flask reagent tubs for grenade practice
  basin(120, 170, 10, Cell.Water);
  basin(1150, 1200, 8, Cell.Lava);
  basin(1260, 1310, 10, Cell.Acid);
  // live targets on the far shore
  ctx.enemyCtl.spawn('slime', 1120, FLOOR - 2);
  ctx.enemyCtl.spawn('slime', 1220, FLOOR - 2);
  ctx.enemyCtl.spawn('bat', 1180, FLOOR - 120);
  mark(ctx, 360, FLOOR - 62, 1040, FLOOR, 'The lake', 'Icelance the surface into a bridge; the fire pit melts it back');
  mark(ctx, 250, FLOOR - 8, 290, FLOOR, 'Fire pit', 'Re-melt your bridge behind you');
  arrive(
    ctx,
    120,
    'FREEZE A CROSSING — THROW WHAT BURNS',
    'FROST RANGE: icelance the lake to bridge it; fill the flask and throw it',
  );
}
