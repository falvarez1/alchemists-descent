import { afterEach, describe, expect, test } from 'vitest';
import { AI_PERSONALITIES, PERSONALITY_IDS, PERSONALITY_KEYS, resetPersonalities, setPersonalityValue } from '@/config/aiPersonalities';
import { aiTier, difficultyLevel, resetAiTiers, setAiTierValue } from '@/config/aiTiers';
import { CombatMemory } from '@/arena/ai/memory';
import { actionUtilities, selectAction, targetUtilities } from '@/arena/ai/utility';
import type { ActionSituation, CombatAction } from '@/arena/ai/utility';
import { chooseIntent, styleFor } from '@/arena/ai/intent';
import { Execution } from '@/arena/ai/execution';
import type { PerceivedFoe } from '@/arena/ai/execution';
import { createWorldView } from '@/arena/ai/worldView';
import type { Enemy } from '@/core/types';
import { Rng } from '@/core/rng';
import { Hand } from '@/arena/ai/control';
import type { BrainSelf } from '@/arena/ai/brain';
import { BasicBrain } from '@/arena/ai/brains/basic';

afterEach(() => { resetPersonalities(); resetAiTiers(); });
function foe(x = 70, hp = 100, slot = 1): PerceivedFoe {
  const f = { ref: {} as Enemy, slot, kind: 'fighter' as const, x, y: 100, cx: x, cy: 91, vx: 0, vy: 0,
    hp, maxHp: 100, hpFrac: hp / 100, halfW: 4, h: 17, dx: x, dy: 0, dist: x, grounded: true, sleeping: false };
  return { foe: f, x, y: 100, cx: x, cy: 91, vx: 0, vy: 0, age: 0, dist: x };
}
function situation(patch: Partial<ActionSituation> = {}): ActionSituation {
  return { me: { ...createWorldView().me, x: 0, y: 100, sy: 91, hp: 100, maxHp: 100, hpFrac: 1, shotAffordable: true },
    target: foe(), personality: AI_PERSONALITIES.duelist, skill: aiTier(3), memory: new CombatMemory(0),
    tick: 100, threatened: false, eligible: { shoot: true, kick: false, tactical: false, ultimate: false, defend: false, wait: true },
    damage: 18, variation: 0, defensiveKit: false, ...patch };
}
function utility(s: ActionSituation, action: CombatAction) { return actionUtilities(s).find(r => r.action === action)!; }

describe('independent personality and difficulty', () => {
  test('six complete bounded editable presets, and four named difficulties', () => {
    expect(PERSONALITY_IDS).toHaveLength(6);
    for (const id of PERSONALITY_IDS) for (const key of PERSONALITY_KEYS) {
      expect(AI_PERSONALITIES[id][key]).toBeGreaterThanOrEqual(0);
      expect(AI_PERSONALITIES[id][key]).toBeLessThanOrEqual(1);
    }
    expect(setPersonalityValue('berserker', 'aggression', 5)).toBe(1);
    expect(setPersonalityValue('duelist', 'defense', -1)).toBe(0);
    expect(['easy', 'normal', 'hard', 'expert', '2', 'toString', '0'].map(difficultyLevel)).toEqual([1, 3, 4, 5, 2, null, null]);
  });
  test('changing skill and resetting a brain retain personality', () => {
    const brain = new BasicBrain({ seed: 17, slot: 0, level: 1, personality: 'berserker' });
    brain.level = 5; brain.reset();
    expect(brain.personality).toBe('berserker');
    expect(brain.level).toBe(5);
    expect(brain.status.memory?.opponents).toBe(0);
    expect(brain.status.target).toBe('-');
    expect(brain.status.action).toBe('wait');
    expect(brain.status.threat).toBe(false);
  });
  test('berserker initiates more readily; ranger keeps greater spacing on the same fighter', () => {
    const decide = (id: 'berserker' | 'ranger' | 'duelist') => chooseIntent({ me: situation().me, foes: [foe(180)], style: styleFor('ilyra-voss'), current: 'search', heldFor: 100,
      currentTarget: null, otherLevel: () => false, noShotTicks: 0, personality: AI_PERSONALITIES[id] });
    expect(decide('berserker').scores.approach).toBeGreaterThan(decide('duelist').scores.approach);
    expect(decide('ranger').range).toBeGreaterThan(decide('berserker').range + 20);
  });
  test('guard preference changes a real defensive ability score, not legality', () => {
    const s = situation({ defensiveKit: true, threatened: true }); s.eligible.tactical = true;
    const low = utility({ ...s, personality: { ...s.personality, block: 0 } }, 'tactical');
    const high = utility({ ...s, personality: { ...s.personality, block: 1 } }, 'tactical');
    expect(high.total).toBeGreaterThan(low.total);
    expect(low.total).toBeGreaterThan(0);
  });
});

test('concealment changes awareness only after the observation latency', () => {
  setAiTierValue(3, 'reaction', 4);
  const e = new Execution(new Rng(7), 3), view = createWorldView(), target = foe(150);
  Object.assign(view.me, { x: 0, y: 100, sy: 91 });
  target.foe.clarity = 1; view.foes.push(target.foe);
  for (let tick = 0; tick <= 12; tick++) {
    view.tick = tick;
    if (tick === 5) target.foe.clarity = 0.1;
    e.record(view);
    if (tick >= 4 && tick < 9) expect(e.perceive(view)).toHaveLength(1);
    if (tick >= 9) expect(e.perceive(view)).toHaveLength(0);
  }
});

test('an observed kick or ultimate cannot inflate the wand finishing estimate', () => {
  const memory = new CombatMemory(0), target = foe();
  memory.hear({ by: 0, victim: 1, damage: 90, tick: 1, attack: 'ability.ultimate' });
  memory.update(20, 100, 100, [target], []);
  expect(memory.get(target.foe.ref)?.damageEstimate).toBe(0);
  memory.hear({ by: 0, victim: 1, damage: 18, tick: 21, attack: 'spell' });
  memory.update(30, 100, 100, [target], []);
  expect(memory.get(target.foe.ref)?.damageEstimate).toBe(18);
});

describe('contextual actions and stable commitments', () => {
  test('unavailable actions are excluded regardless of personality or finishing value', () => {
    const s = situation({ target: foe(15, 1), damage: 200 });
    s.eligible.shoot = false;
    expect(actionUtilities(s).map(r => r.action)).toEqual(['wait']);
  });
  test('a perceived projectile changes a duelist from shooting to defending', () => {
    const s = situation(); s.eligible.defend = true;
    expect(actionUtilities(s)[0].action).toBe('shoot');
    expect(actionUtilities({ ...s, threatened: true })[0].action).toBe('defend');
  });
  test('finish value uses remaining health and observed damage, not a shared health percentage', () => {
    const s = situation({ target: foe(70, 20), damage: 18 });
    expect(utility(s, 'shoot').terms.finish).toBe(0);
    expect(utility({ ...s, damage: 24 }, 'shoot').terms.finish).toBeGreaterThan(0);
    expect(utility({ ...s, damage: 0 }, 'shoot').terms.finish).toBe(0);
  });
  test('follow-ups require a delayed confirmed hit and expire', () => {
    const s = situation();
    expect(utility(s, 'shoot').terms.followUp).toBe(0);
    s.memory.hear({ by: 0, victim: 1, damage: 18, tick: 90 });
    s.memory.update(100, 100, 100, [{ ...s.target, age: 15 }], []);
    expect(utility(s, 'shoot').terms.followUp).toBe(0);
    s.memory.update(106, 100, 100, [{ ...s.target, age: 15 }], []);
    expect(utility({ ...s, tick: 106 }, 'shoot').terms.followUp).toBeGreaterThan(0);
    expect(utility({ ...s, tick: 150 }, 'shoot').terms.followUp).toBe(0);
  });
  test('repetition has a bounded penalty; a useful repeated attack remains eligible', () => {
    const s = situation({ personality: AI_PERSONALITIES.trickster });
    const before = utility(s, 'shoot').total;
    for (let i = 0; i < 100; i++) s.memory.acted('shoot');
    expect(utility(s, 'shoot').total).toBeLessThan(before);
    expect(utility(s, 'shoot').total).toBeGreaterThan(before - 0.13);
    expect(actionUtilities(s)[0].action).toBe('shoot');
  });
  test('small score changes do not break commitments; invalid actions and threats do', () => {
    const rows = [{ action: 'kick', total: 0.8, terms: {} }, { action: 'shoot', total: 0.77, terms: {} }];
    expect(selectAction(rows, 'shoot', false, false)).toBe('shoot');
    expect(selectAction(rows, 'shoot', true, false)).toBe('shoot');
    expect(selectAction(rows, 'shoot', true, true)).toBe('kick');
    expect(selectAction(rows.slice(0, 1), 'shoot', true, false)).toBe('kick');
  });
});

describe('targets and bounded observed memory', () => {
  test('retains a slightly more distant target; an invalid target is promptly replaced', () => {
    const a = foe(80), b = foe(70);
    const rows = targetUtilities([a, b], a.foe.ref, AI_PERSONALITIES.duelist, undefined);
    expect(rows[0].total).toBeGreaterThan(rows[1].total);
    expect(targetUtilities([b], a.foe.ref, AI_PERSONALITIES.duelist, undefined)[0].terms.persistence).toBe(0);
  });
  test('same observable opponents get equal scores regardless of slot or human ownership', () => {
    const a = foe(70, 100, 0), b = foe(70, 100, 1);
    const rows = targetUtilities([a, b], null, AI_PERSONALITIES.assassin, undefined);
    expect(rows[0].total).toBe(rows[1].total);
  });
  test('grudges wait for perception, decay, and disappear on reset', () => {
    const memory = new CombatMemory(0), target = foe();
    memory.hear({ by: 1, victim: 0, damage: 20, tick: 10 });
    memory.update(12, 80, 100, [{ ...target, age: 5 }], []);
    expect(memory.get(target.foe.ref)?.grudge).toBe(0);
    memory.update(15, 80, 100, [{ ...target, age: 5 }], []);
    const grudge = memory.get(target.foe.ref)!.grudge;
    expect(grudge).toBeGreaterThan(0);
    memory.update(315, 80, 100, [target], []);
    expect(memory.get(target.foe.ref)!.grudge).toBeCloseTo(grudge / 2);
    memory.reset(); expect(memory.opponents.size).toBe(0);
  });
  test('memory stays bounded under repeated arrivals and forgets absent opponents', () => {
    const memory = new CombatMemory(0);
    for (let t = 0; t < 100; t++) memory.update(t, 100, 100, [foe(t)], []);
    expect(memory.opponents.size).toBeLessThanOrEqual(16);
    memory.update(800, 100, 100, [], []);
    expect(memory.opponents.size).toBe(0);
  });
  test('vulnerability and isolation weights bias otherwise comparable targets', () => {
    const a = foe(70, 100), b = foe(70, 10);
    const rows = targetUtilities([a, b], null, AI_PERSONALITIES.assassin, undefined);
    expect(rows[1].total).toBeGreaterThan(rows[0].total);
    const isolated = foe(300);
    expect(targetUtilities([a, b, isolated], null, AI_PERSONALITIES.assassin, undefined)[2].terms.isolation).toBeGreaterThan(rows[0].terms.isolation);
  });
});

test('perception never reads hidden queued inputs and has nonzero latency at every skill', () => {
  for (const level of [1, 3, 4, 5] as const) {
    const e = new Execution(new Rng(19), level), view = createWorldView(), target = foe();
    Object.assign(view.me, { x: 0, y: 100, sy: 91 });
    Object.defineProperty(target.foe.ref, 'queuedInput', { get: () => { throw new Error('hidden input read'); } });
    view.foes.push(target.foe);
    const delay = aiTier(level).reaction;
    for (let tick = 0; tick <= delay; tick++) {
      view.tick = tick; e.record(view);
      expect(e.perceive(view)).toHaveLength(tick < delay ? 0 : 1);
    }
  }
  expect(setAiTierValue(5, 'reaction', 0)).toBe(1);
});

test('ordinary input execution does not move the body or grant resources, and releases queued inputs', () => {
  const self = { player: { x: 20, y: 30, hp: 80, firing: false }, input: { keys: {}, mouse: {} } } as BrainSelf;
  const hand = new Hand(self);
  hand.move(1); hand.jump(true); hand.fire(true); hand.aim(80, 90);
  expect(self.input.keys.right).toBe(true);
  expect(self.input.queuedJump).toBe('jump');
  expect(self.player).toMatchObject({ x: 20, y: 30, hp: 80, firing: true });
  hand.release();
  expect(self.player.firing).toBe(false);
  expect(self.input.queuedJump).toBeUndefined();
  expect(self.input.keys.right).toBe(false);
});
