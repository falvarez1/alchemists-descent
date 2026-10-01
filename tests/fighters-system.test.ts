import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import { FighterSystem } from '@/fighters/FighterSystem';
import { FIGHTER_TUNING } from '@/fighters/tuning';

/**
 * The fighter system against a fake world: just enough Ctx for the tick, the cooldown and charge clocks,
 * the modifiers, the enemy effects and the body-owning move. What each KIT does is probed in the real
 * game (scripts/verify-fighter-*.mjs); this holds the machinery every kit stands on.
 */

interface Spy {
  tacticalCalls: number;
  ultimateCalls: number;
  ultimateTicks: number[];
  ultimateEnds: number;
  hurts: Array<{ amount: number; killed: boolean }>;
  playerHurts: number[];
  resets: number;
  bag: Record<string, number>;
}

function makeKit(spy: Spy, opts: { tacticalFires?: boolean; ultimateFires?: boolean; duration?: number } = {}): { def: FighterKitDef } {
  const def: FighterKitDef = {
    id: 'ilyra-voss',
    tacticalCooldown: 100,
    ultimateDuration: opts.duration ?? 30,
    create(): KitInstance {
      return {
        tactical: () => { spy.tacticalCalls++; return opts.tacticalFires !== false; },
        ultimate: () => { spy.ultimateCalls++; return opts.ultimateFires !== false; },
        ultimateTick: (remaining) => { spy.ultimateTicks.push(remaining); },
        ultimateEnd: () => { spy.ultimateEnds++; },
        onEnemyHurt: (_e, amount, _s, killed) => { spy.hurts.push({ amount, killed }); },
        onPlayerHurt: (lost) => { spy.playerHurts.push(lost); },
        reset: () => { spy.resets++; },
        save: () => ({ ...spy.bag }),
        load: (bag) => { spy.bag = { ...bag }; },
      };
    },
  };
  return { def };
}

function newSpy(): Spy {
  return { tacticalCalls: 0, ultimateCalls: 0, ultimateTicks: [], ultimateEnds: 0, hurts: [], playerHurts: [], resets: 0, bag: {} };
}

function makeEnemy(x: number, y: number, hp = 40): Enemy {
  return { x, y, hp, maxHp: hp, kind: 'slime', vx: 0, vy: 0, bobPhase: 0 } as unknown as Enemy;
}

function makeCtx(walls: (x: number, y: number) => boolean = () => false): { ctx: Ctx; step(n?: number): void; enemies: Enemy[] } {
  const events = new EventBus();
  const enemies: Enemy[] = [];
  const player = {
    x: 100, y: 100, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, lastDamageSource: null as string | null,
  };
  const state = { mode: 'play', frameCount: 1, paused: false };
  const ctx = {
    events,
    state,
    player,
    enemies,
    enemyCtl: { defs: { slime: { hp: 40, halfW: 4, h: 8, bounty: 0 } }, damage: () => undefined },
    audio: { sfx: () => undefined },
    particles: { burst: () => undefined },
    physics: {
      // One cell at a time; a wall blocks (and does not move) the body.
      tryMoveEntity: (e: { x: number; y: number }, dx: number, dy: number): boolean => {
        const nx = e.x + dx, ny = e.y + dy;
        if (walls(nx, ny)) return false;
        e.x = nx; e.y = ny;
        return true;
      },
      entityFree: (x: number, y: number): boolean => !walls(x, y),
    },
  } as unknown as Ctx;
  return {
    ctx,
    enemies,
    step: (n = 1) => { for (let i = 0; i < n; i++) { state.frameCount++; sys?.update(ctx); } },
  };
  // (`sys` is bound per test below; declared here so the closure above can see it.)
}

// The step closure needs the system under test: tests assign it right after constructing it.
let sys: FighterSystem | null = null;

function setup(opts: Parameters<typeof makeKit>[1] = {}, walls?: (x: number, y: number) => boolean) {
  const spy = newSpy();
  const world = makeCtx(walls);
  const { def } = makeKit(spy, opts);
  sys = new FighterSystem(world.ctx, () => def);
  sys.equip('ilyra-voss');
  return { spy, world, sys, ctx: world.ctx, player: world.ctx.player, enemies: world.enemies, step: world.step };
}

describe('the fighter system', () => {
  it('is inert for the classic Alchemist', () => {
    const world = makeCtx();
    const classic = new FighterSystem(world.ctx, () => undefined);
    sys = classic;
    expect(classic.id).toBeNull();
    expect(classic.reduceIncoming(12, 'x')).toBe(12);
    expect(classic.moveScale()).toBe(1);
    expect(classic.climbScale()).toBe(1);
    expect(classic.ownsMovement).toBe(false);
    expect(classic.staggerResist).toBe(false);
    expect(classic.concealment()).toBe(0);
    expect(classic.interceptProjectile({} as never)).toBe(false);
    classic.press('tactical');
    world.step(5);
    expect(classic.view.tactical.ready).toBe(false);
  });

  it('latches a tactical press, fires the kit inside the tick, and runs the cooldown', () => {
    const { spy, sys: s, step } = setup();
    step(1);
    expect(s.view.tactical.ready).toBe(true);
    s.press('tactical');
    expect(spy.tacticalCalls).toBe(0); // latched between ticks, not run in the input handler
    step(1);
    expect(spy.tacticalCalls).toBe(1);
    expect(s.view.tactical.ready).toBe(false);
    expect(s.view.tactical.cooldownSeconds).toBe(2);
    s.press('tactical');
    step(1);
    expect(spy.tacticalCalls).toBe(1); // cooling: refused
    expect(s.view.tactical.refusedAt).toBeGreaterThan(0);
    step(100);
    expect(s.view.tactical.ready).toBe(true);
  });

  it('does not spend the cooldown when the kit refuses (no room, nothing to do)', () => {
    const { spy, sys: s, step } = setup({ tacticalFires: false });
    s.press('tactical');
    step(1);
    expect(spy.tacticalCalls).toBe(1);
    expect(s.view.tactical.ready).toBe(true);
    expect(s.view.tactical.usedAt).toBe(-1);
  });

  it('drops a stale press (a paused game) instead of firing it later', () => {
    const { spy, sys: s, ctx, step } = setup();
    s.press('tactical');
    ctx.state.frameCount += FIGHTER_TUNING.pressWindow + 5; // time passes with no tick
    step(1);
    expect(spy.tacticalCalls).toBe(0);
  });

  it('charges the ultimate from blows dealt, harm taken and kills, and spends it whole', () => {
    const { spy, sys: s, player, step } = setup();
    const e = makeEnemy(110, 100, 40);
    step(1);
    s.noteEnemyHurt(e, 10, 'direct', false);
    step(1);
    expect(s.view.ultimate.charge).toBeCloseTo(10 * FIGHTER_TUNING.chargeDealt, 3);
    expect(spy.hurts).toHaveLength(1);
    // World harm counts for a share.
    const before = s.view.ultimate.charge;
    s.noteEnemyHurt(e, 10, 'burning', false);
    step(1);
    expect(s.view.ultimate.charge - before).toBeCloseTo(10 * FIGHTER_TUNING.chargeDealt * FIGHTER_TUNING.chargeWorldShare, 4);
    // Health lost, whatever the road, charges too and reaches the kit.
    player.hp -= 20;
    step(1);
    expect(spy.playerHurts[0]).toBeCloseTo(20, 5);
    // Fill it.
    s.addCharge(1);
    step(1);
    expect(s.view.ultimate.ready).toBe(true);
    s.press('ultimate');
    step(1);
    expect(spy.ultimateCalls).toBe(1);
    expect(s.view.ultimate.charge).toBeLessThan(0.05);
    expect(s.view.ultimate.active).toBeGreaterThan(0.9);
    expect(spy.ultimateTicks[0]).toBe(30);
    step(40);
    expect(spy.ultimateEnds).toBe(1);
    expect(spy.ultimateTicks.at(-1)).toBe(1);
    expect(s.view.ultimate.active).toBe(0);
  });

  it('refuses the ultimate until the bar is full, and ignores charge while it runs', () => {
    const { spy, sys: s, step } = setup();
    s.press('ultimate');
    step(1);
    expect(spy.ultimateCalls).toBe(0);
    s.addCharge(1);
    s.press('ultimate');
    step(1);
    expect(spy.ultimateCalls).toBe(1);
    s.addCharge(0.5); // while it runs
    expect(s.view.ultimate.charge).toBeLessThan(0.05);
  });

  it('absorbs damage with armor first, after the modifiers, and reports a full absorb as zero', () => {
    const { sys: s } = setup();
    s.setArmorMax(30, true);
    expect(s.reduceIncoming(10, 'x')).toBe(0);
    expect(s.armor).toBe(20);
    expect(s.reduceIncoming(35, 'x')).toBe(15);
    expect(s.armor).toBe(0);
    s.setMod('guard', 60, { damageTaken: 0.5 });
    expect(s.reduceIncoming(10, 'x')).toBe(5);
    s.addArmor(8);
    expect(s.armor).toBe(8);
    s.setArmorMax(5);
    expect(s.armor).toBe(5);
  });

  it('combines modifiers and lets them lapse', () => {
    const { sys: s, step } = setup();
    s.setMod('a', 30, { moveScale: 1.2, damageTaken: 0.5, concealment: 0.3 });
    s.setMod('b', 90, { moveScale: 1.5, concealment: 0.6, staggerResist: true, climbScale: 2 });
    expect(s.moveScale()).toBeCloseTo(1.8, 5);
    expect(s.climbScale()).toBe(2);
    expect(s.concealment()).toBeCloseTo(0.6, 5);
    expect(s.staggerResist).toBe(true);
    step(31);
    expect(s.moveScale()).toBeCloseTo(1.5, 5);
    expect(s.reduceIncoming(10, 'x')).toBe(10);
    step(70);
    expect(s.moveScale()).toBe(1);
    expect(s.staggerResist).toBe(false);
    expect(s.concealment()).toBe(0);
  });

  it('slows, stuns and reveals foes for their own clocks, and forgets them', () => {
    const { sys: s, enemies, step } = setup();
    const e = makeEnemy(110, 100);
    enemies.push(e);
    expect(s.enemySlow(e)).toBe(1);
    s.slowEnemy(e, 0.5, 40);
    s.stunEnemy(e, 10);
    s.revealEnemy(e, 50, [1, 0, 0]);
    s.markEnemy(e, 20);
    expect(s.enemySlow(e)).toBe(0.5);
    expect(s.isRevealed(e)).toBe(true);
    expect(s.isMarked(e)).toBe(true);
    expect(s.drawables.length).toBe(1);
    step(3);
    expect(e.knockT).toBeGreaterThanOrEqual(2); // a stun holds the AI off
    step(45);
    expect(s.enemySlow(e)).toBe(1);
    expect(s.isMarked(e)).toBe(false);
    step(30);
    expect(s.isRevealed(e)).toBe(false);
    step(8);
    expect(s.drawables.length).toBe(0);
  });

  it('finds foes near a point, nearest first, by body centre', () => {
    const { sys: s, enemies } = setup();
    enemies.push(makeEnemy(150, 100), makeEnemy(110, 100), makeEnemy(400, 100));
    const near = s.enemiesNear(100, 96, 60);
    expect(near.map((e) => e.x)).toEqual([110, 150]);
  });

  it('carries out a body-owning move cell by cell and stops at a wall', () => {
    const { sys: s, player, step } = setup({}, (x) => x >= 120);
    let ended: string | null = null;
    s.startMove({ ticks: 20, step: () => ({ dx: 3, dy: 0 }), face: true, onEnd: (r) => { ended = r; } });
    expect(s.ownsMovement).toBe(true);
    step(30);
    expect(player.x).toBe(119); // a wall at 120 stopped the dash
    expect(ended).toBe('blocked');
    expect(s.ownsMovement).toBe(false);
    expect(player.vx).toBeLessThanOrEqual(3);
  });

  it('ends a move that has run its course, and keeps invulnerability topped up', () => {
    const { sys: s, player, step } = setup();
    let ended: string | null = null;
    s.startMove({ ticks: 4, step: () => ({ dx: 2, dy: 0 }), invuln: 5, exitVx: 1, onEnd: (r) => { ended = r; } });
    step(1);
    expect(player.invuln).toBeGreaterThanOrEqual(5);
    step(8);
    expect(ended).toBe('done');
    expect(player.x).toBe(108);
    expect(player.vx).toBe(1);
  });

  it('cancels effects on death, a respawn and a new floor, and keeps the numbers across a floor', () => {
    const { spy, sys: s, player, ctx, step } = setup();
    s.setMod('m', 600, { moveScale: 2 });
    s.addCharge(0.5);
    s.startMove({ ticks: 100, step: () => ({ dx: 1, dy: 0 }) });
    ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(spy.resets).toBe(1);
    expect(s.ownsMovement).toBe(false);
    expect(s.moveScale()).toBe(1);
    step(1);
    expect(s.view.ultimate.charge).toBeCloseTo(0.5, 2); // a new floor keeps the bar
    player.dead = true;
    step(1);
    player.dead = false;
    ctx.events.emit('playerRespawned', undefined);
    expect(s.view.ultimate.charge).toBe(0);
  });

  it('saves and restores its clocks, the charge, the armor and the kit bag', () => {
    const { spy, sys: s, step } = setup();
    spy.bag = { pressure: 7 };
    s.setArmorMax(40, true);
    s.addCharge(0.4);
    s.press('tactical');
    step(10);
    const snap = s.snapshot();
    expect(snap).toMatchObject({ v: 1, id: 'ilyra-voss', kit: { pressure: 7 } });
    expect(snap!.tacticalCooldown).toBeGreaterThan(0);
    spy.bag = {};
    s.restore({ ...snap!, charge: 5, tacticalCooldown: -3, kit: { pressure: 9, junk: Number.NaN } });
    expect(s.view.ultimate.charge).toBe(1); // clamped
    expect(s.view.tactical.cooldown).toBe(0); // clamped
    expect(spy.bag).toEqual({ pressure: 9 }); // non-finite dropped
    expect(new FighterSystem(setup().ctx, () => undefined).snapshot()).toBeNull();
  });

  it('puts the equipped fighter in the view and clears it when none is chosen', () => {
    const { sys: s } = setup();
    expect(s.view.id).toBe('ilyra-voss');
    expect(s.view.tactical.name).toBe('Flash Crucible');
    expect(s.view.ultimate.name).toBe('Phoenix Draft');
    s.equip(null);
    expect(s.id).toBeNull();
    expect(s.view.tactical.name).toBe('');
  });

  it('keeps the hit-point constants it moves the body with in step with the engine', () => {
    expect(PLAYER_HALF_W).toBe(4);
    expect(PLAYER_H).toBe(17);
  });
});
