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
  resolveStatusOrigin,
  SPELL_STATUS_TICKS,
  spellTouched,
  statusBlowCause,
} from '@/combat/AlchemyKills';
import { EventBus } from '@/core/events';
import type { AlchemyKillInfo } from '@/core/run';
import type { Ctx, Enemy, StatusBlow } from '@/core/types';
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

/** A status sample on a dry body with nothing touching it; override what the grid says. */
function blow(overrides: Partial<StatusBlow> = {}): StatusBlow {
  return {
    burn: 0, shock: 0, toxic: 0, burning: false, electrified: false,
    fueled: false, heatContact: false, conducted: false, liquidCharge: false, chargeContact: false, ...overrides,
  };
}

describe('whose fire, whose current: the attribution rule', () => {
  it('names a status origin from the grid and the wand’s last strike', () => {
    // (prev, active, worldForced, contact, strayIsWorld, touched)
    // gone out: forgotten
    expect(resolveStatusOrigin('world', false, true, true, true, false)).toBeNull();
    // fuel or a conductor makes it the world's, whoever struck
    expect(resolveStatusOrigin(null, true, true, true, false, true)).toBe('world');
    expect(resolveStatusOrigin('spell', true, true, false, false, true)).toBe('world');
    // new, right after the wand struck: the spell's own (even across its own spatter)
    expect(resolveStatusOrigin(null, true, false, true, true, true)).toBe('spell');
    // new with no strike behind it: a fire walked into, a current across blood — the world's
    expect(resolveStatusOrigin(null, true, false, true, true, false)).toBe('world');
    // ...but bare blast residue in air or stone cannot travel: it is the bolt's
    expect(resolveStatusOrigin(null, true, false, true, false, false)).toBe('spell');
    // the world's stays the world's; the spell's keeps unless relit outside the window
    expect(resolveStatusOrigin('world', true, false, true, false, true)).toBe('world');
    expect(resolveStatusOrigin('spell', true, false, false, true, false)).toBe('spell');
    expect(resolveStatusOrigin('spell', true, false, true, true, false)).toBe('world');
  });

  it('weighs the world’s shares against the wand’s; the larger dealt the blow', () => {
    // all the wand's own fire and current: a direct blow
    expect(statusBlowCause({ burn: 0.3, shock: 3.2, toxic: 0 }, 'spell', 'spell')).toBe('direct');
    // the QA case: a slime burning in oil the spark lit, the spark's current still on it
    expect(statusBlowCause({ burn: 0.3, shock: 0.2, toxic: 0 }, 'world', 'spell')).toBe('burned');
    // ...but the tick the spark's zap lands (3 hp) is the spark's blow
    expect(statusBlowCause({ burn: 0.3, shock: 3.2, toxic: 0 }, 'world', 'spell')).toBe('direct');
    expect(statusBlowCause({ burn: 0.3, shock: 0.6, toxic: 0 }, 'world', 'world')).toBe('shorted');
    // a pool of sludge poisons; a speck of cooked gore beside the wand's own fire does not
    expect(statusBlowCause({ burn: 0.3, shock: 0, toxic: 1.2 }, 'spell', null)).toBe('poisoned');
    expect(statusBlowCause({ burn: 0.3, shock: 0.2, toxic: 0.4 }, 'spell', 'spell')).toBe('direct');
  });

  it('counts a strike as the wand’s only when it was not the boot', () => {
    expect(spellTouched(mem('direct', 100, 100), 100 + SPELL_STATUS_TICKS)).toBe(true);
    expect(spellTouched(mem('direct', 100, 100), 101 + SPELL_STATUS_TICKS)).toBe(false);
    expect(spellTouched(mem('direct', 100, 100, 100), 100)).toBe(false); // a kick
  });
});

describe('AlchemyKills.noteStatus: spell kills stay spell kills', () => {
  it('a spark that leaves a dry slime crackling on stone is a spell kill', () => {
    const { ctx, alchemy, kills } = harness(5000);
    const e = enemy('slime');
    alchemy.noteHit(e, 'direct'); // the bolt lands
    for (let t = 2; t <= 40; t += 2) {
      ctx.state.frameCount = 5000 + t;
      // live air from its blast: charged, not a conductor
      expect(alchemy.noteStatus(e, blow({ shock: t === 2 ? 3.2 : 0.2, electrified: true, chargeContact: t < 10 }))).toBe('direct');
    }
    expect(alchemy.onKill(e)).toBeNull();
    expect(kills).toHaveLength(0);
  });

  it('a spark that sets a dry slime alight is a spell kill, however long it burns', () => {
    const { ctx, alchemy, kills } = harness(6000);
    const e = enemy('slime');
    alchemy.noteHit(e, 'direct');
    ctx.state.frameCount += 4;
    alchemy.noteStatus(e, blow({ burn: 0.3, burning: true, heatContact: true }));
    // it runs off and burns out its own fire well past the window
    for (let t = 0; t < 300; t += 2) {
      ctx.state.frameCount += 2;
      alchemy.noteStatus(e, blow({ burn: 0.3, burning: true }));
    }
    expect(alchemy.onKill(e)).toBeNull();
    expect(kills).toHaveLength(0);
  });

  it('a spark into oil the slime sits in is FLAMBÉED while its current still crackles on it', () => {
    const { ctx, alchemy, kills } = harness(7000);
    const e = enemy('slime');
    alchemy.noteHit(e, 'direct');
    ctx.state.frameCount += 2;
    alchemy.noteStatus(e, blow({ burn: 0.3, shock: 3.2, burning: true, electrified: true, fueled: true, heatContact: true, chargeContact: true }));
    ctx.state.frameCount += 2;
    alchemy.noteStatus(e, blow({ burn: 0.3, shock: 0.2, burning: true, electrified: true, fueled: true, heatContact: true }));
    expect(alchemy.onKill(e)?.cause).toBe('burned');
    expect(kills).toHaveLength(1);
  });

  it('a wet body, or charged water or metal, SHORTS it — even when the spark was aimed at it', () => {
    const { ctx, alchemy, kills } = harness(8000);
    const wet = enemy('slime');
    alchemy.noteHit(wet, 'direct');
    ctx.state.frameCount += 2;
    expect(alchemy.noteStatus(wet, blow({ shock: 0.6, electrified: true, conducted: true, chargeContact: true }))).toBe('shorted');
    expect(alchemy.onKill(wet)?.cause).toBe('shorted');
    // nobody cast at this one: the current crossed a blood pool to reach it
    const bystander = enemy('slime');
    alchemy.noteStatus(bystander, blow({ shock: 3.2, electrified: true, liquidCharge: true, chargeContact: true }));
    expect(alchemy.onKill(bystander)?.cause).toBe('shorted');
    expect(kills.map((k) => k.cause)).toEqual(['shorted', 'shorted']);
  });

  it('a slime that hops into a missed bolt’s live air is still the spell’s, not SHORTED', () => {
    const { ctx, alchemy, kills } = harness(8500);
    const e = enemy('slime');
    alchemy.noteHit(e, 'direct');
    ctx.state.frameCount += SPELL_STATUS_TICKS + 20; // the next bolt missed; its air is still live
    expect(alchemy.noteStatus(e, blow({ shock: 3.2, electrified: true, chargeContact: true }))).toBe('direct');
    expect(alchemy.onKill(e)).toBeNull();
    // its own spatter under it, charged by the wand's hit, is not a pool it was shorted in
    const bled = enemy('slime');
    alchemy.noteHit(bled, 'direct');
    ctx.state.frameCount += 2;
    expect(alchemy.noteStatus(bled, blow({ shock: 0.2, electrified: true, liquidCharge: true, chargeContact: true }))).toBe('direct');
    expect(kills).toHaveLength(0);
  });

  it('a fire walked into, or relit long after the wand’s strike, is the world’s', () => {
    const { ctx, alchemy } = harness(9000);
    const e = enemy('slime');
    alchemy.noteHit(e, 'direct');
    ctx.state.frameCount += SPELL_STATUS_TICKS + 30;
    expect(alchemy.noteStatus(e, blow({ burn: 0.3, burning: true, heatContact: true }))).toBe('burned');
    // and a boot into the flames is not the wand's either
    const kicked = enemy('slime');
    alchemy.noteHit(kicked, 'direct');
    alchemy.noteKick(kicked);
    ctx.state.frameCount += 6;
    expect(alchemy.noteStatus(kicked, blow({ burn: 4, heatContact: true }))).toBe('burned');
  });

  it('a spell-status tick on a frozen body does not SHATTER it', () => {
    const { ctx, alchemy } = harness(9500);
    const e = enemy('slime', { status: { ...createDefaultStatus(), frozen: 60 } });
    alchemy.noteHit(e, 'direct');
    ctx.state.frameCount += 2;
    alchemy.noteStatus(e, blow({ shock: 3.2, electrified: true, chargeContact: true }));
    expect(alchemy.onKill(e)).toBeNull();
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

  it('a death sequence keeps the verdict of the blow that crossed zero (the Colossus, BOWLED)', () => {
    const { ctx, alchemy, kills } = harness(4000);
    const colossus = enemy('colossus', { x: 180 });
    alchemy.noteHit(colossus, 'bowled'); // a hurled corpse lands the killing blow
    alchemy.sealVerdict(colossus); // ...and the kiln begins to come apart
    ctx.state.frameCount += 300; // the sequence runs for seconds
    alchemy.noteHit(colossus, 'burned'); // its own fire licks it meanwhile: not the kill
    const info = alchemy.onKill(colossus);
    expect(info?.cause).toBe('bowled');
    expect(kills).toHaveLength(1);
    // A wand blow that crossed zero stays the wand's kill, however long the fall.
    const other = enemy('colossus', { x: 180 });
    alchemy.noteHit(other, 'direct');
    alchemy.sealVerdict(other);
    ctx.state.frameCount += 300;
    expect(alchemy.onKill(other)).toBeNull();
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
