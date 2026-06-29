import { describe, expect, it } from 'vitest';

import { Cell, CELL_COUNT } from '@/sim/CellType';
import { MATERIAL_INFO } from '@/ui/materialInfo';

describe('material popover copy', () => {
  it('covers every append-only simulation cell id', () => {
    for (const id of Object.values(Cell)) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(CELL_COUNT);
      expect(MATERIAL_INFO[id]).toEqual(expect.any(String));
      expect(MATERIAL_INFO[id].length).toBeGreaterThan(0);
    }
  });
});
