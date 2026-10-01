import { describe, expect, it } from 'vitest';

import { CLUES, cluesFor } from '@/content/alchemyClues';
import { elixirDef, isElixirCell } from '@/content/elixirs';
import { LEVELS } from '@/config/worldgraph';
import { RECIPES, SIPHONABLE_SOLIDS, type Recipe } from '@/content/recipes';
import { ENEMY_KINDS } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { BOWL_CAPACITY, foreignMass, isReagent, matchMix, meetsAmounts, PURITY_SLACK, specificity } from '@/game/alchemy/mix';
import { MATERIAL_LORE } from '@/game/lore';

/**
 * THE RECIPE DATA: the rules every shipped recipe has to keep so a brew is something a player can
 * DEDUCE and a bowl can actually make. (A recipe that cannot be told from another, cannot fit in the
 * bowl, or leans on an ingredient the player cannot carry does not ship.)
 */

/** The smallest bowl-full that meets BOTH recipes at once: each amount the larger of the two asks. */
function jointMix(a: Recipe, b: Recipe): Record<number, number> {
  const h: Record<number, number> = {};
  for (const r of [a, b]) for (const n of r.needs) h[n.cell] = Math.max(h[n.cell] ?? 0, n.min);
  return h;
}

describe('recipe data', () => {
  it('has unique ids, names and products, and a product that is a real potion', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    expect(new Set(RECIPES.map((r) => r.name)).size).toBe(RECIPES.length);
    expect(new Set(RECIPES.map((r) => r.elixir)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(isElixirCell(r.elixir), `${r.id} product`).toBe(true);
      expect(elixirDef(r.elixir), `${r.id} effect row`).toBeDefined();
      expect(r.name).toBe(r.name.toUpperCase());
      expect(r.page.length, `${r.id} page`).toBeGreaterThan(40);
    }
    expect(RECIPES.length).toBeGreaterThanOrEqual(10);
  });

  it('asks for amounts a ~14-cell bowl can hold and a flask can pour', () => {
    for (const r of RECIPES) {
      const total = specificity(r);
      expect(r.needs.length, r.id).toBeGreaterThanOrEqual(2);
      expect(r.needs.length, r.id).toBeLessThanOrEqual(3);
      expect(total, `${r.id} total`).toBeLessThanOrEqual(BOWL_CAPACITY - 2); // two cells of slack: a hand pours one over, a sinking coal displaces a cell of water
      expect(total, `${r.id} total`).toBeGreaterThanOrEqual(10);
      for (const n of r.needs) {
        expect(Number.isInteger(n.min) && n.min >= 3, `${r.id} ${n.cell}`).toBe(true);
        expect(new Set(r.needs.map((x) => x.cell)).size, `${r.id} duplicate ingredient`).toBe(r.needs.length);
      }
    }
  });

  it('keeps to ingredients a player can actually carry: a liquid, a loose powder, or a solid the flask draws up', () => {
    const carried = (c: number): boolean => isLiquid(c) || c === Cell.Sand || c === Cell.Gunpowder || (SIPHONABLE_SOLIDS as readonly number[]).includes(c);
    for (const r of RECIPES) for (const n of r.needs) {
      expect(carried(n.cell), `${r.id} needs ${n.cell}`).toBe(true);
      expect(isReagent(n.cell), `${r.id} ${n.cell} is a reagent`).toBe(true);
      expect(isElixirCell(n.cell), `${r.id} ingredient is a potion`).toBe(false);
    }
  });

  it('keeps the economy rails: no Gold ingredient (the harvester banks it), no rock or metal either way', () => {
    const forbidden: number[] = [Cell.Gold, Cell.Metal, Cell.Stone, Cell.Wall, Cell.RawOre, Cell.Glass, Cell.Catalyst, Cell.Lava, Cell.Fire, Cell.Ember];
    for (const r of RECIPES) {
      for (const n of r.needs) expect(forbidden, `${r.id} ingredient`).not.toContain(n.cell);
      expect(forbidden, `${r.id} product`).not.toContain(r.elixir);
    }
  });

  it('never lets two recipes be met by one bowl: no overlap that one could shadow the other', () => {
    for (let i = 0; i < RECIPES.length; i++) {
      for (let j = i + 1; j < RECIPES.length; j++) {
        const a = RECIPES[i];
        const b = RECIPES[j];
        const h = jointMix(a, b);
        const mass = Object.values(h).reduce((n, x) => n + x, 0);
        // The smallest bowl that meets both is the likeliest to fit, so if even that is too much (or too impure) no bowl is both.
        const both = meetsAmounts(h, a) && meetsAmounts(h, b) && foreignMass(h, a) <= PURITY_SLACK && foreignMass(h, b) <= PURITY_SLACK && mass <= BOWL_CAPACITY;
        expect(both, `${a.id} and ${b.id} can both match one bowl`).toBe(false);
      }
    }
  });

  it('matches each recipe by its own exact amounts and by nothing else, in any array order', () => {
    for (const r of RECIPES) {
      const exact: Record<number, number> = {};
      for (const n of r.needs) exact[n.cell] = n.min;
      expect(matchMix(exact)?.id, r.id).toBe(r.id);
      expect(matchMix(exact, [...RECIPES].reverse())?.id, `${r.id} reversed`).toBe(r.id);
      const short = { ...exact, [r.needs[0].cell]: r.needs[0].min - 1 };
      expect(matchMix(short)?.id ?? null, `${r.id} one short`).not.toBe(r.id);
      const spoiled = { ...exact, [Cell.Toxic]: PURITY_SLACK + 1 };
      expect(matchMix(spoiled)?.id ?? null, `${r.id} spoiled`).not.toBe(r.id);
    }
  });

  it('asks only for pairs some floor with a cauldron really holds both of', () => {
    // Where each ingredient lies, from a census of the generated floors (seeds 5 and 777: cells of each kind per floor;
    // oil is the kit's on floor 1, slime comes off slimes from floor 2). A recipe no floor can supply is a recipe nobody brews.
    const holds: Record<number, string[]> = {
      [Cell.Water]: ['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4'],
      [Cell.Oil]: ['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4'],
      [Cell.Gunpowder]: ['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4'],
      [Cell.Leaf]: ['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4'],
      [Cell.Sand]: ['d1', 'd2', 'd3b', 'd4'],
      [Cell.Glowshroom]: ['d1', 'd2', 'd3', 'd3b'],
      [Cell.Slime]: ['d2', 'd3', 'd3b'],
      [Cell.Coal]: ['d2', 'd2b', 'd3b', 'd4'],
      [Cell.Snow]: ['d2b'],
      [Cell.Brine]: ['d2b'],
    };
    for (const r of RECIPES) {
      for (const n of r.needs) expect(holds[n.cell], `${r.id}: where does ${n.cell} lie?`).toBeDefined();
      const common = r.needs.map((n) => holds[n.cell]).reduce((a, b) => a.filter((f) => b.includes(f)));
      expect(common.length, `${r.id} has a floor that holds both`).toBeGreaterThan(0);
    }
  });

  it('keeps out of the bowl what the sim will not keep there: blood (dissolves in water, dries on stone), ash (dissolves in water), snow beside brine (melts)', () => {
    for (const r of RECIPES) {
      const cells = r.needs.map((n) => n.cell);
      expect(cells, r.id).not.toContain(Cell.Blood);
      expect(cells, r.id).not.toContain(Cell.Ash);
      if (cells.includes(Cell.Snow)) expect(cells, r.id).not.toContain(Cell.Brine);
    }
  });
});

describe('margin notes', () => {
  it('has unique ids and gives every recipe two or three notes, none of which spell the recipe', () => {
    expect(new Set(CLUES.map((c) => c.id)).size).toBe(CLUES.length);
    for (const r of RECIPES) {
      const notes = cluesFor(r.id);
      expect(notes.length, `${r.id} notes`).toBeGreaterThanOrEqual(2);
      expect(notes.length, `${r.id} notes`).toBeLessThanOrEqual(3);
      // each points at ONE ingredient: no note is allowed to name the recipe's amounts or both its materials by name
      for (const c of notes) {
        expect(c.text.length, c.id).toBeGreaterThan(30);
        expect(c.text, c.id).not.toMatch(/\d+\s*(x|×)/);
      }
    }
    for (const c of CLUES) expect(RECIPES.some((r) => r.id === c.recipe), `${c.id} names a recipe that exists`).toBe(true);
  });

  it('is unlocked by things that can happen: a real floor, a real kind of creature, a cataloged material, a shipped recipe', () => {
    const kinds = new Set<string>(ENEMY_KINDS);
    for (const c of CLUES) {
      const t = c.on;
      if (t.on === 'floor') expect(LEVELS[t.level], `${c.id} floor ${t.level}`).toBeDefined();
      else if (t.on === 'kill') expect(t.kind === '*' || kinds.has(t.kind), `${c.id} kind ${t.kind}`).toBe(true);
      else if (t.on === 'examine') expect(MATERIAL_LORE[t.cell], `${c.id} examines an uncataloged material`).toBeDefined();
      else expect(RECIPES.some((r) => r.id === t.recipe), `${c.id} recipe ${t.recipe}`).toBe(true);
    }
  });

  it('never gives a recipe a note that only its own brew can unlock', () => {
    for (const c of CLUES) if (c.on.on === 'brewed') expect(c.on.recipe, c.id).not.toBe(c.recipe);
  });
});
