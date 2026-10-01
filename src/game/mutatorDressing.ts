import { Rng, hashSeed } from '@/core/rng';
import type { LevelExitWell } from '@/core/types';
import { Cell, blocksEntity } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import type { World } from '@/sim/World';
import { wizardMask } from '@/world/validate';
import { traceRoute, ROUTE_STEP, type PopulationRoute } from '@/game/populationRoute';
import { cleanMutators, mutatorDef, type MutatorDressing } from '@/content/mutators';

/**
 * WORLD DRESSING for the complications that change the floor itself: puddles at the
 * low points and a drip overhead (Wet Floors), slime from the ceilings (Slime Rain), and
 * marsh-gas vents in the floor (Gas Leak).
 *
 * It is a TAIL pass over a floor the generator has already finished, never a generation
 * change: the generated output is untouched (no GEN_VERSION churn). It is planned from the
 * floor's PRISTINE cells, from a fork of the level's seed (`hashSeed(levelSeed, 'mut:' + id)`,
 * one stream per complication, so Wet Floors lays out the same on a seed alone or beside
 * another one), and traced against the same spawn -> key -> exit walk the population uses, so
 * what it adds is on the road the player takes. Puddles are written as real cells once, when
 * the floor is created, and persist in the floor's saved cells; vents are runtime emitters the
 * director re-derives from the same seed whenever the floor is built or restored (a restored
 * floor regenerates pristine and overlays its cells, so an emitter list cannot ride the save).
 *
 * Everything here is pure over a `World` and a seed (no Ctx, no DOM), so it runs in Node tests.
 * Everything FAILS OPEN: a floor with no route to dress, or a dressing that would cost the
 * route anything, is simply left plain (and reported), never half-done.
 */

/** A vent or a drip: a runtime emitter with a budget so a leak never floods a floor. */
export interface Vent {
  kind: MutatorDressing;
  /** The anchor: the solid cell the drip hangs from, or the floor cell the gas rises out of. */
  x: number;
  y: number;
  /** What it emits (a Cell id). */
  cell: number;
  /** 0 = drips down from the anchor, 180 = rises up from it. */
  dir: 0 | 180;
  /** Frames between emissions, and the cells per emission. */
  rate: number;
  burst: number;
  phase: number;
  /** Cells it may still emit on this floor before the pipe runs dry. */
  budget: number;
}

/** A pool planned in a real basin: the exact cells to fill. */
export interface Puddle {
  x: number;
  y: number;
  /** Cells deep at the seed. */
  depth: number;
  cells: number[];
}

export interface LevelPlan {
  vents: Vent[];
  puddles: Puddle[];
  /** Why a floor was left plain, for the report ('' when it was dressed). */
  skipped: string;
}

export const EMPTY_PLAN: LevelPlan = Object.freeze({ vents: [], puddles: [], skipped: '' }) as LevelPlan;

/** The floor facts the planner needs: where the walk starts, where it goes, and what to keep clear. */
export interface DressingAnchors {
  spawn: { x: number; y: number };
  exit: Pick<LevelExitWell, 'x' | 'sealY'>;
  key: { x: number; y: number } | null;
  portal: { x: number; y: number } | null;
  boss: { x: number; y: number } | null;
  /** Rectangles (set pieces, mechanisms) the dressing keeps out of, and points (pickups, waystones) it keeps clear of. */
  keepOutRects: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  keepClear: ReadonlyArray<{ x: number; y: number }>;
}

/** Tuning, in one place. */
export const DRESSING = {
  /** Puddles attempted on a floor, and the cells a pool may hold (a basin larger than this is a lake, not a puddle). */
  PUDDLES: 6,
  PUDDLE_MIN_CELLS: 14,
  PUDDLE_MAX_CELLS: 110,
  PUDDLE_MAX_DEPTH: 4,
  /** Keep-clear radii, in cells. */
  SPAWN_CLEAR: 40,
  POINT_CLEAR: 16,
  PUDDLE_SPACING: 60,
  /** A puddle's bottom must be this many path steps (at most) from the walk. */
  PUDDLE_WALK: 24,
  RECT_PAD: 8,
  /** Vents attempted, per kind. */
  DRIPS: 5,
  SLIME: 8,
  GAS: 5,
  /** How far a ceiling may be above the route before a drip is not worth hanging there. */
  CEILING_REACH: 70,
  FLOOR_REACH: 30,
} as const;

const VENT_SPECS: Record<'drips' | 'slime' | 'gas', Omit<Vent, 'x' | 'y' | 'phase'>> = {
  drips: { kind: 'drips', cell: Cell.Water, dir: 0, rate: 36, burst: 1, budget: 260 },
  slime: { kind: 'slime', cell: Cell.Slime, dir: 0, rate: 30, burst: 2, budget: 300 },
  gas: { kind: 'gas', cell: Cell.MarshGas, dir: 180, rate: 22, burst: 4, budget: 900 },
};

function open(world: Pick<World, 'width' | 'height' | 'types'>, x: number, y: number): boolean {
  return x > 0 && y > 0 && x < world.width - 1 && y < world.height - 1 && !blocksEntity(world.types[x + y * world.width]);
}

function inRect(x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }, pad: number): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
}

/** Is (x, y) a place dressing must keep out of: near the arrival, a pickup or a waystone, or inside a set piece? */
function clearOf(a: DressingAnchors, x: number, y: number, spawnR: number, pointR: number): boolean {
  if (Math.hypot(x - a.spawn.x, y - a.spawn.y) < spawnR) return false;
  for (const p of a.keepClear) if (Math.hypot(x - p.x, y - p.y) < pointR) return false;
  for (const r of a.keepOutRects) if (inRect(x, y, r, DRESSING.RECT_PAD)) return false;
  return true;
}

/**
 * The floor's walk, traced on the pristine world exactly as the population traces it: the
 * body-fit reach from the spawn, then spawn -> key -> exit (or the boss on a boss floor).
 * Null when the walk cannot be made: the floor is then left plain.
 */
export function traceDressingRoute(world: World, a: DressingAnchors): PopulationRoute | null {
  const reach = wizardMask({ world, spawn: a.spawn });
  const goal = a.portal ?? a.boss ?? { x: a.exit.x, y: a.exit.sealY - 12 };
  return traceRoute(reach, world.width, world.height, a.spawn, a.key, goal, a.portal ? 70 : 130);
}

/** Route sample points whose arc length falls near `s`, nearest first. */
function pointsNear(route: PopulationRoute, s: number, spread: number): Array<{ x: number; y: number; s: number }> {
  const lo = Math.max(0, Math.floor((s - spread) / ROUTE_STEP));
  const hi = Math.min(route.points.length - 1, Math.ceil((s + spread) / ROUTE_STEP));
  const out = route.points.slice(lo, hi + 1);
  out.sort((p, q) => Math.abs(p.s - s) - Math.abs(q.s - s));
  return out;
}

/** `n` arc positions spread along the usable part of the walk, jittered (never the very ends). */
function arcTargets(route: PopulationRoute, n: number, rng: Rng): number[] {
  const lo = route.minS + 40;
  const hi = route.maxS - 40;
  if (hi <= lo || n <= 0) return [];
  const span = hi - lo;
  const slot = span / n;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(lo + slot * (k + 0.15 + rng.next() * 0.7));
  return out;
}

/** The ceiling above (x, y): the first blocking cell upward, with empty air under it and a clear drop of a few cells. */
function ceilingAbove(world: World, x: number, y: number): { x: number; y: number } | null {
  for (let dy = 1; dy <= DRESSING.CEILING_REACH; dy++) {
    const yy = y - dy;
    if (yy < 1) return null;
    if (open(world, x, yy)) continue;
    for (let k = 1; k <= 4; k++) if (world.types[x + (yy + k) * world.width] !== Cell.Empty) return null;
    return { x, y: yy };
  }
  return null;
}

/** The floor under (x, y): the first blocking cell downward, with empty air over it. */
function floorBelow(world: World, x: number, y: number): { x: number; y: number } | null {
  for (let dy = 0; dy <= DRESSING.FLOOR_REACH; dy++) {
    const yy = y + dy;
    if (yy >= world.height - 2) return null;
    if (open(world, x, yy)) continue;
    if (world.types[x + (yy - 1) * world.width] !== Cell.Empty) return null;
    return { x, y: yy };
  }
  return null;
}

/**
 * The cells of a pool of water at a basin: the empty cells at or below row `level`, 4-connected
 * from the seed, bounded by anything that is not empty air. Such a region is a CLOSED pool by
 * construction (nothing at or below its surface row leads out of it), so the water stays where it
 * is put. Null when it would exceed `cap` (a lake, or a leak down a shaft) or touches a place the
 * dressing must keep clear of.
 */
export function basinCells(
  world: World,
  seedX: number,
  seedY: number,
  level: number,
  cap: number,
  keep: (x: number, y: number) => boolean,
): number[] | null {
  const W = world.width;
  const start = seedX + seedY * W;
  if (world.types[start] !== Cell.Empty || seedY < level) return null;
  const seen = new Set<number>([start]);
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % W;
    const y = (i - x) / W;
    if (!keep(x, y)) return null;
    const around = [i + 1, i - 1, i + W, i - W];
    const ys = [y, y, y + 1, y - 1];
    const xs = [x + 1, x - 1, x, x];
    for (let k = 0; k < 4; k++) {
      const nx = xs[k];
      const ny = ys[k];
      if (nx < 1 || ny < Math.max(1, level) || nx >= W - 1 || ny >= world.height - 1) continue;
      const ni = around[k];
      if (seen.has(ni) || world.types[ni] !== Cell.Empty) continue;
      seen.add(ni);
      queue.push(ni);
      if (queue.length > cap) return null;
    }
  }
  return queue;
}

/** The deepest closed pool a seed supports: fill levels from one cell deep up to `maxDepth`, keep the last that stays a puddle. */
function deepestPuddle(world: World, x: number, y: number, keep: (x: number, y: number) => boolean): Puddle | null {
  let best: Puddle | null = null;
  for (let depth = 1; depth <= DRESSING.PUDDLE_MAX_DEPTH; depth++) {
    const cells = basinCells(world, x, y, y - depth + 1, DRESSING.PUDDLE_MAX_CELLS, keep);
    if (!cells) break;
    if (cells.length >= DRESSING.PUDDLE_MIN_CELLS) best = { x, y, depth, cells };
  }
  return best;
}

function planPuddles(world: World, a: DressingAnchors, route: PopulationRoute, rng: Rng): Puddle[] {
  const keep = (x: number, y: number): boolean => clearOf(a, x, y, DRESSING.SPAWN_CLEAR, DRESSING.POINT_CLEAR);
  const out: Puddle[] = [];
  const taken = new Set<number>();
  for (const s of arcTargets(route, DRESSING.PUDDLES, rng)) {
    // The candidates near this stretch of the walk, in a seeded order: columns beside the route, each dropped to its floor.
    const candidates: Array<{ x: number; y: number }> = [];
    for (const p of pointsNear(route, s, 90)) {
      for (let dx = -24; dx <= 24; dx += 4) {
        const f = floorBelow(world, p.x + dx, p.y);
        // The pool's bottom must be somewhere the alchemist can STAND, within a few steps of the walk: a pit too
        // narrow for a body, or in a cave off the road, is not a puddle he will ever wade through.
        if (f && route.corridor[f.x + (f.y - 1) * world.width] <= DRESSING.PUDDLE_WALK) candidates.push({ x: f.x, y: f.y - 1 });
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const c of candidates) {
      if (out.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < DRESSING.PUDDLE_SPACING)) continue;
      const puddle = deepestPuddle(world, c.x, c.y, keep);
      if (!puddle || puddle.cells.some((i) => taken.has(i))) continue;
      for (const i of puddle.cells) taken.add(i);
      out.push(puddle);
      break;
    }
  }
  return out;
}

function planVents(world: World, a: DressingAnchors, route: PopulationRoute, spec: keyof typeof VENT_SPECS, count: number, rng: Rng): Vent[] {
  const out: Vent[] = [];
  for (const s of arcTargets(route, count, rng)) {
    let placed = false;
    for (const p of pointsNear(route, s, 60)) {
      for (const dx of [0, 5, -5, 10, -10, 16, -16, 24, -24]) {
        const x = p.x + dx;
        if (!open(world, x, p.y)) continue;
        const anchor = spec === 'gas' ? floorBelow(world, x, p.y) : ceilingAbove(world, x, p.y - 17);
        if (!anchor) continue;
        if (!clearOf(a, anchor.x, anchor.y, DRESSING.SPAWN_CLEAR, 8)) continue;
        if (out.some((v) => Math.hypot(v.x - anchor.x, v.y - anchor.y) < 70)) continue;
        out.push({ ...VENT_SPECS[spec], x: anchor.x, y: anchor.y, phase: rng.int(VENT_SPECS[spec].rate) });
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  return out;
}

/**
 * Plan a floor's dressing from its PRISTINE cells. Deterministic for (cells, anchors, levelSeed, set):
 * the same floor gets the same puddles and vents every time, on createLevel and restoreLevel alike.
 */
export function planDressing(world: World, a: DressingAnchors, levelSeed: number, ids: readonly string[]): LevelPlan {
  const wanted = new Set<MutatorDressing>();
  const dressedBy = new Map<MutatorDressing, string>();
  for (const id of cleanMutators(ids)) {
    for (const kind of mutatorDef(id)?.dressing ?? []) {
      wanted.add(kind);
      if (!dressedBy.has(kind)) dressedBy.set(kind, id);
    }
  }
  if (wanted.size === 0) return EMPTY_PLAN;
  const route = traceDressingRoute(world, a);
  if (!route) return { vents: [], puddles: [], skipped: 'no route' };
  const plan: LevelPlan = { vents: [], puddles: [], skipped: '' };
  const stream = (kind: MutatorDressing): Rng => new Rng(hashSeed(levelSeed, `mut:${dressedBy.get(kind) ?? kind}:${kind}`));
  if (wanted.has('puddles')) plan.puddles = planPuddles(world, a, route, stream('puddles'));
  if (wanted.has('drips')) plan.vents.push(...planVents(world, a, route, 'drips', DRESSING.DRIPS, stream('drips')));
  if (wanted.has('slime')) plan.vents.push(...planVents(world, a, route, 'slime', DRESSING.SLIME, stream('slime')));
  if (wanted.has('gas')) plan.vents.push(...planVents(world, a, route, 'gas', DRESSING.GAS, stream('gas')));
  return plan;
}

/** What `applyPuddles` did, for the report and the tests. */
export interface DressResult {
  /** Cells of water written. */
  cells: number;
  /** The route cells (body-fit positions reachable before) that were not reachable after: zero, or the dressing is reverted. */
  lost: number;
  reverted: boolean;
}

/**
 * Write a plan's puddles into a floor as real water cells and CHECK THE ROUTE: the body-fit
 * reach from the spawn is traced before and after, and if the dressing cost the walk a single
 * position every cell is put back (fail open: a plain floor beats a walled one). Water is not
 * a wall, so this is a guard against the day something changes that, not an expectation; it is
 * exercised by the tests with a deliberately walling dressing.
 */
export function applyPuddles(world: World, spawn: { x: number; y: number }, puddles: readonly Puddle[], fill: number = Cell.Water): DressResult {
  const cells = puddles.flatMap((p) => p.cells).filter((i) => world.types[i] === Cell.Empty);
  if (cells.length === 0) return { cells: 0, lost: 0, reverted: false };
  const before = wizardMask({ world, spawn });
  const color = COLOR_FN[fill];
  for (const i of cells) world.replaceCellAt(i, fill, color ? color() : EMPTY_COLOR);
  const after = wizardMask({ world, spawn });
  let lost = 0;
  for (let i = 0; i < before.length; i++) if (before[i] === 1 && after[i] === 0) lost++;
  if (lost > 0) {
    for (const i of cells) world.clearCellAt(i);
    return { cells: 0, lost, reverted: true };
  }
  return { cells: cells.length, lost: 0, reverted: false };
}

/**
 * Emit a gas vent's cells (rising from its floor), only into empty air and only while it has
 * budget. Returns the cells placed. (A drip is not a cell placed at the ceiling: it is a falling
 * droplet the director spawns, which lands as a real cell: see `dripReady` and MutatorDirector.)
 */
export function emitVent(world: World, vent: Vent): number {
  if (vent.budget <= 0) return 0;
  const step = vent.dir === 180 ? -1 : 1;
  let placed = 0;
  for (let k = 1; k <= vent.burst; k++) {
    const y = vent.y + step * k;
    if (y < 1 || y >= world.height - 1) break;
    const i = vent.x + y * world.width;
    if (world.types[i] !== Cell.Empty) break;
    const color = COLOR_FN[vent.cell];
    world.replaceCellAt(i, vent.cell, color ? color() : EMPTY_COLOR);
    placed++;
    vent.budget--;
    if (vent.budget <= 0) break;
  }
  return placed;
}

/** Can a drip leave this vent now? The cell under its ceiling must be open air and the vent must have budget. */
export function dripReady(world: Pick<World, 'width' | 'height' | 'types'>, vent: Vent): boolean {
  if (vent.budget <= 0 || vent.dir !== 0) return false;
  const y = vent.y + 1;
  return y > 0 && y < world.height - 1 && world.types[vent.x + y * world.width] === Cell.Empty;
}
