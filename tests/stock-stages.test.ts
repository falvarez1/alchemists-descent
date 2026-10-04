import { describe, expect, it } from 'vitest';
import { WIDTH } from '@/config/constants';
import { STOCK_STAGES, STOCK_STAGE_ORDER, slabRuns, stockLampCells, type StockSlab } from '@/config/stockStage';

const inRuns = (slab: StockSlab, x: number, y: number): boolean => {
  const runs = slabRuns(slab, y);
  for (let k = 0; k < runs.length; k += 2) if (x >= runs[k] && x <= runs[k + 1]) return true;
  return false;
};

describe('stock stage proportions (docs/arena/platform-fighter/STAGES.md)', () => {
  for (const id of STOCK_STAGE_ORDER) {
    const stage = STOCK_STAGES[id];
    it(`${id}: a wide main platform at the concept's depth, raised platforms within reach`, () => {
      const { main } = stage;
      expect(main.x1 - main.x0 + 1).toBeGreaterThanOrEqual(420);
      expect(main.x1 - main.x0 + 1).toBeLessThanOrEqual(480);
      expect(Math.abs((main.x0 + main.x1) / 2 - 800)).toBeLessThanOrEqual(1);
      expect(main.y).toBeGreaterThanOrEqual(640);
      expect(main.y).toBeLessThanOrEqual(655);
      // "Concept proportions, wider platforms": the hull is about two fighters deep (a fighter stands 19 cells), not four.
      expect(main.depth).toBeLessThanOrEqual(46);
      for (const p of stage.platforms) {
        expect(main.y - p.y, `${id} platform at ${p.x0}`).toBeGreaterThan(0);
        expect(main.y - p.y, `${id} platform at ${p.x0}`).toBeLessThanOrEqual(80);
        // Overlapping or abutting the main's x-range, or centred over it: the CPU nav rises beside its lip from the main.
        expect(p.x1 >= main.x0 - 1 && p.x0 <= main.x1 + 1, `${id} platform at ${p.x0}`).toBe(true);
        expect(p.depth).toBeLessThanOrEqual(24);
      }
      for (const s of stage.spawns) {
        expect(s.y).toBe(main.y - 1);
        expect(inRuns(main, s.x, main.y)).toBe(true);
      }
    });

    it(`${id}: every lantern's glass hangs clear of the hull from a hull cell, lit in its own colour`, () => {
      const lamps = stockLampCells(stage), slabs = [stage.main, ...stage.platforms];
      expect(lamps.cells.length).toBeGreaterThan(0);
      for (let k = 0; k < lamps.cells.length; k++) {
        const gx = lamps.cells[k] % WIDTH, gy = Math.floor(lamps.cells[k] / WIDTH);
        const ax = lamps.anchors[k] % WIDTH, ay = Math.floor(lamps.anchors[k] / WIDTH);
        expect(slabs.some(s => inRuns(s, gx, gy)), `${id} glass ${gx},${gy} is not solid`).toBe(false);
        expect(slabs.some(s => inRuns(s, ax, ay)), `${id} glass ${gx},${gy} hangs from the hull`).toBe(true);
        expect(ax).toBe(gx);
        expect(ay).toBeLessThan(gy);
        expect(Math.max(lamps.rgb[k * 3], lamps.rgb[k * 3 + 1], lamps.rgb[k * 3 + 2])).toBeCloseTo(1, 5);
      }
    });
  }

  it('gives each stage its concept lamp colour', () => {
    const hues = (id: keyof typeof STOCK_STAGES) => {
      const { rgb, cells } = stockLampCells(STOCK_STAGES[id]);
      return Array.from({ length: cells.length }, (_, k) => [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]]);
    };
    // Foundry and Cistern: teal. The Kiln: furnace orange. The Gallery: amber lanterns and a violet bell jar.
    for (const [r, g, b] of [...hues('foundry'), ...hues('cistern')]) expect(g > r && b > r).toBe(true);
    for (const [r, g, b] of hues('kiln')) expect(r > g && g > b).toBe(true);
    const gallery = hues('gallery');
    expect(gallery.some(([r, g, b]) => r > g && g > b)).toBe(true);
    expect(gallery.some(([r, g, b]) => b > g && r > g)).toBe(true);
  });
});
