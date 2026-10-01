import { describe, expect, it } from 'vitest';

import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { makePickup } from '@/core/pickupDefs';
import { holdFixtureFootings } from '@/world/fixtureFooting';

/**
 * The golden key is let fall to its floor, but not down a shaft no body can follow (GEN 62: a key that
 * fell 94 rows down a five-wide slot, d2b seed 8): a drop longer than the cap is cut short by a shelf.
 */

function solidWorld(): World {
  const w = new World();
  for (let i = 0; i < w.types.length; i++) w.types[i] = Cell.Wall;
  return w;
}
function carveBox(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.types[w.idx(x, y)] = Cell.Empty;
}
const hold = (w: World, key: ReturnType<typeof makePickup>): void => {
  holdFixtureFootings(w, {
    bowls: [], cauldron: null, mechanisms: [], ownTriggers: [], runeVaults: [], pickups: [key], story: null,
    bodies: new Map(), spawn: { x: 200, y: 200 },
  });
};

describe('the golden key\'s fall', () => {
  it('lands on the floor of an ordinary drop', () => {
    const w = solidWorld();
    carveBox(w, 80, 300, 120, 326);
    const key = makePickup('key', 100, 310);
    hold(w, key);
    expect(Math.floor(key.y)).toBeGreaterThan(320);
    expect(w.types[w.idx(100, Math.floor(key.y) + 1)]).not.toBe(Cell.Empty);
  });

  it('is held on a shelf at its own cell when the shaft under it is deep', () => {
    const w = solidWorld();
    carveBox(w, 80, 300, 120, 340);
    carveBox(w, 98, 340, 102, 600); // a five-wide slot, 260 rows deep
    const key = makePickup('key', 100, 310);
    hold(w, key);
    expect(Math.floor(key.y), 'the key stays near where it was put').toBeLessThan(310 + 26);
    for (let dx = -2; dx <= 2; dx++) expect(w.types[w.idx(100 + dx, Math.floor(key.y) + 1)]).not.toBe(Cell.Empty);
  });
});
