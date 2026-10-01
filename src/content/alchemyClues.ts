import { Cell } from '@/sim/CellType';

/**
 * MARGINALIA: the notes a previous reader left beside the recipes, written into
 * the Grimoire as play uncovers them. Each points at ONE ingredient of ONE
 * undiscovered recipe, never at the whole of it: the book's progress is what the
 * player has been told, and the rest is deduction (the cauldron's shimmer and the
 * experiment log do the rest). A clue is unlocked by something the player does
 * anyway: examining a material (`I`), reaching a floor, a kill, a recipe brewed.
 *
 * Voice: dry Victorian-industrial marginalia, a few brisk lines each, no jokes
 * told twice. (Text only: nothing here is spoken.)
 */
export type ClueTrigger =
  /** The material is examined for the first time (the I lens). */
  | { on: 'examine'; cell: number }
  /** The player arrives on this floor (a level id: d1, d2, d2b, d3, d3b, d4). */
  | { on: 'floor'; level: string }
  /** A creature of this kind dies ('*' = any). */
  | { on: 'kill'; kind: string }
  /** The recipe is brewed (written into the book). */
  | { on: 'brewed'; recipe: string };

export interface Clue {
  /** Stable key in the Grimoire record. */
  id: string;
  /** The recipe it is about. */
  recipe: string;
  text: string;
  on: ClueTrigger;
}

export const CLUES: readonly Clue[] = [
  // ---- Elixir of Life: water and blood
  { id: 'life.1', recipe: 'life', on: { on: 'kill', kind: '*' },
    text: 'Pressed into the margin with a brown thumb: “The body keeps its own apothecary. Ask it politely, or otherwise.”' },
  { id: 'life.2', recipe: 'life', on: { on: 'examine', cell: Cell.Blood },
    text: 'Under “Blood”: “Never neat. Thinned with clean water it forgives you, and does not spoil.”' },

  // ---- Elixir of Levity: water and slime
  { id: 'levity.1', recipe: 'levity', on: { on: 'kill', kind: 'slime' },
    text: '“Slimes float. I did not enquire why.” And, smaller: “Drink it thinned.”' },
  { id: 'levity.2', recipe: 'levity', on: { on: 'examine', cell: Cell.Slime },
    text: 'Beside the slime, a doodle of a balloon, and a small, doomed gentleman beneath it.' },

  // ---- Elixir of Stone: blood and sand
  { id: 'stone.1', recipe: 'stone', on: { on: 'examine', cell: Cell.Sand },
    text: 'In a mason’s square hand: “Sand is what skin becomes when it stops negotiating.”' },
  { id: 'stone.2', recipe: 'stone', on: { on: 'brewed', recipe: 'life' },
    text: 'A torn second page: “Life takes the red. So does stone, if you harden it with something coarse.”' },

  // ---- Strong Tea: water and leaf
  { id: 'tea.1', recipe: 'tea', on: { on: 'floor', level: 'd1' },
    text: 'In a hand that smells faintly of bergamot: “Green things, steeped, and patience. Pell’s method. He denies it.”' },
  { id: 'tea.2', recipe: 'tea', on: { on: 'examine', cell: Cell.Leaf },
    text: 'By “Leaf”: “Not for burning. For steeping.” Underlined, twice, by someone who had burned a great many.' },

  // ---- Glowing Draught: oil and glowshroom
  { id: 'glow.1', recipe: 'glow', on: { on: 'examine', cell: Cell.Glowshroom },
    text: 'Beside the Glowshroom: “Eat none. Bottle some.” A second hand adds: “Too late.”' },
  { id: 'glow.2', recipe: 'glow', on: { on: 'floor', level: 'd2' },
    text: '“A lamp is only oil with ambitions. Give it something that already glows and it will stop being modest.”' },

  // ---- Salamander’s Gall: coal, ash and water
  { id: 'salamander.1', recipe: 'salamander', on: { on: 'examine', cell: Cell.Coal },
    text: 'Under “Coal”: “It remembers the fire fondly. So, I am told, do salamanders.”' },
  { id: 'salamander.2', recipe: 'salamander', on: { on: 'examine', cell: Cell.Ash },
    text: 'Under “Ash”: “What the fire forgot. The salamander sleeps in it.” The ink gives out here.' },
  { id: 'salamander.3', recipe: 'salamander', on: { on: 'floor', level: 'd4' },
    text: 'Scratched in at the bottom of the page, from below: “Whatever you brew for the Kiln, bring water to thin it.”' },

  // ---- Frostproof Tonic: brine and snow
  { id: 'frostproof.1', recipe: 'frostproof', on: { on: 'floor', level: 'd2b' },
    text: '“Like cures like,” says the margin, in a shaking hand. “The cold’s own sweepings, sweetened with its own water.”' },
  { id: 'frostproof.2', recipe: 'frostproof', on: { on: 'examine', cell: Cell.Brine },
    text: 'Next to “Brine”: “Salt keeps meat and makes frostbite. Make it keep you.”' },

  // ---- Gutta-Percha Tonic: oil and slime
  { id: 'guttapercha.1', recipe: 'guttapercha', on: { on: 'floor', level: 'd3' },
    text: '“The telegraph men coat their cables in something that comes off slimes and out of lamps. It does not conduct. Be as that.”' },
  { id: 'guttapercha.2', recipe: 'guttapercha', on: { on: 'brewed', recipe: 'levity' },
    text: 'In pencil, on the Levity page: “The slime again. Not only for floating.”' },

  // ---- Charcoal Draught: coal and water
  { id: 'charcoal.1', recipe: 'charcoal', on: { on: 'floor', level: 'd2' },
    text: '“The sump here kills a mule a week. The apothecary on Cinder Row recommends charcoal, and a great deal of water, and not going.”' },
  { id: 'charcoal.2', recipe: 'charcoal', on: { on: 'brewed', recipe: 'tea' },
    text: 'Stained with tea: “And for the stomach: charred wood in water. Ask anyone who has had a bad pie.”' },

  // ---- Brimstone Tincture: gunpowder and oil
  { id: 'brimstone.1', recipe: 'brimstone', on: { on: 'examine', cell: Cell.Gunpowder },
    text: 'By “Gunpowder”: “Add oil, if you must. Not in the office.” The first word has been scratched out and rewritten three times.' },
  { id: 'brimstone.2', recipe: 'brimstone', on: { on: 'floor', level: 'd3b' },
    text: '“Tincture of Brimstone. The fire goes UNDER the pot. Beside the lid is how we lost the east wing.”' },
];

/** The clues about one recipe, in the order the page shows them. */
export function cluesFor(recipe: string): Clue[] {
  return CLUES.filter((c) => c.recipe === recipe);
}
