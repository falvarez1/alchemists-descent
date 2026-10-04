import { expect, test } from 'vitest';
import { AdaptiveMemory } from '@/arena/ai/adaptiveMemory';
import { chooseMelee } from '@/arena/ai/meleeChoice';
import { Rng } from '@/core/rng';
import { planPursuit } from '@/arena/ai/pursuit';
import { stockNav } from '@/arena/ai/nav';
import { createWorldView } from '@/arena/ai/worldView';

test('two failures exclude an unchanged plan even after a long wait', () => {
  const memory = new AdaptiveMemory();
  memory.record('left-platform', 'lip', false);
  expect(memory.allowed('left-platform', 'lip')).toBe(true);
  memory.record('left-platform', 'lip', false);
  expect(memory.allowed('left-platform', 'lip')).toBe(false);
  expect(memory.allowed('left-platform', 'through')).toBe(true);
  expect(memory.allowed('right-platform', 'lip')).toBe(true);
});
test('confirmed outcomes reward useful moves in proportion to difficulty', () => {
  const memory = new AdaptiveMemory();
  for (let i = 0; i < 5; i++) memory.record('near', 'launcher', true, 20);
  expect(memory.bias('near', 'launcher', 0)).toBe(0);
  expect(memory.bias('near', 'launcher', .85)).toBeGreaterThan(memory.bias('near', 'launcher', .2));
  expect(memory.bias('far', 'launcher', 1)).toBe(0);
  memory.reset(); expect(memory.bias('near', 'launcher', 1)).toBe(0);
});
test('hits credit the matching pending attack and its approach, not unrelated hits', () => {
  const memory = new AdaptiveMemory();
  memory.attempt('near', 'opener', 100, 160, 'melee.opener', 0, { context: 'floor>upper', action: 'through' });
  expect(memory.ready('near', 'opener')).toBe(false);
  expect(memory.hit(1, 'spell', 120, 20)).toBe(false);
  expect(memory.hit(0, 'melee.opener', 120, 20)).toBe(true);
  expect(memory.ready('near', 'opener')).toBe(true);
  expect(memory.hit(0, 'melee.opener', 121, 20)).toBe(false);
  expect(memory.bias('near', 'opener', 1)).toBeGreaterThan(0);
  expect(memory.bias('floor>upper', 'through', 1)).toBeGreaterThan(0);
  memory.expire(300);
  expect(memory.allowed('near', 'opener')).toBe(true);
});
test('misses expire once, pending swings are bounded, and interrupted swings do not teach failure', () => {
  const memory = new AdaptiveMemory();
  memory.attempt('near', 'opener', 0, 30, 'melee.opener', 0);
  memory.expire(31); memory.expire(32);
  expect(memory.allowed('near', 'opener')).toBe(true);
  memory.attempt('near', 'opener', 40, 70, 'melee.opener', 0);
  memory.interrupt(); memory.expire(80);
  expect(memory.allowed('near', 'opener')).toBe(true);
  memory.attempt('near', 'opener', 90, 120, 'melee.opener', 0);
  memory.expire(121); expect(memory.allowed('near', 'opener')).toBe(false);
});

test('learned success changes actual choices more on expert, while retaining variation', () => {
  const memory = new AdaptiveMemory();
  for (let i = 0; i < 8; i++) memory.record('near', 'launcher', true, 30);
  const count = (strength: number) => {
    const rng = new Rng(43); let launchers = 0;
    for (let i = 0; i < 1000; i++) if (chooseMelee([{ kind: 'opener', value: .6 }, { kind: 'launcher', value: .6 }], 'near', memory, strength, rng) === 'launcher') launchers++;
    return launchers;
  };
  expect(count(.85)).toBeGreaterThan(count(.2) + 150);
  expect(count(.85)).toBeLessThan(1000);
  memory.record('near', 'opener', false); memory.record('near', 'opener', false);
  expect(chooseMelee([{ kind: 'opener', value: 100 }], 'near', memory, 0, new Rng(1))).toBeNull();
});

test('a failed climb selects another physical route and never a third identical failure', () => {
  const memory = new AdaptiveMemory(), nav = stockNav(), rng = new Rng(43);
  const from = nav.node('floor')!, to = nav.node('side0')!;
  const me = { ...createWorldView().me, x: 640, y: 639, maxLevit: 100 };
  const pick = () => planPursuit(nav, from, to, me, 630, 0, memory, .5, rng, () => true);
  const first = pick()!;
  expect(first.edge.through).toBe(true);
  memory.record(first.context, first.action, false); memory.record(first.context, first.action, false);
  for (let i = 0; i < 20; i++) expect(pick()?.action).not.toBe(first.action);
  for (const action of ['through-center', 'through-left', 'through-right', 'lip']) {
    memory.record(first.context, action, false); memory.record(first.context, action, false);
  }
  expect(pick()).toBeNull();
});
