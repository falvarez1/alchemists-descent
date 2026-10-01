import { RECIPES, type Recipe } from '@/content/recipes';
import { isElixirCell } from '@/content/elixirs';
import type { MixFeel, MixVerdict } from '@/core/alchemy';
import { Cell, isLiquid } from '@/sim/CellType';

/**
 * THE MIX: what is in the bowl, which recipe it is, and how close a failed mix
 * came. Pure functions over a histogram of reagent cells (no world, no events),
 * so the cauldron, the Grimoire's log and the recipe-data tests all judge a mix
 * the same way.
 *
 * Three rules make a recipe a thing you can DEDUCE rather than stumble on:
 *  - a recipe is its ingredients in AMOUNTS (the bowl holds ~14 cells, so the
 *    amounts alone keep two recipes from both being met at once);
 *  - the bowl must be PURE: a few stray cells are forgiven (PURITY_SLACK), a
 *    pinch too many of anything else clouds it;
 *  - when more than one recipe is met, the MOST SPECIFIC one (the most cells
 *    asked for) wins, so a richer recipe is never shadowed by a plainer one.
 */

/** What the stamped bowl reliably holds before it overflows the rim (7 wide, 2 deep). */
export const BOWL_CAPACITY = 14;
/** Foreign reagent cells a brew forgives (a drip, a stray grain): two. */
export const PURITY_SLACK = 2;
/** Cells of an ingredient that count as "it is in the bowl" for a near-match (one drip is not a try). */
export const NEAR_PRESENCE = 2;
/** The least reagent mass a heated bowl needs before it counts as an attempt worth judging. */
export const ATTEMPT_MIN_MASS = 6;

/** Reagent cell id -> cells in the bowl. */
export type Histogram = Readonly<Record<number, number>>;

/** Solids a recipe names (a leaf, a lump of coal): reagents too, though nothing pours them but a flask. */
const INGREDIENTS = new Set<number>();
for (const r of RECIPES) for (const n of r.needs) INGREDIENTS.add(n.cell);

/** A cell a finished brew turns into elixir: any liquid that is not already a potion, and the loose powders. */
export function isBrewable(t: number): boolean {
  if (isElixirCell(t)) return false;
  return isLiquid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder;
}

/** A cell that counts towards what a mix IS: anything brewable, and any solid a recipe asks for. */
export function isReagent(t: number): boolean {
  return isBrewable(t) || INGREDIENTS.has(t);
}

/** Does a finished `recipe` brew consume this cell? (everything brewable, and the solids it named) */
export function consumedBy(recipe: Recipe, t: number): boolean {
  return isBrewable(t) || recipe.needs.some((n) => n.cell === t);
}

export function mixMass(h: Histogram): number {
  let m = 0;
  for (const k in h) m += h[k];
  return m;
}

/** Reagent cells in the bowl that `recipe` does not ask for. */
export function foreignMass(h: Histogram, recipe: Recipe): number {
  let f = 0;
  for (const k in h) if (!recipe.needs.some((n) => n.cell === Number(k))) f += h[k];
  return f;
}

/** Every amount the recipe asks for is in the bowl. */
export function meetsAmounts(h: Histogram, recipe: Recipe): boolean {
  return recipe.needs.every((n) => (h[n.cell] ?? 0) >= n.min);
}

/** How much a recipe asks for in all: the specificity rule's measure. */
export function specificity(recipe: Recipe): number {
  let s = 0;
  for (const n of recipe.needs) s += n.min;
  return s;
}

/**
 * The recipe this bowl IS, or null. The amounts are met, the bowl is pure
 * enough, and of the recipes that qualify the most specific wins (ties go to the
 * earlier entry, so the order is a stable tiebreak and never a hidden rule).
 */
export function matchMix(h: Histogram, recipes: readonly Recipe[] = RECIPES): Recipe | null {
  let best: Recipe | null = null;
  let bestSpec = -1;
  for (const r of recipes) {
    if (!meetsAmounts(h, r) || foreignMass(h, r) > PURITY_SLACK) continue;
    const s = specificity(r);
    if (s > bestSpec) {
      best = r;
      bestSpec = s;
    }
  }
  return best;
}

/** A mix's identity in the experiment log: its reagent counts, sorted by cell ("2:9,18:4"). */
export function mixSignature(h: Histogram): string {
  return Object.keys(h)
    .map(Number)
    .filter((c) => h[c] > 0)
    .sort((a, b) => a - b)
    .map((c) => `${c}:${h[c]}`)
    .join(',');
}

export interface MixAssessment {
  verdict: MixVerdict;
  /** The recipe a close or muddy mix leans towards. */
  closeTo: Recipe | null;
  /** Per reagent in the bowl: how it sits against that recipe (empty for an inert mix). */
  feel: Record<number, MixFeel>;
  /** Ingredient types of that recipe that are not in the bowl at all. */
  missing: number;
}

/**
 * What came of a mix that matched nothing. `close` when the right ingredients are
 * there (most of them, at least a trace each) but the amounts fall short; `muddy`
 * when every amount is met and something foreign spoils it; `inert` when nothing in
 * the bowl answers anything. The nearest recipe is the one the mix covers most of;
 * an undiscovered one wins a tie (it is the one worth a hint).
 */
export function assessMix(
  h: Histogram,
  recipes: readonly Recipe[] = RECIPES,
  known: Readonly<Record<string, boolean>> = {},
): MixAssessment {
  let best: { recipe: Recipe; score: number; met: boolean; missing: number } | null = null;
  for (const r of recipes) {
    const types = r.needs.length;
    const present = r.needs.filter((n) => (h[n.cell] ?? 0) >= NEAR_PRESENCE).length;
    const required = types <= 1 ? 1 : Math.floor(types / 2) + 1;
    if (present < required) continue;
    let have = 0;
    let ask = 0;
    for (const n of r.needs) {
      have += Math.min(h[n.cell] ?? 0, n.min);
      ask += n.min;
    }
    const coverage = have / ask;
    if (coverage < 0.5) continue;
    const foreign = foreignMass(h, r);
    const score = coverage - 0.06 * foreign + (known[r.id] ? 0 : 0.03);
    if (!best || score > best.score) best = { recipe: r, score, met: meetsAmounts(h, r), missing: types - present };
  }
  if (!best) return { verdict: 'inert', closeTo: null, feel: {}, missing: 0 };
  const feel: Record<number, MixFeel> = {};
  for (const k in h) {
    const cell = Number(k);
    const need = best.recipe.needs.find((n) => n.cell === cell);
    feel[cell] = !need ? 'cold' : h[k] >= need.min ? 'hot' : 'warm';
  }
  return { verdict: best.met ? 'muddy' : 'close', closeTo: best.recipe, feel, missing: best.missing };
}
