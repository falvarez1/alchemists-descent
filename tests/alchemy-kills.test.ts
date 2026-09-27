import { describe, expect, it } from 'vitest';

import {
  ALCHEMY_CHAIN_TICKS,
  ALCHEMY_ENGAGE_CELLS,
  ALCHEMY_HEAL,
  ALCHEMY_KICK_TICKS,
  ALCHEMY_MANA_REFILL,
  ALCHEMY_TOUCH_TICKS,
  AlchemyKills,
  alchemyBonusGold,
  causeForCell,
  causeForExplosion,
  creditedToPlayer,
  GOLD_PER_GRAIN,
  type HitMemory,
  killingCause,
  nextChain,
} from '@/combat/AlchemyKills';
import { EventBus } from '@/core/events';
import type { AlchemyKillInfo } from '@/core/run';
import type { Ctx, Enemy } from '@/core/types';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { Enemies } from '@/entities/Enemies';
import { createDefaultStatus } from '@/entities/status';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function mem(source: HitMemory['source'], frame: number, touchFrame = -1e9, kickFrame = -1e9): HitMemory {
  return { source, frame, touchFrame, kickFrame };
}

function enemy(kind: Enemy['kind'], overrides: Partial<Enemy> = {}): Enemy {
  return {
    kind, x: 100, y: 60, fx: 0, fy: 0, vx: 0, vy: 0, hp: 30, maxHp: 30, flash: 0, timer: 0, attackCd: 0,
    bobPhase: 0, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus(), ...overrides,
  };
}

interface Spawned { type: number | null; opts?: { deposit?: boolean } }

function harness(frame = 1000) {
  const events = new EventBus();
  const spawned: Spawned[] = [];
  const wand = { mana: 10, frame: { manaMax: 100 } };
  const ctx = {
    events,
    world: new World(200, 120),
    state: { mode: 'play', frameCount: frame, worldSeed: 7, reduceFlashes: false },
    fx: { bloomKick: 0, hitstop: 0, screenShake: 0 },
    player: { x: 120, y: 64, vx: 0, dead: false, hp: 50, maxHp: 100 },
    enemies: [] as Enemy[],
    params: { global: { bloodAmount: 0, goreBlood: 1, goreSlime: 1, goreOoze: 1 } },
    particles: {
      spawn: (_x: number, _y: number, _vx: number, _vy: number, type: number | null, _c: number, _l: number, opts?: { deposit?: boolean }) => {
        spawned.push({ type, opts });
      },
      burst: () => undefined,
    },
    wands: { wands: [wand, { mana: 0, frame: { manaMax: 100 } }], active: 0 },
    audio: { at: () => undefined, tone: () => undefined },
    telemetry: { count: () => undefined },
    enemyCtl: { defs: ENEMY_DEFS },
  } as unknown as Ctx;
  const kills: AlchemyKillInfo[] = [];
  events.on('alchemyKill', (info) => kills.push(info));
  const alchemy = new AlchemyKills(ctx);
  return { ctx, alchemy, kills, spawned, wand };
}

describe('alchemical kill classification', () => {
  it('lets the wand keep its own kills and names the world’s', () => {
    expect(killingCause(mem('direct', 100), false, 100)).toBeNull();
    expect(killingCause(mem('burned', 100), false, 101)).toBe('burned');
    expect(killingCause(mem('detonated', 100), false, 100)).toBe('detonated');
    expect(killingCause(undefined, false, 100)).toBeNull();
  });

  it('only trusts the blow that actually landed the kill (stale memory is not credit)', () => {
    expect(killingCause(mem('burned', 100), false, 103)).toBe('burned');
    expect(killingCause(mem('burned', 100), false, 104)).toBeNull();
  });

  it('breaks a frozen body into SHATTERED, whatever physical blow did it', () => {
    expect(killingCause(mem('direct', 50), true, 50)).toBe('shattered');
    expect(killingCause(mem('flattened', 50), true, 50)).toBe('shattered');
    expect(killingCause(mem('impaled', 50), true, 50)).toBe('shattered');
    // A frozen body that burns away still burned.
    expect(killingCause(mem('burned', 50), true, 50)).toBe('burned');
  });

  it('maps hazard cells and explosion sources to causes', () => {
    expect(causeForCell(Cell.Lava)).toBe('rendered');
    expect(causeForCell(Cell.Fire)).toBe('burned');
    expect(causeForCell(Cell.Acid)).toBe('dissolved');
    expect(causeForCell(Cell.Toxic)).toBe('poisoned');
    expect(causeForCell(Cell.Steam)).toBe('steeped');
    expect(causeForExplosion(undefined)).toBe('direct');
    expect(causeForExplosion('self-explosion')).toBe('direct');
    expect(causeForExplosion('lightning')).toBe('direct');
    expect(causeForExplosion('gunpowder')).toBe('detonated');
    expect(causeForExplosion('barrel-explosion')).toBe('detonated');
    expect(causeForExplosion('bomber')).toBe('detonated');
  });

  it('credits the alchemist generously: engagement range, a recent touch, a recent kick', () => {
    const frame = 10_000;
    expect(creditedToPlayer(mem('burned', frame), ALCHEMY_ENGAGE_CELLS, frame, true)).toBe(true);
    expect(creditedToPlayer(mem('burned', frame), ALCHEMY_ENGAGE_CELLS + 1, frame, true)).toBe(false);
    expect(creditedToPlayer(mem('burned', frame, frame - ALCHEMY_TOUCH_TICKS), 900, frame, true)).toBe(true);
    expect(creditedToPlayer(mem('burned', frame, frame - ALCHEMY_TOUCH_TICKS - 1), 900, frame, true)).toBe(false);
    expect(creditedToPlayer(mem('rendered', frame, -1e9, frame - ALCHEMY_KICK_TICKS), 900, frame, true)).toBe(true);
    expect(creditedToPlayer(mem('burned', frame), 10, frame, false)).toBe(false);
  });

  it('chains kills inside the window and starts over after it', () => {
    expect(nextChain(0, -1e9, 500)).toBe(1);
    expect(nextChain(1, 500, 500 + ALCHEMY_CHAIN_TICKS)).toBe(2);
    expect(nextChain(2, 500, 520)).toBe(3);
    expect(nextChain(3, 500, 500 + ALCHEMY_CHAIN_TICKS + 1)).toBe(1);
  });

  it('pays whole gold grains that grow with the chain and cap', () => {
    for (const bounty of [15, 30, 70, 110, 450]) {
      for (let chain = 1; chain <= 8; chain++) {
        const gold = alchemyBonusGold(bounty, chain);
        expect(gold % GOLD_PER_GRAIN).toBe(0);
        expect(gold).toBeGreaterThanOrEqual(GOLD_PER_GRAIN);
        if (chain > 1) expect(gold).toBeGreaterThanOrEqual(alchemyBonusGold(bounty, chain - 1));
      }
      expect(alchemyBonusGold(bounty, 5)).toBe(alchemyBonusGold(bounty, 9));
    }
    expect(alchemyBonusGold(70, 1)).toBe(30); // 10 + 24.5 -> 34.5 -> 30
    expect(alchemyBonusGold(70, 3)).toBe(70); // x2
  });
});

describe('AlchemyKills system', () => {
  it('announces, chains and pays a material kill in real gold, mana and a sip of life', () => {
    const { ctx, alchemy, kills, spawned, wand } = harness(1000);
    const a = enemy('rillback');
    alchemy.noteHit(a, 'shorted');
    const info = alchemy.onKill(a);
    expect(info).not.toBeNull();
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ kind: 'rillback', cause: 'shorted', chain: 1 });
    const grains = spawned.filter((s) => s.type === Cell.Gold);
    expect(grains.length * GOLD_PER_GRAIN).toBe(kills[0].bonusGold);
    expect(grains.every((g) => g.opts?.deposit === true)).toBe(true);
    expect(wand.mana).toBeCloseTo(10 + 100 * ALCHEMY_MANA_REFILL);
    expect(ctx.player.hp).toBe(50 + ALCHEMY_HEAL);

    ctx.state.frameCount += 60;
    const b = enemy('weaver');
    alchemy.noteHit(b, 'burned');
    alchemy.onKill(b);
    expect(kills[1]).toMatchObject({ cause: 'burned', chain: 2 });
    expect(alchemy.chain).toBe(2);

    ctx.state.frameCount += ALCHEMY_CHAIN_TICKS + 1;
    expect(alchemy.chain).toBe(0);
    const c = enemy('bat');
    alchemy.noteHit(c, 'detonated');
    alchemy.onKill(c);
    expect(kills[2].chain).toBe(1);
  });

  it('stays silent for the wand’s own kills and for creatures nobody touched', () => {
    const { ctx, alchemy, kills } = harness();
    const a = enemy('slime');
    alchemy.noteHit(a, 'direct');
    expect(alchemy.onKill(a)).toBeNull();
    const far = enemy('slime', { x: 120 + ALCHEMY_ENGAGE_CELLS + 50 });
    alchemy.noteHit(far, 'burned');
    expect(alchemy.onKill(far)).toBeNull();
    const untouched = enemy('slime');
    expect(alchemy.onKill(untouched)).toBeNull();
    ctx.state.mode = 'build';
    const built = enemy('slime');
    alchemy.noteHit(built, 'burned');
    expect(alchemy.onKill(built)).toBeNull();
    expect(kills).toHaveLength(0);
  });

  it('credits a far death to a kick that launched the body', () => {
    const { ctx, alchemy, kills } = harness(2000);
    const far = enemy('bat', { x: 120 + 600 });
    alchemy.noteKick(far);
    ctx.state.frameCount += 90;
    alchemy.noteHit(far, 'rendered');
    alchemy.onKill(far);
    expect(kills[0]?.cause).toBe('rendered');
  });

  it('resets the chain when the level changes', () => {
    const { ctx, alchemy } = harness(3000);
    const a = enemy('slime');
    alchemy.noteHit(a, 'burned');
    alchemy.onKill(a);
    expect(alchemy.chain).toBe(1);
    ctx.events.emit('levelChanged', { id: 'd2', name: 'X', depth: 2 } as never);
    expect(alchemy.chain).toBe(0);
  });
});

describe('Enemies report their killing blows', () => {
  function enemiesHarness() {
    const h = harness(4000);
    const ctx = h.ctx as Ctx & { enemies: Enemy[] };
    Object.assign(ctx, {
      alchemy: h.alchemy,
      camera: { x: 0, y: 0 },
      levels: { current: null },
      waves: { kills: 0 },
      explosions: { trigger: () => undefined },
      lightning: { spark: () => undefined },
      rigidBodies: { bodies: [] },
    });
    Object.assign(ctx.audio, { at: () => undefined, deathCry: () => undefined, noiseBurst: () => undefined, zap: () => undefined });
    Object.assign(ctx.player, { perks: {} });
    const enemies = new Enemies(ctx);
    (ctx as { enemyCtl: unknown }).enemyCtl = enemies;
    return { ...h, ctx, enemies };
  }

  it('a gunpowder blast that kills is DETONATED; a spark bolt that kills is not', () => {
    const { ctx, enemies, kills } = enemiesHarness();
    const a = enemy('slime', { hp: 5 });
    const b = enemy('slime', { hp: 5 });
    ctx.enemies.push(a, b);
    enemies.damage(a, 10, 0, 0, 'detonated');
    enemies.damage(b, 10, 0, 0);
    expect(kills.map((k) => k.cause)).toEqual(['detonated']);
    expect(ctx.enemies).toHaveLength(0);
  });

  it('a poured hazard strikes as its material, the Flame Jet as the wand', () => {
    const { ctx, enemies, kills } = enemiesHarness();
    const a = enemy('slime', { hp: 0.5 });
    ctx.enemies.push(a);
    expect(enemies.splashHazard(a.x, a.y - 3, Cell.Acid)).toBe(true);
    expect(kills[0]?.cause).toBe('dissolved');
    const b = enemy('slime', { hp: 0.5 });
    ctx.enemies.push(b);
    expect(enemies.splashHazard(b.x, b.y - 3, Cell.Fire, 'direct')).toBe(true);
    expect(kills).toHaveLength(1);
  });

  it('being shot always provokes: the creature gets a confident fix on the shooter', () => {
    const { ctx, enemies } = enemiesHarness();
    const w = enemy('weaver', { hp: 100, maxHp: 100, x: 60 });
    ctx.enemies.push(w);
    enemies.damage(w, 5, 1, 0);
    expect(w.alerted).toBe(true);
    expect(w.mind?.targetX).toBe(ctx.player.x);
    expect(w.mind?.confidence ?? 0).toBeGreaterThanOrEqual(0.8);
    expect(w.mind?.irritation ?? 0).toBeGreaterThanOrEqual(0.75);
    const bat = enemy('bat', { hp: 16, maxHp: 16 });
    ctx.enemies.push(bat);
    enemies.damage(bat, 2, 1, 0);
    expect(bat.fear ?? 0).toBeGreaterThanOrEqual(0.45); // a bat bolts rather than presses
  });
});
