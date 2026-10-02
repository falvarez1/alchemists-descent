import { describe, expect, test } from 'vitest';
import { FightRecorder, parseFightJSONL, FIGHTER_COLUMNS } from '@/fighters/telemetry/fightLog';
import type { FightCtx } from '@/fighters/telemetry/fightLog';

/** The fight recorder (docs/arena/TELEMETRY-AND-BALANCE.md 3.1): two fighters, hits, hurts, abilities, hazards, the JSONL round trip. */

interface FakeBody {
  x: number; y: number; vx: number; vy: number; hp: number; grounded: boolean; climbing: boolean; crawling: boolean;
  staggerT: number; stunT: number; invuln: number; inLiquid: boolean; dead: boolean; lastDamageSource: string | null;
}

function body(x: number, hp = 100): FakeBody {
  return { x, y: 100, vx: 0, vy: 0, hp, grounded: true, climbing: false, crawling: false, staggerT: 0, stunT: 0, invuln: 0, inLiquid: false, dead: false, lastDamageSource: null };
}

function setup(): { ctx: FightCtx; a: FakeBody; b: FakeBody; state: { frameCount: number }; arena: { bound: number; activeBlow: { by: number; tag: string } | null } } {
  const a = body(10), b = body(200);
  const state = { frameCount: 1000 };
  const view = { armor: 0, ultimate: { charge: 0.5, active: 0 }, tactical: { cooldown: 0.25, active: 0 } };
  const fighters = { view, concealment: () => 0, attribute: () => 'spell' as const };
  const arena = { active: true, slotCount: 2, bound: 0, activeBlow: null as { by: number; tag: string } | null, bundle: (s: number) => ({ player: s === 0 ? a : b, fighters }) };
  const ctx = { player: a, enemies: [], state, fighters, arena } as unknown as FightCtx;
  return { ctx, a, b, state, arena };
}

const header = (): Parameters<FightRecorder['start']>[0] => ({
  runId: 'r', fight: 0, seed: 7, yard: 'fighter-duel',
  fighters: [{ slot: 0, id: 'ilyra-voss', brain: 'basic:3', hp: 100, maxHp: 100 }, { slot: 1, id: 'brann-rook', brain: 'basic:3', hp: 100, maxHp: 100 }],
});

describe('FightRecorder in a duel', () => {
  test('samples both fighters on the cadence, with the columns the header names', () => {
    const { ctx, state } = setup();
    const rec = new FightRecorder(ctx, { sampleEvery: 6 });
    rec.start(header());
    for (let i = 0; i < 12; i++) { state.frameCount++; rec.tick(); }
    rec.end({ winner: null, reason: 'timeout' });
    const r = rec.toRecord();
    expect(r.header.fighters.length).toBe(2);
    expect(r.samples.map((s) => s.t)).toEqual([0, 6, 12]);
    for (const s of r.samples) { expect(s.f.length).toBe(2); expect(s.f[0].length).toBe(FIGHTER_COLUMNS.length); }
    expect(r.samples[0].f[0][0]).toBe(10);
    expect(r.samples[0].f[1][0]).toBe(200);
  });

  test('a hurt event names the victim (the bound slot), the attacker and the blow\'s tag from the arena', () => {
    const { ctx, b, arena, state } = setup();
    const rec = new FightRecorder(ctx);
    rec.start(header());
    state.frameCount += 5;
    arena.bound = 1; arena.activeBlow = { by: 0, tag: 'kick' };
    b.hp -= 4; // the damage: 8 raw, 4 reached health
    rec.hurt(8, 4, 'fighter', 3, -1);
    arena.bound = 0; arena.activeBlow = null;
    rec.end({ winner: null, reason: 'timeout' });
    const hurt = rec.toRecord().events.find((e) => e.e === 'hurt');
    expect(hurt).toMatchObject({ e: 'hurt', t: 5, src: 0, dst: 1, tag: 'kick', raw: 8, taken: 4, absorbed: 4, source: 'fighter' });
    expect(rec.totals().taken.fighter).toBe(4);
  });

  test('a hazard that never touched damage() is inferred from the health delta, per fighter, once', () => {
    const { ctx, a, b, state } = setup();
    const rec = new FightRecorder(ctx);
    rec.start(header());
    state.frameCount++; a.hp -= 2; a.lastDamageSource = 'fire'; rec.tick();
    state.frameCount++; b.hp -= 3; rec.tick();
    state.frameCount++; rec.tick();
    rec.end({ winner: null, reason: 'timeout' });
    const hurts = rec.toRecord().events.filter((e) => e.e === 'hurt');
    expect(hurts.length).toBe(2);
    expect(hurts[0]).toMatchObject({ dst: 0, src: -1, taken: 2, source: 'fire', inferred: true });
    expect(hurts[1]).toMatchObject({ dst: 1, src: -1, taken: 3, inferred: true });
  });

  test('a blow that did go through damage() is not counted again as a drip', () => {
    const { ctx, a, arena, state } = setup();
    const rec = new FightRecorder(ctx);
    rec.start(header());
    state.frameCount++;
    arena.bound = 0;
    a.hp -= 5;
    rec.hurt(5, 5, 'explosion', 0, 0);
    rec.tick();
    rec.end({ winner: null, reason: 'timeout' });
    expect(rec.toRecord().events.filter((e) => e.e === 'hurt').length).toBe(1);
  });

  test('an ability press is recorded against the bound fighter', () => {
    const { ctx, arena, state } = setup();
    const rec = new FightRecorder(ctx);
    rec.start(header());
    state.frameCount += 2;
    arena.bound = 1;
    rec.ability('tactical', 'fired');
    arena.bound = 0;
    rec.ability('ultimate', 'refused');
    rec.end({ winner: 0, reason: 'ko' });
    const ev = rec.toRecord().events.filter((e) => e.e === 'ability');
    expect(ev[0]).toMatchObject({ who: 1, slot: 'tactical', res: 'fired' });
    expect(ev[1]).toMatchObject({ who: 0, slot: 'ultimate', res: 'refused' });
    expect(rec.totals().abilities.tactical.fired).toBe(1);
    expect(rec.totals().abilities.ultimate.refused).toBe(1);
  });

  test('ending twice or at a sample tick adds one closing event and no duplicate sample', () => {
    const { ctx, state } = setup();
    const rec = new FightRecorder(ctx, { sampleEvery: 6 });
    rec.start(header());
    for (let i = 0; i < 6; i++) { state.frameCount++; rec.tick(); }
    rec.end({ winner: 1, reason: 'ko' });
    rec.end({ winner: 0, reason: 'ko' });
    const r = rec.toRecord();
    expect(r.samples.map((s) => s.t)).toEqual([0, 6]);
    const ends = r.events.filter((e) => e.e === 'end');
    expect(ends.length).toBe(1);
    expect(ends[0]).toMatchObject({ winner: 1, reason: 'ko', hp: [100, 100] });
  });

  test('the JSONL round-trips: header first, events before the sample of their tick, parse gives the record back', () => {
    const { ctx, state, arena } = setup();
    const rec = new FightRecorder(ctx, { sampleEvery: 6 });
    rec.start(header());
    state.frameCount += 6;
    arena.bound = 1; arena.activeBlow = { by: 0, tag: 'spell' };
    rec.hurt(10, 10, 'fighter', 1, 0);
    arena.bound = 0; arena.activeBlow = null;
    rec.tick();
    rec.end({ winner: 0, reason: 'ko' });
    const text = rec.toJSONL();
    const lines = text.trim().split('\n').map((l) => JSON.parse(l) as { k: string; t?: number; e?: string });
    expect(lines[0].k).toBe('h');
    const hurtAt = lines.findIndex((l) => l.e === 'hurt');
    const sampleAt = lines.findIndex((l) => l.k === 's' && l.t === 6);
    expect(hurtAt).toBeGreaterThan(0);
    expect(hurtAt).toBeLessThan(sampleAt);
    const back = parseFightJSONL(text);
    expect(back.header.seed).toBe(7);
    expect(back.samples.length).toBe(rec.toRecord().samples.length);
    expect(back.events.length).toBe(rec.toRecord().events.length);
  });

  test('a single fighter with no arena still records (a gauntlet): one row per sample', () => {
    const p = body(5);
    const state = { frameCount: 0 };
    const ctx = { player: p, enemies: [], state, fighters: { view: { armor: 0, ultimate: { charge: 0, active: 0 }, tactical: { cooldown: 0, active: 0 } }, concealment: () => 0, attribute: () => 'spell' } } as unknown as FightCtx;
    const rec = new FightRecorder(ctx);
    rec.start({ ...header(), fighters: [{ slot: 0, id: 'ilyra-voss', brain: 'human', hp: 100, maxHp: 100 }] });
    state.frameCount += 6; rec.tick();
    rec.end({ winner: null, reason: 'timeout' });
    expect(rec.toRecord().samples[0].f.length).toBe(1);
  });
});
