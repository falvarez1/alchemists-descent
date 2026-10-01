import { describe, expect, it } from 'vitest';

import type { Recipe } from '@/content/recipes';
import { Cell } from '@/sim/CellType';
import {
  assessMix,
  BOWL_CAPACITY,
  consumedBy,
  foreignMass,
  isBrewable,
  isReagent,
  matchMix,
  meetsAmounts,
  mixMass,
  mixSignature,
  PURITY_SLACK,
  specificity,
} from '@/game/alchemy/mix';

const recipe = (id: string, needs: Array<[number, number]>): Recipe => ({
  id,
  name: id.toUpperCase(),
  elixir: Cell.ElixirLife,
  needs: needs.map(([cell, min]) => ({ cell: cell as Cell, min })),
  page: '',
});

const tea = recipe('tea', [[Cell.Water, 9], [Cell.Leaf, 4]]);
const lev = recipe('lev', [[Cell.Water, 9], [Cell.Slime, 4]]);
const broth = recipe('broth', [[Cell.Water, 6], [Cell.Slime, 3], [Cell.Leaf, 3]]);

describe('matching a mix to a recipe', () => {
  it('needs every amount, and reads nothing else in the bowl as a requirement', () => {
    expect(matchMix({ [Cell.Water]: 9, [Cell.Leaf]: 4 }, [tea, lev])?.id).toBe('tea');
    expect(matchMix({ [Cell.Water]: 9, [Cell.Leaf]: 3 }, [tea, lev])).toBeNull();
    expect(matchMix({ [Cell.Water]: 12, [Cell.Slime]: 4 }, [tea, lev])?.id).toBe('lev');
    expect(matchMix({}, [tea, lev])).toBeNull();
  });

  it('forgives a couple of stray cells and refuses a spoiled bowl', () => {
    expect(PURITY_SLACK).toBe(2);
    expect(matchMix({ [Cell.Water]: 9, [Cell.Leaf]: 4, [Cell.Blood]: 2 }, [tea])?.id).toBe('tea');
    expect(matchMix({ [Cell.Water]: 9, [Cell.Leaf]: 4, [Cell.Blood]: 3 }, [tea])).toBeNull();
    expect(foreignMass({ [Cell.Water]: 9, [Cell.Leaf]: 4, [Cell.Blood]: 2 }, tea)).toBe(2);
  });

  it('prefers the most specific recipe when several qualify, never the array order', () => {
    const plain = recipe('plain', [[Cell.Water, 8], [Cell.Leaf, 3]]);
    const rich = recipe('rich', [[Cell.Water, 6], [Cell.Leaf, 3], [Cell.Slime, 3]]);
    const mix = { [Cell.Water]: 8, [Cell.Leaf]: 3, [Cell.Slime]: 3 };
    // `plain` is first and its amounts are met, but the bowl holds Slime beyond the slack: it is rich's.
    expect(matchMix(mix, [plain, rich])?.id).toBe('rich');
    expect(matchMix(mix, [rich, plain])?.id).toBe('rich');
    // When both are pure matches the richer (more cells asked for) wins.
    const a = recipe('a', [[Cell.Water, 5]]);
    const b = recipe('b', [[Cell.Water, 5], [Cell.Leaf, 2]]);
    const both = { [Cell.Water]: 6, [Cell.Leaf]: 2 };
    expect(specificity(b)).toBeGreaterThan(specificity(a));
    expect(matchMix(both, [a, b])?.id).toBe('b');
    expect(matchMix(both, [b, a])?.id).toBe('b');
  });

  it('signs a mix by its sorted reagent counts', () => {
    expect(mixSignature({ [Cell.Blood]: 4, [Cell.Water]: 9 })).toBe('2:9,18:4');
    expect(mixSignature({ [Cell.Water]: 0, [Cell.Blood]: 4 })).toBe('18:4');
  });
});

describe('what counts as a reagent', () => {
  it('takes liquids and loose powders but never a finished potion', () => {
    for (const c of [Cell.Water, Cell.Oil, Cell.Blood, Cell.Slime, Cell.Sand, Cell.Gunpowder, Cell.Gold]) expect(isBrewable(c)).toBe(true);
    for (const c of [Cell.ElixirLife, Cell.ElixirLevity, Cell.ElixirStone]) {
      expect(isBrewable(c)).toBe(false);
      expect(isReagent(c)).toBe(false);
    }
    for (const c of [Cell.Wall, Cell.Stone, Cell.Metal, Cell.Fire, Cell.Steam, Cell.Empty]) expect(isReagent(c)).toBe(false);
  });

  it('treats the solids a recipe names as reagents too, and consumes them with the brew', () => {
    // Leaf is no liquid, yet Strong Tea names it (content/recipes): it counts, and the brew takes it.
    const leafy = recipe('leafy', [[Cell.Water, 9], [Cell.Leaf, 4]]);
    expect(isBrewable(Cell.Leaf)).toBe(false);
    expect(consumedBy(leafy, Cell.Leaf)).toBe(true);
    expect(consumedBy(leafy, Cell.Coal)).toBe(false);
    expect(consumedBy(leafy, Cell.Water)).toBe(true);
    expect(mixMass({ [Cell.Water]: 9, [Cell.Leaf]: 4 })).toBe(13);
  });
});

describe('what came of a mix that matched nothing', () => {
  it('is inert when nothing in the bowl answers anything', () => {
    expect(assessMix({ [Cell.Water]: 14 }, [tea, lev]).verdict).toBe('inert');
    expect(assessMix({ [Cell.Oil]: 8, [Cell.Gunpowder]: 3 }, [tea, lev]).verdict).toBe('inert');
    // a drip of the second ingredient is not a try
    expect(assessMix({ [Cell.Water]: 12, [Cell.Leaf]: 1 }, [tea, lev]).verdict).toBe('inert');
  });

  it('shimmers when the right ingredients are in but short, and says how each one sits without naming the rest', () => {
    const a = assessMix({ [Cell.Water]: 9, [Cell.Leaf]: 2, [Cell.Blood]: 2 }, [tea, lev]);
    expect(a.verdict).toBe('close');
    expect(a.closeTo?.id).toBe('tea');
    expect(a.feel).toEqual({ [Cell.Water]: 'hot', [Cell.Leaf]: 'warm', [Cell.Blood]: 'cold' });
    expect(a.missing).toBe(0);
  });

  it('clouds when every amount is met but something foreign spoils it', () => {
    const a = assessMix({ [Cell.Water]: 9, [Cell.Leaf]: 4, [Cell.Blood]: 5 }, [tea, lev]);
    expect(a.verdict).toBe('muddy');
    expect(a.closeTo?.id).toBe('tea');
    expect(a.feel[Cell.Blood]).toBe('cold');
  });

  it('counts the unnamed ingredient a three-part recipe is still missing', () => {
    const a = assessMix({ [Cell.Water]: 6, [Cell.Slime]: 3 }, [broth]);
    expect(a.verdict).toBe('close');
    expect(a.missing).toBe(1);
    expect(assessMix({ [Cell.Water]: 6 }, [broth]).verdict).toBe('inert');
  });

  it('leans towards the undiscovered recipe when two are equally close', () => {
    const mix = { [Cell.Water]: 9, [Cell.Leaf]: 2, [Cell.Slime]: 2 };
    expect(assessMix(mix, [tea, lev], {}).closeTo?.id).toBe('tea');
    expect(assessMix(mix, [tea, lev], { tea: true }).closeTo?.id).toBe('lev');
  });

  it('never reads a full bowl as more than a bowl', () => {
    expect(BOWL_CAPACITY).toBe(14);
    expect(meetsAmounts({ [Cell.Water]: 9, [Cell.Leaf]: 4 }, tea)).toBe(true);
  });
});
