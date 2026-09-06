import { describe, expect, it, vi } from 'vitest';
import type { Ctx, Enemy, Pickup } from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Pickups } from '@/game/Pickups';
import { releaseWeaverLeg, updateLooseWeaverLeg, looseLegPose } from '@/combat/LooseWeaverLeg';
import { updateHeldLeg } from '@/combat/HeldLeg';
import { getAimGuide } from '@/combat/AimGuide';
import { TRICKSHOT_DEFAULTS } from '@/config/trickshot';

function fixture() {
  const player = createPlayer(), pickups: Pickup[] = [];
  player.x = 60; player.y = 95;
  player.legClub = { durability: 4, owner: 'original-weaver', length: 34, angle: 0, cooldown: 0, swingT: 0 };
  const ctx = { player, world: new World(300, 180), state: { mode: 'play', frameCount: 1 },
    input: { mouse: { x: 230, y: 85 } }, levels: { current: { pickups } }, enemies: [], projectiles: [],
    audio: { noiseBurst: vi.fn(), pickup: vi.fn() }, particles: { burst: vi.fn() },
    telemetry: { count: vi.fn() }, events: { emit: vi.fn() }, fx: { hitstop: 0 },
    enemyCtl: { damage: vi.fn((e: Enemy, n: number) => { e.hp -= n; }) },
  } as unknown as Ctx;
  for (let x = 0; x < 300; x++) ctx.world.replaceCellAt(ctx.world.idx(x, 160), Cell.Stone, 0);
  updateHeldLeg(ctx);
  return { ctx, player, pickups };
}

describe('Weaver leg equipment and release', () => {
  it('drops once, clears held fire, and stays discarded while the wizard stands nearby', () => {
    const { ctx, player, pickups } = fixture(); player.firing = true; player.firePressed = true;
    expect(releaseWeaverLeg(ctx, false)).toBe(true);
    expect(releaseWeaverLeg(ctx, false)).toBe(false);
    expect(player.legClub).toBeUndefined(); expect(player.firing).toBe(false); expect(player.firePressed).toBe(false);
    expect(player.fireBlockedUntilRelease).toBe(true); expect(pickups).toHaveLength(1);
    const p = pickups[0];
    // Keep the observer beside the falling tool; there is no pickup timeout.
    for (let i = 0; i < 180; i++) {
      player.x = p.x; player.y = p.y + 8; new Pickups().update(ctx);
    }
    expect(p.taken).toBe(false); expect(player.legClub).toBeUndefined();
    expect(p.data).toMatchObject({ legDurability: 4, legOwner: 'original-weaver', legPickupBlocked: true, legThrown: false });
  });

  it('preserves ownership and wear through a saved drop and ordinary re-collection', () => {
    const { ctx, player, pickups } = fixture(); releaseWeaverLeg(ctx, false);
    player.x = 230; new Pickups().update(ctx);
    pickups[0] = JSON.parse(JSON.stringify(pickups[0])) as Pickup;
    const dropped = pickups[0]; player.x = dropped.x; player.y = dropped.y + 8;
    new Pickups().update(ctx);
    expect(dropped.taken).toBe(true);
    expect(player.legClub).toMatchObject({ durability: 4, owner: 'original-weaver', length: 34 });
  });

  it('throws with movement momentum and keeps both segments joined during free flight', () => {
    const still = fixture(), moving = fixture(); moving.player.vx = 2.85;
    releaseWeaverLeg(still.ctx, true); releaseWeaverLeg(moving.ctx, true);
    expect(moving.pickups[0].vx).toBeGreaterThan(still.pickups[0].vx);
    for (let i = 0; i < 10; i++) {
      const p = moving.pickups[0]; updateLooseWeaverLeg(moving.ctx, p);
      const r = looseLegPose(p)!;
      expect([r.hand.x, r.hip.y, p.vx, p.vy].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(r.hand.x - r.knee.x, r.hand.y - r.knee.y)).toBeCloseTo(34 * .55, 1);
      expect(Math.hypot(r.hip.x - r.knee.x, r.hip.y - r.knee.y)).toBeCloseTo(34 * .45, 1);
    }
    expect(moving.pickups[0].x).toBeGreaterThan(140);
  });

  it('lands one projectile hit, spends one use, and remains recoverable', () => {
    const { ctx, pickups } = fixture();
    const enemy = { kind: 'golem', x: 130, y: 105, hp: 100 } as Enemy; ctx.enemies.push(enemy);
    releaseWeaverLeg(ctx, true);
    for (let i = 0; i < 50; i++) updateLooseWeaverLeg(ctx, pickups[0]);
    expect(enemy.hp).toBe(76); expect(ctx.enemyCtl.damage).toHaveBeenCalledTimes(1);
    expect(pickups[0].data).toMatchObject({ legDurability: 3, legThrown: false });
    expect(pickups[0].taken).toBe(false);
  });

  it('cannot tunnel through a one-cell wall or hit the creature behind it', () => {
    const { ctx, pickups } = fixture();
    for (let y = 0; y < 180; y++) ctx.world.replaceCellAt(ctx.world.idx(105, y), Cell.Stone, 0);
    ctx.enemies.push({ kind: 'golem', x: 130, y: 105, hp: 100 } as Enemy);
    releaseWeaverLeg(ctx, true);
    for (let i = 0; i < 80; i++) updateLooseWeaverLeg(ctx, pickups[0]);
    expect(ctx.enemyCtl.damage).not.toHaveBeenCalled();
    const pose = looseLegPose(pickups[0])!;
    expect(Math.max(pose.hand.x, pose.knee.x, pose.hip.x)).toBeLessThan(105);
    expect(pickups[0].data.legDurability).toBe(4);
  });

  it('splinters on the last connected throw and never regenerates a usable pickup', () => {
    const { ctx, player, pickups } = fixture(); player.legClub!.durability = 1;
    ctx.enemies.push({ kind: 'golem', x: 130, y: 105, hp: 100 } as Enemy);
    releaseWeaverLeg(ctx, true);
    for (let i = 0; i < 50 && !pickups[0].taken; i++) updateLooseWeaverLeg(ctx, pickups[0]);
    expect(pickups[0].taken).toBe(true); expect(pickups[0].data.legDurability).toBe(0);
  });

  it('hides the stowed wand trajectory while a leg is equipped', () => {
    const { ctx } = fixture(); ctx.state.trickshot = { ...TRICKSHOT_DEFAULTS, enabled: true };
    expect(getAimGuide(ctx)).toBeNull();
  });
});
