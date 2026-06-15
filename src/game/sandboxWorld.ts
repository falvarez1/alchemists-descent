import type { Ctx } from '@/core/types';
import { World } from '@/sim/World';
import { resetCombatTransients } from '@/game/transients';

export function ensureSandboxWorldDetached(ctx: Ctx, reason = 'SANDBOX WORLD DETACHED FROM EXPEDITION'): boolean {
  const runtime = ctx.levels.current;
  if (!runtime || runtime.def.id === 'custom' || ctx.world !== runtime.world) return false;

  const scratch = new World(runtime.world.width, runtime.world.height);
  scratch.types.set(runtime.world.types);
  scratch.colors.set(runtime.world.colors);
  scratch.life.set(runtime.world.life);
  scratch.charge.set(runtime.world.charge);
  scratch.moved.fill(0);
  scratch.movedTick = runtime.world.movedTick;
  scratch.simBounds.x0 = runtime.world.simBounds.x0;
  scratch.simBounds.x1 = runtime.world.simBounds.x1;
  scratch.simBounds.y0 = runtime.world.simBounds.y0;
  scratch.simBounds.y1 = runtime.world.simBounds.y1;

  ctx.world = scratch;
  ctx.enemies.length = 0;
  resetCombatTransients(ctx, { simulationAccumulator: true });
  ctx.events.emit('toast', { text: reason });
  return true;
}
