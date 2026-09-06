import type { Critter, Ctx, Enemy } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { sightClear } from './perception';
import { nodeImmersion } from './body';

/** Surface skimming and current drag are separate from pursuit: dry targets
 * do not give an immersed animal lift, and a strong sluice can carry it away. */
export function carryRillback(ctx: Ctx, enemy: Enemy): void {
  const x = enemy.x + enemy.fx, y = enemy.y - 4 + enemy.fy;
  const immersion = nodeImmersion(ctx.world, x, y);
  if ((enemy.rillWet ?? 0) >= .28 && (enemy.swoop ?? 0) === 0) {
    const above = nodeImmersion(ctx.world, x, y - 6);
    if (above < 1) {
      enemy.vy += (1 - above) * .22;
      if (enemy.vy < 0) enemy.vy *= .75;
    }
  }
  const strength = .065 * immersion;
  enemy.vx += (ctx.world.flow.x(x, y) - enemy.vx * .35) * strength;
  enemy.vy += ctx.world.flow.y(x, y) * strength;
}

/** Pool predation consumes an existing resident, never a decorative duplicate. */
export function rillbackPrey(ctx: Ctx, enemy: Enemy): Critter | null {
  if (!enemy.mind || enemy.mind.hunger < .18 || enemy.mind.intent !== 'forage' || (enemy.rillWet ?? 0) < .28) return null;
  let best: Critter | null = null, distance = 130 * 130;
  for (const prey of ctx.critters.list) {
    if (prey.kind !== 'fish' || ctx.world.type(Math.round(prey.x), Math.round(prey.y)) !== Cell.Water) continue;
    const d = (prey.x - enemy.x) ** 2 + (prey.y - enemy.y + 4) ** 2;
    if (d >= distance || !sightClear(ctx.world, enemy.x, enemy.y - 4, prey.x, prey.y)) continue;
    best = prey; distance = d;
  }
  return best;
}

export function feedRillback(ctx: Ctx, enemy: Enemy, prey: Critter): boolean {
  if (!enemy.mind || Math.hypot(prey.x - enemy.x, prey.y - enemy.y + 4) > 9 || !ctx.critters.list.includes(prey)) return false;
  ctx.critters.remove(prey);
  enemy.mind.hunger = .06;
  enemy.mind.intent = 'rest';
  enemy.mind.commitUntil = ctx.state.frameCount + 150;
  enemy.rillFeedT = 80;
  enemy.attackCd = Math.max(enemy.attackCd, 90);
  enemy.vx *= .35; enemy.vy *= .35;
  return true;
}

/** The lash hits only when the rendered tendril reaches its committed endpoint. */
export function advanceRootLash(ctx: Ctx, enemy: Enemy, canDamage = true): void {
  if (!enemy.rootLashT) return;
  enemy.rootLashT--;
  if (enemy.rootLashT === 5 && canDamage && enemy.rootLashX !== undefined && enemy.rootLashY !== undefined) {
    const x = enemy.rootLashX, y = enemy.rootLashY;
    if (!ctx.player.dead && Math.hypot(ctx.player.x - x, ctx.player.y - 9 - y) < 10 &&
        Math.hypot(x - enemy.x, y - enemy.y + 7) < 66 && sightClear(ctx.world, enemy.x, enemy.y - 7, x, y)) {
      ctx.playerCtl.damage(13 * (enemy.dmgK ?? 1), Math.sign(x - enemy.x || 1) * 3.2, -1.8, 'rootloper-lash');
    }
  }
  if (enemy.rootLashT === 0) { enemy.rootLashX = undefined; enemy.rootLashY = undefined; }
}
