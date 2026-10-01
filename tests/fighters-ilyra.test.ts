import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/ilyra-voss';
import {
  Mixture, TUNING, blastKnock, channelOf, glideStep, launchVial, selfShove, stepVial, ticksToReady, trailSpan, trailing,
} from '@/fighters/kits/ilyra-voss-logic';
import type { BlowFacts, VialProbe } from '@/fighters/kits/ilyra-voss-logic';
import { Cell } from '@/sim/CellType';

/**
 * Ilyra Voss's arithmetic (docs/fighters/ilyra-voss.md): the passive's state machine, what counts as a
 * weapon, the vial's flight, the burst's push, the trail's geometry and the reload maths, then the kit's
 * passive wired to a fake engine. What the engine does with it is probed in the real game
 * (scripts/verify-fighter-ilyra.mjs).
 */

const facts = (over: Partial<BlowFacts> = {}): BlowFacts => ({ source: 'direct', melee: false, card: 'spark', cardAge: 10, flaskOpen: false, ...over });

describe('channelOf: what is a weapon', () => {
  it('a spell card is its own weapon, a kick is another, the crucible a third', () => {
    expect(channelOf(facts())).toBe('spell:spark');
    expect(channelOf(facts({ card: 'frostshard' }))).toBe('spell:frostshard');
    expect(channelOf(facts({ melee: true }))).toBe('melee');
  });

  it('a kick wins over the card even though its blow is also "direct"', () => {
    expect(channelOf(facts({ melee: true, card: 'spark' }))).toBe('melee');
  });

  it('a direct blow with no recent cast is the body (a stomp), not a stale card', () => {
    expect(channelOf(facts({ card: null }))).toBe('body');
    expect(channelOf(facts({ cardAge: TUNING.cardMemory + 1 }))).toBe('body');
    expect(channelOf(facts({ cardAge: -5 }))).toBe('body');
  });

  it('a thrown body is a weapon; a flask is only while its window is open', () => {
    expect(channelOf(facts({ source: 'bowled' }))).toBe('bowled');
    expect(channelOf(facts({ source: 'rendered', flaskOpen: true }))).toBe('flask');
    expect(channelOf(facts({ source: 'dissolved', flaskOpen: true }))).toBe('flask');
    expect(channelOf(facts({ source: 'rendered', flaskOpen: false }))).toBeNull();
  });

  it('fire already burning, a fall and a blast she did not cast are not her weapons', () => {
    expect(channelOf(facts({ source: 'burned', flaskOpen: true }))).toBeNull();
    expect(channelOf(facts({ source: 'flattened', flaskOpen: true }))).toBeNull();
    expect(channelOf(facts({ source: 'shorted' }))).toBeNull();
  });
});

describe('Mixture: two different weapons prime a Scorch', () => {
  it('the same weapon twice never primes', () => {
    const m = new Mixture();
    expect(m.note('spell:spark', 100)).toBe(false);
    expect(m.note('spell:spark', 110)).toBe(false);
    expect(m.primed(120)).toBe(false);
  });

  it('two different weapons inside the window prime her, on the second hit', () => {
    const m = new Mixture();
    expect(m.note('spell:spark', 100)).toBe(false);
    expect(m.note('melee', 100 + TUNING.mixtureWindow)).toBe(true);
    expect(m.primed(100 + TUNING.mixtureWindow)).toBe(true);
  });

  it('...but not if the first weapon is older than the window', () => {
    const m = new Mixture();
    m.note('spell:spark', 100);
    expect(m.note('melee', 100 + TUNING.mixtureWindow + 1)).toBe(false);
    expect(m.primed(100 + TUNING.mixtureWindow + 1)).toBe(false);
  });

  it('a primed mixture is spent by the next hit and forgets both weapons', () => {
    const m = new Mixture();
    m.note('spell:spark', 0);
    m.note('melee', 10);
    expect(m.primed(11)).toBe(true);
    m.spend();
    expect(m.primed(12)).toBe(false);
    // The pair that primed her is gone: the same two weapons again have to be struck afresh.
    expect(m.note('melee', 20)).toBe(false);
    expect(m.note('spell:spark', 30)).toBe(true);
  });

  it('while primed, a further hit does not re-prime (the caller spends it on a Scorch)', () => {
    const m = new Mixture();
    m.note('a', 0);
    m.note('b', 1);
    expect(m.note('c', 2)).toBe(false);
    expect(m.primed(3)).toBe(true);
  });

  it('the blow that primes her is not the next hit: ready only once its tick has passed', () => {
    const m = new Mixture();
    m.note('a', 100);
    expect(m.note('b', 100)).toBe(true);
    expect(m.primed(100)).toBe(true);
    expect(m.ready(100)).toBe(false); // a bolt's blast in the same tick does not spend it
    expect(m.ready(101)).toBe(true);
    m.spend();
    expect(m.ready(102)).toBe(false);
    m.restore(50, 500);
    expect(m.ready(500)).toBe(true); // a prime restored from a save is ready at once
  });

  it('an unspent prime goes cold after primeTicks', () => {
    const m = new Mixture();
    m.note('a', 0);
    m.note('b', 0);
    expect(m.primed(TUNING.primeTicks - 1)).toBe(true);
    expect(m.primedLeft(TUNING.primeTicks - 1)).toBe(1);
    expect(m.primed(TUNING.primeTicks)).toBe(false);
    expect(m.primedLeft(TUNING.primeTicks)).toBe(0);
  });

  it('windowLeft counts the pair window down while one weapon waits for its partner', () => {
    const m = new Mixture();
    expect(m.windowLeft(0)).toBe(0);
    m.note('a', 100);
    expect(m.windowLeft(100)).toBe(TUNING.mixtureWindow);
    expect(m.windowLeft(160)).toBe(TUNING.mixtureWindow - 60);
    expect(m.windowLeft(100 + TUNING.mixtureWindow)).toBe(0);
  });

  it('a stamp from the future (a restarted frame counter) is stale, never recent', () => {
    const m = new Mixture();
    m.note('a', 50000);
    expect(m.note('b', 10)).toBe(false);
    expect(m.primed(11)).toBe(false);
    const r = new Mixture();
    r.restore(TUNING.primeTicks, 99999);
    expect(r.primed(5)).toBe(false); // primedUntil is impossibly far ahead of "now"
  });

  it('a save restores the prime that was left, capped to the real window', () => {
    const m = new Mixture();
    m.restore(120, 1000);
    expect(m.primed(1000)).toBe(true);
    expect(m.primedLeft(1000)).toBe(120);
    expect(m.primed(1120)).toBe(false);
    m.restore(99999, 1000);
    expect(m.primedLeft(1000)).toBe(TUNING.primeTicks);
    m.restore(0, 1000);
    expect(m.primed(1000)).toBe(false);
  });
});

/** A flat world: solid below `floorY`, nothing else; foes at the cells in `foes`. */
function flat(floorY: number, foes: Array<[number, number]> = [], wall?: { x: number; y0: number; y1: number }): VialProbe {
  return {
    inBounds: (x, y) => x >= 0 && y >= 0 && x < 1600 && y < 1064,
    solid: (x, y) => y >= floorY || (wall !== undefined && x === wall.x && y >= wall.y0 && y <= wall.y1),
    foe: (x, y) => foes.some(([fx, fy]) => fx === x && fy === y),
  };
}

function fly(vial: ReturnType<typeof launchVial>, probe: VialProbe, max = 200) {
  for (let i = 0; i < max; i++) {
    const end = stepVial(vial, probe);
    if (end) return { end, ticks: i + 1 };
  }
  return { end: null, ticks: max };
}

describe('the vial flies like Flask.ts\'s bottle', () => {
  it('launches along the aim at 6.5 cells/tick', () => {
    const v = launchVial(10, 20, 0);
    expect(v.vx).toBeCloseTo(6.5);
    expect(v.vy).toBeCloseTo(0);
    const up = launchVial(10, 20, -Math.PI / 2);
    expect(up.vy).toBeCloseTo(-6.5);
  });

  it('gravity bends the arc down (0.18 a tick)', () => {
    const v = launchVial(0, 0, 0);
    stepVial(v, flat(10000));
    expect(v.vy).toBeCloseTo(0.18);
    stepVial(v, flat(10000));
    expect(v.vy).toBeCloseTo(0.36);
  });

  it('bursts at its first solid cell, in the open cell before it', () => {
    const v = launchVial(100, 90, Math.atan2(0.4, 1));
    const { end } = fly(v, flat(100));
    expect(end?.reason).toBe('solid');
    expect(end!.y).toBeLessThan(100);
    expect(end!.y).toBeGreaterThanOrEqual(98); // right on top of the floor
  });

  it('with nothing to hit, the fuse bursts it on the 40th tick', () => {
    const v = launchVial(100, 500, -Math.PI / 2 + 0.2);
    const { end, ticks } = fly(v, flat(10000));
    expect(end?.reason).toBe('fuse');
    expect(ticks).toBe(TUNING.vialFuse);
  });

  it('a fast vial cannot tunnel a one-cell wall', () => {
    const v = launchVial(100, 90, 0);
    const { end } = fly(v, flat(10000, [], { x: 130, y0: 0, y1: 500 }));
    expect(end?.reason).toBe('solid');
    expect(end!.x).toBeLessThanOrEqual(129);
    expect(end!.x).toBeGreaterThan(120);
  });

  it('bursts on a foe\'s body rather than flying through it', () => {
    const v = launchVial(100, 90, 0);
    const { end } = fly(v, flat(10000, [[120, 90], [120, 91], [121, 90], [121, 91]]));
    expect(end?.reason).toBe('foe');
    expect(end!.x).toBeGreaterThanOrEqual(119);
    expect(end!.x).toBeLessThanOrEqual(121);
  });

  it('bursts at the edge of the world instead of leaving it', () => {
    const v = launchVial(5, 90, Math.PI);
    const { end } = fly(v, flat(10000));
    expect(end?.reason).toBe('bounds');
    expect(end!.x).toBeGreaterThanOrEqual(0);
  });
});

describe('the burst pushes outward', () => {
  it('a foe is thrown away from the burst, hardest at the centre, never past 3.4', () => {
    const near = blastKnock(5, 0, 5, 1);
    const far = blastKnock(28, 0, 28, 1);
    const left = blastKnock(-10, 0, 10, 1);
    expect(near.kx).toBeGreaterThan(0);
    expect(left.kx).toBeLessThan(0);
    expect(near.kx).toBeGreaterThan(far.kx);
    expect(Math.abs(blastKnock(0.001, 0, 0.001, 1).kx)).toBeLessThanOrEqual(TUNING.burstKnock + 1e-9);
    expect(far.kx).toBeGreaterThan(TUNING.burstKnock * 0.5);
    expect(near.ky).toBeLessThan(0); // and up off the floor
  });

  it('a foe exactly on the centre goes the way she faces', () => {
    expect(blastKnock(0, 0, 0, 1).kx).toBeGreaterThan(0);
    expect(blastKnock(0, 0, 0, -1).kx).toBeLessThan(0);
  });

  it('she is shoved clear inside 22 cells and left alone beyond', () => {
    const s = selfShove(-10, 0, 1, 0);
    expect(s).not.toBeNull();
    expect(s!.vx).toBeLessThan(0);
    expect(Math.abs(s!.vx)).toBeLessThanOrEqual(TUNING.selfShove + 1e-9);
    expect(s!.vy).toBeLessThan(-1); // lifted off the floor, so the shove carries
    expect(selfShove(TUNING.selfShoveRadius + 1, 0, 1, 0)).toBeNull();
    expect(selfShove(0, TUNING.selfShoveRadius - 1, 1, 0)).not.toBeNull();
  });

  it('the glide carries her 9-14 cells, bleeding off to nothing, up and over', () => {
    const s = selfShove(-10, 0, 1, 0)!;
    let x = 0, y = 0, top = 0;
    for (let t = 0; t < TUNING.shoveTicks; t++) {
      const g = glideStep(s.vx, s.vy, t);
      x += g.dx;
      y += g.dy;
      top = Math.min(top, y);
    }
    expect(Math.abs(x)).toBeGreaterThan(9);
    expect(Math.abs(x)).toBeLessThan(14);
    expect(x).toBeLessThan(0); // away from the burst, which was on her right
    expect(top).toBeLessThan(-3); // arced up
    expect(Math.abs(glideStep(s.vx, s.vy, TUNING.shoveTicks).dx)).toBe(0);
    expect(glideStep(s.vx, s.vy, TUNING.shoveTicks - 1).dy).toBeGreaterThan(0); // and coming down
  });

  it('standing on the burst she is thrown back the way she threw from', () => {
    const s = selfShove(0, 0, 1, 0);
    expect(s!.vx).toBeLessThan(0);
  });
});

describe('the Phoenix trail', () => {
  it('lights a column for every cell she covered since the last drop, behind her', () => {
    // She ran right: the last drop ended at x=100, she is now at x=108.
    const cols = trailSpan(100, 108, 1);
    expect(cols[0]).toBe(100);
    expect(cols[cols.length - 1]).toBe(108 - TUNING.trailBehind);
    for (let i = 1; i < cols.length; i++) expect(cols[i]).toBe(cols[i - 1] + 1);
  });

  it('works leftward too, and the first drop is a single column', () => {
    const left = trailSpan(200, 192, -1);
    expect(left[0]).toBe(200);
    expect(left[left.length - 1]).toBe(192 + TUNING.trailBehind);
    expect(trailSpan(null, 50, 1)).toEqual([50 - TUNING.trailBehind]);
  });

  it('never lays more than trailMaxSpan columns at once, and restarts after a long gap', () => {
    expect(trailSpan(100, 112, 1).length).toBeLessThanOrEqual(TUNING.trailMaxSpan);
    expect(trailSpan(0, 500, 1)).toEqual([500 - TUNING.trailBehind]);
  });

  it('leaves a trail only above 1.5 cells/tick', () => {
    expect(trailing(1.5, 0)).toBe(false);
    expect(trailing(1.51, 0)).toBe(true);
    expect(trailing(0, 4)).toBe(true); // a fall counts: she is moving fast
    expect(trailing(1, 1)).toBe(false); // hypot(1, 1) = 1.41 is under the bar
  });
});

describe('Phoenix Draft halves the wand\'s delay', () => {
  it('a cooldown that runs down twice a tick is ready in half the ticks', () => {
    // The oak wand with one card: castDelay 14 + recharge 22 on every wrap.
    expect(ticksToReady(36, 1)).toBe(36);
    expect(ticksToReady(36, TUNING.phoenixReloadRate)).toBe(18);
    expect(ticksToReady(9 + 45, 1)).toBe(54);
    expect(ticksToReady(9 + 45, 2)).toBe(27);
    expect(ticksToReady(0, 2)).toBe(0);
  });

  it('so a held wand casts twice as often over a fixed span', () => {
    const shots = (perTick: number, span: number): number => {
      let cd = 0, n = 0;
      for (let t = 0; t < span; t++) {
        if (cd <= 0) { n++; cd = 36; } // the cast tick (player update) sets the delay...
        cd = Math.max(0, cd - perTick); // ...and the tick's decrements run after it
      }
      return n;
    };
    const base = shots(1, 720), boosted = shots(TUNING.phoenixReloadRate, 720);
    expect(boosted / base).toBeGreaterThan(1.9);
    expect(boosted / base).toBeLessThan(2.1);
  });
});

// ---------------------------------------------------------------------------------------------------
// The kit's passive against a fake engine.

interface Fake {
  sys: FighterSystem;
  ctx: Ctx;
  frame: { n: number };
  hurts: Array<{ kind: string; amount: number }>;
  events: EventBus;
  melee: { on: boolean };
  placed: number[];
  callouts: string[];
}

function fake(): Fake {
  const events = new EventBus();
  const frame = { n: 1000 };
  const hurts: Array<{ kind: string; amount: number }> = [];
  const placed: number[] = [];
  const callouts: string[] = [];
  const melee = { on: false };
  const enemies: Enemy[] = [];
  const types = new Uint8Array(200 * 200);
  const life = new Uint8Array(200 * 200);
  const world = {
    inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 200 && y < 200,
    idx: (x: number, y: number) => x + y * 200,
    types,
    life,
    replaceCellAt: (i: number, cell: number) => { types[i] = cell; placed.push(cell); },
  };
  const noop = () => undefined;
  const ctx = {
    events,
    state: { get frameCount() { return frame.n; }, reduceFlashes: false },
    player: { x: 100, y: 100, vx: 0, vy: 0, facing: 1, dead: false, status: { burning: 0 } },
    world,
    enemies,
    fx: { screenShake: 0, bloomKick: 0, hitstop: 0 },
    particles: { burst: noop, spawn: noop },
    audio: { sfx: noop },
    spells: { wandTip: () => ({ x: 110, y: 92 }) },
    enemyCtl: {
      defs: { slime: { hp: 40, halfW: 4, h: 8 }, imp: { hp: 40, halfW: 4, h: 12 } },
      // Fire hurts everything but an imp, and says so.
      splashHazard: (_x: number, _y: number, cell: number): boolean => {
        const e = enemies[0];
        if (!e || e.kind === 'imp' || cell !== Cell.Fire) return false;
        e.hp -= 0.7;
        return true;
      },
    },
    wands: { wands: [{ cooldown: 0 }, { cooldown: 0 }] },
  } as unknown as Ctx;
  const sys = {
    ctx,
    get recentMelee() { return melee.on; },
    hurt: (e: Enemy, amount: number) => { e.hp -= amount; hurts.push({ kind: e.kind, amount }); },
    addLight: () => null,
    addDrawable: () => noop,
    enemiesNear: () => enemies,
    setMod: noop,
    clearMod: noop,
  } as unknown as FighterSystem;
  ctx.events.on('combatCallout', (c) => { callouts.push(c.text); });
  return { sys, ctx, frame, hurts, events, melee, placed, callouts };
}

function foe(f: Fake, kind: string, hp = 100): Enemy {
  const e = { kind, x: 120, y: 100, hp, maxHp: hp, status: { burning: 0 } } as unknown as Enemy;
  f.ctx.enemies.length = 0;
  f.ctx.enemies.push(e);
  return e;
}

describe('the passive, wired to a fake engine', () => {
  it('a spark and then a kick prime her, and the next hit sets the foe alight', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    expect(k.meter!()?.label).toBe('MIXTURE');
    f.frame.n += 20;
    f.melee.on = true;
    k.onEnemyHurt!(e, 5, 'direct', false);
    f.melee.on = false;
    expect(k.meter!()?.label).toBe('SCORCH PRIMED');
    expect(e.status.burning).toBe(0);
    f.frame.n += 20;
    k.onEnemyHurt!(e, 8, 'direct', false);
    expect(e.status.burning).toBeGreaterThanOrEqual(TUNING.scorchBurn);
    expect(f.hurts.some((h) => h.amount === TUNING.scorchFlare)).toBe(true);
    expect(f.callouts).toContain('SCORCH');
    expect(f.placed).toContain(Cell.Fire); // real flames licking the body
    expect(k.meter!()).toBeNull(); // spent
  });

  it('the same card twice does not prime', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    for (let i = 0; i < 5; i++) { f.frame.n += 10; k.onEnemyHurt!(e, 8, 'direct', false); }
    expect(e.status.burning).toBe(0);
    expect(k.meter!()?.label).toBe('MIXTURE');
  });

  it('a second card is a second weapon', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    f.frame.n += 30;
    f.events.emit('cardCast', { id: 'frostshard', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    expect(k.meter!()?.label).toBe('SCORCH PRIMED');
  });

  it('a fire-proof foe takes the flare only: no burning status', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'imp');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    f.melee.on = true;
    k.onEnemyHurt!(e, 5, 'direct', false);
    f.melee.on = false;
    f.frame.n += 10;
    k.onEnemyHurt!(e, 8, 'direct', false);
    expect(f.hurts.some((h) => h.amount === TUNING.scorchFlare)).toBe(true);
    expect(e.status.burning).toBe(0);
    expect(f.callouts).toContain('FLARE');
  });

  it('a killing blow does not spend the prime', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    f.melee.on = true;
    k.onEnemyHurt!(e, 5, 'direct', false);
    f.melee.on = false;
    k.onEnemyHurt!(e, 8, 'direct', true); // it died
    expect(k.meter!()?.label).toBe('SCORCH PRIMED');
  });

  it('a blow lighter than minHit (a burning tick) is not a hit at all', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    f.melee.on = true;
    k.onEnemyHurt!(e, TUNING.minHit - 0.1, 'direct', false);
    f.melee.on = false;
    expect(k.meter!()?.label).toBe('MIXTURE');
  });

  it('a fire she did not light is nobody\'s weapon (no flask in the air)', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    k.onEnemyHurt!(e, 8, 'rendered', false);
    expect(k.meter!()?.label).toBe('MIXTURE');
    // ...but once a flask has been thrown, the lava it spilled is.
    f.events.emit('flaskUsed', { verb: 'throw', material: Cell.Lava, amount: 100 });
    k.onEnemyHurt!(e, 8, 'rendered', false);
    expect(k.meter!()?.label).toBe('SCORCH PRIMED');
  });

  it('the prime goes cold unspent, and a save carries it', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    f.melee.on = true;
    k.onEnemyHurt!(e, 5, 'direct', false);
    f.melee.on = false;
    const saved = k.save!();
    expect(saved.primed).toBe(TUNING.primeTicks);
    f.frame.n += TUNING.primeTicks + 1;
    expect(k.meter!()).toBeNull();
    k.load!(saved);
    expect(k.meter!()?.label).toBe('SCORCH PRIMED');
    k.reset!();
    expect(k.meter!()).toBeNull();
  });

  it('reset forgets the pair and dispose lets go of the events', () => {
    const f = fake();
    const k = kit.create(f.sys);
    const e = foe(f, 'slime');
    f.events.emit('cardCast', { id: 'spark', origin: 'wand', x: 0, y: 0 });
    k.onEnemyHurt!(e, 8, 'direct', false);
    k.reset!();
    expect(k.meter!()).toBeNull();
    k.dispose!();
    f.events.emit('flaskUsed', { verb: 'throw', material: null, amount: 0 });
    // (no throw: the listener is gone)
    expect(k.meter!()).toBeNull();
  });
});

describe('Phoenix Draft, wired to a fake engine', () => {
  it('runs both wands\' cooldowns down one extra tick, and a held mod is set and cleared', () => {
    const f = fake();
    const mods: string[] = [];
    (f.sys as unknown as { setMod: (id: string) => void }).setMod = (id) => { mods.push('+' + id); };
    (f.sys as unknown as { clearMod: (id: string) => void }).clearMod = (id) => { mods.push('-' + id); };
    const k = kit.create(f.sys);
    expect(k.ultimate()).toBe(true);
    const wands = f.ctx.wands.wands as unknown as Array<{ cooldown: number }>;
    wands[0].cooldown = 10;
    wands[1].cooldown = 1;
    k.ultimateTick!(100);
    expect(wands[0].cooldown).toBe(9);
    expect(wands[1].cooldown).toBe(0);
    k.ultimateTick!(99);
    expect(wands[1].cooldown).toBe(0); // never below zero
    k.ultimateEnd!();
    expect(mods).toEqual(['+phoenix', '-phoenix']);
  });

  it('keeps her from burning: the status is cleared every tick', () => {
    const f = fake();
    const k = kit.create(f.sys);
    k.ultimate();
    f.ctx.player.status.burning = 200;
    k.ultimateTick!(100);
    expect(f.ctx.player.status.burning).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// Her kit on the REAL FighterSystem (cooldowns, charge, modifiers) against a fake world.


function realSystem() {
  const events = new EventBus();
  const frame = { n: 1000 };
  const enemies: Enemy[] = [];
  const sfx: string[] = [];
  const types = new Uint8Array(2000 * 2000);
  const life = new Uint8Array(2000 * 2000);
  const lights: unknown[] = [];
  const player = {
    x: 100, y: 100, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, aimAngle: 0, throwT: 0, lastDamageSource: null as string | null,
    status: { burning: 0 },
  };
  let sys: FighterSystem | null = null;
  const ctx = {
    events,
    state: { get frameCount() { return frame.n; }, mode: 'play', reduceFlashes: false },
    player,
    enemies,
    world: {
      inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 2000 && y < 2000,
      idx: (x: number, y: number) => x + y * 2000,
      types,
      life,
      replaceCellAt: (i: number, cell: number) => { types[i] = cell; },
    },
    fx: { screenShake: 0, bloomKick: 0, hitstop: 0 },
    particles: { burst: () => undefined, spawn: () => undefined },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    spells: { wandTip: () => ({ x: player.x + 10, y: player.y - 8 }) },
    levels: { current: { authoredLights: lights } },
    rigidBodies: { applyRadialImpulse: () => undefined },
    physics: {
      tryMoveEntity: (e: { x: number; y: number }, dx: number, dy: number): boolean => { e.x += dx; e.y += dy; return true; },
      entityFree: (): boolean => true,
    },
    enemyCtl: {
      defs: { slime: { hp: 40, halfW: 4, h: 8 } },
      damage: (e: Enemy, amount: number, _kx: number, _ky: number, source?: string) => {
        e.hp -= amount;
        sys?.noteEnemyHurt(e, amount, (source ?? 'direct') as never, e.hp <= 0);
      },
      splashHazard: () => false,
    },
    wands: { wands: [{ cooldown: 0 }, { cooldown: 0 }] },
  } as unknown as Ctx;
  sys = new FighterSystem(ctx, () => kit);
  sys.equip('ilyra-voss');
  const step = (n = 1) => { for (let i = 0; i < n; i++) { frame.n++; sys!.update(ctx); } };
  step(1);
  return { sys, ctx, player: ctx.player, enemies, sfx, lights, step };
}

describe('Ilyra on the real FighterSystem', () => {
  it('Z throws the vial: a 9 s cooldown, refused while it runs, and the vial bursts on its fuse', () => {
    const { sys, sfx, lights, step } = realSystem();
    expect(sys.view.tactical.ready).toBe(true);
    sys.press('tactical');
    step(1);
    expect(sys.view.tactical.ready).toBe(false);
    expect(sys.view.tactical.cooldownSeconds).toBe(9);
    expect(sfx).toContain('flask.throw');
    expect(sys.drawables.length).toBe(1); // the vial in flight is a drawable
    const refused = sys.view.tactical.refusedAt;
    sys.press('tactical');
    step(1);
    expect(sys.view.tactical.refusedAt).toBeGreaterThan(refused);
    expect(sfx.filter((s) => s === 'flask.throw').length).toBe(1);
    step(TUNING.vialFuse + 2);
    expect(sfx).toContain('flask.shatter');
    expect(lights.length).toBe(1); // the burst's flash light...
    step(30);
    expect(lights.length).toBe(0); // ...is gone again
    step(TUNING.tacticalCooldown);
    expect(sys.view.tactical.ready).toBe(true);
  });

  it('a vial that hits a foe charges the ultimate bar and opens the mixture window; her own blow never re-enters the passive', () => {
    const { sys, ctx, enemies, step } = realSystem();
    const e = { kind: 'slime', x: 125, y: 100, hp: 100, maxHp: 100, vx: 0, vy: 0, status: { burning: 0 } } as unknown as Enemy;
    enemies.push(e);
    const before = sys.view.ultimate.charge;
    sys.press('tactical');
    step(12);
    expect(e.hp).toBe(100 - TUNING.burstDamage);
    expect(sys.view.ultimate.charge).toBeGreaterThan(before + TUNING.burstDamage * 0.0014);
    expect(sys.view.meter?.label).toBe('MIXTURE'); // the crucible counts as a weapon, once
    expect(ctx.fx.hitstop).toBeGreaterThanOrEqual(2);
    // The blast was ONE blow: the foe took the 14 once, no Scorch (nothing was primed).
  });

  it('T is refused below a full bar; at full it gives speed x1.25 and fire-proofing, and takes them back when it ends', () => {
    const { sys, step } = realSystem();
    sys.press('ultimate');
    step(1);
    expect(sys.view.ultimate.active).toBe(0);
    expect(sys.view.ultimate.refusedAt).toBeGreaterThan(0);
    expect(sys.moveScale()).toBe(1);
    sys.refill();
    sys.press('ultimate');
    step(1);
    expect(sys.view.ultimate.active).toBeGreaterThan(0.99);
    expect(sys.view.ultimate.charge).toBe(0); // the bar is spent whole
    expect(sys.moveScale()).toBeCloseTo(1.25);
    for (const src of ['fire', 'burning', 'oiled-fire']) expect(sys.reduceIncoming(10, src)).toBe(0);
    for (const src of ['lava', 'acid', 'explosion', 'toxic', undefined]) expect(sys.reduceIncoming(10, src)).toBe(10);
    step(TUNING.phoenixTicks - 2);
    expect(sys.view.ultimate.active).toBeGreaterThan(0);
    step(4);
    expect(sys.view.ultimate.active).toBe(0);
    expect(sys.moveScale()).toBe(1);
    expect(sys.reduceIncoming(10, 'fire')).toBe(10);
  });

  it('while it runs the wand\'s cooldown falls two a tick, and she is not set alight', () => {
    const { sys, ctx, player, step } = realSystem();
    sys.refill();
    sys.press('ultimate');
    step(1);
    const wands = ctx.wands.wands as unknown as Array<{ cooldown: number }>;
    wands[0].cooldown = 20;
    player.status.burning = 300;
    step(1);
    expect(wands[0].cooldown).toBe(19); // one from the draught (the engine's own decrement is WandSystem's)
    expect(player.status.burning).toBe(0);
  });

  it('a reset (death, a new floor) clears the draught, the vial and every light at once', () => {
    const { sys, lights, step } = realSystem();
    sys.refill();
    sys.press('ultimate');
    step(1);
    sys.press('tactical');
    step(2);
    expect(lights.length).toBeGreaterThanOrEqual(1);
    sys.reset();
    expect(sys.moveScale()).toBe(1);
    expect(sys.drawables.length).toBe(0);
    expect(lights.length).toBe(0);
    expect(sys.reduceIncoming(10, 'fire')).toBe(10);
  });
});
