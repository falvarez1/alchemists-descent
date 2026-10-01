import { Cell } from '@/sim/CellType';

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
    page: 'Water for the body and blood for the argument. Drink it before it cools; it will not wait for you.',
  },
  {
    id: 'levity',
    name: 'ELIXIR OF LEVITY',
    elixir: Cell.ElixirLevity,
    needs: [
      { cell: Cell.Water, min: 9 },
      { cell: Cell.Slime, min: 4 },
    ],
    page: 'Slime is lighter than it looks, and so, briefly, is the person who drinks it.',
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
];
