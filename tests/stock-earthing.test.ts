import { describe, expect, it } from 'vitest';
import { STOCK_STAGE, slabRuns } from '@/config/stockStage';
import { earthStockStage } from '@/arena/stockEarthing';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

describe('competitive stage earthing', () => {
  it('drains charge from the stage hull but leaves every other conductor live', () => {
    const w = new World(), main = STOCK_STAGE.main;
    const runs = slabRuns(main, main.y);
    for (let x = runs[0]; x <= runs[1]; x++) w.replaceCellAt(w.idx(x, main.y), Cell.Metal, 0);
    // A lightning strike lands on the deck, and a puddle beside the stage carries its own current.
    const deck = w.idx(runs[0] + 40, main.y), puddle = w.idx(main.x0 - 30, main.y - 1), loose = w.idx(main.x1 + 30, main.y + 20);
    w.replaceCellAt(puddle, Cell.Water, 0); w.replaceCellAt(loose, Cell.Metal, 0);
    w.setChargeAt(deck, 120); w.setChargeAt(puddle, 90); w.setChargeAt(loose, 90);
    expect(earthStockStage(w, STOCK_STAGE)).toBe(1);
    expect(w.charge[deck]).toBe(0);
    expect(w.activeCharges.has(deck)).toBe(false);
    expect(w.charge[puddle]).toBe(90);
    expect(w.charge[loose]).toBe(90);
  });
});
