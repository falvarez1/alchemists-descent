import { describe, expect, it } from 'vitest';

import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { bankFurnace, FURNACE_TOP } from '@/world/furnace';

/** THE FURNACE UNDER THE POT (world/furnace): a sealed pocket of embers in sound ground under a cauldron. */
function ground(): World {
  const w = new World(128, 96);
  for (let y = 41; y < 96; y++) for (let x = 0; x < 128; x++) w.types[w.idx(x, y)] = Cell.Stone;
  return w;
}
const C = { x: 60, y: 40 }; // bottom interior row 40; its stone base is row 41 (part of the ground here)

describe('bankFurnace', () => {
  it('banks 7 x 2 embers, three rows under the bowl, in solid ground', () => {
    const w = ground();
    expect(bankFurnace(w, C)).toBe(true);
    for (let y = C.y + FURNACE_TOP; y <= C.y + FURNACE_TOP + 1; y++) {
      for (let x = C.x - 3; x <= C.x + 3; x++) expect(w.types[w.idx(x, y)], `${x},${y}`).toBe(Cell.Ember);
      // sealed: a wall of ground either side, and the floor under it
      expect(w.types[w.idx(C.x - 4, y)]).toBe(Cell.Stone);
      expect(w.types[w.idx(C.x + 4, y)]).toBe(Cell.Stone);
    }
    expect(w.types[w.idx(C.x, C.y + FURNACE_TOP + 2)]).toBe(Cell.Stone);
    // the slab over it: the base and a row of ground
    expect(w.types[w.idx(C.x, C.y + 1)]).toBe(Cell.Stone);
    expect(w.types[w.idx(C.x, C.y + 2)]).toBe(Cell.Stone);
    let embers = 0;
    for (let i = 0; i < w.types.length; i++) if (w.types[i] === Cell.Ember) embers++;
    expect(embers).toBe(14);
  });

  it('banks as many rows as asked (the kettle on floor 1 is three)', () => {
    const w = ground();
    expect(bankFurnace(w, C, 3)).toBe(true);
    let embers = 0;
    for (let i = 0; i < w.types.length; i++) if (w.types[i] === Cell.Ember) embers++;
    expect(embers).toBe(21);
  });

  it('writes nothing where the ground is not sound all round: air, a pool, soft growth, a ledge', () => {
    const open = (set: (w: World) => void): boolean => {
      const w = ground();
      set(w);
      const before = w.types.slice();
      const ok = bankFurnace(w, C);
      if (!ok) expect(Buffer.from(w.types).equals(Buffer.from(before)), 'a refusal changes nothing').toBe(true);
      return ok;
    };
    // a cave under the cauldron
    expect(open((w) => { for (let x = 50; x < 70; x++) w.types[w.idx(x, 45)] = Cell.Empty; })).toBe(false);
    // water in the wall
    expect(open((w) => { w.types[w.idx(C.x + 4, C.y + 3)] = Cell.Water; })).toBe(false);
    // a moss crown is not a wall
    expect(open((w) => { w.types[w.idx(C.x - 4, C.y + 4)] = Cell.Moss; })).toBe(false);
    // a ledge: ground only a few rows deep
    expect(open((w) => { for (let y = 45; y < 96; y++) for (let x = 0; x < 128; x++) w.types[w.idx(x, y)] = Cell.Empty; })).toBe(false);
    // the bowl's own ground missing
    expect(open((w) => { w.types[w.idx(C.x, C.y + 2)] = Cell.Empty; })).toBe(false);
    // and solid ground is fine
    expect(open(() => undefined)).toBe(true);
  });

  it('heat is what the cauldron reads: an ember within six cells outside the bowl', () => {
    const w = ground();
    bankFurnace(w, C);
    // the bowl's window: x +- 6, rows y-2 .. y+4, outside the interior (game/Brewing HEAT_*)
    let hot = 0;
    for (let dy = -2; dy <= 4; dy++) for (let dx = -6; dx <= 6; dx++) {
      if (Math.abs(dx) <= 3 && dy >= -4 && dy <= 0) continue;
      if (w.types[w.idx(C.x + dx, C.y + dy)] === Cell.Ember) hot++;
    }
    expect(hot).toBe(14); // both pocket rows (dy +3 and +4) are inside the window
  });
});
