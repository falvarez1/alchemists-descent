import type { Critter, CritterKind, Ctx, Enemy, Projectile } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { OrganismAction } from '@/core/events';
import { blocksEntity, Cell } from '@/sim/CellType';
import { sightClear } from '@/creatures/perception';

/** What an organism may ask of the critter layer that owns it. */
export interface OrganismHost {
  readonly list: readonly Critter[];
  remove(c: Critter): void;
  find(id: string | undefined): Critter | undefined;
}

export function solidAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world, xi = Math.floor(x), yi = Math.floor(y);
  return !w.inBounds(xi, yi) || blocksEntity(w.types[w.idx(xi, yi)]);
}

export function typeAt(ctx: Ctx, x: number, y: number): number {
  const w = ctx.world, xi = Math.floor(x), yi = Math.floor(y);
  return w.inBounds(xi, yi) ? w.types[w.idx(xi, yi)] : Cell.Wall;
}

export function isHot(t: number): boolean {
  return t === Cell.Fire || t === Cell.Lava || t === Cell.Ember;
}

/** Hot cells (fire, lava, embers) in a small box — sampled, not exhaustive. */
export function hotNear(ctx: Ctx, x: number, y: number, r: number): number {
  const w = ctx.world, x0 = Math.floor(x - r), y0 = Math.floor(y - r), x1 = Math.floor(x + r), y1 = Math.floor(y + r);
  let n = 0;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    if (w.inBounds(xx, yy) && isHot(w.types[w.idx(xx, yy)])) n++;
  }
  return n;
}

/** Distance from a point to an axis-aligned box whose bottom-centre is (bx, by). */
function boxGap(x: number, y: number, bx: number, by: number, halfW: number, h: number): number {
  const dx = Math.max(bx - halfW - x, 0, x - (bx + halfW));
  const dy = Math.max(by - h + 1 - y, 0, y - by);
  return Math.hypot(dx, dy);
}

export function playerGap(ctx: Ctx, x: number, y: number): number {
  const p = ctx.player;
  if (p.dead) return Infinity;
  return boxGap(x, y, p.x, p.y, PLAYER_HALF_W, PLAYER_H);
}

/** The living creature whose body is nearest (x, y) within r cells, or null. */
export function enemyWithin(ctx: Ctx, x: number, y: number, r: number, skipBosses = true): Enemy | null {
  let best: Enemy | null = null, bestGap = r;
  for (const e of ctx.enemies) {
    if (e.hp <= 0 || (skipBosses && (e.kind === 'colossus' || e.kind === 'leviathan'))) continue;
    if (Math.abs(e.x - x) > r + 20 || Math.abs(e.y - y) > r + 30) continue;
    const def = ctx.enemyCtl.defs[e.kind];
    const gap = boxGap(x, y, e.x, e.y, def.halfW, def.h);
    if (gap <= bestGap) { best = e; bestGap = gap; }
  }
  return best;
}

/** A projectile inside r cells of (x, y) this tick. */
export function projectileWithin(ctx: Ctx, x: number, y: number, r: number): Projectile | null {
  for (const p of ctx.projectiles) {
    if (p.charging) continue;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy <= r * r) return p;
  }
  return null;
}

/** A living critter (not this one, not already held) within r cells matching `kinds`. */
export function critterWithin(
  host: OrganismHost, self: Critter, x: number, y: number, r: number, kinds: ReadonlySet<CritterKind>,
): Critter | null {
  let best: Critter | null = null, bestD = r * r;
  for (const c of host.list) {
    if (c === self || c.heldBy || (c.dead ?? 0) > 0 || !kinds.has(c.kind)) continue;
    const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy;
    if (d <= bestD) { best = c; bestD = d; }
  }
  return best;
}

export function organismEvent(ctx: Ctx, kind: CritterKind, action: OrganismAction, x: number, y: number): void {
  ctx.events.emit('organism', { kind, action, x, y });
}

/** Is the alchemist standing in liquid (the feet or the shins)? */
export function playerWading(ctx: Ctx): boolean {
  const p = ctx.player, w = ctx.world;
  for (const dy of [1, 3, 6]) {
    const x = Math.floor(p.x), y = Math.floor(p.y - dy);
    if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Water) return true;
  }
  return false;
}

/**
 * How strongly the wand's light reaches (x, y), 0..1. The light workstream's
 * `ctx.lightQuery` is the truth when present; without it (tests, a build
 * without the light layer) a conservative stand-in: the beam is a forward cone
 * from the wand tip, falling off over 110 cells, blocked by rock.
 */
export function wandLightAt(ctx: Ctx, x: number, y: number): number {
  const q = ctx.lightQuery;
  if (q) return q.hooded ? 0 : q.wandLight(x, y);
  const p = ctx.player;
  if (p.dead) return 0;
  const aim = p.aimAngle ?? 0;
  const wx = p.x + Math.cos(aim) * 9, wy = p.y - 9 + Math.sin(aim) * 9;
  const dx = x - wx, dy = y - wy, d = Math.hypot(dx, dy);
  if (d > 110) return 0;
  if (d < 3) return 1;
  const along = (dx * Math.cos(aim) + dy * Math.sin(aim)) / d;
  const omni = Math.max(0, 1 - d / 26) * 0.6;
  const beam = along > 0.16 ? (1 - d / 110) * Math.min(1, (along - 0.16) * 3) : 0;
  // Scaled to the light field's coverage units (a beam reads ~0.05–0.25 there).
  const k = Math.max(omni, beam) * 0.25;
  return k > 0.005 && sightClear(ctx.world, wx, wy, x, y) ? k : 0;
}
