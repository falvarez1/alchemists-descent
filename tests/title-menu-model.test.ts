import { describe, expect, test } from 'vitest';
import { FIGHTER_DEFS } from '@/content/fighters';
import { KIT_DEFS, KIT_ORDER } from '@/content/kits';
import { MAX_MUTATORS, MUTATOR_DEFS, MUTATOR_ORDER } from '@/content/mutators';
import { DIFFICULTY_ORDER } from '@/config/difficulty';
import {
  complicationDetail,
  complicationsDetail,
  complicationsTotal,
  complicationsValue,
  continueLine,
  cycleDifficulty,
  cycleKit,
  cycleOpen,
  dailyLines,
  difficultyDetail,
  keyHints,
  kitDetail,
  loadMark,
  moveFocusIndex,
  seedDetail,
  seedValue,
  toggleComplication,
} from '@/ui/title/titleMenuModel';

describe('cycleOpen: Left / Right on a choice row', () => {
  test('steps to the next open option, wrapping, and skips the locked ones', () => {
    const order = ['a', 'b', 'c', 'd'] as const;
    const open = (o: string): boolean => o !== 'b' && o !== 'c';
    expect(cycleOpen(order, open, 'a', 1)).toBe('d');
    expect(cycleOpen(order, open, 'd', 1)).toBe('a');
    expect(cycleOpen(order, open, 'a', -1)).toBe('d');
    expect(cycleOpen(order, open, 'd', -1)).toBe('a');
  });

  test('stays put when nothing else is open, or when the current one is not in the list', () => {
    expect(cycleOpen(['a', 'b'], (o) => o === 'a', 'a', 1)).toBe('a');
    expect(cycleOpen(['a', 'b'], () => true, 'z', 1)).toBe('a');
  });

  test('the kit row skips locked kits; a fresh profile only has the Sparkwright', () => {
    expect(cycleKit(new Set(['spark']), 'spark', 1)).toBe('spark');
    expect(cycleKit(new Set(['spark', 'storm']), 'spark', 1)).toBe('storm');
    expect(cycleKit(new Set(['spark', 'frost']), 'spark', -1)).toBe('frost');
    expect(KIT_ORDER).toContain('storm');
  });

  test('the difficulty row follows the ladder: a new player can only choose I and II', () => {
    expect(cycleDifficulty(0, 2, 1)).toBe(1);
    expect(cycleDifficulty(0, 1, 1)).toBe(2);
    expect(cycleDifficulty(0, 2, -1)).toBe(1);
    expect(DIFFICULTY_ORDER).toEqual([1, 2, 3, 4]);
    expect(cycleDifficulty(4, 4, 1)).toBe(1);
  });

});

describe('moveFocusIndex: Up / Down wrap, Home / End jump', () => {
  test('wraps in both directions', () => {
    expect(moveFocusIndex(0, 4, 'ArrowDown')).toBe(1);
    expect(moveFocusIndex(3, 4, 'ArrowDown')).toBe(0);
    expect(moveFocusIndex(0, 4, 'ArrowUp')).toBe(3);
    expect(moveFocusIndex(2, 4, 'ArrowUp')).toBe(1);
  });
  test('Home and End', () => {
    expect(moveFocusIndex(2, 5, 'Home')).toBe(0);
    expect(moveFocusIndex(1, 5, 'End')).toBe(4);
  });
  test('with nothing focused, Down lands on the first and Up on the first too', () => {
    expect(moveFocusIndex(-1, 4, 'ArrowDown')).toBe(0);
    expect(moveFocusIndex(-1, 4, 'ArrowUp')).toBe(3);
  });
  test('an empty list has nowhere to go', () => {
    expect(moveFocusIndex(-1, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('what the main page says', () => {
  test('Continue names where you are', () => {
    expect(continueLine(null, 4, '0:00')).toBe('');
    expect(continueLine({ maxFloor: 2, kit: 'spark', timeMs: 1, fighter: null }, 4, '12:41')).toBe(`Floor 2 of 4 · ${KIT_DEFS.spark.short} · 12:41`);
    expect(continueLine({ maxFloor: 3, kit: 'frost', timeMs: 1, fighter: 'mara-quell' }, 4, '3:05')).toBe(`Floor 3 of 4 · ${KIT_DEFS.frost.short} · ${FIGHTER_DEFS['mara-quell'].name} · 3:05`);
    expect(continueLine({ maxFloor: 0, kit: 'spark', timeMs: 0 }, 4, '0:00')).toContain('Floor 1 of 4');
  });

  test("Today's descent shows the date until there is a best to show", () => {
    const time = (ms: number): string => `${ms}ms`;
    expect(dailyLines({ today: '2026-10-01', best: null }, 4, time).sub).toBe('2026-10-01');
    expect(dailyLines({ today: '2026-10-01', best: { victory: false, floor: 2, timeMs: 5 } }, 4, time).sub).toBe('Best: Floor 2 of 4 in 5ms');
    expect(dailyLines({ today: '2026-10-01', best: { victory: true, floor: 4, timeMs: 9 } }, 4, time).sub).toBe('Best: the Kiln quieted in 9ms');
    expect(dailyLines({ today: '2026-10-01', best: null }, 4, time).hint).toContain('one seed for everyone');
  });

  test('the seed row says Random until a seed is chosen', () => {
    expect(seedValue(null)).toBe('Random');
    expect(seedValue({ seed: 42 })).toBe('42');
    expect(seedValue({ seed: -1 })).toBe('4294967295');
    expect(seedDetail(null).heading).toMatch(/random/i);
    expect(seedDetail({ seed: 42, phrase: false }).heading).toBe('Seed 42');
  });
});

describe('the detail cards', () => {
  test('a locked kit says how to earn it; an open one says what is in the case', () => {
    for (const id of KIT_ORDER) {
      expect(kitDetail(id, true).body).toBe(KIT_DEFS[id].blurb);
      expect(kitDetail(id, true).locked).toBe(false);
    }
    const locked = kitDetail('storm', false);
    expect(locked.locked).toBe(true);
    expect(locked.body).toContain(KIT_DEFS.storm.unlockHint);
  });

  test('a locked difficulty says what opens it', () => {
    expect(difficultyDetail(2, 0).locked).toBe(false);
    const locked = difficultyDetail(4, 0);
    expect(locked.locked).toBe(true);
    expect(locked.body).toMatch(/Quiet the Kiln/);
    expect(difficultyDetail(4, 3).locked).toBe(false);
  });

});

describe('the key legend', () => {
  const labels = (hints: ReturnType<typeof keyHints>): string[] => hints.map((h) => h.label);
  test('the main page has no Back; a drilled page does', () => {
    expect(labels(keyHints('drill', 0, false))).toEqual(['Select', 'Open']);
    expect(labels(keyHints('action', 1, false))).toEqual(['Select', 'Confirm', 'Back']);
  });
  test('a choice row also changes in place', () => {
    expect(labels(keyHints('choice', 1, false))).toEqual(['Select', 'Change', 'Open', 'Back']);
  });
  test('a gamepad names its own buttons', () => {
    const pad = keyHints('choice', 1, true);
    expect(pad.flatMap((h) => h.keys)).toEqual(['D-pad', '◂', '▸', 'A', 'B']);
    expect(keyHints('choice', 1, false).flatMap((h) => h.keys)).toEqual(['↑', '↓', '←', '→', 'Enter', 'Esc']);
  });
});

describe('complications on the loadout page', () => {
  test('toggling turns an entry on and off, and the set is never more than three', () => {
    expect(toggleComplication([], 'tinderbox')).toEqual({ chosen: ['tinderbox'], refused: false, note: '' });
    expect(toggleComplication(['tinderbox'], 'tinderbox')).toEqual({ chosen: [], refused: false, note: '' });
    const full = toggleComplication(['wet-floors', 'tinderbox', 'famine'], 'fireworks');
    expect(full.refused).toBe(true);
    expect(full.chosen).toEqual(['wet-floors', 'tinderbox', 'famine']);
    expect(full.note).toMatch(/3 at a time/);
    expect(MAX_MUTATORS).toBe(3);
  });

  test('two that cancel swap, and the note names both', () => {
    const swapped = toggleComplication(['famine', 'hush'], 'nosy-neighbours');
    expect(swapped.chosen).toEqual(['famine', 'nosy-neighbours']);
    expect(swapped.note).toMatch(/Nosy Neighbours takes the place of Hush/);
    expect(swapped.refused).toBe(false);
  });

  test('a full set refuses even a swap: the limit is checked first, as on the old fold', () => {
    const r = toggleComplication(['wet-floors', 'hush', 'famine'], 'nosy-neighbours');
    expect(r.refused).toBe(true);
  });

  test('every complication has a card with its weight and its regulation', () => {
    for (const id of MUTATOR_ORDER) {
      const card = complicationDetail(id, []);
      expect(card.heading).toBe(MUTATOR_DEFS[id].name);
      expect(card.eyebrow).toContain(loadMark(MUTATOR_DEFS[id].weight));
      expect(card.body).toContain(MUTATOR_DEFS[id].regulation);
      expect(card.locked).toBe(false);
    }
  });

  test('with three in force the others are locked and the card says why; the ones in force are not', () => {
    const chosen = ['wet-floors', 'tinderbox', 'famine'] as const;
    expect(complicationDetail('fireworks', chosen).locked).toBe(true);
    expect(complicationDetail('fireworks', chosen).body).toMatch(/3 at a time/);
    expect(complicationDetail('famine', chosen).locked).toBe(false);
  });

  test('the weight marks use a real minus', () => {
    expect(loadMark(2)).toBe('+2');
    expect(loadMark(0)).toBe('±0');
    expect(loadMark(-1)).toBe('−1');
  });

  test('the row value and the totals', () => {
    expect(complicationsValue([])).toBe('None');
    expect(complicationsValue(['famine', 'hush'])).toBe('2 in force');
    expect(complicationsTotal([])).toBe('None in force. The Works as issued.');
    expect(complicationsTotal(['tinderbox'])).toMatch(/1 in force: \+1 pressure\. A win counts toward the next tier\./);
    expect(complicationsTotal(['low-gravity'])).toMatch(/will not open a harder tier/);
    expect(complicationsDetail([]).heading).toBe('The Works as issued');
    expect(complicationsDetail(['tinderbox', 'famine']).lines?.map((l) => l.name)).toEqual(['Tinderbox', 'Short Rations']);
  });

  test("today's descent names what it carries", () => {
    const lines = dailyLines({ today: '2026-10-01', best: null, carries: 'Wet Floors' }, 4, (ms) => `${ms}`);
    expect(lines.sub).toBe('2026-10-01 · Wet Floors');
    expect(lines.hint).toContain('on Adept · Wet Floors');
    expect(dailyLines({ today: '2026-10-01', best: null }, 4, (ms) => `${ms}`).sub).toBe('2026-10-01');
  });

  test('a toggle row says Toggle in the legend', () => {
    expect(keyHints('toggle', 1, false).map((h) => h.label)).toEqual(['Select', 'Toggle', 'Back']);
  });
});
