import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { Enemies } from '@/entities/Enemies';
import { createDefaultStatus } from '@/entities/status';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { COL, tickColossus, colossusDamageScale } from '@/creatures/bosses/colossus';
import { LEV, tickLeviathan } from '@/creatures/bosses/leviathan';
import type { BossHost, BossSense } from '@/creatures/bosses/types';
import { BOSS_WORLD_GRACE, bossTakesWorldHarm, engageBoss, ensureBossBrain } from '@/creatures/bosses/types';

const noop = (): undefined => undefined;

function boss(kind: 'colossus' | 'leviathan', x = 200, y = 150): Enemy {
  const def = ENEMY_DEFS[kind];
  return {
    kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 0,
    bobPhase: 0.3, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus(),
  } as Enemy;
}

function makeCtx(): { ctx: Ctx; events: EventBus; runComplete: ReturnType<typeof vi.fn>; playerDamage: ReturnType<typeof vi.fn> } {
  const events = new EventBus();
  const runComplete = vi.fn();
  events.on('runComplete', runComplete);
  const playerDamage = vi.fn();
  const world = new World(400, 220);
  for (let y = 151; y < 220; y++) for (let x = 0; x < 400; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
  const ctx = {
    events, world,
    state: { mode: 'play', frameCount: 1000, worldSeed: 3, reduceFlashes: true, reduceCameraShake: true, score: 0 },
    player: { x: 100, y: 150, vx: 0, vy: 0, dead: false, grounded: true, perks: {}, hp: 100, maxHp: 100 },
    enemies: [] as Enemy[],
    projectiles: [],
    camera: { x: 0, y: 0, cineDx: 0, cineDy: 0, cineZoom: 1 },
    fx: { bloomKick: 0, screenShake: 0, hitstop: 0 },
    particles: { spawn: noop, burst: noop },
    rigidBodies: { spawn: () => ({}) },
    explosions: { trigger: noop },
    physics: { entityFree: () => false },
    playerCtl: { damage: playerDamage, applyImpulse: noop },
    critters: { list: [], remove: noop },
    params: { global: { bloodAmount: 1 } },
    levels: { current: null, abandonExpedition: noop },
    waves: { kills: 0 },
    audio: new Proxy({}, { get: (_t, key) => (key === 'at' ? (_x: number, _y: number, fn: () => void) => fn() : () => undefined) }),
  } as unknown as Ctx;
  return { ctx, events, runComplete, playerDamage };
}

function host(ctx: Ctx, finish = vi.fn()): BossHost {
  return {
    voice: (_e, fn) => fn(), shakeAt: noop, hasAttackLine: () => true, finishDeath: finish,
    poolVolley: noop, introducing: () => false,
  };
  void ctx;
}

const sense = (over: Partial<BossSense> = {}): BossSense => ({
  targetAlive: true, canAttack: false, pdx: -100, pdy: 0, pDist: 100, debugSuppressed: false, ...over,
});

describe('a boss fight is honest', () => {
  it('the world cannot hurt a boss the player has not engaged, nor inside the grace beat', () => {
    const { ctx } = makeCtx();
    const enemies = new Enemies(ctx);
    const c = boss('colossus');
    ctx.enemies.push(c);
    enemies.damage(c, 50, 0, 0, 'shorted');
    enemies.damage(c, 50, 0, 0, 'flattened');
    expect(c.hp).toBe(c.maxHp);
    const b = ensureBossBrain(c);
    engageBoss(b, ctx.state.frameCount);
    enemies.damage(c, 50, 0, 0, 'detonated');
    expect(c.hp).toBe(c.maxHp);
    ctx.state.frameCount += BOSS_WORLD_GRACE;
    expect(bossTakesWorldHarm(c, ctx.state.frameCount)).toBe(true);
    enemies.damage(c, 50, 0, 0, 'detonated');
    expect(c.hp).toBe(c.maxHp - 50);
  });

  it('a direct blow always lands and starts the fight', () => {
    const { ctx } = makeCtx();
    const enemies = new Enemies(ctx);
    const c = boss('colossus');
    ctx.enemies.push(c);
    enemies.damage(c, 20, 0, 0, 'direct');
    expect(c.hp).toBe(c.maxHp - 20);
    expect(c.boss?.engaged).toBe(true);
  });

  it('its own blast is not a blow', () => {
    const { ctx } = makeCtx();
    const enemies = new Enemies(ctx);
    const c = boss('colossus');
    ctx.enemies.push(c);
    const b = ensureBossBrain(c);
    engageBoss(b, 0);
    b.selfHarmUntil = ctx.state.frameCount + 3;
    enemies.damage(c, 40, 0, 0, 'detonated');
    expect(c.hp).toBe(c.maxHp);
  });
});

describe('the Kiln Colossus', () => {
  it('water on a hot kiln after the fight began is a thermal-shock burst and a kneel', () => {
    const { ctx } = makeCtx();
    const c = boss('colossus');
    const b = ensureBossBrain(c);
    engageBoss(b, 0);
    c.status.wet = 60;
    const hp0 = c.hp;
    tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense());
    expect(hp0 - c.hp).toBeCloseTo(c.maxHp * COL.QUENCH_SHARE, 5);
    expect(b.move).toBe('quench');
    expect(b.exposed).toBeGreaterThan(100);
    expect(colossusDamageScale(c)).toBeCloseTo(COL.EXPOSED_MUL, 5);
    // still wet next tick: one burst, not a drain
    const hp1 = c.hp;
    for (let i = 0; i < 30; i++) { ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense()); }
    expect(c.hp).toBe(hp1);
  });

  it('a puddle it already stood in, or a cold kiln, does not crack it', () => {
    const { ctx } = makeCtx();
    const c = boss('colossus');
    const b = ensureBossBrain(c);
    c.status.wet = 60;
    tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense()); // wet before the fight
    engageBoss(b, ctx.state.frameCount);
    ctx.state.frameCount += 200;
    tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense());
    expect(c.hp).toBe(c.maxHp);
    const cold = boss('colossus');
    const cb = ensureBossBrain(cold);
    engageBoss(cb, 0);
    cb.heat = 0.3;
    cold.status.wet = 60;
    tickColossus(ctx, cold, ENEMY_DEFS.colossus, host(ctx), sense());
    expect(cold.hp).toBe(cold.maxHp);
  });

  it('roars into its phases and sheds its plates in the third', () => {
    const { ctx } = makeCtx();
    const c = boss('colossus');
    const b = ensureBossBrain(c);
    engageBoss(b, 0);
    c.hp = c.maxHp * 0.6;
    tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense());
    expect(b.phase).toBe(2);
    expect(b.move).toBe('roar');
    for (let i = 0; i < COL.ROAR_DUR + 2; i++) { ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense()); }
    c.hp = c.maxHp * 0.2;
    ctx.state.frameCount++;
    tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense());
    expect(b.phase).toBe(3);
    for (let i = 0; i < 3; i++) { ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), sense()); }
    expect(b.plates).toBe(0);
    expect(colossusDamageScale(c)).toBeCloseTo(COL.BARE_MUL, 5);
  });

  it('telegraphs: a stomp launches its floor waves only at the committed beat, and a wave only hurts a grounded alchemist', () => {
    const { ctx, playerDamage } = makeCtx();
    const c = boss('colossus', 200, 150);
    const b = ensureBossBrain(c);
    engageBoss(b, 0);
    c.attackCd = 0;
    b.phase = 2; b.lastMove = 'slam'; // the second phase always answers mid range with a stomp
    ctx.player.x = 120;
    const s = sense({ canAttack: true, pdx: -80, pDist: 80 });
    tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), s);
    expect(b.move).toBe('stomp');
    for (let i = 0; i < COL.STOMP_HIT - 2; i++) { ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), s); }
    expect(b.waves).toHaveLength(0);
    ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), s);
    ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), s);
    expect(b.waves.length).toBe(2);
    ctx.player.grounded = false; // a jump clears it
    for (let i = 0; i < 70; i++) { ctx.state.frameCount++; tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx), s); }
    expect(playerDamage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'colossus-stomp');
  });

  it('dies as a sequence, then hands off to the kill path once', () => {
    const { ctx, runComplete } = makeCtx();
    const enemies = new Enemies(ctx);
    const c = boss('colossus');
    ctx.enemies.push(c);
    enemies.damage(c, c.maxHp + 10, 0, 0, 'direct');
    expect(ctx.enemies).toContain(c);
    expect(c.boss?.move).toBe('dying');
    const finish = vi.fn((e: Enemy) => enemies.kill(e, 0, 0));
    for (let i = 0; i < COL.DEATH_DUR + 5; i++) {
      ctx.state.frameCount++;
      enemies.damage(c, 100, 0, 0, 'direct'); // nothing lands on a dying kiln
      if (ctx.enemies.includes(c)) tickColossus(ctx, c, ENEMY_DEFS.colossus, host(ctx, finish), sense());
    }
    expect(finish).toHaveBeenCalledTimes(1);
    expect(ctx.enemies).not.toContain(c);
    expect(runComplete).toHaveBeenCalledTimes(1);
  });
});

describe('the Sunken Leviathan', () => {
  function pool(ctx: Ctx): void {
    for (let y = 100; y <= 150; y++) for (let x = 150; x <= 250; x++) ctx.world.replaceCellAt(ctx.world.idx(x, y), Cell.Water, 0x2255aa);
  }

  it('a live pool jolts it in bursts, only in a fight the player started', () => {
    const { ctx } = makeCtx();
    pool(ctx);
    const l = boss('leviathan', 200, 148);
    l.timer = 4;
    l.status.electrified = 200;
    tickLeviathan(ctx, l, ENEMY_DEFS.leviathan, host(ctx), sense());
    expect(l.submerged).toBe(true);
    expect(l.hp).toBe(l.maxHp); // not engaged
    const b = ensureBossBrain(l);
    engageBoss(b, ctx.state.frameCount);
    ctx.state.frameCount += BOSS_WORLD_GRACE;
    tickLeviathan(ctx, l, ENEMY_DEFS.leviathan, host(ctx), sense());
    expect(l.maxHp - l.hp).toBeCloseTo(l.maxHp * LEV.JOLT_SHARE, 5);
    expect(b.move).toBe('shock');
    const hp1 = l.hp;
    for (let i = 0; i < LEV.JOLT - 1; i++) { ctx.state.frameCount++; tickLeviathan(ctx, l, ENEMY_DEFS.leviathan, host(ctx), sense()); }
    expect(l.hp).toBe(hp1); // a jolt, then a beat — not a drain
  });

  it('douses its lure before it lunges', async () => {
    const { leviathanLureDim } = await import('@/creatures/bosses/leviathan');
    const { ctx } = makeCtx();
    pool(ctx);
    const l = boss('leviathan', 200, 148);
    l.timer = 4;
    l.alerted = true;
    engageBoss(ensureBossBrain(l), 0);
    tickLeviathan(ctx, l, ENEMY_DEFS.leviathan, host(ctx), sense({ canAttack: true, pdx: 40, pDist: 40 }));
    expect(l.boss?.move).toBe('lunge');
    for (let i = 0; i < 10; i++) { ctx.state.frameCount++; tickLeviathan(ctx, l, ENEMY_DEFS.leviathan, host(ctx), sense({ canAttack: true, pdx: 40, pDist: 40 })); }
    expect(leviathanLureDim(l)).toBe(1);
    expect(l.swoop ?? 0).toBe(0); // still the tell
  });
});
