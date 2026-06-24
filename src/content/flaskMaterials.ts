import type { MaterialParams } from '@/core/types';
import { Cell } from '@/sim/CellType';

export interface FlaskMaterialOption {
  id: number;
  name: string;
}

export function flaskMaterialOptions(materials: Record<number, MaterialParams>): FlaskMaterialOption[] {
  return Object.entries(materials)
    .map(([id, def]) => ({ id: Number(id), name: def.name }))
    .filter((entry) => entry.id !== Cell.Empty && Number.isFinite(entry.id) && entry.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
