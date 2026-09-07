import { describe, expect, it, vi } from 'vitest';
import type { Ctx, Enemy, Pickup } from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { createDefaultStatus } from '@/entities/status';
import { makeWeaverLoco, weaverHipWorld } from '@/entities/weaverLocomotion';
import { weaverBodyHit, weaverLegAt, weaverLegGeometry } from '@/creatures/weaverAnatomy';
import { startLegSwing, strikeWeaverLeg, updateLegSwing } from '@/combat/WeaverLimbs';
import { Pickups } from '@/game/Pickups';
import { reviveSavedEnemy, snapshotEnemyForSave } from '@/game/Levels';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { TRICKSHOT_DEFAULTS } from '@/config/trickshot';
import { Projectiles } from '@/combat/Projectiles';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { createGameParams } from '@/config/params';
import { updateHeldLeg } from '@/combat/HeldLeg';

function fixture() {
  const e = { kind: 'weaver', x: 100, y: 80, fx: 0, fy: 0, vx: 0, vy: 0, hp: 260, maxHp: 260, flash: 0,
    timer: 0, attackCd: 0, bobPhase: 0, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0,
    jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus(), weaverLoco: makeWeaverLoco(100, 80) } as Enemy;
  const pickups: Pickup[] = [], player = createPlayer(); player.x = 65; player.y = 80; player.aimAngle = 0;
  const ctx = { world: new World(200, 120), state: { mode: 'play', frameCount: 5 }, player, enemies: [e],
    levels: { current: { pickups } }, fx: { hitstop: 0 }, events: { emit: vi.fn() }, telemetry: { count: vi.fn() },
    audio: { tone: vi.fn(), noiseBurst: vi.fn(), pickup: vi.fn(), at: (_x: number, _y: number, fn: () => void) => fn(),
      finisherWhip: vi.fn(), duck: vi.fn(), shellCrack: vi.fn(), chirr: vi.fn() }, particles: { burst: vi.fn() },
    enemyCtl: { damage: vi.fn((enemy: Enemy, damage: number) => { enemy.hp -= damage; }), gustShove: vi.fn() },
  } as unknown as Ctx;
  return { ctx, e, pickups };
}

describe('Weaver anatomy and salvage', () => {
  it('keeps every socket inside the thorax through crouch, rear, walls and ceilings', () => {
    const { e } = fixture(), loco = e.weaverLoco!;
    for (const ride of [4, 5.5, 11.5, 15.5]) for (const angle of [0, .4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      loco.ride = ride; loco.nx = Math.sin(angle); loco.ny = -Math.cos(angle);
      for (const face of [-1, 1] as const) {
        loco.face = face;
        for (let i = 0; i < 8; i++) {
          const hip = weaverHipWorld(loco, i);
          const dx = hip.x - loco.px, dy = hip.y - loco.py;
          const along = (-loco.ny * dx + loco.nx * dy) * face, out = loco.nx * dx + loco.ny * dy;
          expect(((along - 2) / 7.5) ** 2 + (out / 5.7) ** 2).toBeLessThan(.85);
          expect(weaverLegGeometry(e, i)[0]).toEqual(hip);
          expect(weaverBodyHit(e, hip.x, hip.y)).toBe(true);
        }
      }
    }
  });

  it('uses the visible skeleton as a target and excludes the torso and empty air', () => {
    const { e } = fixture(), joints = weaverLegGeometry(e, 2), knee = joints[2];
    expect(weaverLegAt(e, knee.x, knee.y)).toBeGreaterThanOrEqual(0);
    expect(weaverLegAt(e, e.x + 2, e.y - 9)).toBe(-1);
    expect(weaverLegAt(e, e.x + 80, e.y - 50)).toBe(-1);
  });

  it('accumulates aimed damage, drops one physical limb and never drops it twice after restore', () => {
    const { ctx, e, pickups } = fixture();
    expect(strikeWeaverLeg(ctx, e, 2, 8, 4, 0)).toBe(true);
    expect(pickups).toHaveLength(0);
    strikeWeaverLeg(ctx, e, 2, 8, 4, 0);
    expect(pickups).toHaveLength(1); expect(pickups[0].kind).toBe('weaverleg');
    expect(e.weaverLoco!.legs[2]).toMatchObject({ missing: true, planted: false });
    expect(e.weaverRetreatT).toBeGreaterThan(0);
    const saved = snapshotEnemyForSave(e), revived = reviveSavedEnemy(saved);
    expect(revived.weaverSalvageId).toBe(pickups[0].data.legOwner);
    expect(revived.weaverSalvageId).toBeTruthy();
    expect(revived.weaverMissingLegs).toBe(4);
    expect(revived.weaverLegDamage?.[2]).toBe(14);
    revived.weaverLoco = makeWeaverLoco(revived.x, revived.y);
    expect(strikeWeaverLeg(ctx, revived, 2, 100, 4, 0)).toBe(false);
    expect(pickups).toHaveLength(1);
    e.weaverLegDamage![0] = 10; expect(saved.weaverLegDamage![0]).toBe(0);
  });

  it('collects the severed leg and lands one delayed melee hit per swing', () => {
    const { ctx, e, pickups } = fixture(); strikeWeaverLeg(ctx, e, 0, 18, 4, 0);
    pickups[0].x = ctx.player.x; pickups[0].y = ctx.player.y - 8;
    new Pickups().update(ctx);
    expect(pickups[0].taken).toBe(true); expect(ctx.player.legClub?.durability).toBe(6);
    expect(ctx.player.legClub?.owner).toBe(e.weaverSalvageId);
    vi.mocked(ctx.enemyCtl.damage).mockClear();
    expect(startLegSwing(ctx)).toBe(true);
    for (let i = 0; i < 5; i++) updateLegSwing(ctx);
    expect(ctx.enemyCtl.damage).not.toHaveBeenCalled();
    for (let i = 0; i < 13; i++) updateLegSwing(ctx);
    expect(ctx.enemyCtl.damage).toHaveBeenCalledTimes(1);
    expect(ctx.enemyCtl.damage).toHaveBeenCalledWith(e, 24, 3.2, -1.2);
    for (let i = 0; i < 15; i++) updateLegSwing(ctx);
    expect(ctx.enemyCtl.damage).toHaveBeenCalledTimes(1);
    expect(ctx.player.legClub?.durability).toBe(5);
  });

  it('cannot smack through walls or behind the committed aim; misses do not consume the club', () => {
    const { ctx } = fixture();
    ctx.player.legClub = { durability: 2, length: 34, swingT: 0, cooldown: 0, angle: 0 };
    for (let y = 0; y < 120; y++) ctx.world.replaceCellAt(ctx.world.idx(75, y), Cell.Stone, 0);
    startLegSwing(ctx); for (let i = 0; i < 26; i++) updateLegSwing(ctx);
    expect(ctx.enemyCtl.damage).not.toHaveBeenCalled(); expect(ctx.player.legClub.durability).toBe(2);
    ctx.world.clear(); ctx.player.aimAngle = Math.PI;
    startLegSwing(ctx); for (let i = 0; i < 26; i++) updateLegSwing(ctx);
    expect(ctx.enemyCtl.damage).not.toHaveBeenCalled(); expect(ctx.player.legClub.durability).toBe(2);
    ctx.player.aimAngle = 0; ctx.player.legClub.durability = 1;
    startLegSwing(ctx); for (let i = 0; i < 9; i++) updateLegSwing(ctx);
    expect(ctx.player.legClub).toBeUndefined();
  });

  it('executes the owner finish only while the experiment is enabled', () => {
    for (const enabled of [false, true]) {
      const { ctx, e } = fixture();
      ctx.state.trickshot = { ...TRICKSHOT_DEFAULTS, enabled };
      e.hp = 35; e.weaverSalvageId = 'saved-owner';
      ctx.player.legClub = { owner: 'saved-owner', durability: 6, length: 34, swingT: 0, cooldown: 0, angle: 0 };
      startLegSwing(ctx); for (let i = 0; i < 9; i++) updateLegSwing(ctx);
      expect(e.hp <= 0).toBe(enabled);
      expect(ctx.player.legClub.durability).toBe(5);
      if (enabled) expect(ctx.fx.trickshot?.label).toBe('RETURNED WITH INTEREST');
      else { expect(e.hp).toBe(11); expect(ctx.fx.trickshot).toBeUndefined(); }
    }
  });

  it('hits an exposed ceiling Weaver at its actual body instead of testing cover toward its floor-based anchor', () => {
    const { ctx, e } = fixture();
    e.weaverLoco!.py = 95; e.weaverLoco!.ny = 1; e.weaverLoco!.nx = 0;
    ctx.player.x = 74; ctx.player.y = 106; ctx.player.aimAngle = 0;
    ctx.player.legClub = { durability: 6, length: 34, swingT: 0, cooldown: 0, angle: 0 };
    for (let x = 75; x < 140; x++) ctx.world.replaceCellAt(ctx.world.idx(x, 80), Cell.Metal, 0);
    startLegSwing(ctx); for (let i = 0; i < 26; i++) updateLegSwing(ctx);
    expect(ctx.enemyCtl.damage).toHaveBeenCalledTimes(1);
    expect(ctx.player.legClub.durability).toBe(5);
  });

  it('severs a visible leg with a fractional-coordinate projectile in clear air', () => {
    const { ctx, e, pickups } = fixture(), knee = weaverLegGeometry(e, 2)[2];
    const side = Math.sign(knee.x - e.x) || 1;
    ctx.params = createGameParams(); ctx.enemyCtl.defs = ENEMY_DEFS;
    ctx.projectiles = [{ x: knee.x + side * 8.25, y: knee.y + .13, vx: -side * 1.75, vy: 0,
      type: 'bolt', life: 180, age: 0, charging: false, hostile: false }];
    ctx.particles.spawn = vi.fn();
    ctx.explosions = { trigger: vi.fn() } as unknown as Ctx['explosions'];
    const projectiles = new Projectiles();
    for (let i = 0; i < 12 && ctx.projectiles.length; i++) { ctx.state.frameCount++; projectiles.update(ctx); }
    expect(e.weaverMissingLegs).toBeGreaterThan(0);
    expect(pickups).toHaveLength(1); expect(ctx.projectiles).toHaveLength(0);
    expect(e.hp).toBe(255.5); // limb damage, not an ordinary torso hit
  });

  it('lets the carried thigh lag and recover after acceleration while both joint lengths remain fixed', () => {
    const { ctx } = fixture(), p = ctx.player;
    p.legClub = { durability: 6, length: 34, swingT: 0, cooldown: 0, angle: 0 };
    for (let i = 0; i < 180; i++) updateHeldLeg(ctx);
    const offsets: number[] = [];
    for (let i = 0; i < 110; i++) {
      p.vx = i < 18 ? 2.85 : 0; p.x += p.vx;
      const r = updateHeldLeg(ctx)!;
      expect(Math.hypot(r.hand.x - r.knee.x, r.hand.y - r.knee.y)).toBeCloseTo(34 * .55, 8);
      expect(Math.hypot(r.hip.x - r.knee.x, r.hip.y - r.knee.y)).toBeCloseTo(34 * .45, 8);
      offsets.push(r.hip.x - r.knee.x);
    }
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(6);
    expect(Math.max(...offsets.slice(18, 38)) - Math.min(...offsets.slice(18, 38))).toBeGreaterThan(2);
    expect(Math.abs(offsets.at(-1)!)).toBeLessThan(Math.max(...offsets.map(Math.abs)));
  });

  it('keeps the hinged limb finite through reversals and jumps, and resets a teleported grip without a whip impulse', () => {
    const { ctx } = fixture(), p = ctx.player;
    p.legClub = { durability: 6, length: 44, swingT: 0, cooldown: 0, angle: 0 };
    for (let i = 0; i < 80; i++) {
      p.facing = i < 35 ? 1 : -1; p.x += p.facing * 1.2; p.y += i < 20 ? -1 : i < 40 ? 1 : 0;
      const r = updateHeldLeg(ctx)!;
      expect([r.hip.x, r.hip.y, r.vx, r.vy, r.wrist].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(r.hip.x - r.knee.x, r.hip.y - r.knee.y)).toBeCloseTo(44 * .45, 8);
      expect(Math.abs(r.wristVelocity)).toBeLessThanOrEqual(.8);
    }
    p.x = 150; p.y = 50; p.vx = 0; p.vy = 0;
    const r = updateHeldLeg(ctx)!;
    expect(Math.hypot(r.hand.x - r.previousHand.x, r.hand.y - r.previousHand.y)).toBe(0);
    expect(Math.hypot(r.vx, r.vy)).toBeLessThan(1);
  });
});
