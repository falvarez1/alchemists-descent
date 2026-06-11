import { describe, expect, it } from 'vitest';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';
import {
  CELL_NAME,
  CELL_PALETTE,
  cellForColor,
  nearestPaletteCell,
  paletteAsGpl,
  paletteColor,
} from '@/sim/cellPalette';

/**
 * Asset-pipeline foundations. The palette is append-only ABI (like cell ids):
 * these tests are the lock — a new cell type without a palette entry, or an
 * entry edited/too close to an existing one, fails here.
 */

const manhattan = (a: number, b: number): number =>
  Math.abs(unpackR(a) - unpackR(b)) +
  Math.abs(unpackG(a) - unpackG(b)) +
  Math.abs(unpackB(a) - unpackB(b));

describe('cell palette ABI', () => {
  it('has exactly one entry and one name per cell type', () => {
    expect(CELL_PALETTE.length).toBe(CELL_COUNT);
    expect(CELL_NAME.length).toBe(CELL_COUNT);
  });

  it('keeps every pair of material colors >= 12 Manhattan apart', () => {
    for (let a = 1; a < CELL_COUNT; a++) {
      for (let b = a + 1; b < CELL_COUNT; b++) {
        expect(
          manhattan(CELL_PALETTE[a], CELL_PALETTE[b]),
          `${CELL_NAME[a]} vs ${CELL_NAME[b]}`,
        ).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('round-trips every material through exact lookup', () => {
    for (let t = 1; t < CELL_COUNT; t++) {
      expect(cellForColor(paletteColor(t))).toBe(t);
    }
  });

  it('treats Empty as transparency, never a color match', () => {
    expect(cellForColor(paletteColor(Cell.Empty))).toBeNull();
  });

  it('does not silently map opaque black', () => {
    expect(cellForColor(0x000000)).toBeNull();
  });

  it('snaps small color shifts back to the source material', () => {
    for (const t of [Cell.Sand, Cell.Wall, Cell.Gunpowder, Cell.Lava, Cell.Moss]) {
      const p = CELL_PALETTE[t];
      const shifted =
        ((Math.min(255, unpackR(p) + 3) << 16) |
          (Math.min(255, unpackG(p) + 2) << 8) |
          Math.min(255, unpackB(p) + 1)) >>>
        0;
      const near = nearestPaletteCell(shifted);
      expect(near.cell).toBe(t);
      expect(near.dist).toBeLessThanOrEqual(6);
    }
  });

  it('exports a .gpl swatch per material', () => {
    const gpl = paletteAsGpl();
    expect(gpl).toContain('GIMP Palette');
    expect(gpl.split('\n').filter((l) => l.includes('\t')).length).toBe(CELL_COUNT - 1);
    expect(gpl).toContain('Moss');
  });
});
