import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { Ctx } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';
import { COLOR_FN } from '@/sim/colors';
import { isGas, isLiquid } from '@/sim/CellType';

/**
 * Small shared helpers for kits: where the fighter is aiming, a safe spot to blink to, a safe way to
 * write cells, a sight line to the first solid. Pure functions of the Ctx, no state; anything with a
 * lifetime lives in the system (`FighterSystem`) so a floor change can clear it.
 *
 * Gameplay randomness must be seeded (entityRandom / fxRandom from '@/core/simRandom'): the lint rule
 * covers this directory.
 */

export interface Aim {
  /** Unit vector toward the cursor from the shoulder. */
  x: number;
  y: number;
  /** +1 right, -1 left (the sign of x; right when straight up or down). */
  facing: number;
  angle: number;
}

/** The fighter's aim, as the wand fires along it. */
export function aimOf(ctx: Ctx): Aim {
  const a = ctx.player.aimAngle;
  const x = Math.cos(a), y = Math.sin(a);
  return { x, y, facing: x < -1e-6 ? -1 : 1, angle: a };
}

/** The shoulder the wand ray leaves from (feet - 9, prone feet - 4). */
export function shoulderOf(ctx: Ctx): { x: number; y: number } {
  const p = ctx.player;
  return { x: p.x, y: p.y - (p.crawling ? 4 : 9) };
}

/**
 * The nearest standable spot to (x, y) within `reach` cells: room for the body, a floor underfoot, no
 * hazard in it. Searches outward in rings; null when there is none. Never inside rock.
 */
export function findLanding(ctx: Ctx, x: number, y: number, reach = 12): { x: number; y: number } | null {
  const free = (px: number, py: number): boolean => ctx.physics.entityFree(px, py, PLAYER_HALF_W, PLAYER_H);
  const standable = (px: number, py: number): boolean => free(px, py) && !ctx.physics.entityFree(px, py + 1, PLAYER_HALF_W, 1);
  const bx = Math.round(x), by = Math.round(y);
  if (standable(bx, by)) return { x: bx, y: by };
  for (let r = 1; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (standable(bx + dx, by + dy)) return { x: bx + dx, y: by + dy };
      }
    }
  }
  return null;
}

/** March from (x, y) along (dx, dy) for up to `range` cells and return the last open point before the first solid, and whether one was hit. */
export function castToSolid(ctx: Ctx, x: number, y: number, dx: number, dy: number, range: number): { x: number; y: number; hit: boolean; hitX: number; hitY: number } {
  const w = ctx.world;
  let lx = x, ly = y;
  for (let d = 1; d <= range; d++) {
    const px = Math.round(x + dx * d), py = Math.round(y + dy * d);
    if (!w.inBounds(px, py)) return { x: lx, y: ly, hit: true, hitX: px, hitY: py };
    if (blocksEntity(w.types[w.idx(px, py)])) return { x: lx, y: ly, hit: true, hitX: px, hitY: py };
    lx = px; ly = py;
  }
  return { x: lx, y: ly, hit: false, hitX: lx, hitY: ly };
}

/**
 * Write `cell` into the open cells (air, gas, or liquid when `intoLiquid`) of a disc, never into solids
 * and never over the body of the player or a foe. `life` seeds the cell's countdown for the materials
 * that use one (smoke, fire, steam). Returns how many cells were written. Writes go through
 * `replaceCellAt`, the safe primitive; a caller that wants a ragged edge passes `keep` < 1 with
 * a seeded roll.
 */
export function stampDisc(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  cell: number,
  opts: { life?: number; keep?: (dx: number, dy: number) => boolean; intoLiquid?: boolean; yScale?: number } = {},
): number {
  const w = ctx.world;
  const color = COLOR_FN[cell];
  if (!color) return 0;
  const ys = opts.yScale ?? 1;
  let n = 0;
  const ri = Math.ceil(r);
  for (let dy = -Math.ceil(ri * ys); dy <= Math.ceil(ri * ys); dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + (dy / ys) * (dy / ys) > r * r) continue;
      if (opts.keep && !opts.keep(dx, dy)) continue;
      const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y), t = w.types[i];
      const open = t === 0 || isGas(t) || (opts.intoLiquid === true && isLiquid(t));
      if (!open) continue;
      w.replaceCellAt(i, cell, color());
      if (opts.life !== undefined) w.life[i] = opts.life;
      n++;
    }
  }
  return n;
}

/** Count cells of `type` within a box around (x, y): a cheap read of the grid for a kit that asks "am I in smoke?". */
export function countCells(ctx: Ctx, type: number, x: number, y: number, rx: number, ry: number): number {
  const w = ctx.world;
  let n = 0;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (w.inBounds(px, py) && w.types[w.idx(px, py)] === type) n++;
    }
  }
  return n;
}

/** Screen punch for an ability's landing: shake and a bloom kick, scaled and capped the way explosions are. */
export function punch(ctx: Ctx, shake = 0.02, bloom = 0.35): void {
  ctx.fx.screenShake = Math.min(Math.max(ctx.fx.screenShake, 0) + shake, 0.05);
  ctx.fx.bloomKick = Math.min(Math.max(ctx.fx.bloomKick, 0) + bloom, 1.2);
}
