import { describe, expect, it } from 'vitest';
import type { Ctx, Projectile } from '@/core/types';
import { ensureSandboxWorldDetached } from '@/core/runtimeState';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

function ctxWithRuntime(world: World, id = 'd1'): Ctx {
  const keys = { left: true, right: false, up: false, jump: true, wallJump: true, down: false, grab: false };
  const charging: Projectile = {
    x: 1,
    y: 2,
    vx: 0,
    vy: 0,
    type: 'blackhole',
    life: 60,
    age: 0,
    charging: true,
    hostile: false,
  };
  const toasts: string[] = [];
  return {
    world,
    enemies: [{ kind: 'slime' }],
    projectiles: [charging],
    shockwaves: [{ x: 1, y: 1, r: 1, life: 1, maxLife: 1 }],
    particles: { clear: () => undefined },
    lightning: { clear: () => undefined },
    simulation: { accumulator: 3 },
    input: {
      keys,
      mouse: { x: 0, y: 0 },
      isDrawing: true,
      lastX: 10,
      lastY: 11,
      buildSpellHeld: true,
      bombCharge: 0.5,
      activeChargingBlackHole: charging,
      siphonHeld: true,
      pourHeld: true,
      drinkHeld: true,
    },
    player: { firing: true },
    fx: { digBeam: { x: 1 }, hitstop: 0 },
    levels: {
      current: { def: { id }, world },
    },
    events: {
      emit: (_type: string, payload: { text?: string }) => {
        if (payload.text) toasts.push(payload.text);
      },
    },
    __toasts: toasts,
  } as unknown as Ctx;
}

describe('sandbox world detachment', () => {
  it('clones a live expedition world before Sandbox raw-grid mutation', () => {
    const runtimeWorld = new World(16, 16);
    runtimeWorld.types[0] = Cell.Water;
    runtimeWorld.life[0] = 12;
    const ctx = ctxWithRuntime(runtimeWorld);

    expect(ensureSandboxWorldDetached(ctx)).toBe(true);

    expect(ctx.world).not.toBe(runtimeWorld);
    expect(ctx.world.types[0]).toBe(Cell.Water);
    expect(ctx.world.life[0]).toBe(12);
    ctx.world.types[0] = Cell.Empty;
    ctx.world.life[0] = 0;
    expect(runtimeWorld.types[0]).toBe(Cell.Water);
    expect(runtimeWorld.life[0]).toBe(12);
    expect(ctx.enemies).toHaveLength(0);
    expect(ctx.projectiles).toHaveLength(0);
    expect(ctx.input.activeChargingBlackHole).toBeNull();
    expect(ctx.input.keys.left).toBe(false);
    expect(ctx.player.firing).toBe(false);
    expect((ctx as unknown as { __toasts: string[] }).__toasts).toEqual([
      'SANDBOX WORLD DETACHED FROM EXPEDITION',
    ]);
  });

  it('does not detach disposable custom runtimes', () => {
    const runtimeWorld = new World(16, 16);
    const ctx = ctxWithRuntime(runtimeWorld, 'custom');

    expect(ensureSandboxWorldDetached(ctx)).toBe(false);
    expect(ctx.world).toBe(runtimeWorld);
  });
});
