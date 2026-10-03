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
    const gravity = shot.gravity ?? 0;
    const sx = shot.x + shot.vx * age;
    const sy = shot.y + shot.vy * age + gravity * age * (age + 1) * .5;
    const vy = shot.vy + gravity * age;
    let px = sx, py = sy;
    for (let t = 1; t <= AI_BEHAVIOR.dodgeLookahead; t++) {
      if (age + t >= (shot.life ?? Infinity)) break;
      const x = sx + shot.vx * t, y = sy + vy * t + gravity * t * (t + 1) * .5;
      if (!clear(px, py, x, y)) break;
      px = x; py = y;
      const dx = x - me.vx * t - me.x;
      const dy = y - me.vy * t - me.sy;
      // Include half a step so a fast projectile cannot skip straight over the body.
      if (Math.abs(dx) > 7 + Math.abs(shot.vx - me.vx) * 0.5 || Math.abs(dy) > 10 + Math.abs(vy + gravity * t - me.vy) * 0.5) continue;
      if (!hit || t < hit.ticks) hit = { shot, ticks: t };
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
  for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) {
    for (let dy = -PLAYER_H; dy <= 3; dy++) {
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
    for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) {
      const gx = Math.round(x + dx), gy = Math.round(y + down);
      if (!ctx.world.inBounds(gx, gy) || dangerousCell(ctx.world.types[ctx.world.idx(gx, gy)])) return false;
    }
    // Test the eventual standing pose. Support twelve cells below a midair
    // pose does not establish that the descent itself is safe.
    if (ctx.physics.cellBlocks(Math.round(x), Math.round(y + down + 1))) return safeFooting(ctx, x, y + down);
  }
  return false;
}

/** Scan the body corridor, rather than trusting only the far endpoint. The
 * walk's support is checked separately so traversable craters remain usable. */
export function safeTravel(ctx: Pick<Ctx, 'world' | 'physics'>, x: number, y: number, toX: number): boolean {
  const steps = Math.ceil(Math.abs(toX - x));
  let previous = Infinity, initial = 0, final = 0;
  for (let i = 0; i <= steps; i++) {
    const cx = x + (toX - x) * i / Math.max(1, steps);
    const exposure = bodyHazardExposure(ctx, cx, y);
    if (!Number.isFinite(exposure)) return false;
    // Fire can appear around the bot after it commits. Let it leave that
    // patch without walking through a fresh one or increasing its exposure.
    if (i === 0) initial = exposure;
    if (exposure > previous) return false;
    previous = final = exposure;
  }
  return final === 0 || final < initial;
}

function bodyHazardExposure(ctx: Pick<Ctx, 'world'>, x: number, y: number): number {
  let exposure = 0;
  for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) for (let dy = -PLAYER_H; dy <= 3; dy++) {
    const gx = Math.round(x + dx), gy = Math.round(y + dy);
    if (!ctx.world.inBounds(gx, gy)) return Infinity;
    if (dangerousCell(ctx.world.types[ctx.world.idx(gx, gy)])) exposure++;
  }
  return exposure;
}

/** A mobility skill may cross air above a safe shallow landing. Its entire
 * body corridor must be free; this never blesses a dash through a wall. */
export function safeMobilityLanding(ctx: Pick<Ctx, 'world' | 'physics'>, x: number, y: number, toX: number): boolean {
  if (!safeDrop(ctx, toX, y) || !safeTravel(ctx, x, y, toX)) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(toX - x) / 2));
  for (let i = 1; i <= steps; i++) {
    if (!ctx.physics.entityFree(x + (toX - x) * i / steps, y, PLAYER_HALF_W, PLAYER_H)) return false;
  }
  return true;
}

/** Find a clear rise-and-cross lane above a nearby hazard or cover wall.
 * Fuel bounds the lift; the ordinary collision query and a safe descent
 * bound the crossing. A hazardous or unsupported far side is never accepted. */
export function safeHopClearance(ctx: Pick<Ctx, 'world' | 'physics'>, x: number, y: number, toX: number, maxRise: number): number | null {
  for (let rise = 8; rise <= maxRise; rise += 4) {
    if (!safeMobilityLanding(ctx, x, y - rise, toX)) continue;
    let clear = true, previous = bodyHazardExposure(ctx, x, y);
    for (let up = 2; up <= rise; up += 2) {
      const exposure = bodyHazardExposure(ctx, x, y - up);
      if (!ctx.physics.entityFree(x, y - up, PLAYER_HALF_W, PLAYER_H) || !Number.isFinite(exposure) || exposure > previous) { clear = false; break; }
      previous = exposure;
    }
    if (clear) return y - rise;
  }
  return null;
}

/** Search the bounded hop's reachable landing interval for safe footing. */
export function hazardHopClearance(ctx: Pick<Ctx, 'world' | 'physics'>, x: number, y: number, dir: number, lookahead: number, maxRise: number): { clearY: number; landingX: number } | null {
  for (let distance = lookahead * 2; distance <= lookahead * 4; distance += 2) {
    const topY = safeHopClearance(ctx, x, y, x + dir * distance, maxRise);
    if (topY !== null) return { clearY: topY, landingX: x + dir * distance };
  }
  return null;
}

/** Check the actual launch direction and ballistic arc until its progress
 * toward the target reaches the full distance, including vertical shots.
 * Instant/straight spells retain their direct aim line.
 * Every segment uses the game's terrain query, including thin ceilings. */
export function weaponLaneClear(
  origin: { x: number; y: number }, target: { x: number; y: number }, aim: { x: number; y: number },
  weapon: WeaponView, clear: (x0: number, y0: number, x1: number, y1: number) => boolean,
): boolean {
  if (weapon.speed <= 0 || weapon.gravity === 0) return clear(origin.x, origin.y, aim.x, aim.y);
  const dx = aim.x - origin.x, dy = aim.y - origin.y, length = Math.hypot(dx, dy) || 1;
  const vx = dx / length * weapon.speed;
  let vy = dy / length * weapon.speed, x = origin.x, y = origin.y;
  const tx = target.x - origin.x, ty = target.y - origin.y, distance = Math.hypot(tx, ty);
  if (distance === 0) return clear(x, y, aim.x, aim.y);
  // Project discrete ballistic displacement v*t + g*t*(t+1)/2 onto
  // the full target direction. Its first positive crossing gives flight
  // time without dividing by a zero or tiny horizontal launch velocity.
  const a = .5 * weapon.gravity * ty / distance;
  const b = (vx * tx + vy * ty) / distance + a;
  const discriminant = b * b + 4 * a * distance;
  if (discriminant < 0 || (a <= 0 && b <= 0)) return false;
  const flight = Math.abs(a) < 1e-8 ? distance / b
    : b > 0 ? 2 * distance / (b + Math.sqrt(discriminant))
      : (Math.sqrt(discriminant) - b) / (2 * a);
  // Never approve a lane after tracing only an arbitrary initial portion.
  if (!Number.isFinite(flight) || flight <= 0 || flight > 120) return false;
  const steps = Math.max(1, Math.ceil(flight));
  for (let i = 0; i < steps; i++) {
    vy += weapon.gravity;
    const nx = x + vx, ny = y + vy;
    if (!clear(x, y, nx, ny)) return false;
    x = nx; y = ny;
  }
  return true;
}
