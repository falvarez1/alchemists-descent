import { afterEach, describe, expect, test } from 'vitest';
import { AI_LEVELS, AI_TIERS, AI_TIER_DEFAULTS, AI_TIER_KEYS, AI_TIER_RANGES, aiTier, clampAiLevel, resetAiTiers, setAiTierValue } from '@/config/aiTiers';
import { Rng } from '@/core/rng';
import { Execution } from '@/arena/ai/execution';
import type { WorldView } from '@/arena/ai/worldView';
import { isExternallyDriven, setExternalControl } from '@/input/externalControl';
import type { InputState } from '@/core/types';

/** The computer fighter's pure parts (docs/arena/AI-FIGHTERS.md): the skill levels, the seeded execution noise and the keyboard switch. */

afterEach(() => resetAiTiers());

describe('the skill levels', () => {
  test('are a dial: every number moves the right way from level 1 to level 5', () => {
    for (let l = 1; l < 5; l++) {
      const a = AI_TIER_DEFAULTS[(l) as 1], b = AI_TIER_DEFAULTS[(l + 1) as 2];
      expect(b.reaction).toBeLessThan(a.reaction);
      expect(b.aimError).toBeLessThan(a.aimError);
      expect(b.decision).toBeLessThan(a.decision);
      expect(b.mistake).toBeLessThan(a.mistake);
    }
  });

  test('every default lies inside its declared range', () => {
    for (const l of AI_LEVELS) for (const k of AI_TIER_KEYS) {
      expect(AI_TIER_DEFAULTS[l][k], `${l} ${k}`).toBeGreaterThanOrEqual(AI_TIER_RANGES[k].min);
      expect(AI_TIER_DEFAULTS[l][k], `${l} ${k}`).toBeLessThanOrEqual(AI_TIER_RANGES[k].max);
    }
  });

  test('clampAiLevel rounds and clamps anything the console or the panel passes', () => {
    expect([0, 1, 2.4, 2.6, 5, 9, -3, Number.NaN].map(clampAiLevel)).toEqual([1, 1, 2, 3, 5, 5, 1, 3]);
  });

  test('a live write is clamped to its range and stepped, and reset restores the shipped numbers', () => {
    expect(setAiTierValue(3, 'reaction', 500)).toBe(AI_TIER_RANGES.reaction.max);
    expect(setAiTierValue(3, 'mistake', -1)).toBe(0);
    expect(setAiTierValue(3, 'aimError', 5.26)).toBeCloseTo(5.5, 5);
    expect(aiTier(3).reaction).toBe(60);
    resetAiTiers();
    expect(AI_TIERS[3]).toEqual(AI_TIER_DEFAULTS[3]);
  });
});

function view(tick: number, foes: Array<{ ref: object; x: number }>): WorldView {
  return {
    tick,
    me: { x: 0, y: 0, sy: -9 },
    foes: foes.map((f) => ({ ref: f.ref, x: f.x, y: 0, cx: f.x, cy: -4, vx: 0, vy: 0 })),
  } as unknown as WorldView;
}

describe('execution: reaction time', () => {
  test('a bot sees its foes where they were `reaction` ticks ago, and a foe that just arrived not at all', () => {
    const e = new Execution(new Rng(1), 1);
    const a = {}, b = {};
    const delay = aiTier(1).reaction;
    for (let t = 0; t < delay + 5; t++) {
      const v = view(t, t < delay + 2 ? [{ ref: a, x: 100 + t }] : [{ ref: a, x: 100 + t }, { ref: b, x: 300 }]);
      e.record(v);
      if (t === delay + 4) {
        const seen = e.perceive(v);
        expect(seen.map((s) => s.foe.ref)).toEqual([a]);
        expect(seen[0].x).toBe(100 + (t - delay));
        expect(seen[0].age).toBe(delay);
      }
    }
  });

  test('a sharper bot is less behind', () => {
    const a = {};
    const slow = new Execution(new Rng(1), 1), quick = new Execution(new Rng(1), 5);
    for (let t = 0; t < 40; t++) { const v = view(t, [{ ref: a, x: 100 + t }]); slow.record(v); quick.record(v); }
    const v = view(39, [{ ref: a, x: 139 }]);
    expect(quick.perceive(v)[0].x).toBeGreaterThan(slow.perceive(v)[0].x);
  });
});

describe('execution: seeded noise', () => {
  const run = (seed: number, level: 1 | 5): { lapses: number; aim: number[] } => {
    const e = new Execution(new Rng(seed), level);
    const aim: number[] = [];
    for (let t = 0; t < 2000; t++) {
      if (e.decisionDue(t)) e.decided(t);
      if (t % 40 === 0) aim.push(+e.tickAim(1).toFixed(6));
    }
    return { lapses: e.lapses, aim };
  };

  test('the same seed gives the same lapses and the same aim: a fight can be replayed', () => {
    expect(run(7, 1)).toEqual(run(7, 1));
  });

  test('another seed gives another hand', () => {
    expect(run(7, 1)).not.toEqual(run(8, 1));
  });

  test('a clumsy bot lapses more often than a sharp one, and aims wider', () => {
    let clumsy = 0, sharp = 0, wideC = 0, wideS = 0;
    for (let s = 1; s <= 12; s++) {
      const c = run(s, 1), k = run(s, 5);
      clumsy += c.lapses; sharp += k.lapses;
      wideC += Math.max(...c.aim.map(Math.abs)); wideS += Math.max(...k.aim.map(Math.abs));
    }
    expect(clumsy).toBeGreaterThan(sharp * 2);
    expect(wideC).toBeGreaterThan(wideS * 2);
  });

  test('decisions are spaced by the level\'s interval, not every tick', () => {
    const e = new Execution(new Rng(3), 1);
    let decided = 0;
    for (let t = 0; t < 400; t++) if (e.decisionDue(t)) { e.decided(t); decided++; }
    expect(decided).toBeLessThan(400 / (aiTier(1).decision * 0.8) + 2);
    expect(decided).toBeGreaterThan(400 / (aiTier(1).decision * 1.2) - 2);
  });

  test('a faster target is harder to track: the aim error scales up with its speed', () => {
    const e = new Execution(new Rng(5), 1);
    e.decided(0);
    for (let i = 0; i < 60; i++) e.tickAim(0);
    const still = Math.abs(e.tickAim(0));
    const fast = Math.abs(e.tickAim(3));
    expect(fast).toBeGreaterThanOrEqual(still);
  });
});

describe('the keyboard switch', () => {
  const input = (): InputState => ({ keys: {} } as unknown as InputState);

  test('is per input object, off by default, and reversible', () => {
    const a = input(), b = input();
    expect(isExternallyDriven(a)).toBe(false);
    setExternalControl(a, true);
    expect(isExternallyDriven(a)).toBe(true);
    expect(isExternallyDriven(b)).toBe(false);
    setExternalControl(a, false);
    expect(isExternallyDriven(a)).toBe(false);
  });
});
