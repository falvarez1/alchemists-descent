import type { Ctx } from '@/core/types';
import type { World } from '@/sim/World';
import { WORKS_PLANTS, worksPlantRoot } from '@/world/worksHabitat';

const gardens = new WeakMap<World, Array<{ angle: number; velocity: number }>>();

export function habitatBend(world: World, index: number): number { return gardens.get(world)?.[index]?.angle ?? 0; }

/** A continuous contact force and a damped spring let fronds yield, lag behind
 * a passing body, and recover. Crossing a root never flips a sign instantly. */
export function updateHabitatMotion(ctx: Ctx): void {
  if (!ctx.levels.current?.living) return;
  let plants = gardens.get(ctx.world);
  if (!plants) { plants = WORKS_PLANTS.map(() => ({ angle: 0, velocity: 0 })); gardens.set(ctx.world, plants); }
  for (let i = 0; i < WORKS_PLANTS.length; i++) {
    const [x, expectedY, size, hanging] = WORKS_PLANTS[i];
    if (hanging) continue;
    const motion = plants[i], y = worksPlantRoot(ctx.world, x, expectedY, false, true);
    if (y < 0) { motion.angle = 0; motion.velocity = 0; continue; }
    let target = Math.sin(ctx.state.frameCount * .018 + x * .037) * .035;
    const brush = (px: number, py: number, vx: number) => {
      const distance = Math.hypot(px - x, py - y + size * .4);
      if (distance >= 38) return;
      const force = Math.max(-1, Math.min(1, (x - px) / 18));
      target += (force * .5 + vx * .022) * (1 - distance / 38);
    };
    brush(ctx.player.x, ctx.player.y - 8, ctx.player.vx);
    for (const enemy of ctx.enemies) if (enemy.hp > 0) brush(enemy.x, enemy.y - 7, enemy.vx);
    motion.velocity = motion.velocity * .79 + (target - motion.angle) * .055;
    motion.angle = Math.max(-.6, Math.min(.6, motion.angle + motion.velocity));
  }
}
