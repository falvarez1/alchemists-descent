import { afterEach, describe, expect, test } from 'vitest';
import { AI_BEHAVIOR, AI_BEHAVIOR_DEFAULTS, AI_BEHAVIOR_KEYS, AI_BEHAVIOR_RANGES, resetAiBehavior, setAiBehaviorValue } from '@/config/aiBehavior';
import { setAiTierValue, resetAiTiers } from '@/config/aiTiers';
import { chooseIntent, styleFor } from '@/arena/ai/intent';
import { abilityPlan } from '@/arena/ai/playbooks';
import { incomingShot, safeFooting, threatensSlot, weaponView } from '@/arena/ai/combat';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { leadPoint } from '@/arena/ai/control';
import { Execution } from '@/arena/ai/execution';
import { createWorldView } from '@/arena/ai/worldView';
import type { FoeView, ShotView } from '@/arena/ai/worldView';
import type { PerceivedFoe } from '@/arena/ai/execution';
import type { CastAction, Ctx, Enemy } from '@/core/types';
import { Rng } from '@/core/rng';
import { duelNav } from '@/arena/ai/nav';

afterEach(() => { resetAiBehavior(); resetAiTiers(); });
const me = () => ({ ...createWorldView().me, x: 600, y: 639, sy: 630, shotAffordable: true, fighter: 'ilyra-voss' as const });
function foe(x = 675, hpFrac = 1): PerceivedFoe {
  const f: FoeView = { ref: {} as Enemy, kind: 'fighter', x, y: 639, cx: x, cy: 630, vx: 0, vy: 0, hp: hpFrac * 100, maxHp: 100, hpFrac, halfW: 4, h: 18, dx: x - 600, dy: 0, dist: x - 600, grounded: true, sleeping: false };
  return { foe: f, x, y: 639, cx: x, cy: 630, vx: 0, vy: 0, age: 0, dist: x - 600 };
}
function intent(overrides: Partial<Parameters<typeof chooseIntent>[0]> = {}) {
  return chooseIntent({ me: me(), foes: [foe()], style: styleFor('ilyra-voss'), current: 'zone', heldFor: 100, currentTarget: null, otherLevel: () => false, noShotTicks: 0, ...overrides });
}

describe('combat decisions', () => {
  test('low mana creates space instead of rushing into melee', () => {
    const choice = intent({ me: { ...me(), shotAffordable: false, manaFrac: 0 }, recovering: true });
    expect(choice.intent).toBe('recover');
    expect(choice.range).toBeGreaterThan(40);
  });
  test('pursues a wounded opponent when healthy, but protects a losing trade', () => {
    expect(intent({ foes: [foe(660, 0.2)] }).intent).toBe('pressure');
    expect(intent({ me: { ...me(), hpFrac: 0.1 }, foes: [foe(630, 0.2)] }).intent).toBe('retreat');
  });
  test('explosive users retreat outside their own blast even against a nearly dead opponent', () => {
    const choice = intent({ me: { ...me(), weapon: { speed: 7.5, gravity: 0.14, minRange: 100, maxRange: 220 } }, foes: [foe(660, 0.1)] });
    expect(choice.intent).toBe('retreat');
    expect(choice.range).toBeGreaterThan(120);
  });
  test('prefers an available firing lane over a slightly closer blocked target', () => {
    const a = foe(650), b = foe(675);
    expect(intent({ foes: [a, b], hasLine: (f) => f === b }).target).toBe(b);
  });
  test('changes position after losing the shot, and routes to another platform', () => {
    expect(intent({ noShotTicks: 80 }).intent).toBe('reposition');
    expect(intent({ otherLevel: () => true }).intent).toBe('reposition');
    const nav = duelNav();
    for (const n of nav.nodes.slice(1)) {
      expect(nav.route('floor', n.id)?.length).toBe(1);
      expect(nav.route(n.id, 'floor')?.length).toBe(1);
    }
  });
});

describe('recognizing and avoiding shots', () => {
  test('does not dodge a shot that expires before reaching the body', () => {
    const shot = { ref: {}, age: 0, x: 680, y: 630, vx: -5, vy: 0, life: 4 };
    expect(incomingShot(me(), [shot], () => true)).toBeNull();
  });
  test('recognizes a falling arc from the delayed projectile observation', () => {
    const shot = { ref: {}, age: 4, x: 655, y: 600, vx: -3, vy: 0, gravity: .2, life: 100 };
    expect(incomingShot(me(), [shot], () => true)).not.toBeNull();
  });
  test('ignores an arc that falls below us instead of treating it as a straight shot', () => {
    const shot = { ref: {}, age: 0, x: 680, y: 630, vx: -5, vy: 0, gravity: .8, life: 100 };
    expect(incomingShot(me(), [shot], () => true)).toBeNull();
  });
  test('a landing with fire touching the head is unsafe even when the feet are clear', () => {
    const world = new World();
    for (let x = 596; x <= 604; x++) world.replaceCellAt(world.idx(x, 640), Cell.Metal, 0);
    world.replaceCellAt(world.idx(600, 622), Cell.Fire, 0);
    const ctx = { world, physics: { entityFree: () => true, cellBlocks: (x: number, y: number) => world.type(x, y) === Cell.Metal } } as unknown as Pick<Ctx, 'world' | 'physics'>;
    expect(safeFooting(ctx, 600, 639)).toBe(false);
  });
  test('Duel ownership works for both sides, including implicit owner zero', () => {
    expect(threatensSlot({ hostile: false, owner: 1 }, 0, true)).toBe(true);
    expect(threatensSlot({ hostile: false }, 1, true)).toBe(true);
    expect(threatensSlot({ hostile: false, owner: 1 }, 1, true)).toBe(false);
    expect(threatensSlot({ hostile: false }, 0, false)).toBe(false);
    expect(threatensSlot({ hostile: true }, 0, false)).toBe(true);
  });
  test('dodges an incoming crossing, ignores receding, overhead and blocked shots', () => {
    const shot: ShotView = { ref: {}, age: 0, x: 700, y: 630, vx: -8, vy: 0 };
    expect(incomingShot(me(), [shot], () => true)?.ticks).toBeLessThan(18);
    expect(incomingShot(me(), [{ ...shot, vx: 8 }], () => true)).toBeNull();
    expect(incomingShot(me(), [{ ...shot, y: 580 }], () => true)).toBeNull();
    expect(incomingShot(me(), [shot], () => false)).toBeNull();
    AI_BEHAVIOR.dodgeLookahead = 0;
    expect(incomingShot(me(), [shot], () => true)).toBeNull();
  });
  test('initial awareness and projectile turns obey reaction delay; health does not leak from live state', () => {
    setAiTierValue(3, 'reaction', 4);
    const exec = new Execution(new Rng(1), 3), view = createWorldView();
    Object.assign(view.me, me());
    const f = foe().foe, shot: ShotView = { ref: {}, age: 0, x: 700, y: 630, vx: -8, vy: 0 };
    view.foes.push(f); view.shots.push(shot);
    for (let tick = 0; tick <= 4; tick++) {
      view.tick = tick;
      if (tick === 4) { f.hpFrac = 0.1; shot.vx = 8; }
      exec.record(view);
      if (tick < 4) { expect(exec.perceive(view)).toHaveLength(0); expect(exec.perceiveShots(view)).toHaveLength(0); }
    }
    expect(exec.perceive(view)[0].foe.hpFrac).toBe(1);
    expect(exec.perceiveShots(view)[0]).toMatchObject({ vx: -8, age: 4 });
    exec.reset();
    expect(exec.perceiveShots(view)).toHaveLength(0);
  });
});

describe('weapon and ability choices', () => {
  test('uses actual speed modifiers, explosive clearance and gravity', () => {
    const ctx = { params: { spells: { bolt: { velocityForce: 9.5, explosionRadius: 6.5 }, bomb: { velocityForce: 7.5, explosionRadius: 52 } } } } as Ctx;
    const spark = weaponView(ctx, { card: 'spark', speedMul: 2, dmgMul: 1 } as CastAction);
    const bomb = weaponView(ctx, { card: 'bomb', speedMul: 1, dmgMul: 2 } as CastAction);
    expect(spark.speed).toBe(19);
    expect(bomb.minRange).toBeGreaterThan(90);
    const target = { cx: 100, cy: 0, vx: 0, vy: 0, age: 0 };
    expect(leadPoint({ x: 0, y: 0 }, target, bomb.speed, 0, bomb.gravity).y).toBeLessThan(0);
    const moving = { ...target, vx: 2 };
    expect(leadPoint({ x: 0, y: 0 }, moving, 5, 0).x).toBeGreaterThan(leadPoint({ x: 0, y: 0 }, moving, 19, 0).x);
  });
  test('Brann guards a ranged exchange and Ilyra uses her ultimate before near death', () => {
    const body = { ...me(), tactical: { ...me().tactical, ready: true }, ultimate: { ...me().ultimate, ready: true } };
    expect(abilityPlan({ ...body, fighter: 'brann-rook' }, foe(750), 'approach', true, true).tactical).toBeTruthy();
    expect(abilityPlan(body, foe(), 'zone', true, false).ultimate).toBeTruthy();
    expect(abilityPlan(body, foe(900), 'approach', false, false).tactical).toBeNull();
    expect(abilityPlan(body, foe(900), 'approach', false, false).ultimate).toBeNull();
  });
  test('Edda saves healing until hurt; escape skills aim away while withdrawing', () => {
    const body = { ...me(), grounded: true, tactical: { ...me().tactical, ready: true }, ultimate: { ...me().ultimate, ready: true } };
    expect(abilityPlan({ ...body, fighter: 'edda-morrow' }, foe(), 'zone', true, false).ultimate).toBeNull();
    expect(abilityPlan({ ...body, fighter: 'edda-morrow', hpFrac: 0.5 }, foe(), 'zone', true, false).ultimate).toBeTruthy();
    const escape = abilityPlan({ ...body, fighter: 'selene-wraith' }, foe(), 'retreat', true, false);
    expect(escape.tactical).toBeTruthy();
    expect(escape.aim!.x).toBeLessThan(body.x);
  });
  test('Selene waits for footing before a blink while Kest can dash in midair', () => {
    const body = { ...me(), grounded: false, tactical: { ...me().tactical, ready: true } };
    expect(abilityPlan({ ...body, fighter: 'selene-wraith' }, foe(), 'retreat', true, true).tactical).toBeNull();
    expect(abilityPlan({ ...body, grounded: true, fighter: 'selene-wraith' }, foe(), 'retreat', true, true).tactical).toBeTruthy();
    expect(abilityPlan({ ...body, fighter: 'kest-rel' }, foe(), 'retreat', true, true).tactical).toBeTruthy();
  });
});

test('every behavior knob is bounded, live and resettable', () => {
  for (const key of AI_BEHAVIOR_KEYS) {
    const range = AI_BEHAVIOR_RANGES[key];
    expect(AI_BEHAVIOR_DEFAULTS[key]).toBeGreaterThanOrEqual(range.min);
    expect(AI_BEHAVIOR_DEFAULTS[key]).toBeLessThanOrEqual(range.max);
    expect(setAiBehaviorValue(key, -1000)).toBe(range.min);
    expect(setAiBehaviorValue(key, 1000)).toBe(range.max);
    expect(setAiBehaviorValue(key, NaN)).toBeCloseTo(AI_BEHAVIOR_DEFAULTS[key], 4);
  }
  resetAiBehavior();
  expect(AI_BEHAVIOR).toEqual(AI_BEHAVIOR_DEFAULTS);
});
