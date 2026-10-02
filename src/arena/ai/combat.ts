import type { CastAction, Ctx, Projectile } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { MeView, ShotView } from '@/arena/ai/worldView';
import { AI_BEHAVIOR } from '@/config/aiBehavior';
import { PLAYER_PROJECTILE_SPEED, projectileGravity } from '@/combat/projectileDefs';
import { Cell } from '@/sim/CellType';

export interface WeaponView { speed: number; gravity: number; minRange: number; maxRange: number; cycleTicks?: number }

/** Read the equipped cast, including speed modifiers and self-blast radius. */
export function weaponView(ctx: Pick<Ctx, 'params'>, action: CastAction | undefined): WeaponView {
  const sp = ctx.params.spells;
  const scale = action?.speedMul ?? 1;
  const card = action?.card ?? 'spark';
  switch (card) {
    case 'bomb': return { speed: (sp.bomb.velocityForce ?? 7.5) * scale, gravity: projectileGravity('bomb'), minRange: (sp.bomb.explosionRadius ?? 52) * 1.5 * Math.min(1.45, 1 + ((action?.dmgMul ?? 1) - 1) * 0.15) + 12, maxRange: 220 };
    case 'spark': return { speed: (sp.bolt.velocityForce ?? 9.5) * scale, gravity: 0, minRange: (sp.bolt.explosionRadius ?? 6.5) * 1.5 + 6, maxRange: 250 };
    case 'icelance': return { speed: PLAYER_PROJECTILE_SPEED.icelance * scale, gravity: 0, minRange: 0, maxRange: 280 };
    case 'frostshard': return { speed: PLAYER_PROJECTILE_SPEED.frostshard * scale, gravity: projectileGravity('iceshard'), minRange: 0, maxRange: 250 };
    case 'wisp': return { speed: PLAYER_PROJECTILE_SPEED.wisp * scale, gravity: 0, minRange: 0, maxRange: 220 };
    case 'meteor': return { speed: PLAYER_PROJECTILE_SPEED.meteor * scale, gravity: projectileGravity('meteor'), minRange: 75, maxRange: 240 };
    // The stream's direct-damage cone reaches 36 cells from the wand tip (nine from the shoulder).
    case 'flame': return { speed: 0, gravity: 0, minRange: 0, maxRange: 45 };
    case 'lightning': return { speed: 0, gravity: 0, minRange: 0, maxRange: sp.lightning.range ?? 180 };
    case 'dig': return { speed: 0, gravity: 0, minRange: 0, maxRange: sp.dig.range ?? 80 };
    default: return { speed: 0, gravity: 0, minRange: 20, maxRange: 180 };
  }
}

/** Rival spells are friendly to their caster, but dangerous to the other slot. */
export function threatensSlot(shot: Pick<Projectile, 'hostile' | 'owner'>, slot: number, dueling: boolean): boolean {
  return shot.hostile || (dueling && (shot.owner ?? 0) !== slot);
}

export interface Incoming { shot: ShotView; ticks: number }

/** Predict the first crossing of our body using only a delayed observation of each shot.
 * Terrain must still allow the shot to reach us. Old motion is extrapolated, never replaced with live velocity.
 */
export function incomingShot(me: MeView, shots: readonly ShotView[], clear: (x0: number, y0: number, x1: number, y1: number) => boolean): Incoming | null {
  let hit: Incoming | null = null;
  for (const shot of shots) {
    const age = shot.age ?? 0;
    const sx = shot.x + shot.vx * age;
    const sy = shot.y + shot.vy * age;
    for (let t = 1; t <= AI_BEHAVIOR.dodgeLookahead; t++) {
      const dx = sx + (shot.vx - me.vx) * t - me.x;
      const dy = sy + (shot.vy - me.vy) * t - me.sy;
      // Include half a step so a fast projectile cannot skip straight over the body.
      if (Math.abs(dx) > 7 + Math.abs(shot.vx - me.vx) * 0.5 || Math.abs(dy) > 10 + Math.abs(shot.vy - me.vy) * 0.5) continue;
      if ((!hit || t < hit.ticks) && clear(sx, sy, me.x + me.vx * t, me.sy + me.vy * t)) hit = { shot, ticks: t };
      break;
    }
  }
  return hit;
}

export function dangerousCell(type: number): boolean {
  return type === Cell.Lava || type === Cell.Acid || type === Cell.Fire || type === Cell.Ember;
}

/** Local landing/footing check; uses real cells and the normal body collision test. */
export function safeFooting(ctx: Pick<Ctx, 'world' | 'physics'>, x: number, y: number): boolean {
  if (!ctx.physics.entityFree(x, y, PLAYER_HALF_W, PLAYER_H)) return false;
  for (const dx of [-4, 0, 4]) {
    for (const dy of [-8, -1, 1, 3]) {
      const gx = Math.round(x + dx), gy = Math.round(y + dy);
      if (!ctx.world.inBounds(gx, gy) || dangerousCell(ctx.world.types[ctx.world.idx(gx, gy)])) return false;
    }
  }
  for (let drop = 1; drop <= 12; drop++) if (ctx.physics.cellBlocks(Math.round(x), Math.round(y + drop))) return true;
  return false;
}

/** A crater is traversable when every cell along the descent is safe and its floor is nearby. */
export function safeDrop(ctx: Pick<Ctx, 'world' | 'physics'>, x: number, y: number): boolean {
  for (let down = 0; down <= 48; down++) {
    for (const dx of [-PLAYER_HALF_W, 0, PLAYER_HALF_W]) {
      const gx = Math.round(x + dx), gy = Math.round(y + down);
      if (!ctx.world.inBounds(gx, gy) || dangerousCell(ctx.world.types[ctx.world.idx(gx, gy)])) return false;
    }
    if (safeFooting(ctx, x, y + down)) return true;
  }
  return false;
}
