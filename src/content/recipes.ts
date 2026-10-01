import { Cell } from '@/sim/CellType';

/**
 * The loose solids a flask can draw up besides liquids and the powders (sand, gunpowder, gold):
 * what a recipe may ask for that is not a liquid (a leaf, a lump of coal). One cell at a time off
 * the world, one cell at a time back out: the grid is the only inventory, so every reagent a
 * recipe names is either a liquid, one of these, or a loose powder the flask already carries.
 */
export const SIPHONABLE_SOLIDS: readonly Cell[] = [Cell.Snow, Cell.Coal, Cell.Ash, Cell.Leaf, Cell.Glowshroom];

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
      { cell: Cell.Water, min: 8 },
      { cell: Cell.Blood, min: 5 },
    ],
    page: 'Blood, thinned with water, and told it is still wanted. The Guild’s physicians used nothing else. They also used a great deal of it.',
  },
  {
    id: 'levity',
    name: 'ELIXIR OF LEVITY',
    elixir: Cell.ElixirLevity,
    needs: [
      { cell: Cell.Water, min: 9 },
      { cell: Cell.Slime, min: 4 },
    ],
    page: 'Slime is lighter than it looks, and so, for a short while, is the person who drinks it. Mind the ceiling.',
  },
  {
    id: 'stone',
    name: 'ELIXIR OF STONE',
    elixir: Cell.ElixirStone,
    needs: [
      { cell: Cell.Blood, min: 8 },
      { cell: Cell.Sand, min: 4 },
    ],
    page: 'Blood, hardened with sand. The skin forgets how to be struck. The knees do not.',
  },
  {
    id: 'tea',
    name: 'STRONG TEA',
    elixir: Cell.ElixirSwift,
    needs: [
      { cell: Cell.Water, min: 9 },
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
      { cell: Cell.Coal, min: 5 },
      { cell: Cell.Ash, min: 4 },
      { cell: Cell.Water, min: 4 },
    ],
    page: 'Coal and ash, thinned with water, for the Kiln. Fire is told it has no business with you. It listens, for a while.',
  },
  {
    id: 'frostproof',
    name: 'FROSTPROOF TONIC',
    elixir: Cell.ElixirFrost,
    needs: [
      { cell: Cell.Brine, min: 7 },
      { cell: Cell.Snow, min: 5 },
    ],
    page: 'Brine and snow, taken warm: the cold’s own medicine. Like cures like, and the Cold Store has never wanted for either.',
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
      { cell: Cell.Coal, min: 5 },
      { cell: Cell.Water, min: 8 },
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
      { cell: Cell.Blood, min: 7 },
      { cell: Cell.Leaf, min: 5 },
    ],
    page: 'Leaves steeped in blood where tea would have had water. Each creature you fell pays a little of itself back. The Guild called this theft, and then asked for the recipe.',
  },
  {
    id: 'hush',
    name: 'HUSH DRAUGHT',
    elixir: Cell.ElixirHush,
    needs: [
      { cell: Cell.Snow, min: 6 },
      { cell: Cell.Ash, min: 5 },
    ],
    page: 'Snow and soot, the two quietest things in the Works. Hood the lantern, drink, and the dark takes your side. It does not take it kindly, or for long.',
  },
];
