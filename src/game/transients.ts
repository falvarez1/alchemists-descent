import type { Ctx, Projectile } from '@/core/types';

export type ProjectileResetMode = 'clear-all' | 'keep-friendly' | 'keep-all';

export interface CombatTransientResetOptions {
  projectiles?: ProjectileResetMode;
  shockwaves?: boolean;
  particles?: boolean;
  lightning?: boolean;
  heldInputs?: boolean;
  digBeam?: boolean;
  simulationAccumulator?: boolean;
}

const DEFAULT_RESET: Required<CombatTransientResetOptions> = {
  projectiles: 'clear-all',
  shockwaves: true,
  particles: true,
  lightning: true,
  heldInputs: true,
  digBeam: true,
  simulationAccumulator: false,
};

export function cancelChargingBlackHole(ctx: Ctx, options: { removeProjectile?: boolean } = {}): Projectile | null {
  const projectile = ctx.input.activeChargingBlackHole;
  if (!projectile) return null;
  projectile.charging = false;
  ctx.input.activeChargingBlackHole = null;
  if (options.removeProjectile === true) {
    const idx = ctx.projectiles.indexOf(projectile);
    if (idx >= 0) ctx.projectiles.splice(idx, 1);
  }
  return projectile;
}

export function resetHeldSpellInputs(ctx: Ctx): void {
  const keys = ctx.input.keys;
  keys.left = false;
  keys.right = false;
  keys.up = false;
  keys.jump = false;
  keys.wallJump = false;
  keys.down = false;
  keys.grab = false;
  ctx.input.isDrawing = false;
  ctx.input.lastX = null;
  ctx.input.lastY = null;
  ctx.input.buildSpellHeld = false;
  ctx.input.bombCharge = -1;
  ctx.input.siphonHeld = false;
  ctx.input.pourHeld = false;
  ctx.input.drinkHeld = false;
  ctx.player.firing = false;
}

export function resetCombatTransients(ctx: Ctx, options: CombatTransientResetOptions = {}): void {
  const opts = { ...DEFAULT_RESET, ...options };
  const charging = cancelChargingBlackHole(ctx);

  if (opts.projectiles === 'clear-all') {
    ctx.projectiles.length = 0;
  } else if (opts.projectiles === 'keep-friendly') {
    const kept: Projectile[] = ctx.projectiles.filter((projectile) => !projectile.hostile && projectile !== charging);
    ctx.projectiles.length = 0;
    ctx.projectiles.push(...kept);
  }

  if (opts.shockwaves) ctx.shockwaves.length = 0;
  if (opts.particles) ctx.particles.clear();
  if (opts.lightning) ctx.lightning.clear();
  if (opts.heldInputs) {
    if (ctx.input.releaseHeldInput) ctx.input.releaseHeldInput();
    else resetHeldSpellInputs(ctx);
    cancelChargingBlackHole(ctx);
  }
  if (opts.digBeam) ctx.fx.digBeam = null;
  if (opts.simulationAccumulator) ctx.simulation.accumulator = 0;
}
