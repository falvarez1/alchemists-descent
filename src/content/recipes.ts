import { Cell } from '@/sim/CellType';

export interface Recipe {
  /** Stable Grimoire/telemetry key. */
  id: string;
  /** Banner name, upper case to match the banner voice. */
  name: string;
  elixir: Cell;
  /** Basin histogram requirements: minimum cell counts that must all be met. */
  needs: Array<{ cell: Cell; min: number }>;
}

/*
 * Thresholds are sized to the STAMPED bowl: the generator builds a 7-wide
 * interior with 2-tall walls (cauldron.y is the bottom interior row), so the
 * bowl reliably holds ~14 cells before overflowing the rim. Requirements must
 * be pourable by a player with one 600-cell flask and an honest aim.
 */
export const RECIPES: Recipe[] = [
  {
    id: 'life',
    name: 'ELIXIR OF LIFE',
    elixir: Cell.ElixirLife,
    needs: [
      { cell: Cell.Water, min: 10 },
      { cell: Cell.Gold, min: 3 },
    ],
  },
  {
    id: 'levity',
    name: 'ELIXIR OF LEVITY',
    elixir: Cell.ElixirLevity,
    needs: [
      { cell: Cell.Water, min: 9 },
      { cell: Cell.Slime, min: 4 },
    ],
  },
  {
    id: 'stone',
    name: 'ELIXIR OF STONE',
    elixir: Cell.ElixirStone,
    needs: [
      { cell: Cell.Blood, min: 8 },
      { cell: Cell.Sand, min: 4 },
    ],
  },
];
