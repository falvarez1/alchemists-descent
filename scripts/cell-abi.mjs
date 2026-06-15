import { readFileSync } from 'node:fs';

export function loadCellAbi() {
  const source = readFileSync(new URL('../src/sim/CellType.ts', import.meta.url), 'utf8');
  const cellBlock = source.match(/export const Cell = \{([\s\S]*?)\} as const;/);
  const countMatch = source.match(/export const CELL_COUNT = (\d+);/);
  if (!cellBlock || !countMatch) throw new Error('Unable to read canonical Cell ABI from src/sim/CellType.ts');

  const cell = {};
  for (const match of cellBlock[1].matchAll(/^\s*(\w+):\s*(\d+),/gm)) {
    cell[match[1]] = Number(match[2]);
  }
  const count = Number(countMatch[1]);
  const maxId = Math.max(...Object.values(cell));
  if (maxId >= count) throw new Error(`Cell ABI mismatch: max id ${maxId} >= CELL_COUNT ${count}`);
  return cell;
}
