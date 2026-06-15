import { describe, expect, it } from 'vitest';

import { compileWand } from '@/combat/wands/compiler';
import { WandSystem } from '@/combat/wands/WandSystem';
import { createDefaultWandLightSettings } from '@/config/params';
import { EventBus } from '@/core/events';
import type { CardId, Ctx } from '@/core/types';

/**
 * The cast compiler is a PURE function of the slot list, so every rule that
 * matters — left-to-right modifier attachment, multicast grouping, the x4
 * damage clamp, the 6-actions-per-group spill, the depth-1 trigger fold,
 * and group mana accounting — is pinned here.
 */
describe('compileWand', () => {
  it('compiles an empty or projectile-less wand to []', () => {
    expect(compileWand([])).toEqual([]);
    expect(compileWand([null, null, null])).toEqual([]);
    // Mods and multicasts with nothing to fire produce no program.
    expect(compileWand(['speed', 'double', null])).toEqual([]);
  });

  it('attaches a modifier to the next projectile: [speed, spark]', () => {
    const program = compileWand(['speed', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions).toHaveLength(1);
    expect(program[0].actions[0].card).toBe('spark');
    expect(program[0].actions[0].speedMul).toBeCloseTo(1.6);
    // speed (4) + spark (10)
    expect(program[0].manaCost).toBe(14);
  });

  it('does not leak consumed modifiers onto later projectiles', () => {
    const program = compileWand(['speed', 'spark', 'spark']);
    expect(program).toHaveLength(2);
    expect(program[0].actions[0].speedMul).toBeCloseTo(1.6);
    expect(program[1].actions[0].speedMul).toBe(1);
  });

  it('groups the next 2 projectiles under a double: [double, spark, spark]', () => {
    const program = compileWand(['double', 'spark', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions).toHaveLength(2);
    expect(program[0].actions.map((a) => a.card)).toEqual(['spark', 'spark']);
    // double (6) + spark (10) + spark (10)
    expect(program[0].manaCost).toBe(26);
  });

  it('ships a partial multicast when the deck runs dry: [double, spark]', () => {
    const program = compileWand(['double', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions).toHaveLength(1);
    expect(program[0].manaCost).toBe(16);
  });

  it('clamps the total damage multiplier at x4: [heavy, heavy, heavy, spark]', () => {
    const program = compileWand(['heavy', 'heavy', 'heavy', 'spark']);
    expect(program).toHaveLength(1);
    const a = program[0].actions[0];
    // 1.7^3 = 4.913 -> clamped to 4; velocity penalty is NOT clamped.
    expect(a.dmgMul).toBe(4);
    expect(a.speedMul).toBeCloseTo(0.75 ** 3);
  });

  it('spills past 6 projectiles per group into the next group', () => {
    const cards: CardId[] = ['triple', 'triple', 'triple',
      'spark', 'spark', 'spark', 'spark', 'spark', 'spark', 'spark', 'spark', 'spark'];
    const program = compileWand(cards);
    expect(program).toHaveLength(2);
    expect(program[0].actions).toHaveLength(6);
    expect(program[1].actions).toHaveLength(3);
    // Multicast mana lands on the group it opened: 3x triple + 6x spark.
    expect(program[0].manaCost).toBe(36 + 60);
    expect(program[1].manaCost).toBe(30);
  });

  it('folds the following group into a trigger payload: [trigger, spark, bomb]', () => {
    const program = compileWand(['trigger', 'spark', 'bomb']);
    // The bomb is consumed as the payload — NOT a separate program step.
    expect(program).toHaveLength(1);
    const spark = program[0].actions[0];
    expect(spark.card).toBe('spark');
    expect(spark.triggered).not.toBeNull();
    expect(spark.triggered).toHaveLength(1);
    expect(spark.triggered![0].card).toBe('bomb');
    // trigger (8) + spark (10) + payload bomb (24), paid up front.
    expect(program[0].manaCost).toBe(42);
  });

  it('carries the payload projectile its OWN mods', () => {
    const program = compileWand(['trigger', 'spark', 'heavy', 'bomb']);
    expect(program).toHaveLength(1);
    const payload = program[0].actions[0].triggered!;
    expect(payload[0].card).toBe('bomb');
    expect(payload[0].dmgMul).toBeCloseTo(1.7);
    expect(program[0].actions[0].dmgMul).toBe(1); // host spark untouched
  });

  it('ignores triggers inside a triggered payload (depth-1 clamp)', () => {
    const program = compileWand(['trigger', 'spark', 'trigger', 'bomb', 'spark']);
    expect(program).toHaveLength(2);
    const host = program[0].actions[0];
    expect(host.triggered![0].card).toBe('bomb');
    // The payload bomb's own trigger is a dud: it must NOT capture the
    // trailing spark, which stays a normal program group.
    expect(host.triggered![0].triggered).toBeNull();
    expect(program[1].actions[0].card).toBe('spark');
    expect(program[1].actions[0].triggered).toBeNull();
  });

  it('leaves a trigger with no following group as a dud (triggered: null)', () => {
    const program = compileWand(['trigger', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions[0].triggered).toBeNull();
  });

  it('compiles [flame] alone to a single one-action group', () => {
    const program = compileWand(['flame']);
    expect(program).toHaveLength(1);
    expect(program[0].actions[0]).toEqual({
      card: 'flame',
      speedMul: 1,
      dmgMul: 1,
      spreadAdd: 0,
      infused: false,
      bounces: 0,
      triggered: null,
    });
    expect(program[0].manaCost).toBe(2);
  });

  it('skips null slots entirely (slot indices still point at the real slots)', () => {
    const sparse = compileWand([null, 'speed', null, 'spark', null]);
    const dense = compileWand(['speed', 'spark']);
    // identical PROGRAM (slots differ by design: the HUD cursor must point
    // at the cards' true positions in the wand, gaps included)
    const stripSlots = (gs: typeof sparse) => gs.map(({ slots: _slots, ...g }) => g);
    expect(stripSlots(sparse)).toEqual(stripSlots(dense));
    expect(sparse[0].slots).toEqual([1, 3]);
    expect(dense[0].slots).toEqual([0, 1]);
  });

  it('marks spread/infuser/bounce on the action it modifies', () => {
    const program = compileWand(['spread', 'spread', 'infuser', 'bounce', 'spark']);
    const a = program[0].actions[0];
    expect(a.spreadAdd).toBeCloseTo(0.36);
    expect(a.infused).toBe(true);
    expect(a.bounces).toBe(2);
    // spread (3) x2 + infuser (6) + bounce (5) + spark (10)
    expect(program[0].manaCost).toBe(27);
  });
});

describe('wand light defaults', () => {
  it('preserves the shipped player wand light look', () => {
    expect(createDefaultWandLightSettings()).toEqual({
      intensity: 4.6,
      radius: 112,
      r: 1.0,
      g: 0.84,
      b: 0.6,
      flicker: 0.24,
      fillR: 0.5,
      fillG: 0.45,
      fillB: 0.36,
      torchIntensity: 5.6,
      torchRadius: 152,
      torchMinFlicker: 1.05,
    });
  });
});

describe('WandSystem runtime snapshots', () => {
  it('restores private playtest progression flags with the visible loadout', () => {
    const events = new EventBus();
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);
    const before = wands.snapshotRuntimeState();

    events.emit('recipeDiscovered', { name: 'ELIXIR OF LIFE', bounty: 100 });
    events.emit('levelChanged', { depth: 2, name: 'D2' });
    expect(wands.collection).toContain('infuser');
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(true);
    expect(wands.snapshotRuntimeState().depthsGranted).toEqual([2]);

    wands.restoreRuntimeState(before);

    const restored = wands.snapshotRuntimeState();
    expect(restored.infuserGranted).toBe(false);
    expect(restored.depthsGranted).toEqual([]);
    expect(wands.collection).toEqual(before.collection);

    events.emit('recipeDiscovered', { name: 'ELIXIR OF LIFE', bounty: 100 });
    expect(wands.collection.filter((card) => card === 'infuser')).toHaveLength(1);
  });
});

describe('WandSystem bench transfers', () => {
  it('supports indexed collection placement, slot swaps, and slot returns', () => {
    const events = new EventBus();
    let changed = 0;
    events.on('wandChanged', () => changed++);
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);

    wands.slotCollectionCard(1, 0, 1);
    expect(wands.wands[0].cards).toEqual(['spark', 'flame', null]);
    expect(wands.collection).not.toContain('flame');

    wands.swapSlots(0, 0, 0, 1);
    expect(wands.wands[0].cards).toEqual(['flame', 'spark', null]);

    wands.moveSlotToCollection(0, 1, 0);
    expect(wands.wands[0].cards).toEqual(['flame', null, null]);
    expect(wands.collection[0]).toBe('spark');
    expect(changed).toBe(3);
  });
});
