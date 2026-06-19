import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileWand } from '@/combat/wands/compiler';
import { buildWandSentenceView, nextWandSentence } from '@/combat/wands/sentenceView';
import { REVIEW_WAND_LOADOUTS, WAND_FRAMES, WandSystem } from '@/combat/wands/WandSystem';
import { TRIGGERED, TRIGGER_SOURCE_SPREAD } from '@/combat/wands/projectileMarks';
import { createDefaultWandLightSettings, createGameParams } from '@/config/params';
import { EventBus } from '@/core/events';
import type { CardId, CastAction, Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { cardGrantBenchCue, contextualObjectiveText } from '@/ui/Hud';
import { canOpenWandBench, cardMatchesBenchFilter, recipeHintsForCard, wandBenchUnavailableCue } from '@/ui/WandBench';

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

  it('preserves frost combo modifiers inside trigger payload actions', () => {
    const program = compileWand(['trigger', 'frostcharge', 'spark', 'shattercrit', 'spark']);
    expect(program).toHaveLength(1);
    const host = program[0].actions[0];
    const payload = host.triggered!;

    expect(host).toMatchObject({ card: 'spark', frostCharge: true, shatterCrit: false });
    expect(payload[0]).toMatchObject({ card: 'spark', frostCharge: false, shatterCrit: true });
    expect(program[0].manaCost).toBe(44);
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
      waterTrail: 0,
      oilTrail: 0,
      electricCharge: false,
      critWet: false,
      shortHoming: false,
      frostCharge: false,
      shatterCrit: false,
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

  it('marks review-only setup modifiers on the action they modify', () => {
    const program = compileWand(['watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming', 'frostcharge', 'shattercrit', 'spark', 'spark']);
    expect(program).toHaveLength(2);

    const wetSpark = program[0].actions[0];
    expect(wetSpark.card).toBe('spark');
    expect(wetSpark.waterTrail).toBe(18);
    expect(wetSpark.oilTrail).toBe(14);
    expect(wetSpark.electricCharge).toBe(true);
    expect(wetSpark.critWet).toBe(true);
    expect(wetSpark.shortHoming).toBe(true);
    expect(wetSpark.frostCharge).toBe(true);
    expect(wetSpark.shatterCrit).toBe(true);
    expect(program[0].manaCost).toBe(59);

    const drySpark = program[1].actions[0];
    expect(drySpark.card).toBe('spark');
    expect(drySpark.waterTrail).toBe(0);
    expect(drySpark.oilTrail).toBe(0);
    expect(drySpark.electricCharge).toBe(false);
    expect(drySpark.critWet).toBe(false);
    expect(drySpark.shortHoming).toBe(false);
    expect(drySpark.frostCharge).toBe(false);
    expect(drySpark.shatterCrit).toBe(false);
  });

  it('caps review-only trail budgets and strips projectile-body modifiers from unsupported casts', () => {
    const capped = compileWand(['watertrail', 'watertrail', 'spark']);
    expect(capped[0].actions[0].waterTrail).toBe(18);
    expect(capped[0].manaCost).toBe(20);

    const oilCapped = compileWand(['oiltrail', 'oiltrail', 'spark']);
    expect(oilCapped[0].actions[0].oilTrail).toBe(14);
    expect(oilCapped[0].manaCost).toBe(24);

    const unsupported = compileWand(['watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming', 'frostcharge', 'shattercrit', 'lightning']);
    expect(unsupported[0].actions[0].card).toBe('lightning');
    expect(unsupported[0].actions[0].waterTrail).toBe(0);
    expect(unsupported[0].actions[0].oilTrail).toBe(0);
    expect(unsupported[0].actions[0].electricCharge).toBe(false);
    expect(unsupported[0].actions[0].critWet).toBe(false);
    expect(unsupported[0].actions[0].shortHoming).toBe(false);
    expect(unsupported[0].actions[0].frostCharge).toBe(false);
    expect(unsupported[0].actions[0].shatterCrit).toBe(false);
    expect(unsupported[0].manaCost).toBe(75);
  });

  it('keeps built-in review loadouts from silently stripping review-only projectile-body modifiers', () => {
    const brass = compileWand(REVIEW_WAND_LOADOUTS[0].cards);
    expect(brass[0].actions[0]).toMatchObject({
      card: 'spark',
      waterTrail: 18,
      electricCharge: true,
      critWet: true,
      shortHoming: true,
    });

    const voidLattice = compileWand(REVIEW_WAND_LOADOUTS[1].cards);
    expect(voidLattice[0].actions[0]).toMatchObject({
      card: 'spark',
      oilTrail: 14,
    });
  });

  it('keeps named review primer loadouts valid and discoverable', () => {
    const loadouts = new Map(REVIEW_WAND_LOADOUTS.map((loadout) => [loadout.id, loadout]));
    expect([...loadouts.keys()]).toEqual(expect.arrayContaining([
      'wet-crit-primer',
      'fuse-primer',
      'trigger-primer',
      'frost-shatter-primer',
    ]));

    for (const loadout of REVIEW_WAND_LOADOUTS) {
      const frame = WAND_FRAMES[loadout.frameId];
      expect(frame, loadout.id).toBeDefined();
      expect(loadout.cards.length, loadout.id).toBeLessThanOrEqual(frame.capacity);
      expect(compileWand(loadout.cards).length, loadout.id).toBeGreaterThan(0);
    }

    expect(loadouts.get('wet-crit-primer')?.cards).toEqual(['watertrail', 'critwet', 'spark']);
    expect(loadouts.get('fuse-primer')?.cards).toEqual(['oiltrail', 'spark', 'flame']);
    expect(loadouts.get('trigger-primer')?.cards).toEqual(['trigger', 'spark', 'bomb']);
    expect(loadouts.get('frost-shatter-primer')?.cards).toEqual(['frostcharge', 'spark', 'shattercrit', 'spark']);
  });
});

describe('wand sentence view', () => {
  it('renders empty and malformed decks honestly', () => {
    const empty = buildWandSentenceView([]);
    expect(empty.lines[0]).toMatchObject({
      label: 'No spell ready',
      detail: 'Slot at least one projectile card',
      manaCost: 0,
      slots: [],
    });

    const malformed = buildWandSentenceView(['speed', 'double', null]);
    expect(malformed.lines[0].label).toBe('No spell ready');
    expect(malformed.warnings).toEqual(expect.arrayContaining([
      'Swift Charm in slot 1 has no projectile after it',
      'Twin Cast in slot 2 wants 2 projectiles, found 0',
    ]));
    expect(malformed.slotWarnings[0]).toContain('Swift Charm in slot 1 has no projectile after it');
    expect(malformed.slotWarnings[1]).toContain('Twin Cast in slot 2 wants 2 projectiles, found 0');
  });

  it('describes modifiers and their target slots', () => {
    const view = buildWandSentenceView(['speed', 'spark']);
    expect(view.lines[0]).toMatchObject({
      label: 'Next: Swift Spark Bolt',
      detail: '14 mana - slots 1, 2',
      manaCost: 14,
      slots: [0, 1],
    });
    expect(view.warnings).toEqual([]);
    expect(view.slotRelations[0]).toEqual(expect.arrayContaining([1]));
    expect(view.slotRelations[1]).toEqual(expect.arrayContaining([0]));
    expect(view.slotLinks[0]).toEqual(expect.arrayContaining([{ kind: 'modifier', from: 0, to: 1 }]));
    expect(view.slotLinks[1]).toEqual(expect.arrayContaining([{ kind: 'modifier', from: 0, to: 1 }]));
  });

  it('exposes directional modifier and multicast links for bench badges', () => {
    const view = buildWandSentenceView(['double', 'speed', 'spark', 'spark']);

    expect(view.slotLinks[0]).toEqual(expect.arrayContaining([
      { kind: 'multicast', from: 0, to: 2 },
      { kind: 'multicast', from: 0, to: 3 },
    ]));
    expect(view.slotLinks[1]).toEqual(expect.arrayContaining([{ kind: 'modifier', from: 1, to: 2 }]));
    expect(view.slotLinks[2]).toEqual(expect.arrayContaining([
      { kind: 'multicast', from: 0, to: 2 },
      { kind: 'modifier', from: 1, to: 2 },
    ]));
    expect(view.slotLinks[3]).toEqual(expect.arrayContaining([{ kind: 'multicast', from: 0, to: 3 }]));
  });

  it('describes wet setup modifiers in the next-cast sentence', () => {
    const view = buildWandSentenceView(['watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming', 'frostcharge', 'shattercrit', 'spark']);
    expect(view.lines[0]).toMatchObject({
      label: 'Next: Water-Trail Oil-Wick Electric Wet-Crit Short-Homing Frost-Charged Shatter-Crit Spark Bolt',
      detail: '59 mana - slots 1, 2, 3, 4, 5, 6, 7, 8',
      manaCost: 59,
      slots: [0, 1, 2, 3, 4, 5, 6, 7],
    });
  });

  it('warns when projectile-body modifiers target casts without projectile bodies', () => {
    const view = buildWandSentenceView(['watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming', 'frostcharge', 'shattercrit', 'lightning']);
    expect(view.lines[0]).toMatchObject({
      label: 'Next: Chain Lightning',
      detail: '75 mana - slots 1, 2, 3, 4, 5, 6, 7, 8',
    });
    const warnings = [
      'Water Trail in slot 1 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
      'Oil Wick in slot 2 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
      'Electric Charge in slot 3 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
      'Critical on Wet in slot 4 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
      'Short Homing in slot 5 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
      'Frost Charge in slot 6 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
      'Shatter Frozen in slot 7 needs a projectile body; Chain Lightning in slot 8 cannot carry it',
    ];
    expect(view.warnings).toEqual(expect.arrayContaining(warnings));
    for (let i = 0; i < warnings.length; i++) expect(view.slotWarnings[i]).toContain(warnings[i]);
    expect(view.slotWarnings[7]).toEqual(expect.arrayContaining(warnings));
  });

  it('warns when basic modifiers target casts without that effect surface', () => {
    const view = buildWandSentenceView(['heavy', 'warp']);

    expect(view.lines[0].label).toBe('Next: Warp Bolt');
    expect(view.warnings).toContain('Heavy Charm in slot 1 has no damage effect on Warp Bolt in slot 2');
    expect(view.slotWarnings[0]).toContain('Heavy Charm in slot 1 has no damage effect on Warp Bolt in slot 2');
    expect(view.slotWarnings[1]).toContain('Heavy Charm in slot 1 has no damage effect on Warp Bolt in slot 2');
    expect(view.slotLinks[0]).toEqual(expect.arrayContaining([{ kind: 'modifier', from: 0, to: 1 }]));
    expect(view.slotLinks[1]).toEqual(expect.arrayContaining([{ kind: 'modifier', from: 0, to: 1 }]));
  });

  it('describes trigger payloads as one upfront-paid cast', () => {
    const view = buildWandSentenceView(['trigger', 'spark', 'bomb']);
    expect(view.lines[0]).toMatchObject({
      label: 'Next: Spark Bolt -> Cast Bomb at impact',
      detail: '42 mana - slots 1, 2, 3',
      manaCost: 42,
      slots: [0, 1, 2],
    });
    expect(view.warnings).toEqual([]);
    expect(view.slotRelations[0]).toEqual(expect.arrayContaining([1, 2]));
    expect(view.slotRelations[1]).toEqual(expect.arrayContaining([0, 2]));
    expect(view.slotLinks[0]).toEqual(expect.arrayContaining([
      { kind: 'trigger-host', from: 0, to: 1 },
      { kind: 'trigger-payload', from: 0, to: 2 },
    ]));
    expect(view.slotLinks[1]).toEqual(expect.arrayContaining([{ kind: 'trigger-host', from: 0, to: 1 }]));
    expect(view.slotLinks[2]).toEqual(expect.arrayContaining([{ kind: 'trigger-payload', from: 0, to: 2 }]));
  });

  it('keeps trigger payload modifier links separate from trigger host and payload links', () => {
    const view = buildWandSentenceView(['trigger', 'spark', 'heavy', 'bomb']);

    expect(view.slotLinks[0]).toEqual(expect.arrayContaining([
      { kind: 'trigger-host', from: 0, to: 1 },
      { kind: 'trigger-payload', from: 0, to: 3 },
    ]));
    expect(view.slotLinks[2]).toEqual(expect.arrayContaining([{ kind: 'modifier', from: 2, to: 3 }]));
    expect(view.slotLinks[3]).toEqual(expect.arrayContaining([
      { kind: 'trigger-payload', from: 0, to: 3 },
      { kind: 'modifier', from: 2, to: 3 },
    ]));
  });

  it('does not badge ignored nested triggers as active trigger sources', () => {
    const view = buildWandSentenceView(['trigger', 'spark', 'trigger', 'bomb', 'spark']);

    expect(view.slotLinks[0]).toEqual(expect.arrayContaining([
      { kind: 'trigger-host', from: 0, to: 1 },
      { kind: 'trigger-payload', from: 0, to: 3 },
    ]));
    expect((view.slotLinks[2] ?? []).filter((link) => link.from === 2)).toEqual([]);
  });

  it('warns when a trigger has a host but no payload group', () => {
    const view = buildWandSentenceView(['trigger', 'spark']);
    expect(view.lines[0]).toMatchObject({
      label: 'Next: Spark Bolt',
      detail: '18 mana - slots 1, 2',
    });
    expect(view.warnings).toContain('Trigger in slot 1 has no payload group after its host');
    expect(view.slotWarnings[0]).toContain('Trigger in slot 1 has no payload group after its host');
    expect(view.slotWarnings[1]).toContain('Trigger in slot 1 has no payload group after its host');
  });

  it('warns when stacked multicasts request more projectiles than the deck supplies', () => {
    const view = buildWandSentenceView(['double', 'triple', 'spark', 'spark', 'spark', 'spark']);
    expect(view.lines[0].label).toBe('Next: 4 casts: Spark Bolt + Spark Bolt + Spark Bolt + Spark Bolt');
    expect(view.lines[0].manaCost).toBe(58);
    expect(view.warnings).toContain('Stacked multicasts starting slot 1 want 5 projectiles, found 4');
    expect(view.slotWarnings[0]).toContain('Stacked multicasts starting slot 1 want 5 projectiles, found 4');
    expect(view.slotWarnings[1]).toContain('Stacked multicasts starting slot 1 want 5 projectiles, found 4');
    expect(view.slotRelations[0]).toEqual(expect.arrayContaining([2, 3, 4, 5]));
    expect(view.slotRelations[1]).toEqual(expect.arrayContaining([2, 3, 4, 5]));
  });

  it('rotates labels around the current cast cursor', () => {
    const view = buildWandSentenceView(['spark', 'dig'], 1);
    expect(view.lines[0].label).toBe('Next: Excavate Ray');
    expect(view.lines[1].label).toBe('Then: Spark Bolt');
    expect(nextWandSentence(['spark', 'dig'], 1).label).toBe('Next: Excavate Ray');
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

describe('wand bench card organization', () => {
  it('filters cards by kind and high-signal tags', () => {
    expect(cardMatchesBenchFilter('spark', 'all')).toBe(true);
    expect(cardMatchesBenchFilter('spark', 'projectile')).toBe(true);
    expect(cardMatchesBenchFilter('spark', 'modifier')).toBe(false);
    expect(cardMatchesBenchFilter('speed', 'modifier')).toBe(true);
    expect(cardMatchesBenchFilter('double', 'multicast')).toBe(true);
    expect(cardMatchesBenchFilter('watertrail', 'setup')).toBe(true);
    expect(cardMatchesBenchFilter('frostcharge', 'setup')).toBe(true);
    expect(cardMatchesBenchFilter('conjure', 'terrain')).toBe(true);
    expect(cardMatchesBenchFilter('critwet', 'terrain')).toBe(false);
  });

  it('keeps recipe hints tied to implemented card combinations', () => {
    expect(recipeHintsForCard('watertrail').join(' ')).toContain('Critical on Wet');
    expect(recipeHintsForCard('watertrail').join(' ')).toContain('Electric Charge');
    expect(recipeHintsForCard('oiltrail').join(' ')).toContain('Flame');
    expect(recipeHintsForCard('frostcharge').join(' ')).toContain('Shatter Frozen');
    expect(recipeHintsForCard('shattercrit').join(' ')).toContain('Frost Charge');
    expect(recipeHintsForCard('trigger').join(' ')).toContain('payload');
    expect(recipeHintsForCard('spark')).toEqual([]);
  });
});

function objectiveCtx(opts: {
  player?: { x: number; y: number };
  collection?: CardId[];
  refuge?: { x: number; y: number } | null;
  portal?: { x: number; y: number; open: boolean } | null;
  keyTaken?: boolean;
  waystones?: Array<{ x: number; y: number; lit: boolean }>;
  mode?: 'play' | 'build';
} = {}): Ctx {
  return {
    state: { mode: opts.mode ?? 'play' },
    player: opts.player ?? { x: 100, y: 100 },
    wands: { collection: opts.collection ?? [] },
    levels: {
      current: {
        refuge: opts.refuge ?? null,
        portal: opts.portal ?? null,
        keyTaken: opts.keyTaken ?? false,
        waystones: opts.waystones ?? [],
      },
    },
  } as unknown as Ctx;
}

describe('HUD contextual objectives', () => {
  it('prioritizes short card-to-bench guidance when spare cards can be slotted', () => {
    const ctx = objectiveCtx({
      collection: ['speed'],
      refuge: { x: 120, y: 100 },
      portal: { x: 500, y: 100, open: false },
    });

    expect(contextualObjectiveText(ctx, 'FIND THE GOLDEN KEY', 60)).toBe('BENCH AVAILABLE IN REFUGE');
  });

  it('shows portal and key state with plan wording', () => {
    const beforeKey = objectiveCtx({ portal: { x: 500, y: 100, open: false }, keyTaken: false });
    const afterKey = objectiveCtx({ portal: { x: 500, y: 100, open: false }, keyTaken: true });

    expect(contextualObjectiveText(beforeKey, 'anything')).toBe('FIND THE GOLDEN KEY');
    expect(contextualObjectiveText(afterKey, 'anything')).toBe('RETURN TO THE PORTAL');
  });

  it('calls out nearby unlit waystones before falling back to the base objective', () => {
    const nearWaystone = objectiveCtx({
      player: { x: 100, y: 100 },
      waystones: [{ x: 130, y: 100, lit: false }],
    });
    const litWaystone = objectiveCtx({
      player: { x: 100, y: 100 },
      waystones: [{ x: 130, y: 100, lit: true }],
    });

    expect(contextualObjectiveText(nearWaystone, 'EXPLORE')).toBe('LIGHT WAYSTONE: BRING FIRE');
    expect(contextualObjectiveText(litWaystone, 'EXPLORE')).toBe('EXPLORE');
  });

  it('gives card-grant bench directions even before the Refuge map marker is visible', () => {
    const away = objectiveCtx({
      player: { x: 60, y: 150 },
      refuge: { x: 120, y: 100 },
    });
    const near = objectiveCtx({
      player: { x: 118, y: 100 },
      refuge: { x: 120, y: 100 },
    });

    expect(cardGrantBenchCue(away)).toBe('BENCH IN REFUGE EAST ABOVE - 78 STEPS');
    expect(cardGrantBenchCue(near)).toBe('BENCH AVAILABLE IN REFUGE');
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

    events.emit('recipeBrewed', { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: true });
    events.emit('levelChanged', { depth: 2, name: 'D2' });
    expect(wands.collection).toContain('infuser');
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(true);
    expect(wands.snapshotRuntimeState().depthsGranted).toEqual([2]);

    wands.restoreRuntimeState(before);

    const restored = wands.snapshotRuntimeState();
    expect(restored.infuserGranted).toBe(false);
    expect(restored.depthsGranted).toEqual([]);
    expect(wands.collection).toEqual(before.collection);

    events.emit('recipeBrewed', { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: true });
    expect(wands.collection.filter((card) => card === 'infuser')).toHaveLength(1);
  });

  it('marks legacy loadouts that already contain Infuser as progression-complete', () => {
    const events = new EventBus();
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);

    wands.loadLoadout({
      active: 0,
      collection: ['infuser'],
      wands: [
        { frameId: 'oak', cards: ['spark', null, null], mana: 90 },
        { frameId: 'bone', cards: ['dig', null, null, null], mana: 120 },
      ],
    });
    wands.markDepthGrantsThrough(3);
    events.emit('recipeBrewed', { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: true });

    expect(wands.collection.filter((card) => card === 'infuser')).toHaveLength(1);
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(true);
  });

  it('keeps Infuser out of waystone random grants', () => {
    const events = new EventBus();
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      events.emit('waystoneLit');
    } finally {
      random.mockRestore();
    }

    expect(wands.collection).not.toContain('infuser');
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(false);
  });

  it('does not spend mana or advance the cast cycle while a black hole is charging', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    wands.loadLoadout({
      active: 0,
      collection: ['blackhole'],
      wands: [{ frameId: 'oak', cards: ['blackhole', null, null], mana: 90 }],
    });
    const before = wands.snapshotRuntimeState().wands[0];
    ctx.input.activeChargingBlackHole = { type: 'blackhole' } as typeof ctx.input.activeChargingBlackHole;

    wands.fire(ctx);

    const after = wands.snapshotRuntimeState().wands[0];
    expect(ctx.projectiles).toHaveLength(0);
    expect(after.mana).toBe(before.mana);
    expect(after.castIndex).toBe(before.castIndex);
    expect(after.cooldown).toBe(before.cooldown);
  });

  it('uses a zero-mana pick strike with downward pogo on dry fire', () => {
    const ctx = makeCastCtx();
    let eroded: { x: number; y: number; rad: number } | null = null;
    let dug = 0;
    ctx.audio.dig = () => {
      dug++;
    };
    ctx.player.aimAngle = Math.PI / 2;
    ctx.player.vy = 1.4;
    ctx.world.replaceCellAt(ctx.world.idx(10, 18), Cell.Stone, 0x777777);
    ctx.spells.digRay = () => ({ x: 10, y: 18 });
    ctx.spells.erodeAt = (x: number, y: number, rad: number) => {
      eroded = { x, y, rad };
      return 1;
    };
    const wands = new WandSystem(ctx);
    wands.loadLoadout({
      active: 0,
      collection: [],
      wands: [{ frameId: 'oak', cards: ['spark', null, null], mana: 0 }],
    });

    wands.fire(ctx);

    expect(ctx.projectiles).toHaveLength(0);
    expect(eroded).toEqual({ x: 10, y: 18, rad: 2 });
    expect(ctx.player.vy).toBeLessThan(0);
    expect(dug).toBe(1);
  });
});

describe('WandSystem metaprogression', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('seeds fresh-run collection from discovered cards without duplicating starter wand cards', () => {
    const store = new Map<string, string>([
      [
        'alchemists-descent-card-discovery-v1',
        JSON.stringify({ version: 1, cards: ['flame', 'spark', 'dig', 'blackhole'] }),
      ],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const ctx = {
      events: new EventBus(),
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'play' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);

    expect(wands.collection.slice(0, 2)).toEqual(['double', 'speed']);
    expect(wands.collection).toContain('flame');
    expect(wands.collection).toContain('blackhole');
    expect(wands.collection).not.toContain('spark');
    expect(wands.collection).not.toContain('dig');

    wands.collection.length = 0;
    wands.resetLoadout();

    expect(wands.collection).toContain('flame');
    expect(wands.collection).toContain('blackhole');
    expect(wands.collection).not.toContain('spark');
    expect(wands.collection).not.toContain('dig');
  });
});

function action(card: CardId, overrides: Partial<CastAction> = {}): CastAction {
  return {
    card,
    speedMul: 1,
    dmgMul: 1,
    spreadAdd: 0,
    infused: false,
    waterTrail: 0,
    oilTrail: 0,
    electricCharge: false,
    critWet: false,
    shortHoming: false,
    frostCharge: false,
    shatterCrit: false,
    bounces: 0,
    triggered: null,
    ...overrides,
  };
}

function makeCastCtx(): Ctx & { spawned: Array<{ x: number; y: number; type: number | null }> } {
  const spawned: Array<{ x: number; y: number; type: number | null }> = [];
  const ctx = {
    spawned,
    world: new World(),
    events: new EventBus(),
    telemetry: { count: () => undefined },
    audio: {
      zap: () => undefined,
      noiseBurst: () => undefined,
      tone: () => undefined,
      flame: () => undefined,
      dig: () => undefined,
      dryFire: () => undefined,
      learn: () => undefined,
      wandSwap: () => undefined,
    },
    params: createGameParams(),
    state: { mode: 'play', frameCount: 1 },
    input: {
      mouse: { x: 180, y: 180 },
      activeChargingBlackHole: null,
    },
    player: {
      perks: {},
      dead: false,
      aimAngle: 0,
      vx: 0,
      mana: 0,
      maxMana: 0,
    },
    projectiles: [],
    particles: {
      spawn: (x: number, y: number, _vx: number, _vy: number, type: number | null) => {
        spawned.push({ x, y, type });
      },
      burst: () => undefined,
    },
    lightning: { cast: () => undefined },
    spells: {
      wandTip: () => ({ x: 10, y: 10 }),
      digRay: () => null,
      erodeAt: () => undefined,
    },
    fx: { digBeam: null },
    flask: { state: { material: null, count: 0, capacity: 600 } },
  } as unknown as Ctx & { spawned: Array<{ x: number; y: number; type: number | null }> };
  return ctx;
}

describe('WandSystem trigger executor', () => {
  it('uses the impact point for triggered conjure instead of the live mouse', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);

    wands.castActionAt(ctx, action('conjure'), 24, 25, 0, {
      origin: 'trigger',
      target: { x: 24, y: 25 },
    });

    expect(ctx.world.types[ctx.world.idx(24, 25)]).toBe(Cell.Stone);
    expect(ctx.world.types[ctx.world.idx(180, 180)]).toBe(Cell.Empty);
  });

  it('uses the impact point for triggered vitrify instead of the live mouse', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    ctx.world.types[ctx.world.idx(35, 36)] = Cell.Water;
    ctx.world.types[ctx.world.idx(180, 180)] = Cell.Water;

    wands.castActionAt(ctx, action('vitrify'), 35, 36, 0, {
      origin: 'trigger',
      target: { x: 35, y: 36 },
    });

    expect(ctx.world.types[ctx.world.idx(35, 36)]).toBe(Cell.Glass);
    expect(ctx.world.types[ctx.world.idx(180, 180)]).toBe(Cell.Water);
  });

  it('emits triggered flame from the impact point immediately', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);

    wands.castActionAt(ctx, action('flame'), 40, 41, 0, {
      origin: 'trigger',
      target: { x: 40, y: 41 },
    });

    expect(ctx.spawned.length).toBeGreaterThan(0);
    expect(ctx.spawned.every((particle) => particle.x === 40 && particle.y === 41 && particle.type === Cell.Fire)).toBe(true);
  });

  it('applies damage modifiers to live flame stream density', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);

    wands.castActionAt(ctx, action('flame', { dmgMul: 2, speedMul: 1.6, spreadAdd: 0.18 }), 40, 41, 0);
    wands.update(ctx);

    expect(ctx.spawned).toHaveLength(8);
    expect(ctx.spawned.every((particle) => particle.type === Cell.Fire)).toBe(true);
  });

  it('carries heavy modifiers onto bomb projectiles', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);

    wands.castActionAt(ctx, action('bomb', { dmgMul: 1.7 }), 55, 56, 0);

    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].type).toBe('bomb');
    expect(ctx.projectiles[0].mul).toBeCloseTo(1.7);
  });

  it('marks wand-cast black-hole hosts with trigger payload metadata', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    const payload = action('spark');

    wands.castActionAt(ctx, action('blackhole', { triggered: [payload] }), 55, 56, 0);

    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].type).toBe('blackhole');
    expect(ctx.projectiles[0].charging).toBe(true);
    expect(ctx.input.activeChargingBlackHole).toBe(ctx.projectiles[0]);
    expect(TRIGGERED.get(ctx.projectiles[0])).toEqual([payload]);
    expect(TRIGGER_SOURCE_SPREAD.get(ctx.projectiles[0])).toBe(0.02);
  });

  it('spawns triggered black holes without claiming the mouse-up charging lifecycle', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    const payload = action('spark');

    wands.castActionAt(ctx, action('blackhole', { triggered: [payload] }), 55, 56, 0, {
      origin: 'trigger',
      target: { x: 55, y: 56 },
    });

    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].type).toBe('blackhole');
    expect(ctx.projectiles[0].charging).toBe(false);
    expect(ctx.input.activeChargingBlackHole).toBeNull();
    expect(TRIGGERED.get(ctx.projectiles[0])).toEqual([payload]);
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
    wands.grantCard(ctx, 'flame');
    const flameIndex = wands.collection.indexOf('flame');

    wands.slotCollectionCard(flameIndex, 0, 1);
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

describe('wand bench access', () => {
  function benchCtx(overrides: Partial<Ctx> = {}): Ctx {
    return {
      state: { mode: 'play' },
      player: { x: 100, y: 100, dead: false },
      levels: {
        current: {
          refuge: { x: 120, y: 100 },
          cauldron: null,
        },
      },
      ...overrides,
    } as unknown as Ctx;
  }

  it('opens only in play near the Refuge', () => {
    expect(canOpenWandBench(benchCtx())).toBe(true);
    expect(canOpenWandBench(benchCtx({ player: { x: 220, y: 100, dead: false } } as Partial<Ctx>))).toBe(false);
    expect(canOpenWandBench(benchCtx({ state: { mode: 'build' } } as Partial<Ctx>))).toBe(false);
    expect(canOpenWandBench(benchCtx({ player: { x: 100, y: 100, dead: true } } as Partial<Ctx>))).toBe(false);
    expect(canOpenWandBench(benchCtx({
      levels: { current: { refuge: undefined, cauldron: { x: 110, y: 100 } } },
    } as Partial<Ctx>))).toBe(false);
  });

  it('opens from anywhere in play once god mode is active', () => {
    expect(canOpenWandBench(benchCtx({
      state: { mode: 'play', debugGodMode: true },
      player: { x: 400, y: 100, dead: false },
    } as Partial<Ctx>))).toBe(true);
    expect(canOpenWandBench(benchCtx({
      state: { mode: 'build', debugGodMode: true },
    } as Partial<Ctx>))).toBe(false);
  });

  it('explains the Refuge direction when the bench is unavailable', () => {
    expect(wandBenchUnavailableCue(benchCtx({
      player: { x: 60, y: 150, dead: false },
      levels: { current: { refuge: { x: 120, y: 100 }, cauldron: null } },
    } as Partial<Ctx>))).toBe('WAND BENCH IN REFUGE EAST ABOVE - 78 STEPS');
  });
});
