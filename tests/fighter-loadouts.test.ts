import { describe, expect, test } from 'vitest';
import { WAND_FRAMES } from '@/combat/wands/wandCatalog';
import { CARD_DEFS, isCardId } from '@/combat/wands/cards';
import { FIGHTER_LOADOUTS, loadoutSave } from '@/content/fighterLoadouts';
import { FIGHTER_ORDER } from '@/content/fighters';

/** The signature loadouts (docs/arena/MOVESETS-V2.md 6a): data a duel hands each fighter, and the rules that keep it playable. */

describe('signature loadouts', () => {
  test('every fighter has one, with an idea', () => {
    expect(Object.keys(FIGHTER_LOADOUTS).sort()).toEqual([...FIGHTER_ORDER].sort());
    for (const id of FIGHTER_ORDER) expect(FIGHTER_LOADOUTS[id].idea.length, id).toBeGreaterThan(30);
  });

  test('every card is a real card and fits the frame it is on', () => {
    for (const id of FIGHTER_ORDER) {
      for (const [i, w] of FIGHTER_LOADOUTS[id].wands.entries()) {
        const frame = WAND_FRAMES[w.frameId];
        expect(frame, `${id} wand ${i} frame ${w.frameId}`).toBeDefined();
        expect(w.cards.length, `${id} wand ${i} lists as many slots as the frame has`).toBe(frame.capacity);
        for (const c of w.cards) if (c !== null) expect(isCardId(c), `${id}: ${String(c)}`).toBe(true);
      }
    }
  });

  test('wand I is the main weapon: it holds a projectile, and a modifier is never the last card', () => {
    for (const id of FIGHTER_ORDER) {
      const cards = FIGHTER_LOADOUTS[id].wands[0].cards.filter((c): c is NonNullable<typeof c> => c !== null);
      expect(cards.some((c) => CARD_DEFS[c].kind === 'projectile'), `${id} has a projectile in wand I`).toBe(true);
      expect(CARD_DEFS[cards[cards.length - 1]].kind, `${id}: wand I does not end on a modifier`).toBe('projectile');
    }
  });

  test('no two fighters carry the same wand I (the cards and the frame together)', () => {
    const seen = new Map<string, string>();
    for (const id of FIGHTER_ORDER) {
      const w = FIGHTER_LOADOUTS[id].wands[0];
      const key = `${w.frameId}:${w.cards.join(',')}`;
      expect(seen.get(key), `${id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    }
  });

  test('the flask belt holds real materials', () => {
    for (const id of FIGHTER_ORDER) for (const f of FIGHTER_LOADOUTS[id].flasks) { expect(f.material).toBeGreaterThan(0); expect(f.count).toBeGreaterThan(0); }
  });

  test('loadoutSave is the wand system save shape: wand I active, a satchel of the cards, full mana', () => {
    for (const id of FIGHTER_ORDER) {
      const s = loadoutSave(id);
      expect(s.active).toBe(0);
      expect(s.wands.length).toBe(2);
      expect(s.wands[0].frameId).toBe(FIGHTER_LOADOUTS[id].wands[0].frameId);
      for (const c of FIGHTER_LOADOUTS[id].wands.flatMap((w) => w.cards)) if (c !== null) expect(s.collection).toContain(c);
    }
  });
});
