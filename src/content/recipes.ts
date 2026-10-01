import { Cell } from '@/sim/CellType';

/**
 * The loose solids a flask can draw up besides liquids and the powders (sand, gunpowder, gold):
 * what a recipe may ask for that is not a liquid (a leaf, a lump of coal). One cell at a time off
 * the world, one cell at a time back out: the grid is the only inventory, so every reagent a
 * recipe names is either a liquid, one of these, or a loose powder the flask already carries.
 *
 * WHAT A BOWL CAN HOLD, measured with real pours and a real fire (scripts/verify-alchemy): blood
 * dissolves in water within seconds and dries to a stain on a stone floor, ash dissolves in water,
 * and snow melts to water in brine: none of those pairings can be brewed, so no recipe asks for them.
 * A brew asks for at most 12 of the bowl's 14 cells: a hand pours a cell or two over, a sinking coal or
 * sand displaces water over the rim, and pouring the dry things in first (then the liquid) is the order
 * that keeps them.
 */
export const SIPHONABLE_SOLIDS: readonly Cell[] = [Cell.Snow, Cell.Coal, Cell.Leaf, Cell.Glowshroom];

export interface RecipeNeed {
  cell: Cell;
  min: number;
}

export interface Recipe {
  /** Stable Grimoire/telemetry key. */
  id: string;
  /** Banner name, upper case to match the banner voice. */
  name: string;
  elixir: Cell;
  /** Basin histogram requirements: minimum cell counts that must all be met. */
  needs: RecipeNeed[];
  /** The Grimoire's page for it, written in once the recipe is known: a line of the previous reader's. */
  page: string;
}

/*
 * Thresholds are sized to the STAMPED bowl: the generator builds a 7-wide
 * interior with 2-tall walls (cauldron.y is the bottom interior row), so the
 * bowl reliably holds ~14 cells before overflowing the rim (game/alchemy/mix
 * BOWL_CAPACITY). Requirements must be pourable by a player with one 600-cell
 * flask and an honest aim, and carry no Gold: the harvester banks any loose
 * Gold within 30 cells of the player, so a Gold ingredient never stays in the bowl.
 */
export const RECIPES: Recipe[] = [
  {
    id: 'life',
    name: 'ELIXIR OF LIFE',
    elixir: Cell.ElixirLife,
    needs: [
      { cell: Cell.Water, min: 7 },
      { cell: Cell.Glowshroom, min: 5 },
    ],
    page: 'A broth of the cellar mushroom, which the Guild’s nurses boiled for every complaint and every complainant. Wounds knit as you walk. The nurses, sadly, did not.',
  },
  {
    id: 'levity',
    name: 'ELIXIR OF LEVITY',
    elixir: Cell.ElixirLevity,
    needs: [
      { cell: Cell.Water, min: 8 },
      { cell: Cell.Slime, min: 4 },
    ],
    page: 'Slime is lighter than it looks, and so, for a short while, is the person who drinks it. Mind the ceiling.',
  },
  {
    id: 'stone',
    name: 'ELIXIR OF STONE',
    elixir: Cell.ElixirStone,
    needs: [
      { cell: Cell.Oil, min: 6 },
      { cell: Cell.Sand, min: 6 },
    ],
    page: 'Lamp oil worked into sand until it sets like tar. The skin forgets how to be struck. The knees do not.',
  },
  {
    id: 'tea',
    name: 'STRONG TEA',
    elixir: Cell.ElixirSwift,
    needs: [
      { cell: Cell.Water, min: 8 },
      { cell: Cell.Leaf, min: 4 },
    ],
    page: 'Leaves, hot water and patience, which here means six seconds and a naked flame. The Works run on it. Pell maintains this is no coincidence.',
  },
  {
    id: 'glow',
    name: 'GLOWING DRAUGHT',
    elixir: Cell.ElixirTorch,
    needs: [
      { cell: Cell.Oil, min: 7 },
      { cell: Cell.Glowshroom, min: 4 },
    ],
    page: 'Lamp oil with a glowshroom steeped in it. A bright, steady, faintly judgemental light. Do not take it to bed.',
  },
  {
    id: 'salamander',
    name: 'SALAMANDER’S GALL',
    elixir: Cell.ElixirFire,
    needs: [
      { cell: Cell.Oil, min: 6 },
      { cell: Cell.Coal, min: 6 },
    ],
    page: 'Lamp oil and coal: the salamander’s own supper, taken as a tonic, for the Kiln. Fire is told it has no business with you. It listens, for a while.',
  },
  {
    id: 'frostproof',
    name: 'FROSTPROOF TONIC',
    elixir: Cell.ElixirFrost,
    needs: [
      { cell: Cell.Brine, min: 7 },
      { cell: Cell.Leaf, min: 5 },
    ],
    page: 'Leaves cured in brine, the way the Store has always kept everything it cannot afford to lose. The cold reaches you half as fast. It still arrives; it is merely less keen.',
  },
  {
    id: 'guttapercha',
    name: 'GUTTA-PERCHA TONIC',
    elixir: Cell.ElixirShock,
    needs: [
      { cell: Cell.Oil, min: 6 },
      { cell: Cell.Slime, min: 6 },
    ],
    page: 'Oil and slime: what the telegraph men coat their cables in, drunk. The current goes round you. The water still wants to; the tonic merely declines.',
  },
  {
    id: 'charcoal',
    name: 'CHARCOAL DRAUGHT',
    elixir: Cell.ElixirToxin,
    needs: [
      { cell: Cell.Water, min: 7 },
      { cell: Cell.Coal, min: 5 },
    ],
    page: 'Burnt wood in water: an old remedy for bad pies and worse pools. It tastes exactly as it sounds.',
  },
  {
    id: 'brimstone',
    name: 'BRIMSTONE TINCTURE',
    elixir: Cell.ElixirMight,
    needs: [
      { cell: Cell.Gunpowder, min: 6 },
      { cell: Cell.Oil, min: 6 },
    ],
    page: 'Gunpowder and lamp oil, simmered. Every spell lands harder. So, if you are careless, does the pot. The fire goes UNDER it.',
  },
  {
    id: 'heartwine',
    name: 'HEARTWINE',
    elixir: Cell.ElixirVampire,
    needs: [
      { cell: Cell.Slime, min: 6 },
      { cell: Cell.Leaf, min: 5 },
    ],
    page: 'Leaves left in slime until they remember being grapes. Claret in the cup, regret in the morning. Each creature you fell pays a little of itself back; the Guild called this theft, and then asked for the recipe.',
  },
  {
    id: 'hush',
    name: 'HUSH DRAUGHT',
    elixir: Cell.ElixirHush,
    needs: [
      { cell: Cell.Snow, min: 6 },
      { cell: Cell.Coal, min: 5 },
    ],
    page: 'Snow and soot, the two quietest things in the Works. Hood the lantern, drink, and the dark takes your side. It does not take it kindly, or for long.',
  },
];
