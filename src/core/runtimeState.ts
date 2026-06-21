import type { Ctx, Projectile } from '@/core/types';
import { World } from '@/sim/World';

export type ProjectileResetMode = 'clear-all' | 'keep-friendly' | 'keep-all';

export interface CombatTransientResetOptions {
  projectiles?: ProjectileResetMode;
  shockwaves?: boolean;
  particles?: boolean;
  lightning?: boolean;
  wands?: boolean;
  heldInputs?: boolean;
  digBeam?: boolean;
  simulationAccumulator?: boolean;
}

const DEFAULT_RESET: Required<CombatTransientResetOptions> = {
  projectiles: 'clear-all',
  shockwaves: true,
  particles: true,
  lightning: true,
  wands: true,
  heldInputs: true,
  digBeam: true,
  simulationAccumulator: false,
};

export function cancelChargingBlackHole(ctx: Ctx, options: { removeProjectile?: boolean } = {}): Projectile | null {
  const input = ctx.input;
  if (!input) return null;
  const projectile = input.activeChargingBlackHole;
  if (!projectile) return null;
  projectile.charging = false;
  input.activeChargingBlackHole = null;
  if (options.removeProjectile === true) {
    const idx = ctx.projectiles?.indexOf(projectile) ?? -1;
    if (idx >= 0) ctx.projectiles.splice(idx, 1);
  }
  return projectile;
}

export function resetHeldSpellInputs(ctx: Ctx): void {
  const input = ctx.input;
  if (!input) return;
  const keys = input.keys;
  if (!keys) return;
  keys.left = false;
  keys.right = false;
  keys.up = false;
  keys.jump = false;
  keys.wallJump = false;
  keys.down = false;
  keys.grab = false;
  input.isDrawing = false;
  input.lastX = null;
  input.lastY = null;
  input.buildSpellHeld = false;
  input.bombCharge = -1;
  input.siphonHeld = false;
  input.pourHeld = false;
  input.drinkHeld = false;
  if (ctx.player) ctx.player.firing = false;
}

export function resetCombatTransients(ctx: Ctx, options: CombatTransientResetOptions = {}): void {
  const opts = { ...DEFAULT_RESET, ...options };
  const charging = cancelChargingBlackHole(ctx);

  if (opts.projectiles === 'clear-all' && ctx.projectiles) {
    ctx.projectiles.length = 0;
  } else if (opts.projectiles === 'keep-friendly' && ctx.projectiles) {
    let write = 0;
    for (let read = 0; read < ctx.projectiles.length; read++) {
      const projectile = ctx.projectiles[read];
      if (projectile.hostile || projectile === charging) continue;
      ctx.projectiles[write++] = projectile;
    }
    ctx.projectiles.length = write;
  }

  if (opts.shockwaves && ctx.shockwaves) ctx.shockwaves.length = 0;
  if (opts.particles) ctx.particles?.clear();
  if (opts.lightning) ctx.lightning?.clear();
  if (opts.wands) ctx.wands?.clearTransientState?.();
  if (opts.heldInputs) {
    if (ctx.input?.releaseHeldInput) ctx.input.releaseHeldInput();
    else resetHeldSpellInputs(ctx);
    cancelChargingBlackHole(ctx);
  }
  if (opts.digBeam && ctx.fx) ctx.fx.digBeam = null;
  if (opts.simulationAccumulator && ctx.simulation) ctx.simulation.accumulator = 0;
}

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
