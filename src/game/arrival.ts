import { HEIGHT, WIDTH } from '@/config/constants';
import type { BossOrganRect } from '@/core/bossWard';
import { isWardedBoss } from '@/core/bossWard';
import type { Ctx, Enemy } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { sightClear } from '@/creatures/perception';
import { blocksEntity, Cell, isLiquid, isSoftGrowth, isSolid } from '@/sim/CellType';

/**
 * A SAFE ARRIVAL. QA watched the floor-2 title card play over a Weaver biting
 * the alchemist (HP 122→87 before he had control), and a sweep found worse:
 * the generated spawn is the centre of a carved chamber, and when anything
 * below it is open (a shaft, a gallery, a rescue tunnel) the arrival drops
 * straight through — 150 to 610 cells, once into the Kiln itself, onto the
 * Colossus. The population kept its distance from the spawn; nothing kept it
 * from where he actually landed.
 *
 * Three guarantees, in order:
 * 1. FOOTING (`settleArrival`): the level's spawn is settled onto the nearest
 *    floor he can stand on — solid underfoot, headroom, dry, no hazard, never
 *    inside a boss arena — found by walking the open air out from the chamber
 *    (so it is always reachable). Every consumer (population, organisms, the
 *    findability audit, respawns) then works from where he really stands.
 * 2. ROOM (`arrivalThreat` + Levels.secureArrival): no hostile within
 *    ARRIVAL_SAFE_RADIUS with a line of sight, or ARRIVAL_CLOSE_RADIUS behind
 *    rock. Population placement never seeds one there; anything else (a
 *    prefab's foe, a wanderer on a re-entry) is RELOCATED to a spot its kind
 *    may live in, never deleted.
 * 3. GRACE (`arrivalGraceActive`): while the floor's name is up nothing sees or
 *    hurts him; it ends early the moment he fights.
 */

/** No hostile within this many cells of an arrival while it can see him. */
export const ARRIVAL_SAFE_RADIUS = 120;
/** ...and none this close even behind rock (it would round the corner). */
export const ARRIVAL_CLOSE_RADIUS = 60;
/**
 * The arrival's grace, in ticks: the curtain (0.45 s), the title card's rise,
 * its 3.6 s hold and fade — 5.5 s. Ends early when he casts or kicks.
 */
export const ARRIVAL_GRACE_TICKS = 330;

/** Settle search: a coarse walk of the open air, at most ~260 cells of path from the chamber. */
const SETTLE_STEP = 2;
const SETTLE_MAX_DEPTH = 130;
const SETTLE_NODE_BUDGET = 40000;
/** Rows of open air above the feet a settled arrival needs (the player is 17 tall). */
const SETTLE_HEADROOM = 24;
/** A boss arena is kept this far from any settled arrival. */
const SETTLE_ARENA_MARGIN = 40;
/** No settled arrival within this many cells of a pickup: walking onto a tome at arrival opened
 *  its card offer over the floor's title card (and paused the settling world under it). */
const SETTLE_PICKUP_CLEAR = 28;
/** Rows of rigid rock under the feet: a thin lip is not footing (a later rescue tunnel or a
 *  draining powder bed took one out from under a settled arrival in the sweep). */
const SETTLE_GROUND_ROWS = 3;

export interface ArrivalPoint {
  x: number;
  y: number;
}

/** Is the arrival's grace still on? */
export function arrivalGraceActive(ctx: Ctx): boolean {
  const until = ctx.state.arrivalGraceUntil;
  return until !== undefined && ctx.state.frameCount < until;
}

function hazardCell(t: number): boolean {
  return t === Cell.Lava || t === Cell.Fire || t === Cell.Acid || t === Cell.Ember || t === Cell.Toxic;
}

function inRect(x: number, y: number, r: BossOrganRect, margin: number): boolean {
  return x >= r.x0 - margin && x <= r.x1 + margin && y >= r.y0 - margin && y <= r.y1 + margin;
}

/** Rigid rock a settled arrival may stand on (not powder, not growth a body passes through). */
function firm(t: number): boolean {
  return isSolid(t) && !isSoftGrowth(t);
}

/**
 * Where a body with its feet on row `fy` at column `x` could stand safely:
 * the body fits with SETTLE_HEADROOM rows of air, SETTLE_GROUND_ROWS of rigid
 * rock under the middle of the feet, no liquid in the body, no lava/fire/acid
 * within reach of the feet, and outside every avoided arena.
 */
export function arrivalStandable(
  ctx: Ctx, x: number, fy: number, avoid: readonly BossOrganRect[] = [], pickups: readonly ArrivalPoint[] = [],
): boolean {
  const w = ctx.world;
  const ph = ctx.physics;
  if (!ph?.entityFree) return true; // a small test context: nothing to judge by
  if (x < PLAYER_HALF_W + 3 || x > WIDTH - PLAYER_HALF_W - 4 || fy < SETTLE_HEADROOM + 2 || fy > HEIGHT - 4 - SETTLE_GROUND_ROWS) return false;
  if (!ph.entityFree(x, fy, PLAYER_HALF_W, PLAYER_H)) return false;
  if (!ph.entityFree(x, fy - (SETTLE_HEADROOM - PLAYER_H), PLAYER_HALF_W, PLAYER_H)) return false;
  if (!blocksEntity(w.types[w.idx(x, fy + 1)]) || ph.entityFree(x, fy + 1, PLAYER_HALF_W, 1)) return false;
  for (let dy = 1; dy <= SETTLE_GROUND_ROWS; dy++) {
    for (const dx of [-2, 0, 2]) if (!firm(w.types[w.idx(x + dx, fy + dy)])) return false;
  }
  for (let dy = 0; dy < PLAYER_H; dy += 4) {
    for (const dx of [-PLAYER_HALF_W, 0, PLAYER_HALF_W]) {
      if (isLiquid(w.types[w.idx(x + dx, fy - dy)])) return false;
    }
  }
  for (let dy = -2; dy <= 3; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const X = x + dx;
      const Y = fy + dy;
      if (w.inBounds(X, Y) && hazardCell(w.types[w.idx(X, Y)])) return false;
    }
  }
  for (const r of avoid) if (inRect(x, fy, r, SETTLE_ARENA_MARGIN)) return false;
  // (Above him counts for more: a pickup on a ledge overhead rolls down onto the arrival.)
  for (const p of pickups) {
    const above = fy - 8 - p.y;
    if (Math.abs(p.x - x) < SETTLE_PICKUP_CLEAR && above > -SETTLE_PICKUP_CLEAR && above < SETTLE_PICKUP_CLEAR * 3) return false;
  }
  return true;
}

/**
 * Where each pickup will lie: its spot and the floor under it (a tome placed in
 * the air falls, and one rolled onto a settled arrival from a ledge above).
 */
export function arrivalPickupRests(ctx: Ctx, pickups: readonly ArrivalPoint[]): ArrivalPoint[] {
  const w = ctx.world;
  const out: ArrivalPoint[] = [];
  for (const p of pickups) {
    const x = Math.round(p.x);
    let y = Math.round(p.y);
    out.push({ x, y });
    for (let k = 0; k < 400 && w.inBounds(x, y + 1) && !blocksEntity(w.types[w.idx(x, y + 1)]); k++) y++;
    if (y !== Math.round(p.y)) out.push({ x, y });
  }
  return out;
}

/**
 * Settle a generated spawn onto footing. The walk starts in the chamber and
 * spreads through the air a body fits in, level by level (so the first floor
 * it meets is the nearest by path — straight down, for an ordinary chamber);
 * among the floors at that distance the one nearest the chamber's centre line
 * wins. With no floor within reach, the straight drop's landing is used if it
 * is safe, and the spawn is returned unchanged only when nothing is.
 */
export function settleArrival(
  ctx: Ctx, spawn: ArrivalPoint, avoid: readonly BossOrganRect[] = [], pickups: readonly ArrivalPoint[] = [],
): ArrivalPoint {
  const ph = ctx.physics;
  if (!ph?.entityFree) return spawn; // a small test context: no body physics to settle with
  pickups = arrivalPickupRests(ctx, pickups);
  const sx = Math.round(spawn.x);
  const sy = Math.round(spawn.y);
  const fits = (x: number, y: number): boolean =>
    x > PLAYER_HALF_W + 2 && x < WIDTH - PLAYER_HALF_W - 3 && y > PLAYER_H + 1 && y < HEIGHT - 3 && ph.entityFree(x, y, PLAYER_HALF_W, PLAYER_H);
  // Already standing (the chamber had a floor right under its centre)?
  for (let fy = sy; fy <= sy + 1; fy++) if (arrivalStandable(ctx, sx, fy, avoid, pickups)) return { x: sx, y: fy };

  // The walk starts from the spawn, or the nearest cell around it a body fits in.
  let start: ArrivalPoint | null = fits(sx, sy) ? { x: sx, y: sy } : null;
  for (let r = SETTLE_STEP; !start && r <= 12; r += SETTLE_STEP) {
    for (const [dx, dy] of [[0, -r], [-r, 0], [r, 0], [0, r]] as const) {
      if (fits(sx + dx, sy + dy)) { start = { x: sx + dx, y: sy + dy }; break; }
    }
  }
  if (start) {
    const seen = new Set<number>();
    let frontier: number[] = [start.x + start.y * WIDTH];
    seen.add(frontier[0]);
    let nodes = 0;
    for (let depth = 0; depth <= SETTLE_MAX_DEPTH && frontier.length > 0 && nodes < SETTLE_NODE_BUDGET; depth++) {
      let best: ArrivalPoint | null = null;
      let bestScore = Infinity;
      const next: number[] = [];
      for (const key of frontier) {
        nodes++;
        const x = key % WIDTH;
        const y = (key - x) / WIDTH;
        for (let fy = y; fy < y + SETTLE_STEP; fy++) {
          if (!arrivalStandable(ctx, x, fy, avoid, pickups)) continue;
          const score = Math.abs(x - sx) * 2 + Math.abs(fy - sy);
          if (score < bestScore) { bestScore = score; best = { x, y: fy }; }
        }
        for (const [dx, dy] of [[0, SETTLE_STEP], [-SETTLE_STEP, 0], [SETTLE_STEP, 0], [0, -SETTLE_STEP]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = nx + ny * WIDTH;
          if (seen.has(nk) || !fits(nx, ny)) continue;
          seen.add(nk);
          next.push(nk);
        }
      }
      if (best) return best;
      frontier = next;
    }
  }

  // Nothing within reach: where the straight drop lands, if that is safe.
  for (let fy = sy; fy < HEIGHT - 4; fy++) {
    if (!fits(sx, fy)) break;
    if (!ph.entityFree(sx, fy + 1, PLAYER_HALF_W, 1)) return arrivalStandable(ctx, sx, fy, avoid, pickups) ? { x: sx, y: fy } : spawn;
  }
  return spawn;
}

/**
 * Is this creature a threat to an alchemist arriving at `at`? Living, not a
 * warded boss (their arenas never hold an arrival: settleArrival keeps clear),
 * and within ARRIVAL_CLOSE_RADIUS, or ARRIVAL_SAFE_RADIUS with a clear sight line.
 */
export function arrivalThreat(ctx: Ctx, e: Enemy, at: ArrivalPoint): boolean {
  if (e.hp <= 0 || isWardedBoss(e.kind)) return false;
  const ex = e.x;
  const ey = e.y - 5;
  const d = Math.hypot(ex - at.x, ey - (at.y - 9));
  if (d >= ARRIVAL_SAFE_RADIUS) return false;
  if (d < ARRIVAL_CLOSE_RADIUS) return true;
  return sightClear(ctx.world, at.x, at.y - 9, ex, ey);
}

/** Move a creature to a new home: position, and the tick-built body/mind state rebuilt there. */
export function relocateCreature(e: Enemy, x: number, y: number): void {
  e.x = x;
  e.y = y;
  e.vx = 0;
  e.vy = 0;
  e.fx = 0;
  e.fy = 0;
  e.alerted = false;
  e.rig = undefined;
  e.body = undefined;
  e.weaverLoco = undefined;
  e.mind = undefined;
}
